import { FetchError } from '@feathery/client-utils';
import { featheryWindow } from '../browser';
import { untrackUnload } from '../offlineRequestHandler';
import { initState } from '../init';

let conflictAlertShown = false;

export function handleFormConflict() {
  // Prevent multiple 409s from displaying multiple alerts
  if (conflictAlertShown) return;
  conflictAlertShown = true;

  untrackUnload(true);
  featheryWindow().alert('This form has been updated. Please reload.');
  location.reload();
}

export function handleFormAuthenticationError(errorMessage?: string) {
  untrackUnload(true);
  // Store the authentication error in initState so Form component can show FormOff
  initState.authenticationError =
    errorMessage || 'Access to this form is restricted';
  // Trigger a re-render by updating remount callbacks
  Object.values(initState.remountCallbacks).forEach((callback: any) => {
    callback?.();
  });
}

// Backoff for retrying the session in the background once the form has fallen
// back to its origin step
export const SESSION_RETRY_DELAYS_MS = [1000, 3000, 7000];

// Dropped connections and server errors can clear up; a rejected request
// (400, 404) won't, so it isn't worth retrying
export function isRetryableSessionError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return (
    error instanceof FetchError &&
    ['Internal server error', 'Unknown error'].includes(error.message)
  );
}
