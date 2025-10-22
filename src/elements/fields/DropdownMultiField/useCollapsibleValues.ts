import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { featheryWindow } from '../../../utils/browser';

import type { OptionData } from './types';

// Treat width deltas under this threshold as noise so we don't thrash measurements.
const WIDTH_EPSILON = 0.5;

export default function useCollapsibleValues(
  containerRef: React.RefObject<HTMLElement | null>,
  values: OptionData[],
  enabled: boolean
) {
  const totalCount = values.length;
  const [visibleCount, setVisibleCount] = useState(totalCount);
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [rowHeight, setRowHeight] = useState<number | null>(null);
  const [measurementTick, setMeasurementTick] = useState(0);
  const pendingMeasurementRef = useRef(false);
  const queuedMeasurementRef = useRef(false);
  const pendingVisibleResetRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const lastWidthRef = useRef<number | null>(null);
  const lastCollapsedVisibleRef = useRef(totalCount);

  const valuesSignature = useMemo(
    () => values.map((item) => item.value).join('|'),
    [values]
  );

  const requestMeasurement = useCallback(() => {
    if (!enabled) return;

    if (pendingMeasurementRef.current) {
      queuedMeasurementRef.current = true;
      return;
    }

    // Let only one measurement frame run at a time—queue the rest.
    pendingMeasurementRef.current = true;
    queuedMeasurementRef.current = false;
    if (containerRef.current) {
      // Cache chip height (content + vertical margins) so masked rows stay steady.
      const chip = containerRef.current.querySelector(
        '[data-feathery-multi-value="true"]'
      ) as HTMLElement | null;
      if (chip) {
        const rect = chip.getBoundingClientRect();
        const style = featheryWindow().getComputedStyle(chip);
        const computedHeight =
          rect.height +
          parseFloat(style.marginTop || '0') +
          parseFloat(style.marginBottom || '0');
        setRowHeight((prev) => {
          if (prev === null) return computedHeight;
          return Math.abs(prev - computedHeight) > WIDTH_EPSILON
            ? computedHeight
            : prev;
        });
      }
    }
    if (!pendingVisibleResetRef.current) {
      setIsMeasuring(true);
    }
    pendingVisibleResetRef.current = true;
    setMeasurementTick((tick) => tick + 1);
  }, [containerRef, enabled, totalCount]);

  useEffect(() => {
    if (!enabled) return;
    requestMeasurement();
  }, [enabled, requestMeasurement, valuesSignature]);

  useEffect(() => {
    if (!enabled) return;

    const node = containerRef.current;
    if (!node) return;

    // Watch the rendered width so we can remap how many chips fit when the field resizes.
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const width = entry.contentRect.width;

      if (pendingMeasurementRef.current) {
        return;
      }

      if (lastWidthRef.current === null) {
        lastWidthRef.current = width;
        requestMeasurement();
        return;
      }

      if (Math.abs(width - lastWidthRef.current) > WIDTH_EPSILON) {
        lastWidthRef.current = width;
        requestMeasurement();
      }
    });

    observer.observe(node);

    return () => observer.disconnect();
  }, [containerRef, enabled, requestMeasurement]);

  useLayoutEffect(() => {
    if (!pendingMeasurementRef.current) return;

    // After React commits, run one frame of measurement to determine how many
    // chips still share the first row and cache their height for later renders.
    frameRef.current = featheryWindow().requestAnimationFrame(() => {
      pendingMeasurementRef.current = false;
      pendingVisibleResetRef.current = false;

      const container = containerRef.current;
      let nextVisible = totalCount;

      if (enabled && container) {
        const chips = Array.from(
          container.querySelectorAll('[data-feathery-multi-value="true"]')
        ) as HTMLElement[];

        if (chips.length) {
          const firstTop = chips[0].offsetTop;
          nextVisible = chips.length;

          for (let index = 0; index < chips.length; index += 1) {
            if (chips[index].offsetTop - firstTop > WIDTH_EPSILON) {
              nextVisible = index;
              break;
            }
          }

          const rect = chips[0].getBoundingClientRect();
          const style = featheryWindow().getComputedStyle(chips[0]);
          const computedHeight =
            rect.height +
            parseFloat(style.marginTop || '0') +
            parseFloat(style.marginBottom || '0');
          setRowHeight((prev) => {
            if (prev === null) return computedHeight;
            return Math.abs(prev - computedHeight) > WIDTH_EPSILON
              ? computedHeight
              : prev;
          });
        }
      }

      const clampedVisible = nextVisible || (enabled && values.length ? 1 : 0);
      setVisibleCount((prev) => (prev === clampedVisible ? prev : clampedVisible));
      setIsMeasuring(false);

      if (containerRef.current) {
        lastWidthRef.current =
          containerRef.current.getBoundingClientRect().width;
      }

      if (enabled) {
        lastCollapsedVisibleRef.current = nextVisible;
      }

      if (queuedMeasurementRef.current) {
        queuedMeasurementRef.current = false;
        requestMeasurement();
      }
    });

    return () => {
      if (frameRef.current !== null) {
        featheryWindow().cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [enabled, measurementTick, requestMeasurement, totalCount]);

  useEffect(() => {
    if (!enabled) {
      setIsMeasuring(false);
      setRowHeight(null);
      pendingMeasurementRef.current = false;
      queuedMeasurementRef.current = false;
      pendingVisibleResetRef.current = false;
      lastWidthRef.current = null;
      return;
    }

    setVisibleCount((prev) => {
      const restored = Math.min(lastCollapsedVisibleRef.current, totalCount);
      const clamped = restored || (totalCount > 0 ? 1 : 0);
      return prev === clamped ? prev : clamped;
    });
  }, [enabled, totalCount]);

  useEffect(() => {
    lastCollapsedVisibleRef.current = Math.min(
      lastCollapsedVisibleRef.current,
      totalCount
    );
  }, [totalCount]);

  const collapsedCount = enabled ? Math.max(totalCount - visibleCount, 0) : 0;

  return {
    visibleCount: enabled ? visibleCount : totalCount,
    collapsedCount,
    isMeasuring: enabled ? isMeasuring : false,
    rowHeight: enabled ? rowHeight : null
  };
}
