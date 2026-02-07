import { featheryWindow } from '../browser';
import { untrackUnload } from '../offlineRequestHandler';
import { initState } from '../init';

let conflictAlertShown = false;
export function handleFormConflict() {
  // Prevent multiple 409s from displaying multiple alerts
  if (conflictAlertShown) return;
  conflictAlertShown = true;

  untrackUnload(true);
  featheryWindow().alert(
    'This form has been updated. Please fill it out again.'
  );
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
