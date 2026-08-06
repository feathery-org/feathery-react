import { attachBlockSync, EditorSurface } from '../blockSync';
import { createBlockStore } from '../store';
import { SAMPLE_DOCUMENT } from '../sampleDocument';
import { FieldAccess, TokenValue } from '../../documentTokens/cycleTypes';

type FakeEditor = EditorSurface & {
  fireContentChange: () => void;
  fireDocumentChange: () => void;
};

const makeEditor = (): FakeEditor => {
  const listeners = new Map<string, () => void>();
  return {
    open: jest.fn(),
    serialize: jest.fn(),
    addEventListener: jest.fn((name, fn) => {
      listeners.set(name, fn);
    }),
    removeEventListener: jest.fn((name, fn) => {
      if (listeners.get(name) === fn) listeners.delete(name);
    }),
    scrollContainer: () => ({ scrollTop: 0 }),
    fireContentChange: () => listeners.get('contentChange')?.(),
    fireDocumentChange: () => listeners.get('documentChange')?.()
  };
};

const makeFields = (initial: Record<string, TokenValue>): FieldAccess => {
  const values: Record<string, TokenValue> = { ...initial };
  return {
    read: (spec) => values[spec.source ?? spec.id],
    write: jest.fn((updates) => {
      for (const { spec, value } of updates)
        values[spec.source ?? spec.id] = value;
    })
  };
};

const lastOpenedRaw = (editor: FakeEditor): string => {
  const calls = (editor.open as jest.Mock).mock.calls;
  return calls[calls.length - 1][0];
};

const lastOpenedSfdt = (editor: FakeEditor) =>
  JSON.parse(lastOpenedRaw(editor));

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
    opened.sections[0].blocks[3].inlines[1].text =
      'The parties agree to the revised services below.';
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

  it('rejects a source-backed token edit when fields is null: no tokenWrite log, and recalcReopen restores it', () => {
    const editor = makeEditor();
    // retainer is source-backed (spec.source = 'retainer'); seeding it via
    // data.values lets resolveTokens render a real value even with no
    // FieldAccess, so the edit below has something concrete to overwrite.
    const docWithValues = { ...SAMPLE_DOCUMENT, values: { retainer: 1500 } };
    const store = createBlockStore(docWithValues);
    const sync = attachBlockSync(editor, store, null);

    const opened = lastOpenedSfdt(editor);
    // sec_pricing, blk_pricing_tbl (index 1), retainer row (index 1), Amount col
    // (index 1): [bookmarkStart, textRun, bookmarkEnd]
    opened.sections[1].blocks[1].rows[1].cells[1].blocks[0].inlines[1].text =
      '$2,000.00';
    (editor.serialize as jest.Mock).mockReturnValue(JSON.stringify(opened));
    (editor.open as jest.Mock).mockClear();
    const before = store.getData();

    editor.fireContentChange();
    jest.advanceTimersByTime(400);

    expect(sync.getLog().some((e) => e.kind === 'tokenWrite')).toBe(false);
    expect(store.getData()).toBe(before); // no store.apply from the rejected edit

    // recalcReopen restores the real ($1,500.00-backed) values, discarding
    // the edit fields had no way to persist.
    expect(editor.open).toHaveBeenCalledTimes(1);
    const reopened = lastOpenedSfdt(editor);
    expect(JSON.stringify(reopened)).toContain('$1,500.00');
    expect(JSON.stringify(reopened)).not.toContain('$2,000.00');
    expect(sync.getLog().some((e) => e.kind === 'recalcReopen')).toBe(true);
  });

  it('rejects an edit to a computed token: no tokenWrite log, and recalcReopen restores it', () => {
    const editor = makeEditor();
    const store = createBlockStore(SAMPLE_DOCUMENT);
    const fields = makeFields({ customer_name: 'Acme Corp', retainer: 1500 });
    const sync = attachBlockSync(editor, store, fields);

    const opened = lastOpenedSfdt(editor);
    // sec_pricing, blk_pricing_tbl (index 1), total row (index 2), Amount col
    // (index 1): [bookmarkStart, textRun, bookmarkEnd]. 'total' is computed
    // (formula), so it is never a writable token.
    opened.sections[1].blocks[1].rows[2].cells[1].blocks[0].inlines[1].text =
      '$999.00';
    (editor.serialize as jest.Mock).mockReturnValue(JSON.stringify(opened));
    (editor.open as jest.Mock).mockClear();

    editor.fireContentChange();
    jest.advanceTimersByTime(400);

    expect(fields.write).not.toHaveBeenCalled();
    expect(sync.getLog().some((e) => e.kind === 'tokenWrite')).toBe(false);

    // The bogus value is not persisted; recalc restores the real total and
    // reopens once.
    expect(editor.open).toHaveBeenCalledTimes(1);
    const reopened = lastOpenedSfdt(editor);
    expect(JSON.stringify(reopened)).toContain('$1,620.00');
    expect(sync.getLog().some((e) => e.kind === 'recalcReopen')).toBe(true);
  });

  it('ignores an async contentChange whose content still matches the last opened sfdt', () => {
    const editor = makeEditor();
    const store = createBlockStore(SAMPLE_DOCUMENT);
    const fields = makeFields({ customer_name: 'Acme Corp', retainer: 1500 });
    const sync = attachBlockSync(editor, store, fields);
    const before = store.getData();

    // Simulate a host editor that fires contentChange asynchronously, after
    // open() already returned and `applying` is back to false, with content
    // unchanged from what was just opened.
    (editor.serialize as jest.Mock).mockReturnValue(lastOpenedRaw(editor));
    (editor.open as jest.Mock).mockClear();

    editor.fireContentChange();
    jest.advanceTimersByTime(400);

    expect(store.getData()).toBe(before); // no store.apply ran
    expect(editor.open).not.toHaveBeenCalled(); // no spurious reopen
    expect(sync.getLog()).toHaveLength(1); // only the initial 'open' entry
  });

  it('reasserts the generated document when documentChange reveals a foreign document', () => {
    const editor = makeEditor();
    const store = createBlockStore(SAMPLE_DOCUMENT);
    const fields = makeFields({ customer_name: 'Acme Corp', retainer: 1500 });
    const sync = attachBlockSync(editor, store, fields);
    (editor.open as jest.Mock).mockClear();

    // Something else (envelope source load, a regenerate, ...) opened a
    // document with no block anchors of ours.
    (editor.serialize as jest.Mock).mockReturnValue(
      '{"sections":[{"sectionFormat":{},"blocks":[]}]}'
    );

    editor.fireDocumentChange();
    jest.advanceTimersByTime(100);

    expect(editor.open).toHaveBeenCalledTimes(1);
    expect(lastOpenedRaw(editor)).toContain('"fblk_');
    expect(
      sync
        .getLog()
        .some(
          (e) => e.kind === 'open' && e.detail === 'reassert after foreign document'
        )
    ).toBe(true);
  });

  it('does not reopen when documentChange fires for the document blockSync itself just opened', () => {
    const editor = makeEditor();
    const store = createBlockStore(SAMPLE_DOCUMENT);
    const fields = makeFields({ customer_name: 'Acme Corp', retainer: 1500 });
    attachBlockSync(editor, store, fields);
    (editor.serialize as jest.Mock).mockReturnValue(lastOpenedRaw(editor));
    (editor.open as jest.Mock).mockClear();

    editor.fireDocumentChange();
    jest.advanceTimersByTime(100);

    expect(editor.open).not.toHaveBeenCalled();
  });

  it('detach stops reacting to documentChange too', () => {
    const editor = makeEditor();
    const store = createBlockStore(SAMPLE_DOCUMENT);
    const fields = makeFields({ customer_name: 'Acme Corp', retainer: 1500 });
    const sync = attachBlockSync(editor, store, fields);
    sync.detach();
    (editor.open as jest.Mock).mockClear();

    (editor.serialize as jest.Mock).mockReturnValue(
      '{"sections":[{"sectionFormat":{},"blocks":[]}]}'
    );
    editor.fireDocumentChange();
    jest.advanceTimersByTime(100);

    expect(editor.open).not.toHaveBeenCalled();
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
