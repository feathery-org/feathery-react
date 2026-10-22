// Enters through index.ts for the same reason accessLink.spec.ts does: the
// client files form an import cycle, and '../../init' is mocked because it
// instantiates FeatheryClient eagerly at module load.
import FeatheryClient from '../index';
import { isRetryableSessionError } from '../utils';
import { initInfo, initState } from '../../init';
import { isInteractionDetected } from '../../interactionState';
import { apiFetch, FetchError } from '@feathery/client-utils';

jest.mock('@feathery/client-utils', () => ({
  ...jest.requireActual('@feathery/client-utils'),
  apiFetch: jest.fn()
}));

jest.mock('../../interactionState', () => ({
  ...jest.requireActual('../../interactionState'),
  isInteractionDetected: jest.fn()
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

const session = {
  new_user_id: 'fuser',
  integrations: {},
  servars: [],
  field_values: {},
  file_values: {}
};

const newClient = () => new FeatheryClient('form-key') as any;

beforeEach(() => {
  jest.clearAllMocks();
  initState.formSessions = {};
  initState.fieldValuesInitialized = false;
  initState.authenticationError = undefined;
  (isInteractionDetected as jest.Mock).mockReturnValue(false);
  (initInfo as jest.Mock).mockReturnValue({
    sdkKey: 'sdkKey',
    userId: 'userId',
    formSessions: {},
    fieldValuesInitialized: false
  });
});

describe('fetchSession when the request fails', () => {
  it('leaves the values unloaded so a retry asks for them again', async () => {
    (apiFetch as jest.Mock).mockRejectedValue(new TypeError('Load failed'));

    await newClient()
      .fetchSession()
      .catch(() => {});

    expect(initState.fieldValuesInitialized).toBe(false);
  });
});

describe('fetchSession as a background retry', () => {
  beforeEach(() => {
    (apiFetch as jest.Mock).mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(session)
    });
  });

  it('drops the session once the user has started filling the form', async () => {
    (isInteractionDetected as jest.Mock).mockReturnValue(true);

    const result = await newClient().fetchSession(null, false, true);

    expect(result).toBeNull();
    expect(initState.formSessions['form-key']).toBeUndefined();
    expect(initState.fieldValuesInitialized).toBe(false);
  });

  it('adopts the session while the form is untouched', async () => {
    const [loaded] = await newClient().fetchSession(null, false, true);

    expect(loaded).toMatchObject({ new_user_id: 'fuser' });
    expect(initState.formSessions['form-key']).toBeDefined();
  });
});

describe('isRetryableSessionError', () => {
  it.each([
    ['a dropped connection', new TypeError('Failed to fetch')],
    ['a server error', new FetchError('Internal server error')],
    ['a rate limit or gateway error', new FetchError('Unknown error')]
  ])('retries %s', (_, error) => {
    expect(isRetryableSessionError(error)).toBe(true);
  });

  it.each([
    ['a bad request', new FetchError('"Invalid form"')],
    ['a missing form', new FetchError("Can't find object")],
    ['a bug in the client', new Error('boom')]
  ])('does not retry %s', (_, error) => {
    expect(isRetryableSessionError(error)).toBe(false);
  });
});
