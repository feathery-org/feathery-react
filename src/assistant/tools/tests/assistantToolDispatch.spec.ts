import {
  buildCallableRules,
  dispatchAssistantTool
} from '../assistantToolDispatch';
import * as assistantToolDispatchExports from '../assistantToolDispatch';

describe('document tool dispatch', () => {
  it('routes getSectionPattern to the live read-only document bridge', async () => {
    const getSectionPattern = jest.fn().mockResolvedValue({
      ok: true,
      pattern: { sequence: [] }
    });

    const result = await dispatchAssistantTool(
      'getSectionPattern',
      { near: '0;7' },
      { docxBridge: { getSectionPattern } }
    );

    expect(result).toEqual({
      handled: true,
      output: { ok: true, pattern: { sequence: [] } }
    });
    expect(getSectionPattern).toHaveBeenCalledWith({ near: '0;7' });
  });

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
    'apply_document_edits'
  ])('does not claim unreachable snake_case alias %s', async (toolName) => {
    const handler = jest.fn();
    const result = await dispatchAssistantTool(
      toolName,
      {},
      {
        docxBridge: {
          getDocumentInventory: handler,
          getSectionPattern: handler,
          findDocumentOccurrences: handler,
          applyDocumentEdits: handler
        }
      }
    );

    expect(result).toEqual({ handled: false });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('rule tool dispatch', () => {
  const CATALOG = [{ id: 'rule-1', name: 'Calc Quote' }];

  it('routes on the model-echoed input.ruleId, never the tool name', async () => {
    const runLogicRule = jest.fn().mockResolvedValue({ ok: true });

    const result = await dispatchAssistantTool(
      'rule_some_decorative_name_zzzz',
      { ruleId: 'rule-1', inputParams: { amount: 5 } },
      { callableRules: CATALOG, runLogicRule }
    );

    expect(runLogicRule).toHaveBeenCalledWith('rule-1', { amount: 5 });
    expect(result).toEqual({ handled: true, output: { ok: true } });
  });

  it('rejects a ruleId outside the catalog with a stale-session hint', async () => {
    const runLogicRule = jest.fn();

    const result = await dispatchAssistantTool(
      'runLogicRule',
      { ruleId: 'not-offered', inputParams: {} },
      { callableRules: CATALOG, runLogicRule }
    );

    expect(runLogicRule).not.toHaveBeenCalled();
    expect(result.handled).toBe(true);
    expect(result.output).toMatchObject({ ok: false, error: 'unknown_rule' });
    expect(result.output.message).toMatch(/stale/i);
  });

  it('reports handler_unavailable, not a stale session, when no form is connected', async () => {
    const result = await dispatchAssistantTool(
      'rule_calc_quote_rule',
      { ruleId: 'rule-1', inputParams: {} },
      { callableRules: CATALOG }
    );

    expect(result.handled).toBe(true);
    expect(result.output).toMatchObject({
      ok: false,
      error: 'handler_unavailable'
    });
    expect(result.output.message).not.toMatch(/stale/i);
  });

  it('rejects an input with no ruleId envelope', async () => {
    const runLogicRule = jest.fn();

    const result = await dispatchAssistantTool(
      'rule_calc_quote_rule',
      { amount: 5 },
      { callableRules: CATALOG, runLogicRule }
    );

    expect(runLogicRule).not.toHaveBeenCalled();
    expect(result.output).toMatchObject({ ok: false, error: 'unknown_rule' });
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
