import { attachBlockSync, EditorSurface } from '../blockSync';
import { createBlockStore } from '../store';
import { SAMPLE_DOCUMENT } from '../sampleDocument';
import { FieldAccess, TokenValue } from '../../documentTokens/cycleTypes';

type FakeEditor = EditorSurface & {
  fireContentChange: () => void;
};

const makeEditor = (): FakeEditor => {
  let listener: (() => void) | null = null;
  return {
    open: jest.fn(),
    serialize: jest.fn(),
    addEventListener: jest.fn((_name, fn) => {
      listener = fn;
    }),
    removeEventListener: jest.fn((_name, fn) => {
      if (listener === fn) listener = null;
    }),
    scrollContainer: () => ({ scrollTop: 0 }),
    fireContentChange: () => listener?.()
  };
};

const makeFields = (initial: Record<string, TokenValue>): FieldAccess => {
  const values: Record<string, TokenValue> = { ...initial };
  return {
    read: (spec) => values[spec.source ?? spec.id],
    write: jest.fn((updates) => {
      for (const { spec, value } of updates) values[spec.source ?? spec.id] = value;
    })
  };
};

const lastOpenedSfdt = (editor: FakeEditor) => {
  const calls = (editor.open as jest.Mock).mock.calls;
  return JSON.parse(calls[calls.length - 1][0]);
};

describe('attachBlockSync', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('opens the generated sample once on attach', () => {
    const editor = makeEditor();
    const store = createBlockStore(SAMPLE_DOCUMENT);
    const fields = makeFields({ customer_name: 'Acme Corp', retainer: 1500 });

    const sync = attachBlockSync(editor, store, fields);

    expect(editor.open).toHaveBeenCalledTimes(1);
    const opened = lastOpenedSfdt(editor);
    expect(JSON.stringify(opened)).toContain('Acme Corp');
    expect(sync.getLog()).toHaveLength(1);
    expect(sync.getLog()[0].kind).toBe('open');
  });

  it('reopens on a panel-origin store change, not on a document-origin one', () => {
    const editor = makeEditor();
    const store = createBlockStore(SAMPLE_DOCUMENT);
    const fields = makeFields({ customer_name: 'Acme Corp', retainer: 1500 });
    attachBlockSync(editor, store, fields);
    (editor.open as jest.Mock).mockClear();

    store.apply((d) => ({ ...d }), 'panel');
    expect(editor.open).toHaveBeenCalledTimes(1);

    (editor.open as jest.Mock).mockClear();
    store.apply((d) => ({ ...d }), 'document');
    expect(editor.open).not.toHaveBeenCalled();
  });

  it('absorbs a plain document edit into the store without reopening', () => {
    const editor = makeEditor();
    const store = createBlockStore(SAMPLE_DOCUMENT);
    const fields = makeFields({ customer_name: 'Acme Corp', retainer: 1500 });
    attachBlockSync(editor, store, fields);

    const opened = lastOpenedSfdt(editor);
    // blk_scope_p is section 0, block index 3: [bookmarkStart, textRun, bookmarkEnd]
    opened.sections[0].blocks[3].inlines[1].text = 'The parties agree to the revised services below.';
    (editor.serialize as jest.Mock).mockReturnValue(JSON.stringify(opened));
    (editor.open as jest.Mock).mockClear();

    editor.fireContentChange();
    jest.advanceTimersByTime(400);

    const scopeParagraph = store
      .getData()
      .sections[0].blocks.find((b) => b.id === 'blk_scope_p');
    expect(scopeParagraph?.content).toEqual([
      { kind: 'text', text: 'The parties agree to the revised services below.' }
    ]);
    expect(editor.open).not.toHaveBeenCalled();
  });

  it('routes a token edit to fields.write and reopens once when a computed token moves', () => {
    const editor = makeEditor();
    const store = createBlockStore(SAMPLE_DOCUMENT);
    const fields = makeFields({ customer_name: 'Acme Corp', retainer: 1500 });
    const sync = attachBlockSync(editor, store, fields);

    const opened = lastOpenedSfdt(editor);
    // sec_pricing, blk_pricing_tbl (index 1), retainer row (index 1), Amount col
    // (index 1): [bookmarkStart, textRun, bookmarkEnd]
    opened.sections[1].blocks[1].rows[1].cells[1].blocks[0].inlines[1].text =
      '$2,000.00';
    (editor.serialize as jest.Mock).mockReturnValue(JSON.stringify(opened));
    (editor.open as jest.Mock).mockClear();

    editor.fireContentChange();
    jest.advanceTimersByTime(400);

    expect(fields.write).toHaveBeenCalledTimes(1);
    const [[updates]] = (fields.write as jest.Mock).mock.calls;
    expect(updates).toEqual([
      { spec: expect.objectContaining({ id: 'retainer' }), value: 2000 }
    ]);

    expect(editor.open).toHaveBeenCalledTimes(1);
    const reopened = lastOpenedSfdt(editor);
    expect(JSON.stringify(reopened)).toContain('$2,160.00');
    expect(sync.getLog().some((e) => e.kind === 'recalcReopen')).toBe(true);
    expect(sync.getLog().some((e) => e.kind === 'tokenWrite')).toBe(true);
  });

  it('detach stops reactions to both the store and the editor', () => {
    const editor = makeEditor();
    const store = createBlockStore(SAMPLE_DOCUMENT);
    const fields = makeFields({ customer_name: 'Acme Corp', retainer: 1500 });
    const sync = attachBlockSync(editor, store, fields);
    const opened = lastOpenedSfdt(editor);
    sync.detach();
    (editor.open as jest.Mock).mockClear();

    store.apply((d) => ({ ...d }), 'panel');
    expect(editor.open).not.toHaveBeenCalled();

    (editor.serialize as jest.Mock).mockReturnValue(JSON.stringify(opened));
    editor.fireContentChange();
    // detach also removed the contentChange listener, but the fake editor
    // tracks the last-registered listener directly; firing confirms no-op.
    jest.advanceTimersByTime(400);
    expect(editor.open).not.toHaveBeenCalled();
  });
});
