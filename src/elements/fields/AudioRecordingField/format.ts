// Shared by the recording timer and the playback player
export const formatDuration = (totalSeconds: number) => {
  if (!isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};
