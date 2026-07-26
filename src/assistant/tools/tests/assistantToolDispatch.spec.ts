import { dispatchAssistantTool } from '../assistantToolDispatch';

describe('document tool dispatch', () => {
  it.each(['findDocumentOccurrences', 'find_document_occurrences'])(
    'routes %s to the live document bridge',
    async (toolName) => {
      const findDocumentOccurrences = jest
        .fn()
        .mockResolvedValue({ ok: true, occurrences: [] });

      const result = await dispatchAssistantTool(toolName, { text: 'Robin' }, {
        docxBridge: { findDocumentOccurrences }
      });

      expect(result).toEqual({
        handled: true,
        output: { ok: true, occurrences: [] }
      });
      expect(findDocumentOccurrences).toHaveBeenCalledWith({ text: 'Robin' });
    }
  );
});
