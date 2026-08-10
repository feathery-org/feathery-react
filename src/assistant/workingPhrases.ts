import { useEffect, useState } from 'react';

// How long each phrase holds before the next one takes over. Tune here only.
export const WORKING_PHRASE_INTERVAL_MS = 5000;

// How long the turn has to stay idle before the busy signals stand down. One
// turn is many HTTP round-trips: the SDK finishes a request, and only once the
// client tool it asked for has resolved does it fire the next one, so its
// status dips through 'ready' in between. Long enough to swallow that dip,
// short enough that the signal still clears promptly when the reply is really
// finished. Tune here only.
export const TURN_IDLE_GRACE_MS = 500;

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

// Latches `running` across the idle gaps between one turn's round-trips: true
// the moment work starts, false only once it has stayed idle for the whole
// grace window. A request starting inside that window means the latch never
// dropped, so nothing keyed on it remounts and the phrase cycle keeps counting.
//
// This is the single owner of "a turn is running" - every visual busy signal
// reads it, so they cannot disagree about when a turn began or ended.
export const useTurnRunning = (running: boolean): boolean => {
  const [latched, setLatched] = useState(running);

  useEffect(() => {
    // Entering is immediate and un-timed: the signal has to feel responsive,
    // and there is no timer to leak on this path
    if (running) {
      setLatched(true);
      return;
    }
    const id = setTimeout(() => setLatched(false), TURN_IDLE_GRACE_MS);
    // Runs both on unmount and the moment `running` goes true again, so a
    // pending stand-down can never fire part-way through the next round-trip
    return () => clearTimeout(id);
  }, [running]);

  return latched;
};

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
