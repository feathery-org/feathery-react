import { featheryWindow } from '../browser';
import {
  FetchError,
  FormConflictError,
  SDKKeyError
} from '@feathery/client-utils';
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

export async function checkResponseSuccess(response: any) {
  let payload;
  switch (response.status) {
    case 200:
    case 201:
    case 202:
      return;
    case 400:
      payload = JSON.stringify(await response.clone().text());
      console.error(payload.toString());
      return;
    case 401:
      throw new SDKKeyError();
    case 404:
      throw new FetchError("Can't find object");
    case 409:
      throw new FormConflictError();
    case 500:
      throw new FetchError('Internal server error');
    default:
      throw new FetchError('Unknown error');
  }
}
