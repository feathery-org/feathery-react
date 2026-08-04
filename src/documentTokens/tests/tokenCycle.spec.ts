/**
 * Automatic propagation: the behaviour the whole feature exists for.
 *
 * A fake editor stands in for SyncFusion, behaving the way the runtime probe
 * measured: controls addressed by bookmark, writes replacing the bookmarked
 * text, undo actions wrapping a batch.
 */

import {
  bookmarkFor,
  ContentControlInfo,
  decodeTag,
  encodeTag
} from '../controls';
import { instanceKey, TokenSpec, valueKey } from '../plan';
import { attachTokenCycle } from '../tokenCycle';

const control = (spec: TokenSpec, value: string): ContentControlInfo => ({
  title: spec.id,
  tag: encodeTag(spec),
  value,
  canEdit: Boolean(spec.formula),
  canDelete: true
});

const fakeEditor = (controls: ContentControlInfo[]) => {
  const log: string[] = [];
  let selected: string | null = null;
  let caret: ContentControlInfo | undefined;
  const handlers: Record<string, Array<() => void>> = {};
  const domHandlers: Record<string, Array<() => void>> = {};

  const keyOf = (info: ContentControlInfo) =>
    valueKey(decodeTag(info.tag) as TokenSpec);
  const addressOf = (info: ContentControlInfo) =>
    instanceKey(decodeTag(info.tag) as TokenSpec);

  const editor: any = {
    log,
    controls,
    exportContentControlData: () => controls.map((c) => ({ ...c })),
    getBookmarks: () => controls.map((c) => bookmarkFor(addressOf(c))),
    selection: {
      getContentControlInfo: () => caret,
      selectBookmark: (name: string) => {
        selected = name;
        log.push(`select ${name}`);
      },
      get text() {
        return controls.find((c) => bookmarkFor(addressOf(c)) === selected)
          ?.value;
      }
    },
    editor: {
      insertText: (text: string) => {
        const target = controls.find(
          (c) => bookmarkFor(addressOf(c)) === selected
        );
        if (target) {
          log.push(`${keyOf(target)}=${text}`);
          target.value = text;
        }
      }
    },
    editorHistory: {
      beginUndoAction: () => log.push('undo:begin'),
      endUndoAction: () => log.push('undo:end')
    },
    // The canvas SyncFusion paints into, which is where dblclick is heard.
    documentHelper: {
      viewerContainer: {
        scrollTop: 0,
        scrollLeft: 0,
        addEventListener: (event: string, handler: () => void) => {
          domHandlers[event] = [...(domHandlers[event] ?? []), handler];
        },
        removeEventListener: (event: string, handler: () => void) => {
          domHandlers[event] = (domHandlers[event] ?? []).filter(
            (h) => h !== handler
          );
        }
      }
    },
    addEventListener: (event: string, handler: () => void) => {
      handlers[event] = [...(handlers[event] ?? []), handler];
    },
    removeEventListener: (event: string, handler: () => void) => {
      handlers[event] = (handlers[event] ?? []).filter((h) => h !== handler);
    }
  };

  return Object.assign(editor, {
    setCaret: (info?: ContentControlInfo) => {
      caret = info;
    },
    fire: (event: string, args?: any) =>
      (handlers[event] ?? []).forEach((h: any) => h(args)),
    fireDomDoubleClick: () =>
      (domHandlers.dblclick ?? []).forEach((h: any) => h()),
    valueOf: (key: string) =>
      controls.find((c) => keyOf(c) === key)?.value as string,
    listenerCount: (event: string) => (handlers[event] ?? []).length
  });
};

/** The prototype's invoice: two line items, subtotal, tax, total. */
const invoiceEditor = () =>
  fakeEditor([
    control(
      { id: 'qty', index: 0, source: 'qty', format: { kind: 'number' } },
      '10'
    ),
    control(
      {
        id: 'unit_cost',
        index: 0,
        source: 'unit_cost',
        format: { kind: 'currency' }
      },
      '$150.00'
    ),
    control(
      { id: 'qty', index: 1, source: 'qty', format: { kind: 'number' } },
      '2'
    ),
    control(
      {
        id: 'unit_cost',
        index: 1,
        source: 'unit_cost',
        format: { kind: 'currency' }
      },
      '$400.00'
    ),
    control(
      { id: 'tax_percent', source: 'tax_percent', format: { kind: 'percent' } },
      '8.25%'
    ),
    control(
      {
        id: 'item_total',
        index: 0,
        formula: 'qty * unit_cost',
        format: { kind: 'currency' }
      },
      '$1,500.00'
    ),
    control(
      {
        id: 'item_total',
        index: 1,
        formula: 'qty * unit_cost',
        format: { kind: 'currency' }
      },
      '$800.00'
    ),
    control(
      {
        id: 'subtotal',
        formula: 'SUM(item_total)',
        format: { kind: 'currency' }
      },
      '$2,300.00'
    ),
    control(
      {
        id: 'total',
        formula: 'subtotal + ROUND(subtotal * tax_percent / 100, 2)',
        format: { kind: 'currency' }
      },
      '$2,489.75'
    )
  ]);

describe('attachTokenCycle — propagation', () => {
  it('reads the document into a graph on attach', () => {
    const editor = invoiceEditor();
    const state = attachTokenCycle(editor).getState();

    expect(state.specs).toHaveLength(9);
    expect(state.values.get('qty__0')).toBe(10);
    expect(state.values.get('unit_cost__0')).toBe(150);
    expect(state.errors.size).toBe(0);
  });

  it('writes nothing on attach when the document is already consistent', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor);
    expect(editor.log).toEqual([]);
  });

  it('propagates one edit through the whole chain', () => {
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor);

    cycle.setTokenValue('qty__0', 20);

    expect(editor.valueOf('item_total__0')).toBe('$3,000.00');
    expect(editor.valueOf('subtotal')).toBe('$3,800.00');
    expect(editor.valueOf('total')).toBe('$4,113.50');
  });

  it('leaves untouched branches alone', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor).setTokenValue('qty__0', 20);

    expect(
      editor.log.filter((l: string) => l.startsWith('item_total_2='))
    ).toEqual([]);
    expect(editor.valueOf('item_total__1')).toBe('$800.00');
  });

  it('reformats the edited token itself', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor).setTokenValue('unit_cost__0', '175');

    expect(editor.valueOf('unit_cost__0')).toBe('$175.00');
  });

  it('accepts a typed value with currency punctuation', () => {
    const editor = invoiceEditor();
    const state = attachTokenCycle(editor).setTokenValue(
      'unit_cost__0',
      '$1,750'
    );

    expect(state.values.get('unit_cost__0')).toBe(1750);
    expect(editor.valueOf('item_total__0')).toBe('$17,500.00');
  });

  it('ignores an unparseable value rather than zeroing the token', () => {
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor);

    cycle.setTokenValue('qty__0', 'not a number');

    expect(editor.valueOf('qty__0')).toBe('10');
    expect(editor.valueOf('item_total__0')).toBe('$1,500.00');
  });

  it('does nothing when the value has not actually changed', () => {
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor);
    editor.log.length = 0;

    cycle.setTokenValue('qty__0', 10);

    expect(editor.log).toEqual([]);
  });

  it('groups an edit and everything it moved into one undo action', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor).setTokenValue('qty__0', 20);

    expect(editor.log.filter((l: string) => l === 'undo:begin')).toHaveLength(
      1
    );
    expect(editor.log[0]).toBe('undo:begin');
    expect(editor.log[editor.log.length - 1]).toBe('undo:end');
  });
});

describe('attachTokenCycle — undo propagates to the field', () => {
  /** A field store that records writes, standing in for the form engine. */
  const store = (initial: Record<string, any> = {}) => {
    const values: Record<string, any> = { ...initial };
    return {
      values,
      read: (spec: TokenSpec) =>
        spec.source ? values[spec.source] : undefined,
      write: (updates: Array<{ spec: TokenSpec; value: any }>) => {
        for (const { spec, value } of updates) {
          if (spec.source) values[spec.source] = value;
        }
      }
    };
  };

  const feeEditor = () =>
    fakeEditor([
      control(
        { id: 'fee', source: 'fee', format: { kind: 'currency' } },
        '$150.00'
      ),
      control(
        { id: 'double', formula: 'fee * 2', format: { kind: 'currency' } },
        '$300.00'
      )
    ]);

  it('moves the field to whatever the undo restored', async () => {
    const editor = feeEditor();
    const fields = store({ fee: 150 });
    const cycle = attachTokenCycle(editor, { fields });

    cycle.setTokenValue('fee', 175);
    expect(fields.values.fee).toBe(175);

    // Syncfusion restores the text and reports the replay.
    editor.controls[0].value = '$150.00';
    editor.editorHistory.isUndoing = true;
    editor.fire('contentChange');
    editor.editorHistory.isUndoing = false;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fields.values.fee).toBe(150);
    expect(editor.valueOf('double')).toBe('$300.00');
  });

  it('does not spring back on the next reconcile', async () => {
    const editor = feeEditor();
    const fields = store({ fee: 150 });
    const cycle = attachTokenCycle(editor, { fields });

    cycle.setTokenValue('fee', 175);
    editor.controls[0].value = '$150.00';
    editor.editorHistory.isUndoing = true;
    editor.fire('contentChange');
    editor.editorHistory.isUndoing = false;
    await new Promise((resolve) => setTimeout(resolve, 0));

    cycle.reconcile();
    cycle.reconcile();

    expect(editor.valueOf('fee')).toBe('$150.00');
    expect(fields.values.fee).toBe(150);
  });

  it('ignores a content change that is not a replay', async () => {
    const editor = feeEditor();
    const fields = store({ fee: 150 });
    attachTokenCycle(editor, { fields });

    // Someone typed; the blur path owns that, not this.
    editor.controls[0].value = '$999.00';
    editor.fire('contentChange');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fields.values.fee).toBe(150);
  });

  it('coalesces the several events one undo emits', async () => {
    const editor = feeEditor();
    const fields = store({ fee: 150 });
    const writes: number[] = [];
    const counting = {
      ...fields,
      write: (updates: Array<{ spec: TokenSpec; value: any }>) => {
        writes.push(updates.length);
        fields.write(updates);
      }
    };
    const cycle = attachTokenCycle(editor, { fields: counting });

    cycle.setTokenValue('fee', 175);
    writes.length = 0;
    editor.controls[0].value = '$150.00';
    editor.editorHistory.isUndoing = true;
    editor.fire('contentChange');
    editor.fire('contentChange');
    editor.fire('contentChange');
    editor.editorHistory.isUndoing = false;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(writes).toEqual([1]);
  });

  it('takes a redo back to the redone value too', async () => {
    const editor = feeEditor();
    const fields = store({ fee: 150 });
    const cycle = attachTokenCycle(editor, { fields });

    cycle.setTokenValue('fee', 175);
    editor.controls[0].value = '$150.00';
    editor.editorHistory.isUndoing = true;
    editor.fire('contentChange');
    editor.editorHistory.isUndoing = false;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fields.values.fee).toBe(150);

    editor.controls[0].value = '$175.00';
    editor.editorHistory.isRedoing = true;
    editor.fire('contentChange');
    editor.editorHistory.isRedoing = false;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fields.values.fee).toBe(175);
  });

  it('never adopts a computed token, which is derived rather than entered', async () => {
    const editor = feeEditor();
    const fields = store({ fee: 150 });
    attachTokenCycle(editor, { fields });

    // A stale derived value in the document must not become an input.
    editor.controls[1].value = '$999.00';
    editor.editorHistory.isUndoing = true;
    editor.fire('contentChange');
    editor.editorHistory.isUndoing = false;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(editor.valueOf('double')).toBe('$300.00');
  });
});

describe('attachTokenCycle — one undo step per edit', () => {
  const moveCaret = (editor: any, into?: ContentControlInfo) => {
    editor.setCaret(into);
    editor.fire('selectionChange');
  };

  const type = (editor: any, text: string) => {
    editor.fire('keyDown', {
      key: text[0],
      event: { preventDefault: () => {} }
    });
    editor.controls[1].value = text;
  };

  it('wraps the typing and the recalculation in a single action', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor);
    editor.log.length = 0;

    moveCaret(editor, editor.controls[1]); // caret enters unit_cost
    type(editor, '175'); // the first keystroke opens the step
    moveCaret(editor, undefined); // caret leaves, committing

    // One action covering the commit and every dependent it moved, so Ctrl+Z
    // takes back the digits and the numbers together.
    expect(editor.log.filter((l: string) => l === 'undo:begin')).toHaveLength(
      1
    );
    expect(editor.log.filter((l: string) => l === 'undo:end')).toHaveLength(1);
    expect(editor.log[0]).toBe('undo:begin');
    expect(editor.log[editor.log.length - 1]).toBe('undo:end');
    expect(editor.valueOf('unit_cost__0')).toBe('$175.00');
    expect(editor.valueOf('item_total__0')).toBe('$1,750.00');
  });

  it('creates no undo entry for a caret move that changes nothing', () => {
    // Opening on arrival left an empty entry behind for every pass through a
    // token, which buried real edits and threw away the redo path.
    const editor = invoiceEditor();
    attachTokenCycle(editor);
    editor.log.length = 0;

    moveCaret(editor, editor.controls[1]);
    moveCaret(editor, editor.controls[0]);
    moveCaret(editor, undefined);

    expect(editor.log.filter((l: string) => l === 'undo:begin')).toEqual([]);
  });

  it('opens the action on the first keystroke, not on arrival', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor);
    editor.log.length = 0;

    moveCaret(editor, editor.controls[1]);
    expect(editor.log).toEqual([]);

    editor.fire('keyDown', { key: '1', event: { preventDefault: () => {} } });
    expect(editor.log).toEqual(['undo:begin']);
  });

  it('does not open on a key that only moves the caret', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor);
    moveCaret(editor, editor.controls[1]);
    editor.log.length = 0;

    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab']) {
      editor.fire('keyDown', { key, event: { preventDefault: () => {} } });
    }

    expect(editor.log).toEqual([]);
  });

  it('starts a fresh step when moving straight to another token', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor);
    editor.log.length = 0;

    moveCaret(editor, editor.controls[1]);
    type(editor, '175');
    moveCaret(editor, editor.controls[0]); // straight into qty

    // The edit closed on the way out; the next opens when it is typed.
    expect(editor.log.filter((l: string) => l === 'undo:begin')).toHaveLength(
      1
    );
    expect(editor.log.filter((l: string) => l === 'undo:end')).toHaveLength(1);
  });

  it('closes the action on Enter', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor);
    moveCaret(editor, editor.controls[1]);
    editor.log.length = 0;

    type(editor, '175');
    editor.fire('keyDown', { key: 'Enter' });

    expect(editor.log.filter((l: string) => l === 'undo:end')).toHaveLength(1);
  });

  it('closes the action on Escape', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor);
    moveCaret(editor, editor.controls[1]);
    type(editor, '175');
    editor.log.length = 0;

    editor.fire('keyDown', { key: 'Escape' });

    expect(editor.log.filter((l: string) => l === 'undo:end')).toHaveLength(1);
  });

  it('never leaves an action open on detach', () => {
    // A stray open action would swallow every later edit into one step.
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor);
    moveCaret(editor, editor.controls[1]);
    type(editor, '175');
    editor.log.length = 0;

    cycle.detach();

    expect(editor.log).toEqual(['undo:end']);
  });

  it('opens no action while history is replaying', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor);
    editor.editorHistory.isUndoing = true;
    editor.log.length = 0;

    moveCaret(editor, editor.controls[1]);
    editor.fire('keyDown', { key: '1', event: { preventDefault: () => {} } });

    expect(editor.log).toEqual([]);
  });
});

describe('attachTokenCycle — a control never shows a placeholder', () => {
  const PLACEHOLDER = 'Click here or tap to insert text';

  it('overwrites a placeholder even in the token being edited', () => {
    // Normally the focused token is left alone so the caret is not yanked, but
    // Syncfusion's placeholder is not a value and must never stand.
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor);
    editor.setCaret(editor.controls[1]); // unit_cost
    editor.fire('selectionChange');

    editor.controls[1].value = PLACEHOLDER;
    cycle.reconcile();

    expect(editor.valueOf('unit_cost__0')).toBe('$150.00');
  });

  it('still leaves a genuinely empty value alone until blur', () => {
    // Clearing a number on the way to typing a new one must survive.
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor);
    editor.setCaret(editor.controls[1]);
    editor.fire('selectionChange');

    editor.controls[1].value = '';
    cycle.reconcile();

    expect(editor.valueOf('unit_cost__0')).toBe('');
  });

  it('shows the empty rendering when a token has no value at all', () => {
    const editor = fakeEditor([
      control(
        { id: 'fee', source: 'fee', format: { kind: 'currency' } },
        PLACEHOLDER
      ),
      control(
        { id: 'note', source: 'note', format: { kind: 'text' } },
        PLACEHOLDER
      )
    ]);
    attachTokenCycle(editor);

    expect(editor.valueOf('fee')).toBe('$0.00');
    expect(editor.valueOf('note')).toBe('');
  });

  it('never adopts a placeholder as a field value', () => {
    const editor = fakeEditor([
      control(
        { id: 'fee', source: 'fee', format: { kind: 'currency' } },
        PLACEHOLDER
      )
    ]);
    const state = attachTokenCycle(editor).getState();

    expect(state.values.get('fee')).toBeUndefined();
  });
});

describe('attachTokenCycle — while history is replaying', () => {
  it('writes nothing during an undo', () => {
    // Writing into an undo pushes new history entries, so the stack never
    // drains, and the write lands against stale positions and compounds text.
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor);
    editor.editorHistory.isUndoing = true;
    editor.log.length = 0;

    // Whatever the document now shows, reconciling must not touch it.
    editor.controls[1].value = '7';
    cycle.reconcile();

    expect(editor.log).toEqual([]);
    expect(editor.valueOf('unit_cost__0')).toBe('7');
  });

  it('writes nothing during a redo', () => {
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor);
    editor.editorHistory.isRedoing = true;
    editor.log.length = 0;

    editor.controls[1].value = '7';
    cycle.reconcile();

    expect(editor.log).toEqual([]);
  });

  it('does not read restored text in as a user edit', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor);
    editor.setCaret(editor.controls[1]);
    editor.fire('selectionChange');

    // An undo moves the caret and rewrites the text; neither is someone typing.
    editor.editorHistory.isUndoing = true;
    editor.controls[1].value = 'restored junk';
    editor.setCaret(editor.controls[0]);
    editor.fire('selectionChange');

    expect(editor.valueOf('item_total__0')).toBe('$1,500.00');
  });

  it('resumes writing once the replay is over', () => {
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor);
    editor.editorHistory.isUndoing = true;
    cycle.reconcile();

    editor.editorHistory.isUndoing = false;
    editor.controls[1].value = '7';
    cycle.reconcile();

    expect(editor.valueOf('unit_cost__0')).toBe('$150.00');
  });
});

describe('attachTokenCycle — committing on blur', () => {
  /** Move the caret into a control, then away, the way a user would. */
  const blurFrom = (editor: any, into?: ContentControlInfo) => {
    editor.setCaret(into);
    editor.fire('selectionChange');
  };

  it('does not rewrite the document while the caret is still inside', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor);

    blurFrom(editor, editor.controls[0]); // caret enters qty_1
    editor.controls[0].value = '20';
    editor.fire('selectionChange'); // still inside qty_1

    expect(editor.valueOf('item_total__0')).toBe('$1,500.00');
  });

  it('commits and propagates once the caret leaves', () => {
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor);

    blurFrom(editor, editor.controls[0]);
    editor.controls[0].value = '20';
    blurFrom(editor, undefined); // caret moves out into prose

    expect(cycle.getState().values.get('qty__0')).toBe(20);
    expect(editor.valueOf('item_total__0')).toBe('$3,000.00');
    expect(editor.valueOf('subtotal')).toBe('$3,800.00');
  });

  it('commits when the caret moves straight into another token', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor);

    blurFrom(editor, editor.controls[0]);
    editor.controls[0].value = '20';
    blurFrom(editor, editor.controls[2]); // qty_1 -> qty_2, no prose between

    expect(editor.valueOf('item_total__0')).toBe('$3,000.00');
  });

  it('restores formatting on blur even when the number is unchanged', () => {
    // Retyping `$150.00` as `150` parses to the same value, so nothing
    // propagates — but the token must still get its currency shape back.
    const editor = invoiceEditor();
    attachTokenCycle(editor);

    blurFrom(editor, editor.controls[1]); // unit_cost_1
    editor.controls[1].value = '150.00'; // the user deleted just the $
    blurFrom(editor, undefined);

    expect(editor.valueOf('unit_cost__0')).toBe('$150.00');
  });

  it('reformats a typed value into its declared format', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor);

    blurFrom(editor, editor.controls[1]);
    editor.controls[1].value = '1750';
    blurFrom(editor, undefined);

    expect(editor.valueOf('unit_cost__0')).toBe('$1,750.00');
    expect(editor.valueOf('item_total__0')).toBe('$17,500.00');
  });

  it('ignores its own writes', () => {
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor);

    cycle.setTokenValue('qty__0', 20);
    const afterWrite = editor.valueOf('subtotal');
    editor.fire('selectionChange');

    expect(editor.valueOf('subtotal')).toBe(afterWrite);
  });

  it('ignores caret movement through ordinary prose', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor);
    editor.log.length = 0;

    blurFrom(editor, undefined);
    blurFrom(editor, undefined);

    expect(editor.log).toEqual([]);
  });
});

describe('attachTokenCycle — state and lifecycle', () => {
  it('surfaces validation failures without blocking the edit', () => {
    const editor = fakeEditor([
      control(
        {
          id: 'qty',
          index: 0,
          source: 'qty',
          format: { kind: 'number' },
          validate: { min: 1 }
        },
        '10'
      )
    ]);
    const state = attachTokenCycle(editor).setTokenValue('qty__0', 0);

    expect(state.invalid.get('qty__0')).toMatch(/at least 1/);
    expect(editor.valueOf('qty__0')).toBe('0');
  });

  it('attributes a broken formula without losing the rest', () => {
    const editor = fakeEditor([
      control({ id: 'x', source: 'x', format: { kind: 'number' } }, '4'),
      control({ id: 'broken', formula: '(((', format: { kind: 'number' } }, ''),
      control({ id: 'ok', formula: 'x * 2', format: { kind: 'number' } }, '8')
    ]);
    const state = attachTokenCycle(editor).setTokenValue('x', 5);

    expect(state.errors.has('broken')).toBe(true);
    expect(editor.valueOf('ok')).toBe('10');
  });

  it('notifies subscribers when values move', () => {
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor);
    const seen: number[] = [];
    cycle.subscribe((state) =>
      seen.push(state.values.get('subtotal') as number)
    );

    cycle.setTokenValue('qty__0', 20);

    expect(seen).toContain(3800);
  });

  it('rebuilds the graph on refresh so a new line item is picked up', () => {
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor);

    editor.controls.push(
      control(
        { id: 'qty', index: 2, source: 'qty', format: { kind: 'number' } },
        '1'
      ),
      control(
        {
          id: 'unit_cost',
          index: 2,
          source: 'unit_cost',
          format: { kind: 'currency' }
        },
        '$50.00'
      ),
      control(
        {
          id: 'item_total',
          index: 2,
          formula: 'qty * unit_cost',
          format: { kind: 'currency' }
        },
        '$50.00'
      )
    );
    cycle.refresh();

    // SUM(item_total) picked up the new row with no formula edit anywhere.
    expect(editor.valueOf('subtotal')).toBe('$2,350.00');
  });

  it('picks up tokens when the document finishes loading', () => {
    // The editor is ready before its .docx is — attaching finds nothing.
    const editor = fakeEditor([]);
    const cycle = attachTokenCycle(editor);
    expect(cycle.getState().specs).toHaveLength(0);

    editor.controls.push(
      control({ id: 'qty', source: 'qty', format: { kind: 'number' } }, '4'),
      control(
        { id: 'double', formula: 'qty * 2', format: { kind: 'number' } },
        '0'
      )
    );
    editor.fire('documentChange');

    expect(cycle.getState().specs).toHaveLength(2);
    // A stale value in the freshly loaded document is corrected immediately.
    expect(editor.valueOf('double')).toBe('8');
  });

  it('rebuilds rather than merges when a different document loads', () => {
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor);

    editor.controls.length = 0;
    editor.controls.push(control({ id: 'other', source: 'other' }, '1'));
    editor.fire('documentChange');

    expect(cycle.getState().specs.map((s) => s.id)).toEqual(['other']);
  });

  it('commits the focused token on Enter', () => {
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor);

    editor.setCaret(editor.controls[0]);
    editor.fire('selectionChange');
    editor.controls[0].value = '20';
    editor.fire('keyDown', { key: 'Enter' });

    expect(cycle.getState().values.get('qty__0')).toBe(20);
    expect(editor.valueOf('item_total__0')).toBe('$3,000.00');
  });

  it('restores the last committed value on Escape', () => {
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor);

    editor.setCaret(editor.controls[0]);
    editor.fire('selectionChange');
    editor.controls[0].value = '999';
    editor.fire('keyDown', { key: 'Escape' });

    expect(editor.valueOf('qty__0')).toBe('10');
    expect(cycle.getState().values.get('qty__0')).toBe(10);
    expect(editor.valueOf('item_total__0')).toBe('$1,500.00');
  });

  it('refuses a letter typed into a number token', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor);
    editor.setCaret(editor.controls[0]); // qty_1, a number
    editor.fire('selectionChange');

    const args: any = { key: 'a', event: { preventDefault: jest.fn() } };
    editor.fire('keyDown', args);

    expect(args.event.preventDefault).toHaveBeenCalled();
    expect(args.isHandled).toBe(true);
  });

  it('lets a value be cleared', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor);
    editor.setCaret(editor.controls[1]); // unit_cost, still holding $150.00
    editor.fire('selectionChange');

    const args: any = {
      key: 'Backspace',
      event: { preventDefault: jest.fn() }
    };
    editor.fire('keyDown', args);

    expect(args.event.preventDefault).not.toHaveBeenCalled();
  });

  it('swallows Backspace once a token is already empty', () => {
    // Deleting THROUGH an empty value consumes the content control's markers,
    // and a destroyed control cannot be rebuilt.
    const editor = invoiceEditor();
    attachTokenCycle(editor);
    editor.controls[1].value = '';
    editor.setCaret(editor.controls[1]);
    editor.fire('selectionChange');

    const args: any = {
      key: 'Backspace',
      event: { preventDefault: jest.fn() }
    };
    editor.fire('keyDown', args);

    expect(args.event.preventDefault).toHaveBeenCalled();
    expect(args.isHandled).toBe(true);
  });

  it('swallows Delete once a token is already empty', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor);
    editor.controls[1].value = '';
    editor.setCaret(editor.controls[1]);
    editor.fire('selectionChange');

    const args: any = { key: 'Delete', event: { preventDefault: jest.fn() } };
    editor.fire('keyDown', args);

    expect(args.event.preventDefault).toHaveBeenCalled();
  });

  it('allows digits and currency punctuation', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor);
    editor.setCaret(editor.controls[1]); // unit_cost, currency
    editor.fire('selectionChange');

    for (const key of ['5', '.', ',', '$', '-']) {
      const args: any = { key, event: { preventDefault: jest.fn() } };
      editor.fire('keyDown', args);
      expect(args.event.preventDefault).not.toHaveBeenCalled();
    }
  });

  it('scrubs non-numeric text on blur when nothing was ever committed', () => {
    const editor = fakeEditor([
      control({ id: 'fee', source: 'fee', format: { kind: 'currency' } }, '')
    ]);
    attachTokenCycle(editor);

    editor.setCaret(editor.controls[0]);
    editor.fire('selectionChange');
    editor.controls[0].value = 'abc';
    editor.setCaret(undefined);
    editor.fire('selectionChange');

    expect(editor.valueOf('fee')).toBe('$0.00');
  });

  it('ignores Enter and Escape outside a token', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor);
    editor.setCaret(undefined);
    editor.log.length = 0;

    editor.fire('keyDown', { key: 'Enter' });
    editor.fire('keyDown', { key: 'Escape' });

    expect(editor.log).toEqual([]);
  });

  it('carries a text token without forcing it through the numeric path', () => {
    const editor = fakeEditor([
      control(
        { id: 'client', source: 'client', format: { kind: 'text' } },
        'Acme'
      )
    ]);
    const cycle = attachTokenCycle(editor);

    expect(cycle.getState().texts.get('client')).toBe('Acme');
    expect(cycle.getState().values.has('client')).toBe(false);
  });

  it('never blanks a text token on blur', () => {
    // The bug this guards: parseValue returns null for prose, so the numeric
    // path would render undefined as '' and wipe the token.
    const editor = fakeEditor([
      control(
        { id: 'client', source: 'client', format: { kind: 'text' } },
        'Northwind Supply Co.'
      )
    ]);
    attachTokenCycle(editor);

    editor.setCaret(editor.controls[0]);
    editor.fire('selectionChange');
    editor.controls[0].value = 'Northwind Supply Company';
    editor.setCaret(undefined);
    editor.fire('selectionChange');

    expect(editor.valueOf('client')).toBe('Northwind Supply Company');
  });

  it('writes a text token set from outside the document', () => {
    const editor = fakeEditor([
      control(
        { id: 'client', source: 'client', format: { kind: 'text' } },
        'Acme'
      )
    ]);
    const cycle = attachTokenCycle(editor);

    cycle.setTokenValue('client', 'Globex');

    expect(editor.valueOf('client')).toBe('Globex');
    expect(cycle.getState().texts.get('client')).toBe('Globex');
  });

  it('accepts letters typed into a text token', () => {
    const editor = fakeEditor([
      control(
        { id: 'client', source: 'client', format: { kind: 'text' } },
        'Acme'
      )
    ]);
    attachTokenCycle(editor);
    editor.setCaret(editor.controls[0]);
    editor.fire('selectionChange');

    const args: any = { key: 'z', event: { preventDefault: jest.fn() } };
    editor.fire('keyDown', args);

    expect(args.event.preventDefault).not.toHaveBeenCalled();
  });

  it('stays inert against an editor with no content-control API', () => {
    // Older SyncFusion, or an instance still initialising. Tokens are a
    // feature of the document, never a requirement of the editor — failing to
    // read them must not take the editor down.
    const bare: any = { selection: {}, editor: {} };

    expect(() => attachTokenCycle(bare)).not.toThrow();
    const cycle = attachTokenCycle(bare);
    expect(cycle.getState().specs).toEqual([]);
    expect(() => cycle.setTokenValue('qty__0', 5)).not.toThrow();
    expect(() => cycle.detach()).not.toThrow();
  });

  it('settles dependents when a value arrives from outside', () => {
    // A form field changing sets an input whose own value may already match,
    // so recompute is what keeps the derived values honest.
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor);

    // Simulate the graph going stale: a derived control edited out of band.
    editor.controls[7].value = '$0.00'; // subtotal
    cycle.reconcile();

    expect(editor.valueOf('subtotal')).toBe('$2,300.00');
  });

  it('replaces the placeholder undo can leave behind', () => {
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor);

    // Undo emptied a control: SyncFusion shows its placeholder.
    editor.controls[0].value = 'Click here or tap to insert text';
    cycle.reconcile();

    expect(editor.valueOf('qty__0')).toBe('10');
  });

  it('defaults a number token to zero and a text token to empty', () => {
    const editor = fakeEditor([
      control({ id: 'fee', source: 'fee', format: { kind: 'currency' } }, ''),
      control({ id: 'note', source: 'note', format: { kind: 'text' } }, '')
    ]);
    const cycle = attachTokenCycle(editor);

    editor.controls[0].value = 'Click here or tap to insert text';
    editor.controls[1].value = 'Click here or tap to insert text';
    cycle.reconcile();

    expect(editor.valueOf('fee')).toBe('$0.00');
    expect(editor.valueOf('note')).toBe('');
  });

  it('updates every appearance of a token, not only the edited one', () => {
    // Two controls carrying the same value: editing one must move both.
    const first = control(
      { id: 'client', source: 'client', format: { kind: 'text' } },
      'Acme'
    );
    const second = {
      ...control(
        { id: 'client', source: 'client', format: { kind: 'text' } },
        'Acme'
      ),
      tag: encodeTag({
        id: 'client',
        source: 'client',
        format: { kind: 'text' },
        instance: 'client#1'
      })
    };
    const editor = fakeEditor([first, second]);
    const cycle = attachTokenCycle(editor);

    cycle.setTokenValue('client', 'Globex');

    expect(editor.controls[0].value).toBe('Globex');
    expect(editor.controls[1].value).toBe('Globex');
  });

  it('selects the value, not the control, on double click', async () => {
    // SyncFusion selects the whole control, which is locked against deletion,
    // so the selection cannot be typed over.
    const editor = invoiceEditor();
    attachTokenCycle(editor);
    editor.setCaret(editor.controls[0]);
    editor.fire('selectionChange');
    editor.log.length = 0;

    editor.fireDomDoubleClick();
    // The reselect is deferred a task so it lands after SyncFusion's own.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      editor.log.some((l: string) => l.startsWith('select ftk_qty__0'))
    ).toBe(true);
  });

  it('reads a field-backed token from the form, not from itself', () => {
    // The form owns the value: the document follows it, never the reverse.
    const store: Record<string, any> = { qty: [4, 0, 0] };
    const fields = {
      read: (spec: TokenSpec) =>
        Array.isArray(store[spec.source as string])
          ? store[spec.source as string][spec.index ?? 0]
          : store[spec.source as string],
      write: (updates: Array<{ spec: TokenSpec; value: any }>) =>
        updates.forEach(({ spec, value }) => {
          const rows = store[spec.source as string] ?? [];
          rows[spec.index ?? 0] = value;
          store[spec.source as string] = rows;
        })
    };
    const editor = fakeEditor([
      control(
        { id: 'qty', index: 0, source: 'qty', format: { kind: 'number' } },
        '99'
      ),
      control(
        {
          id: 'double',
          index: 0,
          formula: 'qty * 2',
          format: { kind: 'number' }
        },
        '0'
      )
    ]);

    const cycle = attachTokenCycle(editor, { fields });

    // The document said 99; the field says 4, and the field wins.
    expect(cycle.getState().values.get('qty__0')).toBe(4);
    expect(editor.valueOf('qty__0')).toBe('4');
    expect(editor.valueOf('double__0')).toBe('8');
  });

  it('writes a token edit into the form field that owns it', () => {
    const store: Record<string, any> = { fee: 10 };
    const fields = {
      read: (spec: TokenSpec) => store[spec.source as string],
      write: (updates: Array<{ spec: TokenSpec; value: any }>) =>
        updates.forEach(({ spec, value }) => {
          store[spec.source as string] = value;
        })
    };
    const editor = fakeEditor([
      control(
        { id: 'fee', source: 'fee', format: { kind: 'currency' } },
        '$10.00'
      )
    ]);
    const cycle = attachTokenCycle(editor, { fields });

    cycle.setTokenValue('fee', 25);

    expect(store.fee).toBe(25);
    expect(editor.valueOf('fee')).toBe('$25.00');
  });

  it('adopts the value the server rendered when the field has none', () => {
    // Opening an envelope must never blank it just because the form has not
    // been given that field's value.
    const store: Record<string, any> = {};
    const fields = {
      read: (spec: TokenSpec) => store[spec.source as string],
      write: (updates: Array<{ spec: TokenSpec; value: any }>) =>
        updates.forEach(({ spec, value }) => {
          store[spec.source as string] = value;
        })
    };
    const editor = fakeEditor([
      control(
        { id: 'fee', source: 'fee', format: { kind: 'currency' } },
        '$42.00'
      )
    ]);

    attachTokenCycle(editor, { fields });

    expect(store.fee).toBe(42);
    expect(editor.valueOf('fee')).toBe('$42.00');
  });

  it('does not judge a token mid-edit', () => {
    const editor = fakeEditor([
      control(
        {
          id: 'qty',
          index: 0,
          source: 'qty',
          format: { kind: 'number' },
          validate: { min: 1 }
        },
        '5'
      )
    ]);
    const cycle = attachTokenCycle(editor);

    // Caret inside: deleting on the way to a new number must not flash red.
    editor.setCaret(editor.controls[0]);
    editor.fire('selectionChange');
    cycle.setTokenValue('qty__0', 0);

    expect(cycle.getState().invalid.has('qty__0')).toBe(false);
  });

  it('stops listening on detach', () => {
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor);
    expect(editor.listenerCount('selectionChange')).toBe(1);
    expect(editor.listenerCount('documentChange')).toBe(1);

    cycle.detach();
    expect(editor.listenerCount('selectionChange')).toBe(0);
    expect(editor.listenerCount('documentChange')).toBe(0);
  });
});
