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
        {
          id: 's1',
          name: 'Server Rule',
          trigger_event: 'tool',
          server_side: true
        }
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

  it('pairs field_data new values with pre-invoke old values and derives doc updates', async () => {
    const client = {
      runServerSideLogicRule: jest.fn().mockResolvedValue({
        field_data: { premium: '$9,500', internalFlag: { deep: true } }
      })
    };
    seed({
      client,
      fields: { premium: { value: '$8,000' } },
      logicRules: [
        {
          id: 's1',
          name: 'Server Rule',
          trigger_event: 'tool',
          server_side: true
        }
      ]
    });

    const res = await runLogicRuleById('s1', {}, FORM);

    // Old->new details: oldValue from the snapshot taken BEFORE invocation,
    // newValue from the backend's authoritative field_data. A field the form
    // never held snapshots as null.
    expect(res.changedFieldDetails).toEqual([
      { key: 'premium', oldValue: '$8,000', newValue: '$9,500' },
      { key: 'internalFlag', oldValue: null, newValue: { deep: true } }
    ]);
    // Derived doc updates: scalar old->new pairs only - the object-valued
    // field can't drive an exact-text replace and is skipped.
    expect(res.derivedUpdates).toEqual([
      { field: 'premium', previous: '$8,000', value: '$9,500' }
    ]);
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
        {
          id: 's1',
          name: 'Server Rule',
          trigger_event: 'tool',
          server_side: true
        }
      ]
    });
    const res = await runLogicRuleById('s1', {}, FORM);
    expect(res.error).toBe('lambda blew up');
    expect(res.changedFields).toEqual([]);
  });
});

describe('runLogicRuleById - client-side path', () => {
  it('exposes tool inputs as feathery.params and applies the published phone-number rule shape', async () => {
    seed({
      fields: { myField: { value: 'old' } },
      logicRules: [
        {
          id: 'c1',
          name: 'Client Rule',
          trigger_event: 'tool',
          server_side: false,
          code:
            'if (feathery.params.phoneNumber !== "(519) 616-2709") throw new Error("missing phone number");\n' +
            'myField.value = "+10000000000";\n' +
            'return "+10000000000";'
        }
      ]
    });

    const res = await runLogicRuleById(
      'c1',
      { phoneNumber: '(519) 616-2709' },
      FORM
    );

    expect(res.returnValue).toBe('+10000000000');
    expect(res.changedFields).toEqual(['myField']);
    // The pre-invoke snapshot is returned, not discarded: old->new per field.
    expect(res.changedFieldDetails).toEqual([
      { key: 'myField', oldValue: 'old', newValue: '+10000000000' }
    ]);
    // A changed field receives the same deterministic old→new document safety\n    // net as the server path, even when the rule returned only a scalar.\n    expect(res.derivedUpdates).toEqual([\n      { field: 'myField', previous: 'old', value: '+10000000000' }\n    ]);
    expect((internalState[FORM].fields as any).myField.value).toBe(
      '+10000000000'
    );
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
          code: 'return feathery.params.answer;'
        }
      ]
    });

    const res = await runLogicRuleById('c2', { answer: 7 }, FORM);
    expect(res.returnValue).toBe(7);
    expect(res.changedFields).toEqual([]);
  });

  it('returns an error when rule code throws instead of reporting success', async () => {
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
    expect(res.returnValue).toBeUndefined();
    expect(res.changedFields).toEqual([]);
    expect(res.error).toBe('kaboom');
  });
});
