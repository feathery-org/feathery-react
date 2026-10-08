import internalState from '../../internalState';
import { runLogicRuleById } from '../../../Form/logic';
import { runLogicRule } from '../runLogicRule';

jest.mock('../../../Form/logic', () => ({ runLogicRuleById: jest.fn() }));

const runRule = runLogicRuleById as jest.Mock;

// A tool rule runs only when the form offers it, with the params it declares, and reports what changed
describe('runLogicRule', () => {
  const formUuid = 'form-rule-test';

  const toolRule = (over: Record<string, any> = {}) => ({
    id: 'r1',
    name: 'Normalize phone',
    trigger_event: 'tool',
    enabled: true,
    valid: true,
    server_side: false,
    metadata: {
      tool: { parameters: [{ name: 'phone', type: 'string', required: true }] }
    },
    ...over
  });

  const makeState = (logicRules: any[]) => {
    const state: any = {
      currentStep: { key: 'step-1' },
      logicRules,
      inlineErrors: {},
      formSettings: {}
    };
    (internalState as any)[formUuid] = state;
    return state;
  };

  const ran = (fieldChanges: any[] = []) => ({
    ok: true,
    rule: { id: 'r1', name: 'Normalize phone' },
    result: null,
    fieldChanges
  });

  afterEach(() => {
    delete (internalState as any)[formUuid];
    jest.clearAllMocks();
  });

  it('reports a form that has not loaded as a failed call', async () => {
    await expect(runLogicRule(formUuid, 'r1')).resolves.toEqual({
      ok: false,
      reason: 'not_loaded',
      message: expect.any(String)
    });
    expect(runRule).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', []],
    ['change-triggered', [toolRule({ trigger_event: 'change' })]],
    ['disabled', [toolRule({ enabled: false })]],
    ['invalid', [toolRule({ valid: false })]],
    ['server-side', [toolRule({ server_side: true })]]
  ])('refuses a %s rule without running it', async (_label, rules) => {
    makeState(rules);

    const result = await runLogicRule(formUuid, 'r1', { phone: '5' });

    expect(result).toMatchObject({ ok: false, reason: 'unknown_rule' });
    expect(runRule).not.toHaveBeenCalled();
  });

  it.each([
    ['a required param is missing', {}],
    ['a param has the wrong type', { phone: 5 }],
    ['a param is not declared', { phone: '5', extra: 'x' }]
  ])('rejects the call when %s', async (_label, params) => {
    makeState([toolRule()]);

    const result = await runLogicRule(formUuid, 'r1', params as any);

    expect(result).toMatchObject({ ok: false, reason: 'invalid_params' });
    expect(runRule).not.toHaveBeenCalled();
  });

  it('cannot supply a file param for the person', async () => {
    makeState([
      toolRule({
        metadata: { tool: { parameters: [{ name: 'doc', type: 'file' }] } }
      })
    ]);

    const result = await runLogicRule(formUuid, 'r1', { doc: 'x' });

    expect(result).toMatchObject({ ok: false, reason: 'invalid_params' });
  });

  it('runs the rule with its params and returns the changes it made', async () => {
    makeState([toolRule()]);
    const fieldChanges = [{ key: 'phone', before: '5', after: '+15' }];
    runRule.mockResolvedValue(ran(fieldChanges));

    const result = await runLogicRule(formUuid, 'r1', { phone: '5' });

    expect(runRule).toHaveBeenCalledWith('r1', { phone: '5' }, formUuid);
    expect(result).toEqual({
      ok: true,
      rule: { id: 'r1', name: 'Normalize phone' },
      result: null,
      fieldChanges,
      navigated: null
    });
  });

  it('treats a rule that threw as an action that may have partly run', async () => {
    makeState([toolRule()]);
    runRule.mockResolvedValue({ ...ran(), ok: false, error: 'Boom' });

    await expect(
      runLogicRule(formUuid, 'r1', { phone: '5' })
    ).resolves.toEqual({ ok: false, reason: 'action_failed', message: 'Boom' });
  });

  it('reports the step change and the errors the rule surfaced', async () => {
    const state = makeState([toolRule()]);
    runRule.mockImplementation(async () => {
      state.latestStepName = 'step-2';
      state.inlineErrors = { phone: { message: 'Invalid' } };
      return ran();
    });

    const result = await runLogicRule(formUuid, 'r1', { phone: '5' });

    expect(result).toMatchObject({
      ok: true,
      navigated: { fromStepKey: 'step-1', toStepKey: 'step-2' },
      fieldErrors: [{ key: 'phone', message: 'Invalid' }]
    });
  });
});
