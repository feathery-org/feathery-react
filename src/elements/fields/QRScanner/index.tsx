import React, { useCallback, useEffect } from 'react';
import { dynamicImport } from '../../../integrations/utils';
import { FORM_Z_INDEX } from '../../../utils/styles';

import { selectCamera } from './utils/select-camera';
import { getZoomSettings } from './utils/supports-zoom';
import { useDeviceRotation } from './hooks/use-device-rotation';
import { featheryWindow } from '../../../utils/browser';
import {
  Html5QrcodeScannerState,
  PLACEHOLDER_IMAGE,
  QR_SCANNER_LIB_URL,
  SCAN_CONFIG
} from './constants';

let qrPromise = Promise.resolve();
export function loadQRScanner() {
  qrPromise = dynamicImport(QR_SCANNER_LIB_URL);
}

async function createScanner(id: string) {
  await qrPromise;
  const window = featheryWindow();
  for (let i = 0; i < 3; i++) {
    try {
      const scanner = new window.Html5Qrcode(id);
      return scanner;
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
  const servar = element.servar ?? {};
  const id = React.useId();
  const scanner = React.useRef<any>();
  const zoomInput = React.useRef<HTMLInputElement>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [message, setMessage] = React.useState('');
  const [zoomEnabled, setZoomEnabled] = React.useState(false);
  const selectedCamera = React.useRef<MediaDeviceInfo>();
  const [scanningState, setScanningState] =
    React.useState<Html5QrcodeScannerState>(
      Html5QrcodeScannerState.NOT_STARTED
    );

  useEffect(() => {
    if (disabled) return;
    loadQRScanner();
  }, [disabled]);

  useEffect(() => {
    return () => {
      handleStop(true);
    };
  }, []);

  async function scanFile(imageFile: File) {
    if (disabled) return;
    if (!scanner.current) {
      scanner.current = await createScanner(id);
    }

    setMessage('');
    let cameraId = '';
    if (scanner.current.getState() === Html5QrcodeScannerState.SCANNING) {
      const settings = scanner.current.getRunningTrackSettings();
      cameraId = settings.deviceId;
      await scanner.current.stop();
    }
    scanner.current
      .scanFileV2(imageFile, false)
      .then(({ decodedText }: any) => onScanSuccess(decodedText))
      .catch((err: any) => {
        console.error(err);
        setMessage('No QR code detected. Please try with a different image.');
        if (cameraId) {
          scanner.current?.start(
            cameraId,
            SCAN_CONFIG,
            onScanSuccess,
            undefined
          );
        }
      });
  }

  function applyZoom(value: number) {
    // scanner must exist
    if (!scanner.current) {
      return;
    }
    // scanner must be running
    if (scanner.current.getState() !== 2) {
      return;
    }
    // TODO: figure out how to type this properly
    scanner.current?.applyVideoConstraints({
      zoom: value
    } as any);
  }

  function onScanSuccess(decodedText: string) {
    handleStop();
    if (editMode || !decodedText) return;
    if (decodedText !== fieldVal) onChange(decodedText);
  }

  const handleStart = useCallback(async () => {
    if (disabled) return;
    if (!scanner.current) {
      scanner.current = await createScanner(id);
    }
    setScanningState(Html5QrcodeScannerState.SCANNING);
    setMessage('');
    if (scanner.current?.getState() === Html5QrcodeScannerState.NOT_STARTED) {
      let camera = selectedCamera.current;
      if (!camera) {
        camera = await selectCamera();
        selectedCamera.current = camera;
        if (!camera) {
          setMessage('No camera found');
          return;
        }
      }
      await scanner.current.start(
        camera.deviceId,
        SCAN_CONFIG,
        onScanSuccess,
        undefined
      );
      const zoomSettings = getZoomSettings(scanner.current);

      if (zoomSettings && zoomInput.current) {
        zoomInput.current.min = zoomSettings.min.toString();
        zoomInput.current.max = zoomSettings.max.toString();
        zoomInput.current.step = zoomSettings.step.toString();
        zoomInput.current.value = zoomSettings.current.toString();
        setZoomEnabled(true);
      } else {
        setZoomEnabled(false);
      }
    }
  }, []);

  const handleStop = useCallback(async (clearScanner = false) => {
    if (scanner.current) {
      if (scanner.current?.getState() === Html5QrcodeScannerState.SCANNING) {
        scanner.current
          .stop()
          .catch((e: any) => {
            console.error('Error stopping scanner:', e);
          })
          .finally(() => {
            if (clearScanner) {
              scanner.current = null;
            }
          });
      } else if (clearScanner) {
        scanner.current = null;
      }
    }

    if (zoomInput.current) {
      setZoomEnabled(false);
      zoomInput.current.value = '1';
    }

    if (fileInput.current) {
      fileInput.current.value = '';
    }
    setMessage('');
    setScanningState(Html5QrcodeScannerState.NOT_STARTED);
  }, []);

  useDeviceRotation(handleStop, {
    enabled: scanningState === Html5QrcodeScannerState.SCANNING
  });

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
        <span style={{ pointerEvents: 'none' }}>{fieldLabel}</span>
        <div
          css={{
            position: 'relative',
            overflow: 'hidden',
            border: '1px solid #e7e7e7',
            ...responsiveStyles.getTarget('sub-fc')
          }}
        >
          <div
            style={{
              width: '100%',
              minHeight: 150,
              textAlign: 'center',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 10,
              paddingBottom: 16
            }}
          >
            <div id={id} style={{ width: '100%' }} />

            {scanningState === Html5QrcodeScannerState.NOT_STARTED && (
              <>
                <img
                  width='64'
                  src={PLACEHOLDER_IMAGE}
                  alt='Camera based scan'
                  style={{ opacity: '0.8', marginBottom: 10, marginTop: 16 }}
                />
                <button
                  disabled={disabled}
                  type='button'
                  onClick={() => handleStart()}
                >
                  {fieldVal ? 'Scan Again' : 'Start Scanning'}
                </button>
              </>
            )}
            {scanningState === Html5QrcodeScannerState.SCANNING && (
              <>
                <input
                  ref={zoomInput}
                  style={{ alignSelf: 'stretch', margin: 10 }}
                  type='range'
                  hidden={!zoomEnabled}
                  onChange={(event) => {
                    applyZoom(Number(event.target.value));
                  }}
                />
                <button type='button' onClick={() => handleStop()}>
                  Stop Scanning
                </button>
              </>
            )}
            <div>
              <button
                type='button'
                disabled={disabled}
                onClick={() => fileInput.current?.click()}
              >
                Upload Image to Scan
              </button>
              <input
                ref={fileInput}
                type='file'
                accept='image/*'
                capture='environment'
                style={{
                  visibility: 'hidden',
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  height: 0,
                  width: 0,
                  border: 0
                }}
                onChange={(event) => {
                  if (event.target.files && event.target.files.length) {
                    const imageFile = event.target.files[0];
                    scanFile(imageFile);
                  }
                }}
              />
            </div>
            {message && <div style={{ paddingTop: 16 }}>{message}</div>}
          </div>
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
