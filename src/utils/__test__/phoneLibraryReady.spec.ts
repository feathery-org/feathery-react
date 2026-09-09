import FeatheryClient from '../featheryClient';

jest.mock('../init', () => ({
  initInfo: () => ({}),
  initState: {},
  fieldValues: {}
}));

let resolvePhoneLibrary: () => void;
jest.mock('../validation', () => ({
  phoneLibPromise: new Promise<void>((resolve) => {
    resolvePhoneLibrary = resolve;
  })
}));

it('waits for phone parsing before making a form available to logic rules', async () => {
  const schema = { steps: [] };
  const client = {
    fetchCacheForm: jest.fn().mockResolvedValue(schema),
    setDefaultFormValues: jest.fn()
  };
  const result = FeatheryClient.prototype.fetchForm.call(client, {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(client.setDefaultFormValues).not.toHaveBeenCalled();
  resolvePhoneLibrary();
  expect(await result).toBe(schema);
  expect(client.setDefaultFormValues).toHaveBeenCalled();
});
