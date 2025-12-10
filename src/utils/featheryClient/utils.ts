import { featheryWindow } from '../browser';
import * as errors from '../error';
import { untrackUnload } from '../offlineRequestHandler';

let conflictAlertShown = false;

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
      throw new errors.SDKKeyError();
    case 404:
      throw new errors.FetchError("Can't find object");
    case 409:
      // prevent multiple 409s from displaying multiple alerts
      if (conflictAlertShown) return;
      conflictAlertShown = true;

      // Note: remove beforeunload listeners if there is a conflict
      untrackUnload(true);
      featheryWindow().alert(
        'This form has been updated. Please fill it out again.'
      );
      location.reload();
      return;
    case 500:
      throw new errors.FetchError('Internal server error');
    default:
      throw new errors.FetchError('Unknown error');
  }
}
