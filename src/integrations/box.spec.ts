import { getBoxFolderPathFieldValues, openBoxOAuth } from './box';
import { featheryWindow } from '../utils/browser';

describe('getBoxFolderPathFieldValues', () => {
  it('maps the selected Box path to the configured field key', () => {
    expect(
      getBoxFolderPathFieldValues(
        { box_folder_path_field_key: 'box_destination' },
        { folder: { path: 'All Files / Client Files / Applications' } }
      )
    ).toEqual({
      box_destination: 'All Files / Client Files / Applications'
    });
  });

  it('does not update a field when no destination field is configured', () => {
    expect(
      getBoxFolderPathFieldValues(
        {},
        { folder: { path: 'All Files / Applications' } }
      )
    ).toEqual({});
  });
});

describe('openBoxOAuth', () => {
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
      startBoxOAuth: jest.fn().mockResolvedValue(authorization)
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

    const resultPromise = openBoxOAuth(client, popup);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(messageHandler).toBeDefined();
    if (!messageHandler) throw new Error('Message handler was not registered');
    messageHandler({
      source: popup,
      origin: authorization.callback_origin,
      data: {
        type: 'feathery-box-oauth',
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
    expect(client.startBoxOAuth).toHaveBeenCalledWith(win.location.origin);
    expect(popup.location.href).toBe(authorization.authorization_url);
    expect(popup.close).toHaveBeenCalled();
    expect(addEventListener).toHaveBeenCalled();
    expect(removeEventListener).toHaveBeenCalled();
  });

  it('surfaces provider errors from the callback', async () => {
    const client = {
      startBoxOAuth: jest.fn().mockResolvedValue(authorization)
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

    const resultPromise = openBoxOAuth(client, popup);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(messageHandler).toBeDefined();
    if (!messageHandler) throw new Error('Message handler was not registered');
    messageHandler({
      source: popup,
      origin: authorization.callback_origin,
      data: {
        type: 'feathery-box-oauth',
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
      startBoxOAuth: jest.fn().mockResolvedValue(authorization),
      getBoxOAuthStatus: jest
        .fn()
        .mockResolvedValueOnce({ status: 'folder_selection' })
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

    const resultPromise = openBoxOAuth(client, popup);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    jest.advanceTimersByTime(2000);
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(client.getBoxOAuthStatus).toHaveBeenCalledTimes(1);
    expect(popup.close).not.toHaveBeenCalled();

    jest.advanceTimersByTime(2000);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(client.getBoxOAuthStatus).toHaveBeenCalledTimes(2);
    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({ status: 'connected' })
    );
    expect(popup.close).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('reports a blocked popup before starting authorization', async () => {
    const client = { startBoxOAuth: jest.fn() };

    await expect(openBoxOAuth(client, null)).rejects.toThrow(
      'Please allow pop-ups to connect your Box account.'
    );
    expect(client.startBoxOAuth).not.toHaveBeenCalled();
  });
});
