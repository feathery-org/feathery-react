import FeatheryClient from '../featheryClient';
import { fieldValues } from '../init';
import { parseUserVal } from '../entities/Field';
import {
  applyPendingPhoneInference,
  normalizePhoneValues,
  phoneServarsFromSteps
} from '../normalizePhoneValues';
import { loadPhoneValidator, phoneLibPromise } from '../validation';

jest.mock('../init', () => ({
  initInfo: () => ({ formSessions: {} }),
  initState: { formSessions: {} },
  fieldValues: {},
  registerKnownFieldKeys: jest.fn()
}));

const phoneServar = (key: string, repeated = false) => ({
  servar: {
    key,
    type: 'phone_number',
    repeated,
    metadata: { default_country: 'US', default_value: '' }
  }
});
const steps = [
  {
    servar_fields: [
      phoneServar('phone'),
      phoneServar('phone_session'),
      phoneServar('phones', true),
      { servar: { key: 'name', type: 'text_field', metadata: {} } }
    ]
  }
];
const servars = phoneServarsFromSteps(steps);

beforeAll(async () => {
  loadPhoneValidator();
  await phoneLibPromise;
});
beforeEach(() => {
  Object.keys(fieldValues).forEach((key) => delete fieldValues[key]);
});

describe('normalizePhoneValues array identity', () => {
  it('returns the same array when no entry changes', () => {
    const phones = ['12025550123', '442079460018'];
    const result = normalizePhoneValues({ phones }, servars, true);
    expect(result.phones).toBe(phones);
  });

  it('returns a new array when an entry is normalized', () => {
    const phones = ['(202) 555-0123', '442079460018'];
    const result = normalizePhoneValues({ phones }, servars);
    expect(result.phones).not.toBe(phones);
    expect(result.phones).toEqual(['12025550123', '442079460018']);
    expect(phones[0]).toBe('(202) 555-0123');
  });
});

describe('setFieldValues before the schema loads', () => {
  it('infers pre-load values as fresh input once the form arrives', () => {
    // Arrange: no form is loaded, so the servar cannot be found yet.
    fieldValues.phone = parseUserVal('6612345678', 'phone');
    fieldValues.phones = ['6612345678', '(202) 555-0123'].map((entry) =>
      parseUserVal(entry, 'phones')
    );
    fieldValues.name = parseUserVal('Ada', 'name');
    expect(fieldValues.phone).toBe('6612345678');

    // Act
    FeatheryClient.prototype.setDefaultFormValues.call(
      {},
      { steps, additionalValues: {} }
    );

    // Assert: the US field interprets the bare digits nationally.
    expect(fieldValues.phone).toBe('16612345678');
    expect(fieldValues.phones).toEqual(['16612345678', '12025550123']);
    expect(fieldValues.name).toBe('Ada');
  });

  it('keeps a session value that replaced the pre-load value', () => {
    fieldValues.phone_session = parseUserVal('6612345678', 'phone_session');
    // Session hydration assigns saved canonical digits directly.
    fieldValues.phone_session = '66912345678';

    FeatheryClient.prototype.setDefaultFormValues.call(
      {},
      { steps, additionalValues: {} }
    );

    expect(fieldValues.phone_session).toBe('66912345678');
  });

  it('does not reinterpret the same value on a later form load', () => {
    fieldValues.phone = parseUserVal('6612345678', 'phone');
    FeatheryClient.prototype.setDefaultFormValues.call(
      {},
      { steps, additionalValues: {} }
    );
    expect(fieldValues.phone).toBe('16612345678');

    // A saved Thai number arriving afterwards must not be re-inferred.
    fieldValues.phone = '6612345678';
    FeatheryClient.prototype.setDefaultFormValues.call(
      {},
      { steps, additionalValues: {} }
    );
    expect(fieldValues.phone).toBe('6612345678');
  });

  it('leaves keys unknown to the loaded schema pending', () => {
    fieldValues.other_phone = parseUserVal('6612345678', 'other_phone');
    expect(applyPendingPhoneInference(fieldValues, servars)).toEqual({});

    const later = phoneServarsFromSteps([
      { servar_fields: [phoneServar('other_phone')] }
    ]);
    expect(applyPendingPhoneInference(fieldValues, later)).toEqual({
      other_phone: '16612345678'
    });
  });
});
