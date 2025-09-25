import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  components as SelectComponents,
  GroupBase,
  ValueContainerProps
} from 'react-select';
import { featheryWindow } from '../../../../utils/browser';

const STYLES_MORE_INDICATOR = {
  backgroundColor: '#e6e6e6',
  padding: '3px 6px',
  fontSize: '15px',
  borderRadius: '2px',
  flexShrink: 0,
  marginRight: 4,
  marginLeft: 4
};

const CompactOptionValueContainer = <
  Option,
  IsMulti extends boolean,
  Group extends GroupBase<Option>
>(
  props: ValueContainerProps<Option, IsMulti, Group>
) => {
  const ValueContainerWrapper =
    SelectComponents.ValueContainer as unknown as React.ComponentType<
      ValueContainerProps<Option, IsMulti, Group>
    >;

  // Visible container (what the user sees)
  const valueContainerRef = useRef<HTMLDivElement | null>(null);

  // Offscreen option item measurer (always renders all option items for width measurement)
  const offscreenItemsContainerRef = useRef<HTMLDivElement | null>(null);

  // "+N more" indicator refs
  const moreIndicatorRef = useRef<HTMLDivElement | null>(null);
  const offscreenIndicatorRef = useRef<HTMLDivElement | null>(null);

  const rafIdRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // Number of visible option items; the rest collapse behind "+N more"
  const [visibleCount, setVisibleCount] = useState(0);

  // react-select selected count
  const totalItems = props.getValue().length;
  const moreCount = Math.max(0, totalItems - visibleCount);

  // Read outer width including horizontal margins
  const readOuterWidth = (el: HTMLElement): number => {
    const rect = el.getBoundingClientRect();
    const styles = featheryWindow().getComputedStyle(el);
    const ml = parseFloat(styles.marginLeft || '0');
    const mr = parseFloat(styles.marginRight || '0');

    return rect.width + ml + mr;
  };

  // Measure the "+N more" indicator width; prefer real node, else offscreen measurer
  const measureMoreWidth = useCallback((moreCount: number): number => {
    const real = moreIndicatorRef.current;
    if (real && real.textContent === `+${moreCount} more`) {
      return readOuterWidth(real);
    }

    const offscreen = offscreenIndicatorRef.current;
    if (!offscreen) return 0;

    offscreen.textContent = `+${Math.min(
      Number.MAX_SAFE_INTEGER,
      Math.max(1, moreCount)
    )} more`;

    return readOuterWidth(offscreen);
  }, []);

  // Available width for option items = container - input - reservedMore
  const getAvailableWidth = useCallback((reservedMore: number): number => {
    const vc = valueContainerRef.current;
    if (!vc) return 0;

    const containerWidth = vc.clientWidth; // includes padding, excludes border/scrollbar

    const inputEl = vc.querySelector(
      '.react-select__input'
    ) as HTMLElement | null;
    const inputWidth = inputEl ? readOuterWidth(inputEl) : 0;

    return Math.max(0, containerWidth - inputWidth - reservedMore);
  }, []);

  // Core packing based on offscreen option items width array
  const measureAndPack = useCallback(() => {
    const measurer = offscreenItemsContainerRef.current;
    if (!measurer) return;

    const optionItemNodes = Array.from(
      measurer.querySelectorAll('.react-select__multi-value')
    ) as HTMLElement[];

    // No selection
    if (optionItemNodes.length === 0 || totalItems === 0) {
      if (visibleCount !== 0) {
        setVisibleCount(0);
      }

      return;
    }

    // Collect width of all option items
    const itemWidthArray = optionItemNodes.map(readOuterWidth);

    const fitCount = (available: number): number => {
      let sum = 0;

      for (let i = 0; i < itemWidthArray.length; i++) {
        const w = itemWidthArray[i];

        if (sum + w <= available) {
          sum += w;
        } else {
          return i;
        }
      }

      return itemWidthArray.length;
    };

    // Pass 1: no "+N more"
    const available0 = getAvailableWidth(0);
    const visible = fitCount(available0);

    if (visible === totalItems) {
      if (visible !== visibleCount) {
        setVisibleCount(visible);
      }

      return;
    }

    // Pass 2: reserve indicator width for N = total - visible
    const n = Math.max(1, totalItems - visible);
    let reserved = measureMoreWidth(n);
    let available = getAvailableWidth(reserved);

    let visible2 = fitCount(available);
    const n2 = Math.max(1, totalItems - visible2);

    // Pass 3: stabilize if indicator width changed due to digit growth
    if (n2 !== n) {
      reserved = measureMoreWidth(n2);
      available = getAvailableWidth(reserved);
      visible2 = fitCount(available);
    }

    if (visible2 !== visibleCount) {
      setVisibleCount(visible2);
    }
  }, [getAvailableWidth, measureMoreWidth, totalItems, visibleCount]);

  // Schedule measurement with rAF to batch reads/writes post-layout
  const requestMeasure = useCallback(() => {
    if (rafIdRef.current != null) return;

    rafIdRef.current = featheryWindow().requestAnimationFrame(() => {
      rafIdRef.current = null;

      measureAndPack();

      // One-frame correction after indicator mounts
      featheryWindow().requestAnimationFrame(() => measureAndPack());
    });
  }, [measureAndPack]);

  // Observe visible container and input for size changes
  useLayoutEffect(() => {
    const vc = valueContainerRef.current;
    if (!vc) return;

    const ro = new ResizeObserver(() => {
      requestMeasure();
    });
    ro.observe(vc);

    const inputEl = vc.querySelector(
      '.react-select__input'
    ) as HTMLElement | null;
    if (inputEl) ro.observe(inputEl);

    resizeObserverRef.current = ro;

    // Initial measure
    requestMeasure();

    return () => {
      ro.disconnect();

      resizeObserverRef.current = null;

      if (rafIdRef.current != null) {
        featheryWindow().cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [requestMeasure]);

  // Re-measure on selection or children change
  useLayoutEffect(() => {
    requestMeasure();
  }, [totalItems, props.children, requestMeasure]);

  // Visible children container: slice option items by visibleCount
  const childrenContainer = useMemo(() => {
    if (!Array.isArray(props.children)) return props.children;

    const optionItems = props.children[0];

    if (!Array.isArray(optionItems) || totalItems === 0) {
      return <>{props.children[0]}</>;
    }

    const visibleOptionItems =
      visibleCount <= 0
        ? []
        : optionItems.slice(0, Math.min(visibleCount, optionItems.length));

    const indicator =
      moreCount > 0 ? (
        <div
          key={`${props?.selectProps?.inputId}-more-indicator`}
          ref={moreIndicatorRef}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'default',
            ...STYLES_MORE_INDICATOR
          }}
          aria-label={`There are ${moreCount} more selected items`}
          title={`${moreCount} more`}
        >
          +{moreCount} more
        </div>
      ) : null;

    return (
      <>
        {visibleOptionItems}
        {indicator}
      </>
    );
  }, [
    props.children,
    totalItems,
    visibleCount,
    moreCount,
    props?.selectProps?.inputId
  ]);

  // Offscreen measurer: always render all option items here to enable measurement
  const offscreenOptionItems = useMemo(() => {
    if (!Array.isArray(props.children)) return null;

    const optionItems = props.children[0];
    if (!Array.isArray(optionItems) || totalItems === 0) return null;

    return optionItems;
  }, [props.children, totalItems]);

  const inputElement =
    Array.isArray(props.children) && props.children.length > 1
      ? props.children[1]
      : null;

  return (
    <ValueContainerWrapper
      {...props}
      innerProps={{ ...props.innerProps, ref: valueContainerRef }}
    >
      {childrenContainer}
      {inputElement}

      {/* Offscreen option item measurer: must mirror layout constraints for accurate all option items width */}
      <div
        ref={offscreenItemsContainerRef}
        style={{
          position: 'absolute',
          visibility: 'hidden',
          pointerEvents: 'none',
          display: 'flex',
          flexWrap: 'nowrap',
          whiteSpace: 'nowrap',
          width: 'auto',
          maxWidth: 'none',
          left: 0,
          top: 0
        }}
      >
        {offscreenOptionItems}
      </div>

      {/* Offscreen indicator measurer: mirror indicator styles */}
      <div
        ref={offscreenIndicatorRef}
        style={{
          position: 'absolute',
          visibility: 'hidden',
          pointerEvents: 'none',
          ...STYLES_MORE_INDICATOR
        }}
      />
    </ValueContainerWrapper>
  );
};

export default CompactOptionValueContainer;
