import { featheryWindow } from '../../utils/browser';

export const ACCOUNT_CONNECT_POPUP_NAME = 'feathery-account-connect';

const ACCOUNT_CONNECT_POPUP_WIDTH = 620;
const ACCOUNT_CONNECT_POPUP_HEIGHT = 720;
const ACCOUNT_CONNECT_TIMEOUT_MS = 10 * 60 * 1000;

export function getPopupFeatures() {
  const win = featheryWindow();
  const left = Math.max(
    0,
    win.screenX + (win.outerWidth - ACCOUNT_CONNECT_POPUP_WIDTH) / 2
  );
  const top = Math.max(
    0,
    win.screenY + (win.outerHeight - ACCOUNT_CONNECT_POPUP_HEIGHT) / 2
  );

  return [
    `width=${ACCOUNT_CONNECT_POPUP_WIDTH}`,
    `height=${ACCOUNT_CONNECT_POPUP_HEIGHT}`,
    `left=${Math.round(left)}`,
    `top=${Math.round(top)}`,
    'resizable=yes',
    'scrollbars=yes'
  ].join(',');
}

export async function runOAuthPopup(
  client: any,
  provider: string,
  popup: Window | null
): Promise<Record<string, any>> {
  if (!popup) {
    throw new Error('Please allow pop-ups to connect your account.');
  }

  let authorization;
  try {
    authorization = await client.startAccountConnect(
      provider,
      featheryWindow().location.origin
    );
  } catch (error) {
    popup.close();
    throw error;
  }

  const {
    authorization_url: authorizationUrl,
    callback_origin: callbackOrigin
  } = authorization;
  const state = authorization.state;
  if (!authorizationUrl || !callbackOrigin || !state) {
    popup.close();
    throw new Error('Unable to start authorization. Please try again.');
  }

  return new Promise<Record<string, any>>((resolve, reject) => {
    const win = featheryWindow();
    let settled = false;
    let checkingClosedPopup = false;

    const cleanup = () => {
      win.removeEventListener('message', handleMessage);
      win.clearInterval(closePoll);
      win.clearInterval(statusPoll);
      win.clearTimeout(timeout);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const handleResult = (payload: Record<string, any>) => {
      if (payload.success || payload.status === 'connected') {
        popup.close();
        finish(() => resolve(payload));
      } else if (payload.status === 'error' || payload.success === false) {
        popup.close();
        finish(() =>
          reject(new Error(payload.error || 'Unable to connect your account.'))
        );
      }
    };
    const handleMessage = (event: MessageEvent) => {
      const payload = event.data;
      if (
        event.source !== popup ||
        event.origin !== callbackOrigin ||
        payload?.type !== 'feathery-account-connect' ||
        payload?.state !== state
      ) {
        return;
      }
      handleResult(payload);
    };
    const checkStatus = async () => {
      try {
        const result = await client.getAccountConnectStatus(state);
        handleResult(result);
      } catch (_error) {
        // postMessage remains the primary path; transient polling errors can retry.
      }
      return settled;
    };

    win.addEventListener('message', handleMessage);
    const closePoll = win.setInterval(async () => {
      if (popup.closed && !checkingClosedPopup) {
        checkingClosedPopup = true;
        const completed = await checkStatus();
        if (!completed) {
          finish(() =>
            reject(new Error('Authorization was cancelled. Please try again.'))
          );
        }
        checkingClosedPopup = false;
      }
    }, 500);
    const statusPoll = win.setInterval(() => {
      if (!settled) checkStatus();
    }, 2000);
    const timeout = win.setTimeout(() => {
      popup.close();
      finish(() =>
        reject(new Error('Authorization timed out. Please try again.'))
      );
    }, ACCOUNT_CONNECT_TIMEOUT_MS);

    try {
      popup.location.href = authorizationUrl;
      popup.focus();
    } catch (error) {
      popup.close();
      finish(() => reject(error));
    }
  });
}
