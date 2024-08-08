import { getCameraPreferences } from './local-storage';

type CameraDetails = {
  label: string;
  deviceId: string;
  selected?: boolean;
  capabilities: MediaTrackCapabilities;
};

// fetch device list, getting permissions if needed
async function fetchDeviceList(): Promise<MediaDeviceInfo[]> {
  let devices = await navigator.mediaDevices.enumerateDevices();

  const noPermission = devices
    .filter((device) => device.kind === 'videoinput')
    .every((device) => device.label === '');

  if (noPermission) {
    // open a stream, then get list of devices while permission is active
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' }
      },
      audio: false
    });

    // enumerate devices again - now the label field should be non-empty, as we have a stream active
    // (even if we didn't get persistent permission for camera)
    devices = await navigator.mediaDevices.enumerateDevices();

    // close the stream, as we don't need it anymore
    stream.getTracks().forEach((track) => track.stop());
  }

  return devices;
}

export async function selectCamera(): Promise<any> {
  const allCameras = await getVideoCamerasAndCapabilities();
  let possibleCameras = [...allCameras];
  if (possibleCameras.length === 0) {
    console.error('No cameras found!');
    return null;
  }

  const cameraPreference = getCameraPreferences();
  if (
    cameraPreference?.device_id &&
    allCameras.some((cam: any) => cam.deviceId === cameraPreference?.device_id)
  ) {
    return {
      bestCameraId: cameraPreference?.device_id,
      allCameras
    };
  }

  if (possibleCameras.length === 1) {
    return {
      bestCameraId: possibleCameras[0].deviceId,
      allCameras
    };
  }

  if (possibleCameras.some(backFacingCamera)) {
    possibleCameras = possibleCameras.filter(backFacingCamera);
  }

  if (possibleCameras.some(zoomCamera)) {
    possibleCameras = possibleCameras.filter(zoomCamera);
  }

  if (possibleCameras.some(torchCamera)) {
    possibleCameras = possibleCameras.filter(torchCamera);
  }

  possibleCameras.sort(sortByFocusDistance);

  return {
    bestCameraId: possibleCameras[0].deviceId,
    allCameras
  };
}

const backFacingCamera = (camera: CameraDetails) =>
  camera.capabilities.facingMode?.includes('enviroment');
const torchCamera = (camera: CameraDetails) =>
  (camera.capabilities as any).torch;
const zoomCamera = (camera: CameraDetails) =>
  (camera.capabilities as any).zoom?.min != null &&
  (camera.capabilities as any).zoom?.max != null;

const sortByFocusDistance = (a: CameraDetails, b: CameraDetails) => {
  const aFocus = (a.capabilities as any).focusDistance?.min;
  const bFocus = (b.capabilities as any).focusDistance?.min;

  if (typeof aFocus === 'number' && typeof bFocus !== 'number') return -1;
  if (typeof aFocus !== 'number' && typeof bFocus === 'number') return 1;
  if (typeof aFocus !== 'number' && typeof bFocus !== 'number') return 0;
  return aFocus - bFocus;
};

export async function getVideoCamerasAndCapabilities() {
  try {
    // Get the list of media devices
    const devices = await fetchDeviceList();

    // Filter the devices to get only video input devices
    const videoDevices = devices.filter(
      (device) => device.kind === 'videoinput'
    );

    // Create a list to hold the camera details
    const cameraList: CameraDetails[] = [];

    for (const device of videoDevices) {
      // Get a stream from the device to access its capabilities
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: device.deviceId }
      });
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities();
      // Add the camera and its capabilities to the list
      cameraList.push({
        label: device.label,
        deviceId: device.deviceId,
        capabilities: capabilities
      });

      // Stop the track to release the camera
      track.stop();
    }

    return cameraList;
  } catch (error) {
    console.error('Error accessing video devices:', error);
    return [];
  }
}
