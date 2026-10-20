import FeatheryClient from '../featheryClient';
import { markStepCompleted } from '../init';
import { setInteractionDetected } from '../interactionState';

jest.mock('../init', () => ({
  initInfo: jest.fn(() => ({ sdkKey: 'sdkKey', userId: 'user-1' })),
  initFormsPromise: Promise.resolve(),
  initState: { formSessions: {} },
  markStepCompleted: jest.fn(),
  fieldValues: {},
  filePathMap: {},
  fileDeduplicationCount: {},
  fileRetryStatus: {}
}));

const QUEUED_AT = new Date('2026-01-01T00:00:00.000Z');
const SENT_AT = new Date('2026-01-01T00:05:00.000Z');

const makeClient = () => {
  const client = new FeatheryClient('formKey');
  client.flushCustomFields = jest.fn().mockResolvedValue(undefined);
  const runOrSaveRequest = jest.fn().mockResolvedValue(undefined);
  client.offlineRequestHandler.runOrSaveRequest = runOrSaveRequest;
  return { client, runOrSaveRequest };
};

// Args: run, url, options (whose body is what gets stored for offline replay), type, stepKey
const sentRequest = (runOrSaveRequest: jest.Mock, call = 0) => {
  const [, , options, type, stepKey] = runOrSaveRequest.mock.calls[call];
  return { body: JSON.parse(options.body), type, stepKey };
};

describe('FeatheryClient.registerEvent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers('modern');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Runs first: interaction state is module-global and is never reset.
  it('sends events queued before interaction with the time they happened', async () => {
    const { client, runOrSaveRequest } = makeClient();

    jest.setSystemTime(QUEUED_AT);
    const pending = client.registerEvent({
      step_key: 'step-1',
      event: 'load',
      previous_step_key: ''
    });
    expect(runOrSaveRequest).not.toHaveBeenCalled();

    jest.setSystemTime(SENT_AT);
    setInteractionDetected();
    await (client as any).replayQueuedEvents();
    await pending;

    expect(sentRequest(runOrSaveRequest).body.timestamp).toBe(
      QUEUED_AT.toISOString()
    );
  });

  it('records a back event without marking the step completed', async () => {
    const { client, runOrSaveRequest } = makeClient();
    jest.setSystemTime(SENT_AT);

    await client.registerEvent({
      step_key: 'step-2',
      next_step_key: 'step-1',
      event: 'back'
    });

    expect(markStepCompleted).not.toHaveBeenCalled();
    expect(sentRequest(runOrSaveRequest)).toEqual({
      body: expect.objectContaining({
        event: 'back',
        step_key: 'step-2',
        next_step_key: 'step-1',
        timestamp: SENT_AT.toISOString()
      }),
      type: 'registerEvent',
      stepKey: 'step-2'
    });
  });

  it('still marks the step completed for complete events', async () => {
    const { client } = makeClient();

    await client.registerEvent({
      step_key: 'step-1',
      next_step_key: 'step-2',
      event: 'complete'
    });

    expect(markStepCompleted).toHaveBeenCalledWith('step-1');
  });

  it('rejects a failed event without leaving the event chain rejected', async () => {
    const { client, runOrSaveRequest } = makeClient();
    runOrSaveRequest.mockRejectedValueOnce(new Error('400'));

    await expect(
      client.registerEvent({
        step_key: 'step-2',
        next_step_key: 'step-1',
        event: 'back'
      })
    ).rejects.toThrow('400');
    await expect(client.eventQueue).resolves.toBeUndefined();
  });
});
