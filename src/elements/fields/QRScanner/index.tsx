import React, { useEffect } from 'react';
import { FORM_Z_INDEX } from '../../../utils/styles';
import { dynamicImport } from '../../../integrations/utils';
import { featheryWindow } from '../../../utils/browser';

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
    qrPromise.then(() => {
      if (!scanner) {
        const window = featheryWindow();
        scanner = new window.Html5QrcodeScanner('qr-reader', {
          fps: 10,
          qrbox: { width: 250, height: 250 }
        });
      }

      const onSuccess = (decodedText: string) => {
        if (editMode) return;
        if (decodedText !== fieldVal) onChange(fieldVal);
      };
      scanner.render(onSuccess);
    });
  }, []);

  return (
    <>
      <div
        css={{
          maxWidth: '100%',
          width: '100%',
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
          <div id='qr-reader' css={{ width: '600px' }} />
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
              left: 0,
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
