import React, { useEffect } from 'react';
import { FORM_Z_INDEX } from '../../../utils/styles';
import { dynamicImport } from '../../../integrations/utils';
import { featheryDoc, featheryWindow } from '../../../utils/browser';

const QR_SCANNER_URL = 'https://unpkg.com/html5-qrcode';

const qrDivId = 'qr-reader';
let qrPromise = Promise.resolve();
export function loadQRScanner() {
  qrPromise = dynamicImport(QR_SCANNER_URL);
}

const onQRError = () => {
  const errorEl = featheryDoc().getElementById(`${qrDivId}__header_message`);
  if (
    errorEl?.textContent?.trim() ===
    'D: No MultiFormat Readers were able to detect the code.'
  ) {
    errorEl.textContent =
      'No QR code detected. Please try with a different image.';
  }
};

function QRScanner({
  element,
  fieldLabel,
  responsiveStyles,
  editMode,
  elementProps = {},
  disabled = false,
  onChange = () => {},
  fieldVal = '',
  children
}: any) {
  let scanner: any = null;
  const servar = element.servar ?? {};

  useEffect(() => {
    if (disabled) return;

    loadQRScanner();
    qrPromise.then(async () => {
      if (!scanner) {
        const window = featheryWindow();
        for (let i = 0; i < 3; i++) {
          try {
            scanner = new window.Html5QrcodeScanner(qrDivId, {
              fps: 10
            });
            break;
          } catch (e) {
            // TypeError because HTMLScanner object not initialized yet
            // https://feathery-forms.sentry.io/issues/4870682565/
            console.error(e);
            if (!(e instanceof TypeError)) {
              throw e;
            }
          }
          // Half second delay to make sure it is loaded
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      const onSuccess = (decodedText: string) => {
        if (editMode || !decodedText) return;
        if (decodedText !== fieldVal) onChange(decodedText);
      };

      scanner.render(onSuccess, onQRError);
    });
  }, []);

  return (
    <>
      <div
        css={{
          maxWidth: '100%',
          width: '100%',
          height: '100%',
          ...responsiveStyles.getTarget('fc'),
          position: 'relative',
          pointerEvents: editMode || disabled ? 'none' : 'auto'
        }}
        {...elementProps}
      >
        {children}
        {fieldLabel}
        <div
          css={{
            position: 'relative',
            ...responsiveStyles.getTarget('sub-fc')
          }}
        >
          <div id={qrDivId} css={{ width: '100%' }} />
          {/* This input must always be rendered so we can set field errors */}
          <input
            id={servar.key}
            aria-label={element.properties.aria_label}
            // Set to file type so keyboard doesn't pop up on mobile
            // when field error appears
            type='file'
            style={{
              position: 'absolute',
              opacity: 0,
              bottom: 0,
              left: '50%',
              width: '1px',
              height: '1px',
              zIndex: FORM_Z_INDEX - 2
            }}
          />
        </div>
      </div>
    </>
  );
}

export default QRScanner;
