import { setEnvironment } from '@feathery/client-utils';
import { httpHelpers } from '../formHelperFunctions';
import { runServerSideLogic } from '../../Form/logic';
import { defaultClient, fieldValues, initState } from '../init';
import internalState from '../internalState';
import { loadPhoneValidator, phoneLibPromise } from '../validation';

jest.mock('../featheryClient', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ submitCustom: jest.fn() }))
}));
jest.mock('../../auth/LoginForm', () => ({ authState: {} }));

const originalFetch = global.fetch;
const formId = 'connector-phone-form';
beforeAll(async () => {
  setEnvironment('production');
  loadPhoneValidator();
  await phoneLibPromise;
});
beforeEach(() => {
  initState.sdkKey = 'test-sdk';
  Object.keys(fieldValues).forEach((key) => delete fieldValues[key]);
  internalState[formId] = {
    steps: {
      first: {
        servar_fields: [
          {
            servar: {
              key: 'phone',
              type: 'phone_number',
              metadata: { default_country: 'US' }
            }
          }
        ]
      }
    }
  } as any;
  jest.clearAllMocks();
});
afterEach(() => {
  delete internalState[formId];
  global.fetch = originalFetch;
});

const examples = [
  ['6612345678', '16612345678'],
  ['(415) 555-2671', '14155552671'],
  ['+44 (20) 7946-0018', '442079460018'],
  [
    ['6612345678', '(415) 555-2671'],
    ['16612345678', '14155552671']
  ]
];
it.each(examples)(
  'normalizes actual HTTP connector response %j',
  async (input, expected) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {},
        status_code: 200,
        field_values: { phone: input }
      })
    });
    const client = {
      formKey: formId,
      offlineRequestHandler: {
        runOrSaveRequest: (request: any) => request()
      }
    };
    await httpHelpers(client).connect('phone-connector', {});
    expect(fieldValues.phone).toEqual(expected);
    expect(defaultClient.submitCustom).not.toHaveBeenCalled();
  }
);
it.each(examples)(
  'normalizes server-side rule response %j',
  async (input, expected) => {
    const client = {
      runServerSideLogicRule: jest
        .fn()
        .mockResolvedValue({ field_data: { phone: input } })
    };
    await runServerSideLogic({ id: 'rule' } as any, client, false);
    expect(fieldValues.phone).toEqual(expected);
    expect(defaultClient.submitCustom).not.toHaveBeenCalled();
  }
);
