import { runLogicRuleById } from '../logic';
import internalState from '../../utils/internalState';
import { setFieldValues } from '../../utils/init';

// Override setFieldValues so the server-side path doesn't mutate real form
// state, and stub the form-context providers so client-side rules run against a
// lightweight `feathery` object - we're exercising runLogicRuleById's branch
// selection, params exposure, return capture, and changed-field diff, not the
// full form-context machinery.
jest.mock('../../utils/init', () => {
  const actual = jest.requireActual('../../utils/init');
  return { ...actual, setFieldValues: jest.fn() };
});
jest.mock('../../utils/formContext', () => ({ getFormContext: () => ({}) }));
jest.mock('../../utils/sensitiveActions', () => ({
  getPrivateActions: () => ({})
}));
jest.mock('../../utils/formHelperFunctions', () => ({
  httpHelpers: () => ({}),
  processFileValues: jest.fn(),
  rerenderAllForms: jest.fn()
}));

const FORM = 'form-uuid-1';

const seed = (over: Record<string, any> = {}) => {
  internalState[FORM] = {
    client: { runServerSideLogicRule: jest.fn() },
    logicRules: [],
    fields: {},
    extractedSharedCodeInfo: [],
    connectorFields: {},
    ...over
  } as any;
};

afterEach(() => {
  Object.keys(internalState).forEach((k) => delete (internalState as any)[k]);
  jest.clearAllMocks();
});

describe('runLogicRuleById - resolution', () => {
  it('errors when the form has not loaded', async () => {
    const res = await runLogicRuleById('r1', {}, 'missing');
    expect(res.changedFields).toEqual([]);
    expect(res.error).toMatch(/has not loaded/i);
  });

  it('errors when the rule id is not on the form', async () => {
    seed({ logicRules: [] });
    const res = await runLogicRuleById('nope', {}, FORM);
    expect(res.error).toMatch(/was not found/i);
  });

  it('falls back to the only loaded form when no uuid is passed', async () => {
    const client = {
      runServerSideLogicRule: jest.fn().mockResolvedValue({ field_data: {} })
    };
    seed({
      client,
      logicRules: [
        { id: 's1', name: 'S', trigger_event: 'tool', server_side: true }
      ]
    });
    const res = await runLogicRuleById('s1', {});
    expect(client.runServerSideLogicRule).toHaveBeenCalled();
    expect(res.changedFields).toEqual([]);
  });
});

describe('runLogicRuleById - server-side path', () => {
  it('forwards input_params, applies field_data, and reports changedFields', async () => {
    const client = {
      runServerSideLogicRule: jest.fn().mockResolvedValue({
        field_data: { fieldA: '1', fieldB: '2' }
      })
    };
    seed({
      client,
      logicRules: [
        { id: 's1', name: 'Server Rule', trigger_event: 'tool', server_side: true }
      ]
    });

    const res = await runLogicRuleById('s1', { foo: 'bar' }, FORM);

    expect(client.runServerSideLogicRule).toHaveBeenCalledWith('s1', {
      input_params: { foo: 'bar' }
    });
    expect(setFieldValues).toHaveBeenCalledWith(
      { fieldA: '1', fieldB: '2' },
      true,
      true
    );
    expect(res.changedFields.sort()).toEqual(['fieldA', 'fieldB']);
    // Server-side returnValue stays undefined in v1
    expect(res.returnValue).toBeUndefined();
  });

  it('surfaces a backend error and does not report changed fields', async () => {
    const client = {
      runServerSideLogicRule: jest
        .fn()
        .mockResolvedValue({ error: 'lambda blew up' })
    };
    seed({
      client,
      logicRules: [
        { id: 's1', name: 'Server Rule', trigger_event: 'tool', server_side: true }
      ]
    });
    const res = await runLogicRuleById('s1', {}, FORM);
    expect(res.error).toBe('lambda blew up');
    expect(res.changedFields).toEqual([]);
  });
});

describe('runLogicRuleById - client-side path', () => {
  it('exposes params as feathery.inputs, captures the return value, and diffs changed fields', async () => {
    seed({
      fields: { myField: { value: 'old' } },
      logicRules: [
        {
          id: 'c1',
          name: 'Client Rule',
          trigger_event: 'tool',
          server_side: false,
          code:
            'myField.value = feathery.inputs.newVal;\n' +
            'return { token: feathery.inputs.token };'
        }
      ]
    });

    const res = await runLogicRuleById(
      'c1',
      { newVal: 'new', token: 'T-123' },
      FORM
    );

    expect(res.returnValue).toEqual({ token: 'T-123' });
    expect(res.changedFields).toEqual(['myField']);
    expect((internalState[FORM].fields as any).myField.value).toBe('new');
  });

  it('reports no changed fields when the rule touches nothing', async () => {
    seed({
      fields: { myField: { value: 'old' } },
      logicRules: [
        {
          id: 'c2',
          name: 'Read Only Rule',
          trigger_event: 'tool',
          server_side: false,
          code: 'return feathery.inputs.answer;'
        }
      ]
    });

    const res = await runLogicRuleById('c2', { answer: 7 }, FORM);
    expect(res.returnValue).toBe(7);
    expect(res.changedFields).toEqual([]);
  });

  it('captures undefined return value without throwing when rule code errors', async () => {
    seed({
      logicRules: [
        {
          id: 'c3',
          name: 'Boom Rule',
          trigger_event: 'tool',
          server_side: false,
          code: 'throw new Error("kaboom");'
        }
      ]
    });
    const res = await runLogicRuleById('c3', {}, FORM);
    // runClientSideLogic swallows + logs the error; return value is undefined
    expect(res.returnValue).toBeUndefined();
    expect(res.changedFields).toEqual([]);
  });
});
