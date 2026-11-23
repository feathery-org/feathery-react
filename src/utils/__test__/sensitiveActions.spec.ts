import { runClientSideLogic } from '../../Form/logic';
import internalState, { setFormInternalState } from '../internalState';
import { defaultClient, initState } from '../init';
import { getPrivateActions } from '../sensitiveActions';
import { waitUntil } from './test-utils';

describe('Send Email logic action', () => {
  const formUuid = 'send-email-rule';
  let client: any;
  let previousSdkKey: string;

  beforeEach(() => {
    previousSdkKey = initState.sdkKey;
    initState.sdkKey = 'send-email-test';
    client = {
      submitQueue: Promise.resolve(),
      offlineRequestHandler: { runOrSaveRequest: jest.fn() },
      flushCustomFields: jest.fn().mockResolvedValue(undefined),
      sendEmail: jest.fn().mockResolvedValue({ sent: true })
    };
    setFormInternalState(formUuid, { fields: {}, client } as any);
    jest.spyOn(defaultClient, 'flushCustomFields').mockResolvedValue(undefined);
  });

  afterEach(() => {
    initState.sdkKey = previousSdkKey;
    delete internalState[formUuid];
    jest.restoreAllMocks();
  });

  const runEmailRule = () =>
    runClientSideLogic(
      { code: 'return await feathery._sendEmail("template-1");' } as any,
      client,
      [],
      internalState[formUuid],
      {},
      getPrivateActions(formUuid)
    );

  it('waits for the step save even when no custom fields need flushing', async () => {
    let finishSave!: () => void;
    client.submitQueue = new Promise<void>((resolve) => {
      finishSave = resolve;
    });

    const result = runEmailRule();
    await waitUntil(() => client.sendEmail.mock.calls.length > 0);
    const prematureSends = client.sendEmail.mock.calls.length;
    const prematureFlushes = client.flushCustomFields.mock.calls.length;
    finishSave();
    await expect(result).resolves.toEqual({ sent: true });

    expect(prematureSends).toBe(0);
    expect(prematureFlushes).toBe(0);
    expect(client.flushCustomFields).toHaveBeenCalledTimes(1);
    expect(defaultClient.flushCustomFields).toHaveBeenCalledTimes(1);
    expect(client.sendEmail).toHaveBeenCalledWith('template-1');
  });

  it('does not send an email when the current step save fails', async () => {
    const failure = new Error('Step save failed');
    client.submitQueue = Promise.reject(failure);
    client.submitQueue.catch(() => undefined);

    await expect(runEmailRule()).rejects.toBe(failure);

    expect(client.sendEmail).not.toHaveBeenCalled();
    expect(client.flushCustomFields).not.toHaveBeenCalled();
  });
});
