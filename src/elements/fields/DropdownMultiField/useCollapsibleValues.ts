import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react';

import { featheryWindow } from '../../../utils/browser';

import type { OptionData } from './types';

// Treat width deltas under this threshold as noise so we don't thrash measurements.
const WIDTH_EPSILON = 20;
// When checking for a new row (via offsetTop deltas), treat tiny differences as same-line noise.
const ROW_BREAK_EPSILON = 20;

const parseFloatOrZero = (value: string | null | undefined) =>
  value ? parseFloat(value) || 0 : 0;

export default function useCollapsibleValues(
  containerRef: React.RefObject<HTMLElement | null>,
  values: OptionData[],
  enabled: boolean
) {
  const totalCount = values.length;
  const [visibleCount, setVisibleCount] = useState(totalCount);
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measurementTick, setMeasurementTick] = useState(0);
  const pendingMeasurementRef = useRef(false);
  const queuedMeasurementRef = useRef(false);
  const pendingVisibleResetRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const postMeasureFrameRef = useRef<number | null>(null);
  const lastWidthRef = useRef<number | null>(null);
  const lastCollapsedVisibleRef = useRef(totalCount);
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  const lastValuesRef = useRef<OptionData[] | null>(null);
  const suppressResizeRef = useRef(false);

  // Reusable hidden +N indicator used only inside the measurement container.
  // We attach it to the measurement clone's chip parent so we can account for
  // the indicator's width without disturbing the live layout.
  const ensureIndicator = (parent: HTMLElement) => {
    let indicator = indicatorRef.current;
    if (!indicator) {
      const created = parent.ownerDocument?.createElement('span');
      if (!created) {
        return null;
      }
      created.setAttribute('aria-hidden', 'true');
      created.setAttribute('data-feathery-collapsed-indicator', 'true');
      created.className = 'rs-collapsed-chip';
      created.style.visibility = 'hidden';
      created.style.position = 'absolute';
      created.style.pointerEvents = 'none';
      created.style.whiteSpace = 'nowrap';
      created.style.top = '0';
      created.style.left = '0';
      indicatorRef.current = created;
      indicator = created;
    }

    if (!parent.contains(indicator)) {
      parent.appendChild(indicator);
    }

    return indicator;
  };

  useEffect(
    () => () => {
      indicatorRef.current?.remove();
      indicatorRef.current = null;
    },
    []
  );

  // Create a hidden clone of the container so measurements do not disturb the live layout.
  const materializeMeasurementContainer = (
    source: HTMLElement
  ): { node: HTMLElement; cleanup: () => void } | null => {
    const ownerDocument = source.ownerDocument ?? featheryWindow().document;
    const sourceRect = source.getBoundingClientRect();

    if (sourceRect.width <= 0 || sourceRect.height <= 0) {
      return null;
    }

    const clone = source.cloneNode(true) as HTMLElement;
    clone.setAttribute('data-feathery-collapse-measure', 'true');
    clone.style.position = 'absolute';
    clone.style.visibility = 'hidden';
    clone.style.pointerEvents = 'none';
    clone.style.left = '-10000px';
    clone.style.top = '0';
    clone.style.width = `${sourceRect.width}px`;
    clone.style.maxWidth = `${sourceRect.width}px`;
    clone.style.height = 'auto';
    clone.style.maxHeight = 'none';
    clone.style.whiteSpace = 'normal';
    clone.style.overflow = 'visible';
    ownerDocument.body.appendChild(clone);

    const chips = Array.from(
      clone.querySelectorAll('[data-feathery-multi-value="true"]')
    ) as HTMLElement[];

    chips.forEach((chip) => {
      chip.style.removeProperty('display');
      chip.style.removeProperty('opacity');
      chip.style.removeProperty('pointer-events');
      chip.style.removeProperty('position');
      chip.style.removeProperty('left');
      chip.style.removeProperty('top');
    });

    const chipParent = chips[0]?.parentElement as HTMLElement | undefined;
    if (chipParent) {
      chipParent.style.flexWrap = 'wrap';
      chipParent.style.whiteSpace = 'normal';
      chipParent.style.display = 'flex';
    }

    clone
      .querySelectorAll('[data-feathery-collapsed-indicator="true"]')
      .forEach((node) => node.remove());

    return {
      node: clone,
      cleanup: () => {
        clone.remove();
      }
    };
  };

  const requestMeasurement = useCallback(() => {
    if (!enabled) return;

    if (pendingMeasurementRef.current) {
      queuedMeasurementRef.current = true;
      return;
    }

    // Let only one measurement frame run at a time—queue the rest.
    pendingMeasurementRef.current = true;
    queuedMeasurementRef.current = false;
    // Note: We intentionally avoid touching layout here; all DOM measurement
    // happens in a rAF after commit against a hidden clone.
    if (!pendingVisibleResetRef.current) {
      setIsMeasuring(true);
    }
    pendingVisibleResetRef.current = true;
    setMeasurementTick((tick) => tick + 1);
  }, [containerRef, enabled, totalCount]);

  useEffect(() => {
    const previous = lastValuesRef.current;
    lastValuesRef.current = values;

    if (!enabled) return;

    if (!previous) {
      requestMeasurement();
      return;
    }

    const hasChanged =
      previous.length !== values.length ||
      previous.some((item, index) => item.value !== values[index]?.value);

    if (hasChanged) {
      requestMeasurement();
    }
  }, [enabled, requestMeasurement, values]);

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

      if (suppressResizeRef.current) {
        suppressResizeRef.current = false;
        lastWidthRef.current = width;
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
      let nextVisible = Math.min(lastCollapsedVisibleRef.current, totalCount);
      let cleanupMeasurement: (() => void) | undefined;
      let measurementContainer: HTMLElement | null = null;

      if (enabled && container) {
        const result = materializeMeasurementContainer(container);
        if (result) {
          measurementContainer = result.node;
          cleanupMeasurement = result.cleanup;
        }
      }

      if (enabled && measurementContainer) {
        const chips = Array.from(
          measurementContainer.querySelectorAll(
            '[data-feathery-multi-value="true"]'
          )
        ) as HTMLElement[];

        if (chips.length) {
          const firstTop = chips[0].offsetTop;
          nextVisible = chips.length;

          for (let index = 0; index < chips.length; index += 1) {
            if (chips[index].offsetTop - firstTop > ROW_BREAK_EPSILON) {
              nextVisible = index;
              break;
            }
          }

          const parent = chips[0].parentElement;
          if (parent && totalCount > nextVisible) {
            const indicator = ensureIndicator(parent);
            if (indicator) {
              const parentRect = parent.getBoundingClientRect();
              const parentStyle = featheryWindow().getComputedStyle(parent);
              const gap =
                parseFloatOrZero(parentStyle.columnGap) ||
                parseFloatOrZero(parentStyle.gap);
              const paddingLeft = parseFloatOrZero(parentStyle.paddingLeft);
              const paddingRight = parseFloatOrZero(parentStyle.paddingRight);
              // Available width equals inner content box (exclude horizontal padding).
              const availableWidth = Math.max(
                parentRect.width - paddingLeft - paddingRight,
                0
              );

              const updateIndicatorMetrics = () => {
                indicator.textContent = `+${Math.max(
                  totalCount - nextVisible,
                  0
                )}`;
                const indicatorRect = indicator.getBoundingClientRect();
                const indicatorStyle =
                  featheryWindow().getComputedStyle(indicator);
                return (
                  indicatorRect.width +
                  parseFloatOrZero(indicatorStyle.marginLeft) +
                  parseFloatOrZero(indicatorStyle.marginRight)
                );
              };

              const maxIterations = totalCount + 1;
              let iteration = 0;
              let indicatorWidth = 0;

              while (nextVisible > 0 && iteration < maxIterations) {
                indicatorWidth = updateIndicatorMetrics();
                const lastIndex = nextVisible - 1;
                const lastChip = chips[lastIndex];
                if (!lastChip) break;

                const lastChipRect = lastChip.getBoundingClientRect();
                const lastChipStyle =
                  featheryWindow().getComputedStyle(lastChip);
                const chipRightEdge =
                  lastChipRect.right - parentRect.left - paddingLeft;
                const spacer =
                  gap > 0 ? gap : parseFloatOrZero(lastChipStyle.marginRight);

                if (
                  chipRightEdge + spacer + indicatorWidth <=
                  availableWidth + WIDTH_EPSILON
                ) {
                  break;
                }

                nextVisible -= 1;
                iteration += 1;
              }

              if (iteration >= maxIterations) {
                // Guard against oscillation if the indicator width changes while we trim.
                nextVisible = Math.max(
                  Math.min(nextVisible, totalCount - 1),
                  0
                );
              }
            }
          }
        }
      }

      cleanupMeasurement?.();

      const clampedVisible = nextVisible || (enabled && values.length ? 1 : 0);
      setVisibleCount((prev) =>
        prev === clampedVisible ? prev : clampedVisible
      );
      setIsMeasuring(false);
      suppressResizeRef.current = true;

      if (postMeasureFrameRef.current !== null) {
        featheryWindow().cancelAnimationFrame(postMeasureFrameRef.current);
      }
      postMeasureFrameRef.current = featheryWindow().requestAnimationFrame(
        () => {
          postMeasureFrameRef.current = null;
          if (containerRef.current) {
            lastWidthRef.current =
              containerRef.current.getBoundingClientRect().width;
          }
        }
      );

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
      if (postMeasureFrameRef.current !== null) {
        featheryWindow().cancelAnimationFrame(postMeasureFrameRef.current);
        postMeasureFrameRef.current = null;
      }
    };
  }, [enabled, measurementTick, requestMeasurement, totalCount]);

  useEffect(() => {
    if (!enabled) {
      setIsMeasuring(false);
      pendingMeasurementRef.current = false;
      queuedMeasurementRef.current = false;
      pendingVisibleResetRef.current = false;
      lastWidthRef.current = null;
      suppressResizeRef.current = false;
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
    isMeasuring: enabled ? isMeasuring : false
  };
}
