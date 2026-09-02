// Keep in sync with AUDIO_RECORDING_TRANSLATION in the backend's
// integration/translate.py so the translation integration seeds these
export const defaultTranslations = {
  record: 'Record audio',
  stop: 'Stop recording',
  clear: 'Clear recording',
  play: 'Play recording',
  pause: 'Pause recording',
  denied: 'Microphone access was denied',
  unsupported: 'Audio recording is not supported in this browser',
  empty: 'Nothing was recorded. Please try again'
} as const;

export type AudioRecordingTranslations = typeof defaultTranslations;
