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
import { setCameraPreferences } from './utils/local-storage';
import Slider from 'rc-slider';
import SliderStyles from '../SliderField/styles';
import throttle from 'lodash.throttle';

let qrPromise = Promise.resolve();
export function loadQRScanner() {
  qrPromise = dynamicImport(QR_SCANNER_LIB_URL);
}

async function createScanner(cameraElementId: string) {
  await qrPromise;
  const window = featheryWindow();
  return new window.Html5Qrcode(cameraElementId);
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
  const cameraElementId = React.useId();
  const scanner = React.useRef<any>();
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [message, setMessage] = React.useState('');
  const [zoomSettings, setZoomSettings] = React.useState<any>(false);
  const [zoom, setZoom] = React.useState(1);
  const [cameraList, setCameraList] = React.useState<any>([]);
  const [selectedCamera, setSelectedCamera] = React.useState<string>('');
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

  function applyZoom(value: number) {
    // scanner must exist
    if (!scanner.current) {
      return;
    }
    // scanner must be running
    if (scanner.current.getState() !== Html5QrcodeScannerState.SCANNING) {
      return;
    }
    // TODO: figure out how to type this properly
    scanner.current?.applyVideoConstraints({
      zoom: value
    } as any);
  }

  function onScanSuccess(decodedText: string) {
    if (servar.metadata?.close_on_scan) {
      handleStop();
    }
    if (editMode || !decodedText) return;
    if (decodedText !== fieldVal) onChange(decodedText);
  }

  const handleStart = useCallback(
    async (cameraId?: string) => {
      if (disabled) return;
      if (!scanner.current) {
        scanner.current = await createScanner(cameraElementId);
      }
      setScanningState(Html5QrcodeScannerState.SCANNING);
      setMessage('');
      if (scanner.current?.getState() === Html5QrcodeScannerState.NOT_STARTED) {
        let camera = cameraId ?? selectedCamera;
        if (!camera) {
          const result = await selectCamera();
          if (result) {
            const { bestCameraId, allCameras } = result;
            setCameraList(allCameras);
            camera = bestCameraId;
            setSelectedCamera(camera);
          }
          if (!camera) {
            setMessage('No camera found');
            return;
          }
        }
        await scanner.current.start(
          camera,
          SCAN_CONFIG,
          onScanSuccess,
          undefined
        );
        const zoomCapabilities = getZoomSettings(scanner.current);

        if (zoomCapabilities) {
          setZoomSettings(zoomCapabilities);
          setZoom(zoomCapabilities.current);
          applyZoom(zoomCapabilities.current);
        } else {
          setZoomSettings(false);
          setZoom(1);
        }
      }
    },
    [selectedCamera]
  );

  const handleStop = useCallback(async (clearScanner = false) => {
    if (scanner.current) {
      if (scanner.current?.getState() === Html5QrcodeScannerState.SCANNING) {
        setCameraPreferences({
          device_id: scanner.current.getRunningTrackSettings().deviceId
        });
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

    setZoomSettings(false);
    setZoom(1);

    if (fileInput.current) {
      fileInput.current.value = '';
    }
    setMessage('');
    setScanningState(Html5QrcodeScannerState.NOT_STARTED);
  }, []);

  useDeviceRotation(handleStop, {
    enabled: scanningState === Html5QrcodeScannerState.SCANNING
  });

  async function changeCamera(newCameraId: string) {
    setSelectedCamera(newCameraId);
    await handleStop();
    await handleStart(newCameraId);
  }

  const handleZoom = useCallback(
    throttle((value: number) => {
      applyZoom(value);
      setZoom(value);
    }, 10),
    []
  );

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
            <div
              id={cameraElementId}
              style={{
                width: '100%',
                aspectRatio: SCAN_CONFIG.aspectRatio.toString(),
                display:
                  scanningState !== Html5QrcodeScannerState.SCANNING
                    ? 'none'
                    : 'grid',
                overflow: 'hidden',
                placeContent: 'center'
              }}
            />

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
                <SliderStyles
                  customStyles={{
                    ['.rc-slider-handle'.repeat(2)]: {
                      height: 30,
                      width: 30,
                      marginTop: -9,
                      opacity: 1,
                      userSelect: 'none'
                    },
                    ['.rc-slider-track'.repeat(3)]: {
                      height: 12
                    },
                    ['.rc-slider-rail'.repeat(3)]: {
                      height: 12
                    },
                    ['.rc-slider'.repeat(3)]: {
                      height: 12,
                      padding: '10px 0'
                    }
                  }}
                />
                {Boolean(zoomSettings) && (
                  <div
                    style={{
                      display: 'flex',
                      alignSelf: 'stretch',
                      marginInline: 30,
                      marginBottom: 20
                    }}
                  >
                    <Slider
                      value={zoom}
                      min={zoomSettings?.min ?? 0}
                      max={zoomSettings?.max ?? 100}
                      step={zoomSettings?.step ?? 0.1}
                      onChange={handleZoom as any}
                      style={{
                        flex: 1,
                        paddingBlock: 10
                      }}
                    />
                  </div>
                )}
                <div
                  style={{
                    alignSelf: 'stretch',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginInline: 15
                  }}
                >
                  <button type='button' onClick={() => handleStop()}>
                    Stop Scanning
                  </button>
                  {cameraList.length > 1 && (
                    <select
                      value={selectedCamera}
                      onChange={(event) => changeCamera(event.target.value)}
                    >
                      {cameraList.map((camera: any) => (
                        <option key={camera.deviceId} value={camera.deviceId}>
                          {camera.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </>
            )}
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
