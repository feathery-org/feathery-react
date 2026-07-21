import {
  buildCallableRules,
  CallableRule,
  dispatchAssistantTool,
  normalizeSelection,
  resolveRuleId,
  ruleToolName,
  sanitizeRuleSlug,
  SELECTION_TEXT_LIMIT,
  TOOL_TIMEOUT_APPLY_MS,
  TOOL_TIMEOUT_READ_MS,
  withToolTimeout
} from '../assistantToolDispatch';

const rule = (over: Partial<CallableRule> = {}): CallableRule => ({
  id: 'abcd1234-5678',
  name: 'Verify Client',
  description: 'Verifies the client',
  server_side: false,
  parameters: [{ name: 'clientName', type: 'string', required: true }],
  ...over
});

describe('sanitizeRuleSlug / ruleToolName', () => {
  it('lowercases and underscores non-alphanumerics', () => {
    expect(sanitizeRuleSlug('Verify Client!')).toBe('verify_client');
    expect(sanitizeRuleSlug('  A/B  ')).toBe('a_b');
  });

  it('falls back to "rule" for empty names', () => {
    expect(sanitizeRuleSlug('')).toBe('rule');
    expect(sanitizeRuleSlug('###')).toBe('rule');
  });

  it('builds rule_<slug>_<first4-of-id>', () => {
    expect(ruleToolName(rule())).toBe('rule_verify_client_abcd');
  });
});

describe('resolveRuleId', () => {
  const rules = [rule(), rule({ id: 'ffff9999', name: 'Other Rule' })];

  it('resolves rule_* by exact regenerated name', () => {
    expect(resolveRuleId('rule_verify_client_abcd', {}, rules)).toBe(
      'abcd1234-5678'
    );
  });

  it('falls back to the trailing id-suffix segment when the slug drifts', () => {
    // slug differs from what this SDK would generate, but the id4 suffix is
    // unique, so it still resolves.
    expect(resolveRuleId('rule_renamed_thing_abcd', {}, rules)).toBe(
      'abcd1234-5678'
    );
  });

  it('does not resolve an ambiguous id suffix', () => {
    const ambiguous = [rule(), rule({ id: 'abcd0000', name: 'Twin' })];
    expect(resolveRuleId('rule_unknown_abcd', {}, ambiguous)).toBeNull();
  });

  it('validates a model-echoed id against the catalog for runLogicRule', () => {
    expect(resolveRuleId('runLogicRule', { ruleId: 'abcd1234-5678' }, rules)).toBe(
      'abcd1234-5678'
    );
    // a hallucinated id not in the catalog is rejected
    expect(resolveRuleId('runLogicRule', { ruleId: 'nope' }, rules)).toBeNull();
  });
});

describe('dispatchAssistantTool', () => {
  it('runs a custom handler before any built-in, even for a built-in name', async () => {
    const custom = jest.fn().mockResolvedValue({ ok: true, from: 'custom' });
    const bridge = jest.fn().mockResolvedValue({ from: 'bridge' });
    const res = await dispatchAssistantTool(
      'getDocumentInventory',
      { scope: 'outline' },
      {
        customToolHandlers: { getDocumentInventory: custom },
        docxBridge: { getDocumentInventory: bridge }
      }
    );
    expect(res.handled).toBe(true);
    expect(res.output).toEqual({ ok: true, from: 'custom' });
    expect(custom).toHaveBeenCalledWith({ scope: 'outline' });
    expect(bridge).not.toHaveBeenCalled();
  });

  it('dispatches getDocumentInventory to the docx bridge', async () => {
    const bridge = jest.fn().mockResolvedValue({ sections: [] });
    const res = await dispatchAssistantTool(
      'getDocumentInventory',
      { scope: 'outline' },
      { docxBridge: { getDocumentInventory: bridge } }
    );
    expect(res.output).toEqual({ sections: [] });
    expect(bridge).toHaveBeenCalledWith({ scope: 'outline' });
  });

  it('dispatches applyDocumentEdits to the docx bridge', async () => {
    const bridge = jest.fn().mockResolvedValue({ results: [], warnings: [] });
    const res = await dispatchAssistantTool(
      'applyDocumentEdits',
      { edits: [] },
      { docxBridge: { applyDocumentEdits: bridge } }
    );
    expect(res.output).toEqual({ results: [], warnings: [] });
  });

  it('returns a synthetic error when the docx bridge is absent', async () => {
    const read = await dispatchAssistantTool('getDocumentInventory', {}, {});
    expect(read.handled).toBe(true);
    expect(read.output).toMatchObject({
      ok: false,
      error: 'handler_unavailable'
    });

    const apply = await dispatchAssistantTool('applyDocumentEdits', {}, {});
    expect(apply.output).toMatchObject({
      ok: false,
      error: 'handler_unavailable'
    });
  });

  it('surfaces a handler that throws as a synthetic handler_error', async () => {
    const bridge = jest.fn().mockRejectedValue(new Error('boom'));
    const res = await dispatchAssistantTool(
      'getDocumentInventory',
      {},
      { docxBridge: { getDocumentInventory: bridge } }
    );
    expect(res.output).toMatchObject({ ok: false, error: 'handler_error' });
    expect(res.output.message).toBe('boom');
  });

  it('resolves rule_* to the catalog id and forwards the input as params', async () => {
    const runLogicRule = jest
      .fn()
      .mockResolvedValue({ changedFields: ['a'], returnValue: 42 });
    const res = await dispatchAssistantTool(
      'rule_verify_client_abcd',
      { clientName: 'Acme' },
      { callableRules: [rule()], runLogicRule }
    );
    expect(runLogicRule).toHaveBeenCalledWith('abcd1234-5678', {
      clientName: 'Acme'
    });
    expect(res.output).toEqual({ changedFields: ['a'], returnValue: 42 });
  });

  it('resolves the generic runLogicRule and unwraps nested inputParams', async () => {
    const runLogicRule = jest.fn().mockResolvedValue({ changedFields: [] });
    await dispatchAssistantTool(
      'runLogicRule',
      { ruleId: 'abcd1234-5678', inputParams: { clientName: 'Beta' } },
      { callableRules: [rule()], runLogicRule }
    );
    expect(runLogicRule).toHaveBeenCalledWith('abcd1234-5678', {
      clientName: 'Beta'
    });
  });

  it('returns an unknown_rule error when a rule tool cannot be resolved', async () => {
    const runLogicRule = jest.fn();
    const res = await dispatchAssistantTool(
      'rule_ghost_zzzz',
      {},
      { callableRules: [rule()], runLogicRule }
    );
    expect(res.handled).toBe(true);
    expect(res.output).toMatchObject({ ok: false, error: 'unknown_rule' });
    expect(runLogicRule).not.toHaveBeenCalled();
  });

  it('leaves unrelated tools unhandled so built-in branches run', async () => {
    const res = await dispatchAssistantTool('setFieldValue', {}, {});
    expect(res).toEqual({ handled: false });
  });
});

describe('withToolTimeout', () => {
  afterEach(() => jest.useRealTimers());

  it('resolves with the handler result before the deadline', async () => {
    const res = await withToolTimeout(
      () => Promise.resolve({ ok: true }),
      TOOL_TIMEOUT_READ_MS,
      'getDocumentInventory'
    );
    expect(res).toEqual({ ok: true });
  });

  it('resolves a synthetic timeout error when the handler hangs', async () => {
    jest.useFakeTimers();
    const hang = () => new Promise<never>(() => undefined);
    const p = withToolTimeout(hang, TOOL_TIMEOUT_APPLY_MS, 'applyDocumentEdits');
    jest.advanceTimersByTime(TOOL_TIMEOUT_APPLY_MS);
    const res = await p;
    expect(res).toMatchObject({ ok: false, error: 'timeout' });
    expect((res as any).message).toContain('90s');
  });

  it('applies the timeout through dispatchAssistantTool for a hung bridge', async () => {
    jest.useFakeTimers();
    const bridge = () => new Promise<never>(() => undefined);
    const p = dispatchAssistantTool(
      'getDocumentInventory',
      {},
      { docxBridge: { getDocumentInventory: bridge } }
    );
    jest.advanceTimersByTime(TOOL_TIMEOUT_READ_MS);
    const res = await p;
    expect(res.output).toMatchObject({ ok: false, error: 'timeout' });
    expect((res.output as any).message).toContain('60s');
  });
});

describe('normalizeSelection', () => {
  it('returns null for missing or anchorless selections', () => {
    expect(normalizeSelection(null)).toBeNull();
    expect(normalizeSelection(undefined)).toBeNull();
    expect(normalizeSelection({ text: 'x', isCollapsed: true } as any)).toBeNull();
  });

  it('clamps text to the 500-char limit and coerces isCollapsed', () => {
    const long = 'a'.repeat(600);
    const res = normalizeSelection({
      anchor: '0:1',
      text: long,
      isCollapsed: false
    });
    expect(res).not.toBeNull();
    expect(res!.text).toHaveLength(SELECTION_TEXT_LIMIT);
    expect(res!.anchor).toBe('0:1');
    expect(res!.isCollapsed).toBe(false);
  });
});

describe('buildCallableRules', () => {
  it('keeps only tool rules and projects the tool-facing shape', () => {
    const logicRules = [
      {
        id: 'r1',
        name: 'Tool One',
        description: 'does a thing',
        trigger_event: 'tool',
        server_side: true,
        metadata: { tool: { parameters: [{ name: 'x', type: 'number' }] } }
      },
      { id: 'r2', name: 'On Load', trigger_event: 'load', server_side: false }
    ];
    expect(buildCallableRules(logicRules)).toEqual([
      {
        id: 'r1',
        name: 'Tool One',
        description: 'does a thing',
        server_side: true,
        parameters: [{ name: 'x', type: 'number' }]
      }
    ]);
  });

  it('defaults to an empty parameter list and handles no input', () => {
    expect(buildCallableRules()).toEqual([]);
    const [only] = buildCallableRules([
      { id: 'r', name: 'R', trigger_event: 'tool' }
    ]);
    expect(only.parameters).toEqual([]);
    expect(only.server_side).toBe(false);
  });
});
