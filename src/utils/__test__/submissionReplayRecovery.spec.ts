import FeatheryClient from '../featheryClient';
import { getFormContext } from '../formContext';
import { setFormInternalState } from '../internalState';
import { FakeRequest, fakeResponse, installFakeIndexedDB } from './test-utils';

jest.mock('../interactionState', () => ({
  ...jest.requireActual('../interactionState'),
  isInteractionDetected: () => true
}));
jest.mock('@feathery/client-utils', () => ({
  ...jest.requireActual('@feathery/client-utils'),
  setRequestHeaderProvider: jest.fn()
}));
jest.mock('../init', () => ({
  initInfo: () => ({ sdkKey: 'key', userId: 'user' }),
  initState: { defaultErrors: {}, language: '', formSessions: {} },
  fieldValues: {},
  filePathMap: {},
  fileDeduplicationCount: {},
  fileRetryStatus: {},
  restoredFileKeys: new Set(),
  normalizeKnownAsciiValues: (values: Record<string, unknown>) => values,
  defaultClient: { flushCustomFields: jest.fn().mockResolvedValue(undefined) }
}));
jest.mock('../featheryClient/utils', () => ({
  ...jest.requireActual('../featheryClient/utils'),
  handleFormAuthenticationError: jest.fn(),
  handleFormConflict: jest.fn()
}));

describe('server-reading actions after offline replay', () => {
  let store: ReturnType<typeof installFakeIndexedDB>;
  let client: FeatheryClient;
  let originalFetch: typeof fetch;
  let originalRequest: typeof Request;
  let error: TypeError;
  const uuid = 'replay-recovery';
  const invoke = (action: string) =>
    action === 'documents'
      ? getFormContext(uuid).generateDocuments({ documentIds: ['template'] })
      : getFormContext(uuid).setCollaboratorAsCompleted('template');

  beforeEach(async () => {
    originalFetch = global.fetch;
    originalRequest = global.Request;
    global.Request = FakeRequest as any;
    store = installFakeIndexedDB('form');
    client = new FeatheryClient('form');
    jest.spyOn(client, 'errorCallback').mockImplementation(() => {});
    error = new TypeError('Network unavailable');
    jest.spyOn(client, '_fetch').mockRejectedValue(error);
    jest
      .spyOn(client, 'generateDocuments')
      .mockResolvedValue({ files: [] } as any);
    jest
      .spyOn(client, 'setCollaboratorAsCompleted')
      .mockResolvedValue(undefined as any);
    setFormInternalState(uuid, { client, fields: {} } as any);
    await expect(
      client.submitStep(
        [{ key: 'name', text_field: 'new answer' }],
        { key: 'first', buttons: [], subgrids: [] },
        true
      )
    ).rejects.toBe(error);
    expect(store.rows()).toHaveLength(1);
  });

  afterEach(() => {
    store.uninstall();
    global.fetch = originalFetch;
    global.Request = originalRequest;
    jest.restoreAllMocks();
  });

  it.each(['documents', 'collaborator'])(
    'allows %s after the queued save is acknowledged',
    async (action) => {
      await expect(invoke(action)).rejects.toBe(error);
      global.fetch = jest.fn(async () => fakeResponse(200)) as any;
      await client.offlineRequestHandler.replayRequests();
      expect(store.rows()).toEqual([]);
      await invoke(action);
      const request =
        action === 'documents'
          ? client.generateDocuments
          : client.setCollaboratorAsCompleted;
      expect(request).toHaveBeenCalledTimes(1);
    }
  );

  it.each([400, 403, 409])(
    'does not treat a %s replay rejection as acknowledgement',
    async (status) => {
      global.fetch = jest.fn(async () =>
        fakeResponse(status, { message: 'Rejected' })
      ) as any;
      await client.offlineRequestHandler.replayRequests({
        isUserWaiting: true
      });
      await expect(invoke('documents')).rejects.toBe(error);
      expect(client.generateDocuments).not.toHaveBeenCalled();
    }
  );

  it('recovers an auto-submitted file after its own replay succeeds', async () => {
    global.fetch = jest.fn(async () => fakeResponse(200)) as any;
    await client.offlineRequestHandler.replayRequests();
    jest.spyOn(client, '_getFileValue').mockResolvedValue('s3/document.pdf');
    const uploadError = new TypeError('Upload unavailable');
    jest.spyOn(client, '_fetch').mockRejectedValue(uploadError);
    await expect(
      client.submitFiles([
        {
          servar: { key: 'document', file_upload: 's3/document.pdf' },
          stepKey: 'first'
        }
      ])
    ).rejects.toBe(uploadError);
    await expect(invoke('documents')).rejects.toBe(uploadError);
    await client.offlineRequestHandler.replayRequests();
    await invoke('documents');
    expect(client.generateDocuments).toHaveBeenCalledTimes(1);
  });

  it('does not recover a custom write when an unrelated custom field succeeds', async () => {
    global.fetch = jest.fn(async () => fakeResponse(200)) as any;
    await client.offlineRequestHandler.replayRequests();
    const customError = new TypeError('Custom write unavailable');
    jest.spyOn(client, '_fetch').mockRejectedValue(customError);
    await expect(
      client.submitCustom({ first: 'pending' }, { shouldFlush: true })
    ).rejects.toBe(customError);
    global.fetch = jest.fn(async () => fakeResponse(400)) as any;
    jest.spyOn(client, '_fetch').mockResolvedValue({});
    await client.submitCustom({ second: 'saved' }, { shouldFlush: true });
    expect(client.offlineRequestHandler.hasRecoveredWrite(customError)).toBe(
      false
    );
    expect(store.rows()).toHaveLength(1);
  });
});
