import { useEffect, useState } from 'react';
import { featheryWindow } from '../../../utils/browser';

// Whether the viewport is under the form's mobile breakpoint, live across
// resizes -- for styles resolved in JS, so they switch to a mobile override
// exactly when the emitted media queries do.
export default function useMobileViewport(breakpoint: number) {
  const query = `(max-width: ${breakpoint}px)`;
  const [isMobile, setIsMobile] = useState(
    () => !!featheryWindow().matchMedia?.(query).matches
  );

  useEffect(() => {
    const media = featheryWindow().matchMedia?.(query);
    if (!media) return;
    setIsMobile(!!media.matches);
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);

  return isMobile;
}
