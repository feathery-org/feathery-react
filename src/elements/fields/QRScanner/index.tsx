import React, { useEffect, useState } from 'react';
import { FORM_Z_INDEX } from '../../../utils/styles';
import { dynamicImport } from '../../../integrations/utils';
import { featheryDoc, featheryWindow } from '../../../utils/browser';
import { v4 as uuidv4 } from 'uuid';

const QR_SCANNER_URL = 'https://unpkg.com/html5-qrcode';

let qrPromise = Promise.resolve();
export function loadQRScanner() {
  qrPromise = dynamicImport(QR_SCANNER_URL);
}

const onQRError = (qrDivId: string, onChange: any) => () => {
  const errorEl = featheryDoc().getElementById(`${qrDivId}__header_message`);
  if (
    errorEl?.textContent?.trim() ===
    'D: No MultiFormat Readers were able to detect the code.'
  ) {
    errorEl.textContent =
      'No QR code detected. Please try with a different image.';
  }
  onChange('');
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
  const [qrDivId] = useState(`qr-reader-${uuidv4()}`);

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

      scanner.render(onSuccess, onQRError(qrDivId, onChange));
    });

    // Creating the variables outside of the setTimeout for the return function to have access to them
    let scanTypeChangeButton: Element | null, handleClick: () => void;
    let dropZone: Element | null | undefined, handleDrop: () => void;

    setTimeout(() => {
      // Had to go this route to ensure we are able to modify the text of the DnD element too.
      scanTypeChangeButton = featheryDoc().querySelector(
        `#${qrDivId} #html5-qrcode-anchor-scan-type-change`
      );

      handleDrop = () => {
        const dropTextDiv = dropZone
          ? dropZone.querySelector('div:last-child')
          : null;
        if (dropTextDiv) {
          dropTextDiv.textContent = 'Drop an image to scan';
        }
      };

      handleClick = () => {
        const labelToHide: HTMLLabelElement | null =
          featheryDoc().querySelector(
            `#${qrDivId} label[for='html5-qrcode-private-filescan-input']`
          );
        const dropZoneParent = featheryDoc().getElementById(
          `${qrDivId}__dashboard_section_csr`
        ).parentNode;
        dropZone = dropZoneParent?.children[1];

        if (dropZone) {
          dropZone.addEventListener('drop', handleDrop);
          const dropTextDiv = dropZone.querySelector('div:last-child');
          if (dropTextDiv) {
            dropTextDiv.textContent = 'Drop an image to scan';
          }
        }

        if (labelToHide) {
          if (labelToHide?.style) labelToHide.style.display = 'none';
        }
      };

      scanTypeChangeButton?.addEventListener('click', handleClick);
    }, 1000);

    // Clean up the event listener when the component unmounts
    return () => {
      scanTypeChangeButton?.removeEventListener('click', handleClick);
      dropZone?.removeEventListener('drop', handleDrop);
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
