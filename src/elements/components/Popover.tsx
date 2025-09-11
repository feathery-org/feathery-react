import React, {
  ReactNode,
  useLayoutEffect,
  useRef,
  useState,
  useEffect,
  useCallback
} from 'react';
import { createPortal } from 'react-dom';
import { featheryDoc, featheryWindow } from '../../utils/browser';

type Position = {
  top: number;
  left: number;
};

type Placement =
  | 'top'
  | 'top-start'
  | 'top-end'
  | 'left'
  | 'left-start'
  | 'left-end'
  | 'bottom'
  | 'bottom-start'
  | 'bottom-end'
  | 'right'
  | 'right-start'
  | 'right-end';

interface OverlayProps {
  show: boolean;
  target: HTMLElement | null;
  children: ReactNode;
  onHide?: () => void;
  placement?: Placement;
  offset?: number;
}

const Overlay = ({
  show,
  target,
  children,
  onHide,
  placement = 'bottom-start',
  offset = 0
}: OverlayProps) => {
  const targetRef = useRef<HTMLElement>(target);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);

  // Keep target ref updated
  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  // --- Recalculate overlay position ---
  const recalculatePosition = useCallback(() => {
    if (!show || !targetRef.current || !ref.current) return;

    const window = featheryWindow();
    const targetRect = targetRef.current.getBoundingClientRect();
    const overlayRect = ref.current.getBoundingClientRect();

    let top = 0;
    let left = 0;
    let effectivePlacement: Placement = placement;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const calcPosition = (pl: Placement) => {
      switch (pl) {
        case 'top':
          return {
            top: targetRect.top - overlayRect.height - offset,
            left: targetRect.left + (targetRect.width - overlayRect.width) / 2
          };
        case 'top-start':
          return {
            top: targetRect.top - overlayRect.height - offset,
            left: targetRect.left
          };
        case 'top-end':
          return {
            top: targetRect.top - overlayRect.height - offset,
            left: targetRect.right - overlayRect.width
          };
        case 'left':
          return {
            top: targetRect.top + (targetRect.height - overlayRect.height) / 2,
            left: targetRect.left - overlayRect.width - offset
          };
        case 'left-start':
          return {
            top: targetRect.top,
            left: targetRect.left - overlayRect.width - offset
          };
        case 'left-end':
          return {
            top: targetRect.bottom - overlayRect.height,
            left: targetRect.left - overlayRect.width - offset
          };
        case 'bottom':
          return {
            top: targetRect.bottom + offset,
            left: targetRect.left + (targetRect.width - overlayRect.width) / 2
          };
        case 'bottom-start':
          return { top: targetRect.bottom + offset, left: targetRect.left };
        case 'bottom-end':
          return {
            top: targetRect.bottom + offset,
            left: targetRect.right - overlayRect.width
          };
        case 'right':
          return {
            top: targetRect.top + (targetRect.height - overlayRect.height) / 2,
            left: targetRect.right + offset
          };
        case 'right-start':
          return { top: targetRect.top, left: targetRect.right + offset };
        case 'right-end':
          return {
            top: targetRect.bottom - overlayRect.height,
            left: targetRect.right + offset
          };
        default:
          return {
            top: targetRect.bottom + offset,
            left: targetRect.left + (targetRect.width - overlayRect.width) / 2
          };
      }
    };

    ({ top, left } = calcPosition(placement));

    // Flip if overflowing viewport
    const fitsVertically =
      top >= 0 && top + overlayRect.height <= viewportHeight;
    const fitsHorizontally =
      left >= 0 && left + overlayRect.width <= viewportWidth;

    if (!fitsVertically || !fitsHorizontally) {
      switch (placement) {
        case 'top':
        case 'top-start':
        case 'top-end':
          if (top < 0)
            effectivePlacement = placement.replace(
              'top',
              'bottom'
            ) as Placement;
          break;
        case 'bottom':
        case 'bottom-start':
        case 'bottom-end':
          if (top + overlayRect.height > viewportHeight)
            effectivePlacement = placement.replace(
              'bottom',
              'top'
            ) as Placement;
          break;
        case 'left':
        case 'left-start':
        case 'left-end':
          if (left < 0)
            effectivePlacement = placement.replace(
              'left',
              'right'
            ) as Placement;
          break;
        case 'right':
        case 'right-start':
        case 'right-end':
          if (left + overlayRect.width > viewportWidth)
            effectivePlacement = placement.replace(
              'right',
              'left'
            ) as Placement;
          break;
      }
      ({ top, left } = calcPosition(effectivePlacement));
    }

    // Clamp inside viewport
    top = Math.max(0, Math.min(top, viewportHeight - overlayRect.height));
    left = Math.max(0, Math.min(left, viewportWidth - overlayRect.width));

    // Only update state if it changed
    setPosition((prev) => {
      const window = featheryWindow();
      if (
        !prev ||
        prev.top !== top + window.scrollY ||
        prev.left !== left + window.scrollX
      ) {
        return { top: top + window.scrollY, left: left + window.scrollX };
      }
      return prev;
    });
  }, [show, placement, offset]);

  // --- Throttled recalc ---
  const throttledRecalc = useRef<() => void>(() => {});
  useEffect(() => {
    let ticking = false;
    throttledRecalc.current = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          recalculatePosition();
          ticking = false;
        });
      }
    };
  }, [recalculatePosition]);

  // --- Layout effect: position overlay & prevent autofocus scroll ---
  useLayoutEffect(() => {
    if (!show) return;

    const window = featheryWindow();

    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    recalculatePosition();

    const handleFrame = requestAnimationFrame(() => {
      window.scrollTo(scrollX, scrollY);
    });

    window.addEventListener('resize', throttledRecalc.current);
    window.addEventListener('scroll', throttledRecalc.current, true);

    const resizeObserver = new ResizeObserver(() =>
      throttledRecalc.current?.()
    );
    if (ref.current) resizeObserver.observe(ref.current);
    if (targetRef.current) resizeObserver.observe(targetRef.current);

    return () => {
      cancelAnimationFrame(handleFrame);
      window.removeEventListener('resize', throttledRecalc.current);
      window.removeEventListener('scroll', throttledRecalc.current, true);
      resizeObserver.disconnect();
    };
  }, [show, recalculatePosition]);

  // --- Handle Escape & outside clicks ---
  useEffect(() => {
    if (!show) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPosition(null);
        onHide?.();
      }
    };

    const handleClickOutside = (event: any) => {
      if (
        ref.current &&
        !ref.current.contains(event.target) &&
        targetRef.current &&
        !targetRef.current.contains(event.target)
      ) {
        setPosition(null);
        onHide?.();
      }
    };

    featheryDoc().addEventListener('mousedown', handleClickOutside);
    featheryDoc().addEventListener('keydown', handleKeyDown);

    return () => {
      featheryDoc().removeEventListener('mousedown', handleClickOutside);
      featheryDoc().removeEventListener('keydown', handleKeyDown);
    };
  }, [show, onHide]);

  if (!show) return null;

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'absolute',
        ...(position || { top: -9999, left: -9999 })
      }}
    >
      {children}
    </div>,
    featheryDoc().body
  );
};

export default Overlay;
