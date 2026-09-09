import Field from '../entities/Field';
import { defaultClient, fieldValues, setFieldValues } from '../init';
import internalState from '../internalState';
import { loadPhoneValidator, phoneLibPromise } from '../validation';
import { phoneFixtures } from './phoneFixtures';

jest.mock('../featheryClient', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ submitCustom: jest.fn() }))
}));
jest.mock('../formHelperFunctions', () => ({
  rerenderAllForms: jest.fn(),
  remountAllForms: jest.fn()
}));
jest.mock('../../auth/LoginForm', () => ({ authState: {} }));

beforeAll(async () => {
  loadPhoneValidator();
  await phoneLibPromise;
});
beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(fieldValues).forEach((key) => delete fieldValues[key]);
});
afterEach(() => {
  delete internalState.phone_matrix;
  delete internalState.other_phone_matrix;
});
const setup = (country: string, locked = false, repeated = false) => {
  internalState.phone_matrix = {
    steps: {
      first: {
        servar_fields: [
          {
            servar: {
              key: 'phone',
              type: 'phone_number',
              repeated,
              metadata: {
                default_country: country,
                disable_other_countries: locked
              }
            }
          }
        ]
      }
    }
  } as any;
  return new Field('phone', 'phone_matrix');
};
const cases = phoneFixtures.flatMap((fixture) =>
  [false, true].flatMap((locked) =>
    ['scalar', 'array', 'index', 'bulk'].flatMap((mode) =>
      [
        fixture.national,
        fixture.formatted,
        fixture.canonical,
        `+${fixture.canonical}`
      ].map((input) => [
        fixture.country,
        locked,
        mode,
        input,
        fixture.canonical
      ])
    )
  )
);

it.each(cases)(
  '%s locked=%s mode=%s input=%s',
  (country, locked, mode, input, canonical) => {
    const field = setup(
      country as string,
      locked as boolean,
      mode === 'array' || mode === 'index'
    );
    let expected: any = canonical;
    if (mode === 'scalar') field.value = input;
    if (mode === 'array') {
      field.value = [input, null];
      expected = [canonical, null];
    }
    if (mode === 'index') {
      field.value = ['+12025550123', ''];
      (field.value as string[])[1] = input as string;
      expected = ['12025550123', canonical];
    }
    if (mode === 'bulk') setFieldValues({ phone: input });
    expect(fieldValues.phone).toEqual(expected);
    expect(defaultClient.submitCustom).toHaveBeenLastCalledWith({
      phone: expected
    });
  }
);

it('keeps unchanged canonical scalar assignments stable', () => {
  const field = setup('US');
  field.value = '+6612345678';
  const existing = field.value;
  field.value = existing;
  expect(field.value).toBe('6612345678');
  setFieldValues({ phone: field.value });
  expect(field.value).toBe('6612345678');
});
it('keeps canonical repeat entries stable when arrays are copied or reordered', () => {
  const field = setup('US', false, true);
  field.value = ['+6612345678', '+12025550123'];
  field.value = [...(field.value as string[])].reverse();
  expect(field.value).toEqual(['12025550123', '6612345678']);
  (field.value as string[])[1] = (field.value as string[])[1];
  expect(field.value).toEqual(['12025550123', '6612345678']);
});
it('uses the owning form country when multiple forms share a field key', () => {
  setup('US');
  internalState.other_phone_matrix = {
    steps: {
      first: {
        servar_fields: [
          {
            servar: {
              key: 'phone',
              type: 'phone_number',
              metadata: { default_country: 'GB' }
            }
          }
        ]
      }
    }
  } as any;
  const field = new Field('phone', 'other_phone_matrix');
  field.value = '02079460018';
  expect(field.value).toBe('442079460018');
});
it('does not lose writes for a field whose form is not mounted', () => {
  const field = new Field('phone', 'not-mounted');
  field.value = '02079460018';
  expect(field.value).toBe('02079460018');
});
it('uses current country metadata when a rule changes field settings', () => {
  const field = setup('US');
  field.value = '2025550123';
  (
    internalState.phone_matrix.steps as any
  ).first.servar_fields[0].servar.metadata = { default_country: 'GB' };
  field.value = '02079460018';
  expect(field.value).toBe('442079460018');
});
