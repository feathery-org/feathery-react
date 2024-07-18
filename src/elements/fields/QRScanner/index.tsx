import React, { useCallback, useEffect } from 'react';
import { dynamicImport } from '../../../integrations/utils';

import { selectCamera } from './utils/select-camera';
import { getZoomSettings } from './utils/supports-zoom';
import { useDeviceRotation } from './hooks/use-device-rotation';
import { featheryWindow } from '../../../utils/browser';
const QR_SCANNER_URL = 'https://unpkg.com/html5-qrcode';

enum Html5QrcodeScannerState {
  // Invalid internal state, do not set to this state.
  UNKNOWN = 0,
  // Indicates the scanning is not running or user is using file based
  // scanning.
  NOT_STARTED = 1,
  // Camera scan is running.
  SCANNING = 2,
  // Camera scan is paused but camera is running.
  PAUSED = 3
}

let qrPromise = Promise.resolve();
export function loadQRScanner() {
  qrPromise = dynamicImport(QR_SCANNER_URL);
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

const SCAN_CONFIG = {
  fps: 8,
  qrbox: { width: 250, height: 250 },
  rememberLastUsedCamera: true,
  disableFlip: true,
  useBarCodeDetectorIfSupported: true
} as const;

function CustomScanner({ onSuccess, disabled }: any) {
  const id = React.useId();
  const scanner = React.useRef<any>();
  const zoomInput = React.useRef<HTMLInputElement>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [scanningState, setScanningState] =
    React.useState<Html5QrcodeScannerState>(
      Html5QrcodeScannerState.NOT_STARTED
    );

  useEffect(() => {
    if (disabled) return;
    loadQRScanner();
  }, [disabled]);

  async function scanFile(imageFile: File) {
    // scanner must exist
    if (!scanner.current) {
      return;
    }
    const { deviceId: cameraId } = scanner.current.getRunningTrackSettings();
    if (scanner.current.getState() === 2) {
      await scanner.current.stop();
    }
    scanner.current
      .scanFileV2(imageFile, false)
      .then(({ decodedText, result }: any) =>
        onScanSuccess(decodedText, result)
      )
      .catch((err: any) => {
        console.error(err);
        // TODO: toast: no code detected
        if (cameraId) {
          scanner.current?.start(
            cameraId,
            SCAN_CONFIG,
            onScanSuccess,
            undefined
          );
        } else {
          handleStop();
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

  function onScanSuccess(decodedText: string, decodedResult: any) {
    handleStop();
    setScanningState(Html5QrcodeScannerState.NOT_STARTED);
    onSuccess?.(decodedText, decodedResult);
  }

  const handleStart = useCallback(async () => {
    scanner.current = await createScanner(id);
    console.log('scanner.current', scanner.current);
    if (scanner.current?.getState() === Html5QrcodeScannerState.NOT_STARTED) {
      setScanningState(Html5QrcodeScannerState.SCANNING);
      const camera = await selectCamera();
      await scanner.current.start(
        camera.deviceId,
        SCAN_CONFIG,
        onScanSuccess,
        undefined
      );

      const zoomSettings = getZoomSettings(scanner.current);

      if (zoomSettings && zoomInput.current) {
        zoomInput.current.hidden = false;
        zoomInput.current.min = zoomSettings.min.toString();
        zoomInput.current.max = zoomSettings.max.toString();
        zoomInput.current.step = zoomSettings.step.toString();
        zoomInput.current.value = zoomSettings.current.toString();
      }
    }
  }, []);

  const handleStop = useCallback(async () => {
    if (scanner.current) {
      if (scanner.current?.getState() === Html5QrcodeScannerState.SCANNING) {
        scanner.current.stop();
      }
      scanner.current = undefined;
    }

    if (zoomInput.current) {
      zoomInput.current.hidden = true;
      zoomInput.current.value = '1';
    }

    if (fileInput.current) {
      fileInput.current.value = '';
    }

    setScanningState(Html5QrcodeScannerState.NOT_STARTED);
  }, []);

  useDeviceRotation(handleStop, {
    enabled: scanningState === Html5QrcodeScannerState.SCANNING
  });

  return (
    <div>
      <button type='button' onClick={handleStart}>
        Start scanning
      </button>
      <div hidden={scanningState === Html5QrcodeScannerState.NOT_STARTED}>
        <div>
          <div id={id} style={{ width: '100%', height: '100%' }} />
          {scanningState === Html5QrcodeScannerState.SCANNING && (
            <>
              <button type='button' onClick={handleStop}>
                Close
              </button>
              <input
                ref={zoomInput}
                type='range'
                hidden
                onChange={(event) => {
                  applyZoom(Number(event.target.value));
                }}
              />
              <div>
                <button onClick={fileInput.current?.click}>Gallery</button>
                <input
                  ref={fileInput}
                  type='file'
                  accept='image/*'
                  capture='environment'
                  hidden
                  onChange={(event) => {
                    if (event.target.files && event.target.files.length) {
                      const imageFile = event.target.files[0];
                      scanFile(imageFile);
                    }
                  }}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default CustomScanner;
