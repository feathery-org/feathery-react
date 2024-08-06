const CAMERA_PREFERENCE_KEY = 'feathery-camera';

export type Camera_Preference = {
  device_id: string;
  zoom?: number;
};

export function getCameraPreferences(): Camera_Preference | null {
  if (!localStorage) return null;
  const storedData = localStorage.getItem(CAMERA_PREFERENCE_KEY);
  if (!storedData) return null;
  try {
    const preference = JSON.parse(storedData);
    if (
      preference &&
      preference.device_id &&
      typeof preference.device_id === 'string'
    ) {
      return preference;
    }
  } catch {
    return null;
  }
  return null;
}

export function setCameraPreferences(preference: Camera_Preference): void {
  if (!preference) return;
  if (!localStorage) return;
  try {
    localStorage.setItem(CAMERA_PREFERENCE_KEY, JSON.stringify(preference));
  } catch {}
}
