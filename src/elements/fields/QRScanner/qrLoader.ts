import { dynamicImport } from '../../../integrations/utils';

const QR_SCANNER_LIB_URL =
  'https://cdn.jsdelivr.net/npm/html5-qrcode/html5-qrcode.min.js';

export let qrPromise = Promise.resolve();
export function loadQRScanner() {
  qrPromise = dynamicImport(QR_SCANNER_LIB_URL);
}
