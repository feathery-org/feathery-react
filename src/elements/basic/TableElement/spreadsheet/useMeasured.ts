import React from 'react';
import { featheryWindow } from '../../../../utils/browser';

/**
 * Calls `measure` with the element on layout, again whenever it resizes, and
 * whenever `remeasureKey` changes (e.g. the element mounting or its content
 * changing). Sizes are measured rather than assumed: scrollbars are a platform
 * setting, and text wraps.
 */
export function useMeasured<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  measure: (element: T) => void,
  remeasureKey?: unknown
) {
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const report = () => measure(element);
    report();
    const Observer = (featheryWindow() as any).ResizeObserver;
    if (!Observer) return;
    const observer = new Observer(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, measure, remeasureKey]);
}
