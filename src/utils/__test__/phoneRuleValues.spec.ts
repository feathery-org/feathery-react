import Field from '../entities/Field';
import { defaultClient, fieldValues, setFieldValues } from '../init';
import internalState from '../internalState';
import { loadPhoneValidator, phoneLibPromise } from '../validation';

jest.mock('../featheryClient', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ submitCustom: jest.fn() }))
}));
jest.mock('../formHelperFunctions', () => ({
  rerenderAllForms: jest.fn(),
  remountAllForms: jest.fn()
}));
jest.mock('../../auth/LoginForm', () => ({ authState: {} }));

const formId = 'phone-rule-form';
const phoneField = (key: string, country: string) => ({
  servar: {
    key,
    type: 'phone_number',
    metadata: { default_country: country, disable_other_countries: false }
  }
});

beforeAll(async () => {
  loadPhoneValidator();
  await phoneLibPromise;
});

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(fieldValues).forEach((key) => delete fieldValues[key]);
  internalState[formId] = {
    steps: {
      first: {
        servar_fields: [
          phoneField('us_phone', 'US'),
          phoneField('gb_phone', 'GB'),
          { servar: { key: 'text', type: 'text_field', metadata: {} } }
        ]
      }
    }
  } as any;
});

afterEach(() => {
  delete internalState[formId];
});

describe('phone values assigned by custom logic', () => {
  it.each([
    ['us_phone', '(415) 555-2671', '14155552671'],
    ['us_phone', '1 (415) 555-2671', '14155552671'],
    ['gb_phone', '020 7946 0018', '442079460018'],
    ['gb_phone', '44 20 7946 0018', '442079460018'],
    ['us_phone', '442079460018', '442079460018']
  ])(
    'normalizes %s assignment %s before submission',
    (key, value, expected) => {
      const field = new Field(key, formId);
      field.value = value;
      expect(field.value).toBe(expected);
      expect(defaultClient.submitCustom).toHaveBeenLastCalledWith({
        [key]: expected
      });
    }
  );

  it('normalizes repeated values and individual repeat assignments', () => {
    const field = new Field('us_phone', formId);
    field.value = ['(415) 555-2671', '1 212 555 0123'];
    expect(field.value).toEqual(['14155552671', '12125550123']);

    (field.value as string[])[1] = '(650) 253-0000';
    expect(field.value).toEqual(['14155552671', '16502530000']);
    expect(defaultClient.submitCustom).toHaveBeenLastCalledWith({
      us_phone: ['14155552671', '16502530000']
    });
  });

  it('normalizes setFieldValues using the loaded field settings', () => {
    const values = {
      us_phone: ['(415) 555-2671', '1 212 555 0123'],
      gb_phone: '020 7946 0018',
      text: '(415) 555-2671'
    };
    setFieldValues(values);
    expect(fieldValues).toEqual({
      us_phone: ['14155552671', '12125550123'],
      gb_phone: '442079460018',
      text: '(415) 555-2671'
    });
    expect(values.us_phone).toEqual(['(415) 555-2671', '1 212 555 0123']);
    expect(defaultClient.submitCustom).toHaveBeenLastCalledWith(fieldValues);
  });

  it.each(['123', 'not a phone', '', null])(
    'preserves invalid or empty value %s for existing validation',
    (value) => {
      const field = new Field('us_phone', formId);
      field.value = value;
      expect(field.value).toBe(value);
    }
  );

  it('preserves canonical server numbers that also look like local numbers', () => {
    setFieldValues({ us_phone: '6612345678' }, true, true, true);
    expect(fieldValues.us_phone).toBe('6612345678');
    const field = new Field('us_phone', formId);
    field.value = '';
    field.value = '6612345678';
    expect(field.value).toBe('16612345678');
  });

  it('preserves values for fields without phone metadata', () => {
    const field = new Field('text', formId);
    field.value = '(415) 555-2671';
    expect(field.value).toBe('(415) 555-2671');
    setFieldValues({ unknown: '(415) 555-2671' });
    expect(fieldValues.unknown).toBe('(415) 555-2671');
  });
});
