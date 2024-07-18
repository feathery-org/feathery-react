import { Html5Qrcode } from 'html5-qrcode';

type ZoomSettings = {
  min: number;
  max: number;
  current: number;
  step: number;
};

export function getZoomSettings(scanner: Html5Qrcode): ZoomSettings | null {
  if (!scanner) {
    return null;
  }

  // possible options
  const cameraCapabilities = scanner.getRunningTrackCapabilities();
  // current options
  const cameraSettings = scanner.getRunningTrackSettings();

  // todo: figure out type for cameraCapabilities
  const supportsZoom =
    'zoom' in cameraCapabilities &&
    'min' in (cameraCapabilities.zoom as any) &&
    'max' in (cameraCapabilities.zoom as any);

  if (!supportsZoom) {
    return null;
  }

  const zoomCapabilities = cameraCapabilities.zoom as any;

  const current = (
    'zoom' in cameraSettings ? cameraSettings.zoom : 1
  ) as number;

  const zoomSettings = {
    min: zoomCapabilities.min as number,
    max: zoomCapabilities.max as number,
    step: zoomCapabilities.step ?? 0.1,
    current
  };

  return zoomSettings;
}
