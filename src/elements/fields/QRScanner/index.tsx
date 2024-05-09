import React, { useEffect } from 'react';
import { FORM_Z_INDEX } from '../../../utils/styles';
import { dynamicImport } from '../../../integrations/utils';
import { featheryDoc, featheryWindow } from '../../../utils/browser';

const QR_SCANNER_URL = 'https://unpkg.com/html5-qrcode';

let qrPromise = Promise.resolve();
export function loadQRScanner() {
  qrPromise = dynamicImport(QR_SCANNER_URL);
}

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
            scanner = new window.Html5QrcodeScanner('qr-reader', {
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

      const onError = (error: any) => {
        const errorMessageElement = featheryDoc().getElementById(
          'qr-reader__header_message'
        );
        if (
          errorMessageElement &&
          error === 'D: No MultiFormat Readers were able to detect the code.'
        ) {
          errorMessageElement.textContent =
            'No QR code detected. Please try with a different image.';
        }
      };

      scanner.render(onSuccess, onError);
    });

    // Cleanup function to stop and clear the scanner instance
    return () => {
      if (scanner && scanner?.stop) scanner.stop();
      if (scanner && scanner?.clear) scanner.clear();
      scanner = null;
    };
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
          <div id='qr-reader' css={{ width: '100%' }} />
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
