/*
 * selects the best camera available on the device to scan QR code
 * currently the way it does this is by taking the last camera in the list of video devices
 * according to the internet, most devices have the 'normal' back camera as the last device in the list
 * this was the most reliable to pick the back camera, and not secondary back cameras like the wide angle one
 */
export async function selectCamera(): Promise<any> {
  const devices = await fetchDeviceList();
  const cameras = devices.filter((device) => device.kind === 'videoinput');
  return cameras.length ? cameras[cameras.length - 1] : null;
}

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
