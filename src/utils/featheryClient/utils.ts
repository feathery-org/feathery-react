import { featheryWindow } from '../browser';
import { untrackUnload } from '../offlineRequestHandler';

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
