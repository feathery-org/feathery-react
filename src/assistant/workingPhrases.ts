import { useEffect, useState } from 'react';

// How long each phrase holds before the next one takes over. Tune here only.
export const WORKING_PHRASE_INTERVAL_MS = 5000;

// Shown in order while a turn runs, then wraps around. Same register as the
// original single phrase: calm, plainly about what is happening. Edit freely.
export const WORKING_PHRASES = [
  'Working on it...',
  'Still working...',
  'Thinking this through...',
  'Going through the details...',
  'Putting it together...',
  'This is taking a moment...'
];

// Cycles the phrases while `active`, holding on the first one otherwise. The
// index resets whenever `active` changes so every turn reads from the top
// rather than resuming wherever the previous turn stopped.
export const useWorkingPhrase = (active: boolean): string => {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (!active) return;
    const id = setInterval(
      () => setIndex((prev) => (prev + 1) % WORKING_PHRASES.length),
      WORKING_PHRASE_INTERVAL_MS
    );
    return () => clearInterval(id);
  }, [active]);

  return WORKING_PHRASES[index];
};
