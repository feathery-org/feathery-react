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
      {
        field: 'premium',
        previous: '$8,000',
        value: '$9,500',
        describes: "the rendered value of form field 'premium'"
      }
    ]);
    // Fields changed, so the result states plainly the document was not
    // edited by the rule itself.
    expect(res.documentEdited).toBe(false);
    expect(res.note).toMatch(/did NOT edit the open document/);
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

    expect(res.changedFields).toEqual([]);
    expect(res.changedFieldDetails).toEqual([]);
    expect(res.derivedUpdates).toBeUndefined();
    expect(res.documentEdited).toBeUndefined();
    expect(res.note).toBeUndefined();
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
    // A changed field receives the same deterministic old->new document safety
    // net as the server path, even when the rule returned only a scalar.
    expect(res.derivedUpdates).toEqual([
      {
        field: 'myField',
        previous: 'old',
        value: '+10000000000',
        describes: "the rendered value of form field 'myField'"
      }
    ]);
    expect((internalState[FORM].fields as any).myField.value).toBe(
      '+10000000000'
    );
  });

  // The captain's live case: a rule that only mutates a form field and
  // returns nothing must surface the change as a document-reflectable update
  // with the field's before and after values, plus an explicit statement that
  // the document itself was NOT edited.
  it('surfaces a field-mutating rule that returns nothing as a derived update with before/after values', async () => {
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
      FORM
    );

    expect(res.returnValue).toBeUndefined();
    expect(res.changedFieldDetails).toEqual([
      {
        key: 'PE_AETitle',
        oldValue: 'Risk Advisor',
        newValue: 'Sr. Risk Advisor'
      }
    ]);
    // `previous` carries the pre-rule value for the exact-text search, and
    // `describes` names the field (key + admin label) so reflection can fall
    // back to semantic search when the document holds an older rendering.
    expect(res.derivedUpdates).toEqual([
      {
        field: 'PE_AETitle',
        previous: 'Risk Advisor',
        value: 'Sr. Risk Advisor',
        describes: 'the rendered value of form field \'PE_AETitle\' ("Advisor Title")'
      }
    ]);
    // The honesty half: the rule ran, the document did not change.
    expect(res.documentEdited).toBe(false);
    expect(res.note).toMatch(/did NOT edit the open document/);
    expect(res.note).toMatch(/could not be/);
  });

  it('omits `previous` when the pre-rule value is empty, keeping describes as the only locator', async () => {
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

    const res = await runLogicRuleById('c5', {}, FORM);

    expect(res.derivedUpdates).toEqual([
      {
        field: 'PE_Company',
        value: 'New Co',
        describes: "the rendered value of form field 'PE_Company'"
      }
    ]);
    expect(res.documentEdited).toBe(false);
  });

  it('keeps changedFieldDetails and the honesty note for a change that cannot drive a text replace', async () => {
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

    const res = await runLogicRuleById('c6', {}, FORM);

    expect(res.changedFieldDetails).toEqual([
      { key: 'matrix', oldValue: 'plain', newValue: { nested: true } }
    ]);
    // No text to search/replace with - but the result still says the rule did
    // not edit the document, so the model cannot claim a silent success.
    expect(res.derivedUpdates).toBeUndefined();
    expect(res.documentEdited).toBe(false);
    expect(res.note).toMatch(/could not be/);
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

    const res = await runLogicRuleById('c7', {}, FORM);

    // PE_AETitle is covered by the rule's own updates entry (passed through
    // untouched on returnValue) and must not be double-applied; PE_Phone was
    // only mutated, so it still gets the derived safety net.
    expect(res.returnValue.updates).toEqual([
      {
        field: 'PE_AETitle',
        previous: 'Risk Advisor',
        value: 'Sr. Risk Advisor'
      }
    ]);
    expect(res.derivedUpdates).toEqual([
      {
        field: 'PE_Phone',
        previous: '555-1111',
        value: '+15551111',
        describes: "the rendered value of form field 'PE_Phone'"
      }
    ]);
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
    // A rule that changes nothing produces no updates and no reflection note.
    expect(res.derivedUpdates).toBeUndefined();
    expect(res.documentEdited).toBeUndefined();
    expect(res.note).toBeUndefined();
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
