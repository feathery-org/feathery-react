import { dynamicImport } from '../../../integrations/utils';

const QR_SCANNER_LIB_URL = 'https://unpkg.com/html5-qrcode';

export let qrPromise = Promise.resolve();
export function loadQRScanner() {
  qrPromise = dynamicImport(QR_SCANNER_LIB_URL);
}
