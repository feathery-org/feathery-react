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
import { TokenSpec } from '../plan';
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

  const idOf = (info: ContentControlInfo) => decodeTag(info.tag)?.id as string;

  const editor: any = {
    log,
    controls,
    exportContentControlData: () => controls.map((c) => ({ ...c })),
    getBookmarks: () => controls.map((c) => bookmarkFor(idOf(c))),
    selection: {
      getContentControlInfo: () => caret,
      selectBookmark: (name: string) => {
        selected = name;
      }
    },
    editor: {
      insertText: (text: string) => {
        const target = controls.find((c) => bookmarkFor(idOf(c)) === selected);
        if (target) {
          log.push(`${idOf(target)}=${text}`);
          target.value = text;
        }
      },
      insertContentControl: (info: ContentControlInfo) =>
        controls.push({ ...info }),
      insertBookmark: () => undefined
    },
    editorHistory: {
      beginUndoAction: () => log.push('undo:begin'),
      endUndoAction: () => log.push('undo:end')
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
    valueOf: (id: string) =>
      controls.find((c) => idOf(c) === id)?.value as string,
    listenerCount: (event: string) => (handlers[event] ?? []).length
  });
};

/** The prototype's invoice: two line items, subtotal, tax, total. */
const invoiceEditor = () =>
  fakeEditor([
    control({ id: 'qty', index: 0, source: 'qty' }, '10'),
    control(
      { id: 'unit_cost', index: 0, source: 'unit_cost', format: { kind: 'currency' } },
      '$150.00'
    ),
    control({ id: 'qty', index: 1, source: 'qty' }, '2'),
    control(
      { id: 'unit_cost', index: 1, source: 'unit_cost', format: { kind: 'currency' } },
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
      { id: 'subtotal', formula: 'SUM(item_total)', format: { kind: 'currency' } },
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
      control({ id: 'qty', index: 0, source: 'qty', validate: { min: 1 } }, '10')
    ]);
    const state = attachTokenCycle(editor).setTokenValue('qty__0', 0);

    expect(state.invalid.get('qty__0')).toMatch(/at least 1/);
    expect(editor.valueOf('qty__0')).toBe('0');
  });

  it('attributes a broken formula without losing the rest', () => {
    const editor = fakeEditor([
      control({ id: 'x', source: 'x' }, '4'),
      control({ id: 'broken', formula: '(((' }, ''),
      control(
        { id: 'ok', formula: 'x * 2', format: { kind: 'number' } },
        '8'
      )
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
      control({ id: 'qty_3', source: 'qty' }, '1'),
      control({ id: 'unit_cost_3', source: 'unit_cost' }, '$50.00'),
      control(
        {
          id: 'item_total_3',
          formula: 'qty_3 * unit_cost_3',
          format: { kind: 'currency' }
        },
        '$50.00'
      )
    );
    cycle.refresh();

    // SUM(item_total_*) picked up the new row with no formula edit anywhere.
    expect(editor.valueOf('subtotal')).toBe('$2,350.00');
  });

  it('picks up tokens when the document finishes loading', () => {
    // The editor is ready before its .docx is — attaching finds nothing.
    const editor = fakeEditor([]);
    const cycle = attachTokenCycle(editor);
    expect(cycle.getState().specs).toHaveLength(0);

    editor.controls.push(
      control({ id: 'qty__0', source: 'qty' }, '4'),
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
