import FeatheryClient from '../index';
import { fieldValues, initState } from '../../init';
import internalState from '../../internalState';
import { loadPhoneValidator, phoneLibPromise } from '../../validation';

jest.mock('../../init', () => ({
  initInfo: () => ({}),
  initState: { formSchemas: {} },
  fieldValues: {}
}));
const servar = {
  key: 'phone',
  type: 'phone_number',
  metadata: { default_country: 'US' }
};
const steps = [{ servar_fields: [{ servar }] }];
const makeClient = (formKey: string) => ({
  formKey,
  getNoSave: () => false,
  pendingCustomFieldUpdates: {},
  _addCustomFieldListener: jest.fn(),
  debouncedSubmitCustom: jest.fn(),
  flushCustomFields: jest.fn()
});
beforeAll(async () => {
  loadPhoneValidator();
  await phoneLibPromise;
});
beforeEach(() => {
  Object.keys(fieldValues).forEach((key) => delete fieldValues[key]);
  initState.formSchemas = {};
});
afterEach(() => {
  delete internalState.phoneSubmission;
});

it.each(['schema', 'loaded-form', 'default-client'])(
  'normalizes before custom submission aggregation with %s settings',
  async (source) => {
    const client = makeClient(source === 'default-client' ? '' : 'phone-form');
    if (source === 'schema') initState.formSchemas['phone-form'] = { steps };
    else
      internalState.phoneSubmission = {
        client: { formKey: 'phone-form' },
        steps
      } as any;
    const values = {
      phone: ['(415) 555-2671', '6612345678'],
      text: '(415) 555-2671'
    };
    await FeatheryClient.prototype.submitCustom.call(client, values);
    expect(client.pendingCustomFieldUpdates).toEqual({
      phone: ['14155552671', '16612345678'],
      text: '(415) 555-2671'
    });
    expect(values.phone).toEqual(['(415) 555-2671', '6612345678']);
  }
);

it('preserves unchanged canonical rows while normalizing new values', async () => {
  initState.formSchemas['phone-form'] = { steps };
  fieldValues.phone = ['6612345678', '14155552671'];
  const client = makeClient('phone-form');
  await FeatheryClient.prototype.submitCustom.call(client, {
    phone: ['6612345678', '(212) 555-0123']
  });
  expect(client.pendingCustomFieldUpdates).toEqual({
    phone: ['6612345678', '12125550123']
  });
});

it('normalizes raw action payload after Form state has already been normalized', async () => {
  initState.formSchemas['phone-form'] = { steps };
  fieldValues.phone = '16612345678';
  const client = makeClient('phone-form');
  const promise = FeatheryClient.prototype.submitCustom.call(
    client,
    { phone: '6612345678' },
    { shouldFlush: true }
  );
  expect(client.pendingCustomFieldUpdates).toEqual({ phone: '16612345678' });
  expect(client.flushCustomFields).toHaveBeenCalledWith(true);
  await promise;
});

it('does not borrow another form country settings for a scoped client', async () => {
  internalState.phoneSubmission = {
    client: { formKey: 'other' },
    steps
  } as any;
  const client = makeClient('phone-form');
  await FeatheryClient.prototype.submitCustom.call(client, {
    phone: '(415) 555-2671'
  });
  expect(client.pendingCustomFieldUpdates).toEqual({ phone: '(415) 555-2671' });
});
