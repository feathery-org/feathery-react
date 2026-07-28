import {
  buildCallableRules,
  dispatchAssistantTool
} from '../assistantToolDispatch';
import * as assistantToolDispatchExports from '../assistantToolDispatch';

describe('document tool dispatch', () => {
  it('routes findDocumentOccurrences to the live document bridge', async () => {
    const findDocumentOccurrences = jest
      .fn()
      .mockResolvedValue({ ok: true, occurrences: [] });

    const result = await dispatchAssistantTool(
      'findDocumentOccurrences',
      { text: 'Robin' },
      {
        docxBridge: { findDocumentOccurrences }
      }
    );

    expect(result).toEqual({
      handled: true,
      output: { ok: true, occurrences: [] }
    });
    expect(findDocumentOccurrences).toHaveBeenCalledWith({ text: 'Robin' });
  });

  it.each([
    'get_document_inventory',
    'find_document_occurrences',
    'apply_document_edits',
    'get_form_fields'
  ])('does not claim unreachable snake_case alias %s', async (toolName) => {
    const handler = jest.fn();
    const result = await dispatchAssistantTool(toolName, {}, {
      docxBridge: {
        getDocumentInventory: handler,
        findDocumentOccurrences: handler,
        applyDocumentEdits: handler
      },
      getFormFields: handler
    });

    expect(result).toEqual({ handled: false });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('callable rule catalog', () => {
  it('does not mount server-side logic rules as browser tools', () => {
    const callable = buildCallableRules([
      {
        id: 'browser-rule',
        name: 'Browser rule',
        trigger_event: 'tool',
        server_side: false
      },
      {
        id: 'server-rule',
        name: 'Server rule',
        trigger_event: 'tool',
        server_side: true
      }
    ]);

    expect(callable.map((rule) => rule.id)).toEqual(['browser-rule']);
  });
});

describe('public dispatch surface', () => {
  it('does not expose the retired selection shim', () => {
    expect(assistantToolDispatchExports).not.toHaveProperty(
      'normalizeSelection'
    );
  });
});
