import { ReactNode, useEffect, useRef, useState } from 'react';

// Actions that settle faster than this never show a loader, so near-instant
// clicks don't flash a spinner
export const LOADER_SHOW_DELAY_MS = 150;
// Once shown, a loader stays up at least this long so a click that settles just
// after the delay doesn't flicker
export const LOADER_MIN_VISIBLE_MS = 400;

/**
 * Debounces a button's loader. `isLoading` is true from the moment a loader is
 * requested, so the button can block clicks immediately, while `loader` only
 * renders once the request has outlived the show delay.
 */
export default function useDelayedLoader(requested: ReactNode) {
  const isRequested = Boolean(requested);
  const [isShown, setIsShown] = useState(false);
  const shownAtRef = useRef(0);
  // Keeps drawing the last loader through the minimum-visible tail, after the
  // request itself has been cleared
  const lastLoaderRef = useRef<ReactNode>(null);
  if (isRequested) lastLoaderRef.current = requested;

  useEffect(() => {
    if (isRequested === isShown) return;

    const delay = isRequested
      ? LOADER_SHOW_DELAY_MS
      : Math.max(0, LOADER_MIN_VISIBLE_MS - (Date.now() - shownAtRef.current));
    const timer = setTimeout(() => {
      if (isRequested) shownAtRef.current = Date.now();
      setIsShown(isRequested);
    }, delay);
    return () => clearTimeout(timer);
  }, [isRequested, isShown]);

  return {
    loader: isShown ? (isRequested ? requested : lastLoaderRef.current) : null,
    isLoading: isRequested || isShown
  };
}
