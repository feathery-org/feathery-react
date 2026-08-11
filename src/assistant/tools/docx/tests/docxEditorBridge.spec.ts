import { createDocxEditorBridge, readDocxSelection } from '../docxEditorBridge';
import {
  applyDocumentEdits,
  buildIndexBlocks,
  deriveSectionPattern,
  findDocumentOccurrences,
  getDocumentInventory,
  isAssistantWriting
} from '../syncfusionDocumentOps';

jest.mock('../syncfusionDocumentOps', () => ({
  ...jest.requireActual('../syncfusionDocumentOps'),
  applyDocumentEdits: jest.fn(),
  deriveSectionPattern: jest.fn(),
  findDocumentOccurrences: jest.fn(),
  getDocumentInventory: jest.fn()
}));

const applyDocumentEditsMock = applyDocumentEdits as jest.Mock;
const deriveSectionPatternMock = deriveSectionPattern as jest.Mock;
const findDocumentOccurrencesMock = findDocumentOccurrences as jest.Mock;
const getDocumentInventoryMock = getDocumentInventory as jest.Mock;

describe('createDocxEditorBridge', () => {
  beforeEach(() => jest.clearAllMocks());

  it('forwards inventory reads to the hardened engine and returns its result', async () => {
    const editor = { id: 'editor' };
    const input = { scope: 'section', sectionAnchor: '0;2' };
    const output = { inventory: [{ anchor: '0;2', text: 'Details' }] };
    getDocumentInventoryMock.mockReturnValue(output);

    const bridge = createDocxEditorBridge(() => editor);

    await expect(bridge.getDocumentInventory!(input)).resolves.toBe(output);
    expect(getDocumentInventoryMock).toHaveBeenCalledWith(editor, input);
  });

  it('forwards edit batches to the hardened engine and returns its result', async () => {
    const editor = { id: 'editor' };
    const input = {
      edits: [
        {
          op: 'replace_text',
          anchor: '0;1',
          find: '$5,500',
          replace: '$6,000'
        }
      ]
    };
    const output = { results: [{ ok: true, op: 'replace_text' }] };
    applyDocumentEditsMock.mockReturnValue(output);

    const bridge = createDocxEditorBridge(() => editor);

    await expect(bridge.applyDocumentEdits!(input)).resolves.toBe(output);
    expect(applyDocumentEditsMock).toHaveBeenCalledWith(editor, input);
  });

  it('forwards section-pattern reads to the live document engine', async () => {
    const editor = { id: 'editor' };
    const input = { near: '0;7' };
    const output = { ok: true, pattern: { sequence: [] } };
    deriveSectionPatternMock.mockReturnValue(output);

    const bridge = createDocxEditorBridge(() => editor);

    await expect(bridge.getSectionPattern!(input)).resolves.toBe(output);
    expect(deriveSectionPatternMock).toHaveBeenCalledWith(editor, input);
  });

  it('forwards occurrence reads to the hardened engine and returns its result', async () => {
    const editor = { id: 'editor' };
    const input = { queries: ['premium'] };
    const output = { results: [{ query: 'premium', occurrences: [] }] };
    findDocumentOccurrencesMock.mockReturnValue(output);

    const bridge = createDocxEditorBridge(() => editor);

    await expect(bridge.findDocumentOccurrences!(input)).resolves.toBe(output);
    expect(findDocumentOccurrencesMock).toHaveBeenCalledWith(editor, input);
  });

  it('marks the editing session active on the live editor before a write', async () => {
    const editor: any = { id: 'editor' };
    applyDocumentEditsMock.mockReturnValue({ results: [] });
    const bridge = createDocxEditorBridge(() => editor);

    expect(isAssistantWriting(editor)).toBe(false);
    await bridge.applyDocumentEdits!({ edits: [] });
    // Raised for the turn's remaining span; AssistantChat clears it at
    // turn end, so the gaps between tool calls stay guarded.
    expect(isAssistantWriting(editor)).toBe(true);
  });

  it('does not mark the session active for reads', async () => {
    const editor: any = { id: 'editor' };
    getDocumentInventoryMock.mockReturnValue({ inventory: [] });
    const bridge = createDocxEditorBridge(() => editor);

    await bridge.getDocumentInventory!({});
    // A read-only (or text-only) turn never suppresses the review rail.
    expect(isAssistantWriting(editor)).toBe(false);
  });

  it('resolves the live editor for every call and normalizes missing input', async () => {
    const firstEditor = { id: 'first' };
    const secondEditor = { id: 'second' };
    let editor = firstEditor;
    const getEditor = jest.fn(() => editor);
    const bridge = createDocxEditorBridge(getEditor);

    await bridge.getDocumentInventory!(undefined);
    editor = secondEditor;
    await bridge.applyDocumentEdits!(undefined);

    expect(getEditor).toHaveBeenCalledTimes(2);
    expect(getDocumentInventoryMock).toHaveBeenCalledWith(firstEditor, {});
    expect(applyDocumentEditsMock).toHaveBeenCalledWith(secondEditor, {});
  });

  it.each([
    'getDocumentInventory',
    'getSectionPattern',
    'applyDocumentEdits',
    'findDocumentOccurrences'
  ] as const)(
    'reports editor_unavailable without invoking the engine for %s',
    async (method) => {
      const bridge = createDocxEditorBridge(() => undefined);

      await expect(bridge[method]!({})).resolves.toEqual({
        ok: false,
        error: 'editor_unavailable',
        message: 'No in-form document editor is ready.'
      });
      expect(getDocumentInventoryMock).not.toHaveBeenCalled();
      expect(deriveSectionPatternMock).not.toHaveBeenCalled();
      expect(applyDocumentEditsMock).not.toHaveBeenCalled();
      expect(findDocumentOccurrencesMock).not.toHaveBeenCalled();
    }
  );

  it('returns null when the live editor has no usable selection', () => {
    expect(readDocxSelection(undefined as any)).toBeNull();
    expect(readDocxSelection({} as any)).toBeNull();
    expect(readDocxSelection({ selection: {} } as any)).toBeNull();
    expect(
      readDocxSelection({ selection: { startOffset: 42 } } as any)
    ).toBeNull();
  });

  it('returns no index blocks when the editor document cannot be parsed', () => {
    const editor = { serialize: () => '{not valid sfdt' };

    expect(buildIndexBlocks(editor as any)).toEqual([]);
  });
});
