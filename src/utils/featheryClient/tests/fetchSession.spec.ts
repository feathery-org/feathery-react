// Enters through index.ts for the same reason accessLink.spec.ts does: the
// client files form an import cycle, and '../../init' is mocked because it
// instantiates FeatheryClient eagerly at module load.
import FeatheryClient from '../index';
import { initInfo, initState } from '../../init';
import { apiFetch, FormAuthenticationError } from '@feathery/client-utils';

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
