import { runOAuthPopup } from './oauthPopup';
import { featheryWindow } from '../../utils/browser';

describe('runOAuthPopup', () => {
  const authorization = {
    authorization_url: 'https://account.box.com/api/oauth2/authorize',
    callback_origin: 'https://api.feathery.io',
    state: 'box-oauth-state'
  };

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('resolves only for the expected popup, origin, and state', async () => {
    const client = {
      startAccountConnect: jest.fn().mockResolvedValue(authorization)
    };
    const popup = {
      closed: false,
      close: jest.fn(),
      focus: jest.fn(),
      location: { href: 'about:blank' }
    } as unknown as Window;
    const win = featheryWindow();
    let messageHandler: ((event: MessageEvent) => void) | undefined;
    const addEventListener = jest
      .spyOn(win, 'addEventListener')
      .mockImplementation((type, listener) => {
        if (type === 'message') {
          messageHandler = listener as (event: MessageEvent) => void;
        }
      });
    const removeEventListener = jest
      .spyOn(win, 'removeEventListener')
      .mockImplementation(() => {});

    const resultPromise = runOAuthPopup(client, 'box', popup);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(messageHandler).toBeDefined();
    if (!messageHandler) throw new Error('Message handler was not registered');
    messageHandler({
      source: popup,
      origin: authorization.callback_origin,
      data: {
        type: 'feathery-account-connect',
        state: authorization.state,
        success: true,
        account_email: 'respondent@example.com'
      }
    } as MessageEvent);

    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({
        success: true,
        account_email: 'respondent@example.com'
      })
    );
    expect(client.startAccountConnect).toHaveBeenCalledWith(
      'box',
      win.location.origin
    );
    expect(popup.location.href).toBe(authorization.authorization_url);
    expect(popup.close).toHaveBeenCalled();
    expect(addEventListener).toHaveBeenCalled();
    expect(removeEventListener).toHaveBeenCalled();
  });

  it('surfaces provider errors from the callback', async () => {
    const client = {
      startAccountConnect: jest.fn().mockResolvedValue(authorization)
    };
    const popup = {
      closed: false,
      close: jest.fn(),
      focus: jest.fn(),
      location: { href: 'about:blank' }
    } as unknown as Window;
    const win = featheryWindow();
    let messageHandler: ((event: MessageEvent) => void) | undefined;
    const addEventListener = jest
      .spyOn(win, 'addEventListener')
      .mockImplementation((type, listener) => {
        if (type === 'message') {
          messageHandler = listener as (event: MessageEvent) => void;
        }
      });
    const removeEventListener = jest
      .spyOn(win, 'removeEventListener')
      .mockImplementation(() => {});

    const resultPromise = runOAuthPopup(client, 'box', popup);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(messageHandler).toBeDefined();
    if (!messageHandler) throw new Error('Message handler was not registered');
    messageHandler({
      source: popup,
      origin: authorization.callback_origin,
      data: {
        type: 'feathery-account-connect',
        state: authorization.state,
        success: false,
        error: 'The user denied access'
      }
    } as MessageEvent);

    await expect(resultPromise).rejects.toThrow('The user denied access');
    expect(addEventListener).toHaveBeenCalled();
    expect(removeEventListener).toHaveBeenCalled();
  });

  it('keeps the popup open while polling is pending', async () => {
    jest.useFakeTimers();
    const client = {
      startAccountConnect: jest.fn().mockResolvedValue(authorization),
      getAccountConnectStatus: jest
        .fn()
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce({
          status: 'connected',
          success: true,
          account_email: 'respondent@example.com'
        })
    };
    const popup = {
      closed: false,
      close: jest.fn(),
      focus: jest.fn(),
      location: { href: 'about:blank' }
    } as unknown as Window;

    const resultPromise = runOAuthPopup(client, 'box', popup);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    jest.advanceTimersByTime(2000);
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(client.getAccountConnectStatus).toHaveBeenCalledTimes(1);
    expect(popup.close).not.toHaveBeenCalled();

    jest.advanceTimersByTime(2000);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(client.getAccountConnectStatus).toHaveBeenCalledTimes(2);
    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({ status: 'connected' })
    );
    expect(popup.close).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('reports a blocked popup before starting authorization', async () => {
    const client = { startAccountConnect: jest.fn() };

    await expect(runOAuthPopup(client, 'box', null)).rejects.toThrow(
      'Please allow pop-ups to connect your account.'
    );
    expect(client.startAccountConnect).not.toHaveBeenCalled();
  });

  it('ignores a message with a mismatched state', async () => {
    const client = {
      startAccountConnect: jest.fn().mockResolvedValue(authorization)
    };
    const popup = {
      closed: false,
      close: jest.fn(),
      focus: jest.fn(),
      location: { href: 'about:blank' }
    } as unknown as Window;
    const win = featheryWindow();
    let messageHandler: ((event: MessageEvent) => void) | undefined;
    jest.spyOn(win, 'addEventListener').mockImplementation((type, listener) => {
      if (type === 'message')
        messageHandler = listener as (event: MessageEvent) => void;
    });
    jest.spyOn(win, 'removeEventListener').mockImplementation(() => {});

    const resultPromise = runOAuthPopup(client, 'box', popup);
    await new Promise((resolve) => setTimeout(resolve, 0));

    messageHandler!({
      source: popup,
      origin: authorization.callback_origin,
      data: {
        type: 'feathery-account-connect',
        state: 'a-different-state',
        success: true
      }
    } as MessageEvent);

    let settled = false;
    resultPromise.then(
      () => (settled = true),
      () => (settled = true)
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(settled).toBe(false);
    expect(popup.close).not.toHaveBeenCalled();
  });
});
