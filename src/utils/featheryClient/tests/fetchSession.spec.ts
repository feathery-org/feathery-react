// Enters through index.ts for the same reason accessLink.spec.ts does: the
// client files form an import cycle, and '../../init' is mocked because it
// instantiates FeatheryClient eagerly at module load.
import FeatheryClient from '../index';
import { fieldValues, initInfo, initState } from '../../init';
import { apiFetch, FormAuthenticationError } from '@feathery/client-utils';

jest.mock('../../../auth/LoginForm', () => ({ authState: {} }));

jest.mock('@feathery/client-utils', () => ({
  ...jest.requireActual('@feathery/client-utils'),
  apiFetch: jest.fn()
}));

jest.mock('../../init', () => ({
  initInfo: jest.fn(),
  initFormsPromise: Promise.resolve(),
  initState: {
    formSessions: {},
    fieldValuesInitialized: false,
    linkToken: '',
    linkSecret: '',
    remountCallbacks: {}
  },
  fieldValues: {},
  filePathMap: {},
  registerKnownFieldKeys: jest.fn(),
  registerTextVariableFields: jest.fn(),
  normalizeKnownAsciiValues: jest.fn((values) => values),
  setFieldValues: jest.fn(),
  markStepCompleted: jest.fn(),
  fileDeduplicationCount: {},
  fileRetryStatus: {}
}));

const newClient = () => new FeatheryClient('form-key') as any;

beforeEach(() => {
  jest.clearAllMocks();
  initState.formSessions = {};
  initState.fieldValuesInitialized = false;
  initState.authenticationError = undefined;
  (initInfo as jest.Mock).mockReturnValue({
    sdkKey: 'sdkKey',
    userId: 'userId',
    formSessions: {},
    fieldValuesInitialized: false
  });
});

describe('fetchSession when the request fails', () => {
  // The browsers' own messages, which _fetch otherwise swallows
  it.each(['Failed to fetch', 'Load failed'])(
    'throws "%s" instead of reading it as no session',
    async (message) => {
      (apiFetch as jest.Mock).mockRejectedValue(new TypeError(message));

      await expect(newClient().fetchSession()).rejects.toThrow(message);
    }
  );

  it('still reports a rejected form as no session', async () => {
    (apiFetch as jest.Mock).mockRejectedValue(
      new FormAuthenticationError('Form is not available')
    );

    await expect(newClient().fetchSession()).resolves.toEqual([]);
  });
});

describe('fetchSession Salesforce account selection', () => {
  const provider = 'salesforce-client-credentials';
  const emailKey = `feathery.connections.${provider}.email`;
  const credentials = [
    { id: 'first-account', account_email: 'first@example.com' },
    { id: 'second-account', account_email: 'second@example.com' }
  ];
  const session = () => ({
    new_user_id: 'refreshed-submission',
    integrations: { [provider]: { metadata: {} } },
    servars: [],
    field_values: { unrelated: 'saved answer' },
    file_values: {}
  });
  const response = (payload: unknown, status = 200) => ({
    status,
    json: async () => payload
  });
  const returnSessionAndAccounts = (accounts: unknown) => {
    (apiFetch as jest.Mock)
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(response(accounts))
      .mockResolvedValueOnce(
        response({ values: { [emailKey]: 'first@example.com' } })
      );
  };
  const selectionRequests = () =>
    (apiFetch as jest.Mock).mock.calls.filter(([, url]) =>
      url.includes('account-connect/select/')
    );

  beforeEach(() => {
    (apiFetch as jest.Mock).mockReset();
    Object.keys(fieldValues).forEach((key) => delete fieldValues[key]);
    initState.userId = 'initial-submission';
    (initInfo as jest.Mock).mockImplementation(() => ({
      sdkKey: 'sdkKey',
      userId: initState.userId,
      formSessions: initState.formSessions,
      fieldValuesInitialized: false
    }));
  });

  it('attaches the first saved account to a refreshed submission before returning the session', async () => {
    returnSessionAndAccounts({ attached: null, can_save: true, credentials });
    const client = new FeatheryClient('form-key');

    const [loaded] = await client.fetchSession();

    expect(selectionRequests()).toHaveLength(1);
    expect(JSON.parse(selectionRequests()[0][2].body)).toMatchObject({
      provider,
      credential_id: 'first-account',
      fuser_key: 'refreshed-submission'
    });
    expect(loaded.field_values).toEqual({
      unrelated: 'saved answer',
      [emailKey]: 'first@example.com'
    });
    expect(fieldValues[emailKey]).toBe('first@example.com');

    await client.fetchSession();
    expect(selectionRequests()).toHaveLength(1);
  });

  it.each([
    { owner: true, status: 'connected' },
    { owner: true, status: 'disconnected' },
    { owner: true, status: 'reconnect_required' },
    { owner: false, status: 'connected' }
  ])('preserves an existing attachment %j', async (attached) => {
    returnSessionAndAccounts({ attached, can_save: true, credentials });

    await new FeatheryClient('form-key').fetchSession();

    expect(selectionRequests()).toHaveLength(0);
  });

  it.each([
    null,
    { attached: null, can_save: false, credentials },
    { attached: null, can_save: true, credentials: [] }
  ])(
    'leaves account selection available when there is no usable saved account %j',
    async (accounts) => {
      returnSessionAndAccounts(accounts);

      await expect(
        new FeatheryClient('form-key').fetchSession()
      ).resolves.toHaveLength(2);

      expect(selectionRequests()).toHaveLength(0);
    }
  );

  it.each(['listing', 'selection'])(
    'still loads the form when %s fails',
    async (operation) => {
      const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
      (apiFetch as jest.Mock).mockResolvedValueOnce(response(session()));
      if (operation === 'selection') {
        (apiFetch as jest.Mock).mockResolvedValueOnce(
          response({ attached: null, can_save: true, credentials })
        );
      }
      (apiFetch as jest.Mock).mockRejectedValueOnce(new Error('Unavailable'));

      try {
        const [loaded] = await new FeatheryClient('form-key').fetchSession();
        expect(loaded.field_values).toEqual({ unrelated: 'saved answer' });
        expect(fieldValues[emailKey]).toBeUndefined();
      } finally {
        warning.mockRestore();
      }
    }
  );

  it('does not look up accounts for a form without Salesforce', async () => {
    (apiFetch as jest.Mock).mockResolvedValueOnce(
      response({ ...session(), integrations: {} })
    );

    await new FeatheryClient('form-key').fetchSession();

    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('hydrates the connection when another form already initialized field values', async () => {
    (initInfo as jest.Mock).mockImplementation(() => ({
      sdkKey: 'sdkKey',
      userId: initState.userId,
      formSessions: initState.formSessions,
      fieldValuesInitialized: true
    }));
    fieldValues.unrelated = 'current answer';
    returnSessionAndAccounts({ attached: null, can_save: true, credentials });

    await new FeatheryClient('form-key').fetchSession();

    expect(fieldValues[emailKey]).toBe('first@example.com');
    expect(fieldValues.unrelated).toBe('current answer');
  });
});
