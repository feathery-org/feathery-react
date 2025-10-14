import { useLayoutEffect, useState } from 'react';
import { featheryWindow } from '../utils/browser';

export type ElementSize = {
  width?: number;
  height?: number;
};

export default function useElementSize(anchorRef: {
  current: HTMLElement | null;
}): ElementSize {
  const [size, setSize] = useState<ElementSize>({
    width: undefined,
    height: undefined
  });

  useLayoutEffect(() => {
    const measure = () => {
      const element = anchorRef.current;
      if (!element) return;
      const { width, height } = element.getBoundingClientRect();
      setSize({
        width: width > 0 ? width : undefined,
        height: height > 0 ? height : undefined
      });
    };

    const element = anchorRef.current;
    if (!element) return;

    // Minimal fallback for environments without ResizeObserver.
    if (typeof ResizeObserver === 'undefined') {
      const win = featheryWindow() as any;
      if (
        win &&
        typeof win.addEventListener === 'function' &&
        typeof win.removeEventListener === 'function'
      ) {
        win.addEventListener('resize', measure);
        measure();
        return () => win.removeEventListener('resize', measure);
      }
      measure();
      return;
    }

    const resizeObserver = new ResizeObserver(() => measure());
    try {
      resizeObserver.observe(element, {
        box: 'border-box'
      } as ResizeObserverOptions);
    } catch {
      resizeObserver.observe(element);
    }

    measure();
    return () => resizeObserver.disconnect();
  }, [anchorRef]);

  return size;
}
