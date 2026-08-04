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
    fire: (event: string) => (handlers[event] ?? []).forEach((h) => h()),
    valueOf: (id: string) =>
      controls.find((c) => idOf(c) === id)?.value as string,
    listenerCount: (event: string) => (handlers[event] ?? []).length
  });
};

/** The prototype's invoice: two line items, subtotal, tax, total. */
const invoiceEditor = () =>
  fakeEditor([
    control({ id: 'qty_1', source: 'qty' }, '10'),
    control(
      { id: 'unit_cost_1', source: 'unit_cost', format: { kind: 'currency' } },
      '$150.00'
    ),
    control({ id: 'qty_2', source: 'qty' }, '2'),
    control(
      { id: 'unit_cost_2', source: 'unit_cost', format: { kind: 'currency' } },
      '$400.00'
    ),
    control(
      {
        id: 'tax_percent_1',
        source: 'tax_percent',
        format: { kind: 'percent' }
      },
      '8.25%'
    ),
    control(
      {
        id: 'item_total_1',
        formula: 'qty_1 * unit_cost_1',
        format: { kind: 'currency' }
      },
      '$1,500.00'
    ),
    control(
      {
        id: 'item_total_2',
        formula: 'qty_2 * unit_cost_2',
        format: { kind: 'currency' }
      },
      '$800.00'
    ),
    control(
      {
        id: 'subtotal_1',
        formula: 'SUM(item_total_*)',
        format: { kind: 'currency' }
      },
      '$2,300.00'
    ),
    control(
      {
        id: 'total_1',
        formula: 'subtotal_1 + ROUND(subtotal_1 * tax_percent_1 / 100, 2)',
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
    expect(state.values.get('qty_1')).toBe(10);
    expect(state.values.get('unit_cost_1')).toBe(150);
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

    cycle.setTokenValue('qty_1', 20);

    expect(editor.valueOf('item_total_1')).toBe('$3,000.00');
    expect(editor.valueOf('subtotal_1')).toBe('$3,800.00');
    expect(editor.valueOf('total_1')).toBe('$4,113.50');
  });

  it('leaves untouched branches alone', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor).setTokenValue('qty_1', 20);

    expect(
      editor.log.filter((l: string) => l.startsWith('item_total_2='))
    ).toEqual([]);
    expect(editor.valueOf('item_total_2')).toBe('$800.00');
  });

  it('reformats the edited token itself', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor).setTokenValue('unit_cost_1', '175');

    expect(editor.valueOf('unit_cost_1')).toBe('$175.00');
  });

  it('accepts a typed value with currency punctuation', () => {
    const editor = invoiceEditor();
    const state = attachTokenCycle(editor).setTokenValue('unit_cost_1', '$1,750');

    expect(state.values.get('unit_cost_1')).toBe(1750);
    expect(editor.valueOf('item_total_1')).toBe('$17,500.00');
  });

  it('ignores an unparseable value rather than zeroing the token', () => {
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor);

    cycle.setTokenValue('qty_1', 'not a number');

    expect(editor.valueOf('qty_1')).toBe('10');
    expect(editor.valueOf('item_total_1')).toBe('$1,500.00');
  });

  it('does nothing when the value has not actually changed', () => {
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor);
    editor.log.length = 0;

    cycle.setTokenValue('qty_1', 10);

    expect(editor.log).toEqual([]);
  });

  it('groups an edit and everything it moved into one undo action', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor).setTokenValue('qty_1', 20);

    expect(editor.log.filter((l: string) => l === 'undo:begin')).toHaveLength(1);
    expect(editor.log[0]).toBe('undo:begin');
    expect(editor.log[editor.log.length - 1]).toBe('undo:end');
  });
});

describe('attachTokenCycle — reading edits made in the document', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('picks up a typed value once typing stops', () => {
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor, { readBackDelayMs: 400 });

    editor.setCaret(editor.controls[0]); // qty_1
    editor.controls[0].value = '20';
    editor.fire('contentChange');
    jest.advanceTimersByTime(400);

    expect(cycle.getState().values.get('qty_1')).toBe(20);
    expect(editor.valueOf('item_total_1')).toBe('$3,000.00');
  });

  it('waits for typing to stop before rewriting the document', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor, { readBackDelayMs: 400 });

    editor.setCaret(editor.controls[0]);
    editor.controls[0].value = '2';
    editor.fire('contentChange');
    jest.advanceTimersByTime(200);
    editor.controls[0].value = '20';
    editor.fire('contentChange');
    jest.advanceTimersByTime(200);

    // Mid-typing: the intermediate "2" never propagated.
    expect(editor.valueOf('item_total_1')).toBe('$1,500.00');

    jest.advanceTimersByTime(200);
    expect(editor.valueOf('item_total_1')).toBe('$3,000.00');
  });

  it('does not rewrite the token being typed in', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor, { readBackDelayMs: 400 });

    editor.setCaret(editor.controls[0]);
    editor.controls[0].value = '20';
    editor.fire('contentChange');
    jest.advanceTimersByTime(400);

    // Downstream moved; the edited token keeps exactly what was typed.
    expect(editor.valueOf('qty_1')).toBe('20');
    expect(editor.valueOf('subtotal_1')).toBe('$3,800.00');
  });

  it('ignores its own writes', () => {
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor, { readBackDelayMs: 400 });

    // A programmatic write must not be read back as a user edit.
    cycle.setTokenValue('qty_1', 20);
    const afterWrite = editor.valueOf('subtotal_1');
    jest.advanceTimersByTime(400);

    expect(editor.valueOf('subtotal_1')).toBe(afterWrite);
  });

  it('ignores edits made outside any token', () => {
    const editor = invoiceEditor();
    attachTokenCycle(editor, { readBackDelayMs: 400 });
    editor.log.length = 0;

    editor.setCaret(undefined); // ordinary prose
    editor.fire('contentChange');
    jest.advanceTimersByTime(400);

    expect(editor.log).toEqual([]);
  });
});

describe('attachTokenCycle — state and lifecycle', () => {
  it('surfaces validation failures without blocking the edit', () => {
    const editor = fakeEditor([
      control({ id: 'qty_1', source: 'qty', validate: { min: 1 } }, '10')
    ]);
    const state = attachTokenCycle(editor).setTokenValue('qty_1', 0);

    expect(state.invalid.get('qty_1')).toMatch(/at least 1/);
    expect(editor.valueOf('qty_1')).toBe('0');
  });

  it('attributes a broken formula without losing the rest', () => {
    const editor = fakeEditor([
      control({ id: 'x_1', source: 'x' }, '4'),
      control({ id: 'broken_1', formula: '(((' }, ''),
      control(
        { id: 'ok_1', formula: 'x_1 * 2', format: { kind: 'number' } },
        '8'
      )
    ]);
    const state = attachTokenCycle(editor).setTokenValue('x_1', 5);

    expect(state.errors.has('broken_1')).toBe(true);
    expect(editor.valueOf('ok_1')).toBe('10');
  });

  it('notifies subscribers when values move', () => {
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor);
    const seen: number[] = [];
    cycle.subscribe((state) =>
      seen.push(state.values.get('subtotal_1') as number)
    );

    cycle.setTokenValue('qty_1', 20);

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
    expect(editor.valueOf('subtotal_1')).toBe('$2,350.00');
  });

  it('stops listening on detach', () => {
    const editor = invoiceEditor();
    const cycle = attachTokenCycle(editor);
    expect(editor.listenerCount('contentChange')).toBe(1);

    cycle.detach();
    expect(editor.listenerCount('contentChange')).toBe(0);
  });
});
