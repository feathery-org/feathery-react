import { useEffect, useState } from 'react';
import { featheryWindow } from '../../../utils/browser';

export const COLLAPSE_BREAKPOINT = 1024;

export function useIsNarrowViewport() {
  const [isNarrow, setIsNarrow] = useState(
    () =>
      featheryWindow().matchMedia?.(`(max-width: ${COLLAPSE_BREAKPOINT}px)`)
        .matches ?? false
  );

  useEffect(() => {
    const mql = featheryWindow().matchMedia?.(
      `(max-width: ${COLLAPSE_BREAKPOINT}px)`
    );
    if (!mql) return undefined;
    const handler = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isNarrow;
}
