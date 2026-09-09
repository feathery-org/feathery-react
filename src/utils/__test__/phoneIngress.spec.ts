import { featheryWindow } from '../browser';
import FeatheryClient from '../featheryClient';
import { fieldValues } from '../init';
import { saveInitialValuesAndUrlParams } from '../fieldHelperFunctions';
import {
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

const examples = [
  ['US', '(415) 555-2671', '14155552671'],
  ['US', '1-415-555-2671', '14155552671'],
  ['US', '+1 (415) 555.2671', '14155552671'],
  ['GB', '020 7946 0018', '442079460018'],
  ['GB', '44-20-7946-0018', '442079460018'],
  ['GB', '+44 (20) 7946-0018', '442079460018'],
  ['AU', '0412 345 678', '61412345678'],
  ['US', '6612345678', '16612345678']
];
const settings = [false, true].flatMap((forced) =>
  [false, true].map((repeated) => ({ forced, repeated }))
);
const cases = examples.flatMap(([country, input, expected]) =>
  settings.map(({ forced, repeated }) => ({
    country,
    input,
    expected,
    forced,
    repeated
  }))
);
const schema = (
  country: string,
  forced = false,
  repeated = false,
  defaultValue = ''
) => ({
  first: {
    servar_fields: [
      {
        servar: {
          key: 'phone',
          type: 'phone_number',
          repeated,
          metadata: {
            default_country: country,
            disable_other_countries: forced,
            default_value: defaultValue
          }
        }
      }
    ]
  }
});

beforeAll(async () => {
  loadPhoneValidator();
  await phoneLibPromise;
});
beforeEach(() => {
  Object.keys(fieldValues).forEach((key) => delete fieldValues[key]);
  featheryWindow().history.replaceState({}, '', '/');
});

describe('initial, URL and integration phone ingress', () => {
  it.each(cases)(
    'normalizes initial props before display and submission: %j',
    ({ country, input, expected, forced, repeated }) => {
      const steps = schema(country, forced, repeated);
      const initialValues = { phone: repeated ? [input, input] : input };
      const expectedValues = {
        phone: repeated ? [expected, expected] : expected
      };
      const client = { submitCustom: jest.fn() } as any;
      const updateFieldValues = jest.fn();
      FeatheryClient.prototype.setDefaultFormValues.call(client, {
        steps: Object.values(steps),
        additionalValues: initialValues
      });
      expect(fieldValues).toEqual(expectedValues);
      saveInitialValuesAndUrlParams({
        steps,
        initialValues,
        client,
        updateFieldValues,
        saveUrlParams: false,
        hiddenFields: {}
      });
      expect(client.submitCustom).toHaveBeenCalledWith(expectedValues, {
        override: false
      });
      expect(updateFieldValues).toHaveBeenCalledWith(
        expectedValues,
        expect.any(Object)
      );
      expect(initialValues.phone).toEqual(repeated ? [input, input] : input);
    }
  );

  it.each(cases)(
    'normalizes integration updates without changing sibling fields: %j',
    ({ country, input, expected, forced, repeated }) => {
      const value = repeated ? [input, '', null, 'bad'] : input;
      const normalized = normalizePhoneValues(
        { phone: value, text: input },
        phoneServarsFromSteps(schema(country, forced, repeated))
      );
      expect(normalized).toEqual({
        phone: repeated ? [expected, '', null, 'bad'] : expected,
        text: input
      });
    }
  );

  it.each(examples)(
    'normalizes URL values for %s: %s',
    (country, input, expected) => {
      featheryWindow().history.replaceState(
        {},
        '',
        '/?phone=' + encodeURIComponent(input)
      );
      const client = { submitCustom: jest.fn() } as any;
      saveInitialValuesAndUrlParams({
        steps: schema(country),
        initialValues: {},
        client,
        updateFieldValues: jest.fn(),
        saveUrlParams: true,
        hiddenFields: {}
      });
      expect(client.submitCustom).toHaveBeenCalledWith(
        { phone: expected },
        { override: false }
      );
    }
  );

  it.each(['%2B44+20+7946+0018', '+44+20+7946+0018'])(
    'handles encoded or unescaped URL plus: %s',
    (query) => {
      featheryWindow().history.replaceState({}, '', '/?phone=' + query);
      const client = { submitCustom: jest.fn() } as any;
      saveInitialValuesAndUrlParams({
        steps: schema('GB'),
        initialValues: {},
        client,
        updateFieldValues: jest.fn(),
        saveUrlParams: true,
        hiddenFields: {}
      });
      expect(client.submitCustom).toHaveBeenCalledWith(
        { phone: '442079460018' },
        { override: false }
      );
    }
  );

  it('preserves canonical saved values during schema arrival and structural updates', () => {
    fieldValues.phone = '6612345678';
    const steps = schema('US');
    FeatheryClient.prototype.setDefaultFormValues.call(
      {},
      { steps: Object.values(steps), additionalValues: {} }
    );
    expect(fieldValues.phone).toBe('6612345678');
    expect(
      normalizePhoneValues(
        { phone: ['6612345678', ''] },
        phoneServarsFromSteps(steps),
        true
      )
    ).toEqual({ phone: ['6612345678', ''] });
  });

  it.each(cases)(
    'normalizes schema default values: %j',
    ({ country, input, expected, forced, repeated }) => {
      FeatheryClient.prototype.setDefaultFormValues.call(
        {},
        {
          steps: Object.values(schema(country, forced, repeated, input)),
          additionalValues: {}
        }
      );
      expect(fieldValues.phone).toEqual(repeated ? [expected] : expected);
    }
  );
});

it.each([true, false])(
  'normalizes hydration regardless of schema-first=%s',
  async (schemaFirst) => {
    const steps = schema('US');
    const session = {
      field_values: { phone: '(415) 555-2671' },
      servars: ['phone'],
      file_values: {},
      integrations: {}
    };
    let resolveSchema: (value: any) => void = () => {};
    const formPromise = new Promise<any>((resolve) => {
      resolveSchema = resolve;
    });
    const client = {
      formKey: 'phone-session',
      _fetch: jest.fn().mockResolvedValue({ json: async () => session })
    };
    if (schemaFirst) resolveSchema(steps);
    const result = FeatheryClient.prototype.fetchSession.call(
      client,
      formPromise as any
    );
    if (!schemaFirst) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      resolveSchema(steps);
    }
    await result;
    expect(fieldValues.phone).toBe('14155552671');
  }
);
