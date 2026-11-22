import FeatheryClient from '../featheryClient';
import {
  isSubmittedValue,
  recordSubmittedValues,
  resetSubmittedValues,
  startSubmittingValues
} from '../submittedFieldValues';

jest.mock('../interactionState', () => ({
  ...jest.requireActual('../interactionState'),
  isInteractionDetected: () => true
}));

jest.mock('../init', () => ({
  initInfo: () => ({ sdkKey: 'key', userId: 'user' }),
  initFormsPromise: Promise.resolve(),
  initState: { defaultErrors: {}, language: '', formSessions: {} },
  fieldValues: {},
  filePathMap: {},
  fileDeduplicationCount: {},
  fileRetryStatus: {},
  restoredFileKeys: new Set(),
  setFieldValues: () => {},
  normalizeKnownAsciiValues: (values: Record<string, any>) => values,
  markStepCompleted: () => {},
  registerKnownFieldKeys: () => {},
  registerTextVariableFields: () => {}
}));

// The custom_key_values sent by each /custom/submit request
const sentValues = (run: jest.SpyInstance) =>
  run.mock.calls.map(([, , options]) =>
    JSON.parse(options.body.get('custom_key_values'))
  );

describe('unchanged field values are not sent again', () => {
  let client: any;
  let run: jest.SpyInstance;

  beforeEach(() => {
    resetSubmittedValues();
    client = new FeatheryClient('form');
    run = jest
      .spyOn(client.offlineRequestHandler, 'runOrSaveRequest')
      .mockResolvedValue({ ok: true });
  });

  afterEach(() => jest.restoreAllMocks());

  const flush = (values: Record<string, any>, options = {}) =>
    client.submitCustom(values, { shouldFlush: true, ...options });

  it('skips a value matching the last successful send', async () => {
    await flush({ name: 'Ada' });
    await flush({ name: 'Ada' });
    expect(sentValues(run)).toEqual([{ name: 'Ada' }]);
  });

  it('sends only the changed keys of a mixed write', async () => {
    await flush({ a: '1', b: ['x'] });
    await flush({ a: '1', b: ['x'], c: 'new' });
    expect(sentValues(run)).toEqual([{ a: '1', b: ['x'] }, { c: 'new' }]);
  });

  it('sends an array changed in place after it was sent', async () => {
    const tags = ['a'];
    await flush({ tags });
    tags.push('x');
    await flush({ tags });
    expect(sentValues(run)).toEqual([{ tags: ['a'] }, { tags: ['a', 'x'] }]);
  });

  it('resends a value whose earlier send failed', async () => {
    run.mockRejectedValueOnce(new Error('offline'));
    await expect(flush({ name: 'Ada' })).rejects.toThrow('offline');
    await flush({ name: 'Ada' });
    expect(sentValues(run)).toEqual([{ name: 'Ada' }, { name: 'Ada' }]);
  });

  it('sends a value when the previous send was not overriding', async () => {
    await flush({ name: 'Ada' }, { override: false });
    await flush({ name: 'Ada' });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('skips a value saved by a step submit', async () => {
    jest.spyOn(client, '_fetch').mockResolvedValue({ ok: true });
    run.mockImplementation((fn: () => any) => fn());
    await client._submitJSONData([{ key: 'name', text_field: 'Ada' }], 's1');
    run.mockClear();
    await flush({ name: 'Ada' });
    expect(run).not.toHaveBeenCalled();
  });

  it('skips a value set with skipServerSubmit', async () => {
    recordSubmittedValues({ name: 'Ada' });
    await flush({ name: 'Ada' });
    expect(run).not.toHaveBeenCalled();
  });
});

describe('submitted value tracking', () => {
  beforeEach(resetSubmittedValues);

  it('does not count a value as submitted until its send succeeds', () => {
    const commit = startSubmittingValues({ name: 'Ada' });
    expect(isSubmittedValue('name', 'Ada')).toBe(false);
    commit();
    expect(isSubmittedValue('name', 'Ada')).toBe(true);
  });

  it('forgets the old value while a different one is in flight', () => {
    recordSubmittedValues({ name: 'Ada' });
    startSubmittingValues({ name: 'Grace' });
    expect(isSubmittedValue('name', 'Ada')).toBe(false);
  });

  it('keeps the newer send when an older one finishes last', () => {
    const commitOld = startSubmittingValues({ name: 'Ada' });
    const commitNew = startSubmittingValues({ name: 'Grace' });
    commitNew();
    commitOld();
    expect(isSubmittedValue('name', 'Grace')).toBe(true);
    expect(isSubmittedValue('name', 'Ada')).toBe(false);
  });

  it('is cleared when the submission resets', () => {
    recordSubmittedValues({ name: 'Ada' });
    resetSubmittedValues();
    expect(isSubmittedValue('name', 'Ada')).toBe(false);
  });
});
