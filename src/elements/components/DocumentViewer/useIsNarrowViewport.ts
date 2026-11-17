import { RefObject, useEffect, useState } from 'react';
import { featheryWindow } from '../../../utils/browser';

const COLLAPSE_BREAKPOINT = 1024;

// Narrow by the viewport, or by `elementRef`'s own width when given (an
// embedded viewer is sized by its container, not the window).
export function useIsNarrowViewport(
  elementRef?: RefObject<HTMLElement | null>
): boolean {
  // An unmeasured element starts collapsed rather than crowding a small box.
  const [isNarrow, setIsNarrow] = useState(
    () =>
      !!elementRef ||
      (featheryWindow().matchMedia?.(`(max-width: ${COLLAPSE_BREAKPOINT}px)`)
        .matches ??
        false)
  );

  useEffect(() => {
    const element = elementRef?.current;
    if (element) {
      if (typeof ResizeObserver === 'undefined') return undefined;
      const observer = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width;
        if (width) setIsNarrow(width <= COLLAPSE_BREAKPOINT);
      });
      observer.observe(element);
      return () => observer.disconnect();
    }
    const mql = featheryWindow().matchMedia?.(
      `(max-width: ${COLLAPSE_BREAKPOINT}px)`
    );
    if (!mql) return undefined;
    const handler = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [elementRef]);

  return isNarrow;
}
