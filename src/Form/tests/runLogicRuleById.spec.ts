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
const WITH_DOCUMENT = { documentPresent: true };

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
    expect(res.ok).toBe(false);
    expect(res.fieldChanges).toEqual([]);
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
    expect(res).toMatchObject({
      ok: true,
      rule: { id: 's1', name: 'S' },
      result: null,
      fieldChanges: []
    });
  });
});

describe('runLogicRuleById - server-side path', () => {
  it('forwards input_params, applies field_data, and reports canonical fieldChanges', async () => {
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
    expect(res.fieldChanges).toEqual([
      { key: 'fieldA', before: null, after: '1' },
      { key: 'fieldB', before: null, after: '2' }
    ]);
    expect(res.result).toBeNull();
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

    const res = await runLogicRuleById('s1', {}, FORM, WITH_DOCUMENT);

    // Old->new details: oldValue from the snapshot taken BEFORE invocation,
    // newValue from the backend's authoritative field_data. A field the form
    // never held snapshots as null.
    expect(res.fieldChanges).toEqual([
      {
        key: 'premium',
        before: '$8,000',
        after: '$9,500',
        documentHint: {
          describes: "the rendered value of form field 'premium'"
        }
      },
      {
        key: 'internalFlag',
        before: null,
        after: { deep: true },
        documentHint: {
          describes: "the rendered value of form field 'internalFlag'"
        }
      }
    ]);
    expect(res).not.toHaveProperty('changedFields');
    expect(res).not.toHaveProperty('changedFieldDetails');
    expect(res).not.toHaveProperty('derivedUpdates');
    expect(res).not.toHaveProperty('note');
  });

  it('does not surface a field_data entry that echoes the pre-rule value', async () => {
    const client = {
      runServerSideLogicRule: jest.fn().mockResolvedValue({
        field_data: { premium: '$8,000', untouched: 'same' }
      })
    };
    seed({
      client,
      fields: { premium: { value: '$8,000' }, untouched: { value: 'same' } },
      logicRules: [
        {
          id: 's1',
          name: 'No-op Server Rule',
          trigger_event: 'tool',
          server_side: true
        }
      ]
    });

    const res = await runLogicRuleById('s1', {}, FORM);

    expect(res.fieldChanges).toEqual([]);
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
    expect(res.ok).toBe(false);
    expect(res.fieldChanges).toEqual([]);
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
      FORM,
      WITH_DOCUMENT
    );

    expect(res.result).toBe('+10000000000');
    expect(res.fieldChanges).toEqual([
      {
        key: 'myField',
        before: 'old',
        after: '+10000000000',
        documentHint: {
          describes: "the rendered value of form field 'myField'"
        }
      }
    ]);
    expect((internalState[FORM].fields as any).myField.value).toBe(
      '+10000000000'
    );
  });

  it('recursively round-trips non-cloneable values in a client rule return', async () => {
    seed({
      logicRules: [
        {
          id: 'c-file',
          name: 'File Return',
          trigger_event: 'tool',
          server_side: false,
          code:
            'const file = new File(["policy"], "policy.pdf");\n' +
            'return { file, nested: { pending: Promise.resolve("secret") } };'
        }
      ]
    });

    const res = await runLogicRuleById('c-file', {}, FORM);

    expect(res.result).toEqual({
      file: {
        kind: 'file',
        present: true,
        name: 'policy.pdf',
        size: 6
      },
      nested: { pending: { kind: 'promise', present: true } }
    });
    expect(() => JSON.stringify(res)).not.toThrow();
  });

  it('bounds a client rule return before it reaches the assistant transport', async () => {
    seed({
      logicRules: [
        {
          id: 'c-large',
          name: 'Large Return',
          trigger_event: 'tool',
          server_side: false,
          code: 'return { nested: { text: "x".repeat(20000) } };'
        }
      ]
    });

    const res = await runLogicRuleById('c-large', {}, FORM);

    expect(typeof res.result).toBe('string');
    expect(JSON.stringify(res.result).length).toBeLessThanOrEqual(8000);
    expect((res.result as string).endsWith('…')).toBe(true);
  });

  it('bounds the serialized size of escape-heavy return text', async () => {
    seed({
      logicRules: [
        {
          id: 'c-escaped',
          name: 'Escaped Return',
          trigger_event: 'tool',
          server_side: false,
          code: 'return "\\x00".repeat(3000);'
        }
      ]
    });

    const res = await runLogicRuleById('c-escaped', {}, FORM);

    expect(JSON.stringify(res.result).length).toBeLessThanOrEqual(8000);
    expect((res.result as string).endsWith('…')).toBe(true);
  });

  // The captain's live case: a rule that only mutates a form field and returns
  // nothing must surface one canonical change with the field's before/after
  // values and an optional document locator.
  it('surfaces a field-mutating rule that returns nothing as one canonical field change', async () => {
    seed({
      fields: { PE_AETitle: { value: 'Risk Advisor' } },
      steps: {
        step1: {
          servar_fields: [
            { servar: { key: 'PE_AETitle', name: 'Advisor Title' } }
          ]
        }
      },
      logicRules: [
        {
          id: 'c07cc11e',
          name: 'FM Set Advisor Title',
          trigger_event: 'tool',
          server_side: false,
          code: 'PE_AETitle.value = feathery.params.title;'
        }
      ]
    });

    const res = await runLogicRuleById(
      'c07cc11e',
      { title: 'Sr. Risk Advisor' },
      FORM,
      WITH_DOCUMENT
    );

    expect(res.result).toBeNull();
    expect(res.fieldChanges).toEqual([
      {
        key: 'PE_AETitle',
        before: 'Risk Advisor',
        after: 'Sr. Risk Advisor',
        documentHint: {
          describes:
            'the rendered value of form field \'PE_AETitle\' ("Advisor Title")'
        }
      }
    ]);
    const roundTripped = JSON.parse(JSON.stringify(res));
    expect(roundTripped).toEqual(res);
    expect(Object.keys(roundTripped).sort()).toEqual([
      'fieldChanges',
      'ok',
      'result',
      'rule'
    ]);
    expect(
      new Set(roundTripped.fieldChanges.map((change: any) => change.key)).size
    ).toBe(roundTripped.fieldChanges.length);
  });

  it('keeps an empty before value and uses describes as the document locator', async () => {
    seed({
      fields: { PE_Company: { value: '' } },
      logicRules: [
        {
          id: 'c5',
          name: 'Fill Company',
          trigger_event: 'tool',
          server_side: false,
          code: 'PE_Company.value = "New Co";'
        }
      ]
    });

    const res = await runLogicRuleById('c5', {}, FORM, WITH_DOCUMENT);

    expect(res.fieldChanges).toEqual([
      {
        key: 'PE_Company',
        before: '',
        after: 'New Co',
        documentHint: {
          describes: "the rendered value of form field 'PE_Company'"
        }
      }
    ]);
  });

  it('keeps non-text before/after facts in the one canonical list', async () => {
    seed({
      fields: { matrix: { value: 'plain' } },
      logicRules: [
        {
          id: 'c6',
          name: 'Objectify',
          trigger_event: 'tool',
          server_side: false,
          code: 'matrix.value = { nested: true };'
        }
      ]
    });

    const res = await runLogicRuleById('c6', {}, FORM, WITH_DOCUMENT);

    expect(res.fieldChanges).toEqual([
      {
        key: 'matrix',
        before: 'plain',
        after: { nested: true },
        documentHint: {
          describes: "the rendered value of form field 'matrix'"
        }
      }
    ]);
  });

  it('merges with, not duplicates, an explicitly returned updates array', async () => {
    seed({
      fields: {
        PE_AETitle: { value: 'Risk Advisor' },
        PE_Phone: { value: '555-1111' }
      },
      logicRules: [
        {
          id: 'c7',
          name: 'Dual Rule',
          trigger_event: 'tool',
          server_side: false,
          code:
            'PE_AETitle.value = "Sr. Risk Advisor";\n' +
            'PE_Phone.value = "+15551111";\n' +
            'return { updates: [{ field: "PE_AETitle", previous: "Risk Advisor", value: "Sr. Risk Advisor" }] };'
        }
      ]
    });

    const res = await runLogicRuleById('c7', {}, FORM, WITH_DOCUMENT);

    expect(res.result).toBeNull();
    expect(res.fieldChanges).toEqual([
      {
        key: 'PE_AETitle',
        before: 'Risk Advisor',
        after: 'Sr. Risk Advisor',
        documentHint: {
          describes: "the rendered value of form field 'PE_AETitle'"
        }
      },
      {
        key: 'PE_Phone',
        before: '555-1111',
        after: '+15551111',
        documentHint: {
          describes: "the rendered value of form field 'PE_Phone'"
        }
      }
    ]);
    const wireResult = JSON.parse(JSON.stringify(res));
    expect(wireResult).toEqual(res);
    expect(
      new Set(wireResult.fieldChanges.map((change: any) => change.key)).size
    ).toBe(2);
    expect(wireResult).not.toHaveProperty('derivedUpdates');
    expect(wireResult).not.toHaveProperty('changedFieldDetails');
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
    expect(res.result).toBe(7);
    expect(res.fieldChanges).toEqual([]);
  });

  it('does not emit document updates or instructions for a form-only chat', async () => {
    seed({
      fields: { myField: { value: 'old' } },
      logicRules: [
        {
          id: 'form-only',
          name: 'Form-only Rule',
          trigger_event: 'tool',
          server_side: false,
          code: 'myField.value = "new";'
        }
      ]
    });

    const res = await runLogicRuleById('form-only', {}, FORM, {
      documentPresent: false
    });

    expect(res.fieldChanges).toEqual([
      { key: 'myField', before: 'old', after: 'new' }
    ]);
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
    expect(res.result).toBeNull();
    expect(res.fieldChanges).toEqual([]);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('kaboom');
  });
});
