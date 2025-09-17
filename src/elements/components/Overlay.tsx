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
  targetRef: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  onHide?: () => void;
  placement?: Placement;
  offset?: number;
  zIndex?: number;
  /** Optional container ref to render the overlay into. Defaults to document.body */
  containerRef?: React.RefObject<HTMLElement | null>;
}

const Overlay = ({
  show,
  targetRef,
  children,
  onHide,
  placement = 'bottom-start',
  offset = 0,
  zIndex = 1000,
  containerRef
}: OverlayProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);

  const getContainer = useCallback(() => {
    return containerRef?.current || featheryDoc().body;
  }, [containerRef]);

  const recalcPosition = useCallback(() => {
    if (!show || !targetRef.current || !ref.current) return;

    const window = featheryWindow();
    const container = getContainer();
    if (!container) return;

    const targetRect = targetRef.current.getBoundingClientRect();
    const overlayRect = ref.current.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    let { top, left } = calcPosition(
      placement,
      targetRect,
      overlayRect,
      offset
    );

    // Flip if it doesn’t fit
    const overlayBottom = top + overlayRect.height;
    const overlayRight = left + overlayRect.width;

    const fitsVertically = top >= 0 && overlayBottom <= window.innerHeight;
    const fitsHorizontally = left >= 0 && overlayRight <= window.innerWidth;

    if (!fitsVertically || !fitsHorizontally) {
      const flipped = getFlippedPlacement(
        placement,
        !fitsVertically,
        !fitsHorizontally
      );
      if (flipped !== placement) {
        ({ top, left } = calcPosition(
          flipped,
          targetRect,
          overlayRect,
          offset
        ));
      }
    }

    const isBodyContainer = container === featheryDoc().body;
    const finalTop = isBodyContainer
      ? top + window.scrollY
      : top - containerRect.top;
    const finalLeft = isBodyContainer
      ? left + window.scrollX
      : left - containerRect.left;

    setPosition((prev) => {
      if (!prev || prev.top !== finalTop || prev.left !== finalLeft) {
        return { top: finalTop, left: finalLeft };
      }
      return prev;
    });
  }, [show, placement, offset, getContainer, targetRef]);

  const throttledRecalc = useCallback(() => {
    let ticking = false;
    return () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          recalcPosition();
          ticking = false;
        });
      }
    };
  }, [recalcPosition])();

  useLayoutEffect(() => {
    if (show) recalcPosition();
  }, [show, recalcPosition]);

  useEffect(() => {
    if (!show) return;

    const window = featheryWindow();
    const container = getContainer();
    if (!container) return;

    window.addEventListener('resize', throttledRecalc);
    window.addEventListener('scroll', throttledRecalc, true);

    if (container !== featheryDoc().body) {
      container.addEventListener('scroll', throttledRecalc);
    }

    const resizeObserver = new ResizeObserver(() => throttledRecalc());
    if (targetRef.current) resizeObserver.observe(targetRef.current);
    if (container !== featheryDoc().body) resizeObserver.observe(container);

    return () => {
      window.removeEventListener('resize', throttledRecalc);
      window.removeEventListener('scroll', throttledRecalc, true);
      if (container !== featheryDoc().body) {
        container.removeEventListener('scroll', throttledRecalc);
      }
      resizeObserver.disconnect();
    };
  }, [show, throttledRecalc, getContainer, targetRef]);

  useEffect(() => {
    if (!show) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPosition(null);
        onHide?.();
      }
    };

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        ref.current &&
        !ref.current.contains(target) &&
        targetRef.current &&
        !targetRef.current.contains(target)
      ) {
        setPosition(null);
        onHide?.();
      }
    };

    const doc = featheryDoc();
    doc.addEventListener('mousedown', handleClickOutside);
    doc.addEventListener('keydown', handleKeyDown);

    return () => {
      doc.removeEventListener('mousedown', handleClickOutside);
      doc.removeEventListener('keydown', handleKeyDown);
    };
  }, [show, onHide, targetRef]);

  if (!show) return null;

  const container = getContainer();
  if (!container) return <>{children}</>;

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'absolute',
        ...(position || { top: -9999, left: -9999 }),
        zIndex
      }}
    >
      {children}
    </div>,
    container
  );
};

export default Overlay;

const getFlippedPlacement = (
  original: Placement,
  needsVerticalFlip: boolean,
  needsHorizontalFlip: boolean
): Placement => {
  if (needsVerticalFlip) {
    if (original.includes('top')) {
      return original.replace('top', 'bottom') as Placement;
    }
    if (original.includes('bottom')) {
      return original.replace('bottom', 'top') as Placement;
    }
  }
  if (needsHorizontalFlip) {
    if (original.includes('left')) {
      return original.replace('left', 'right') as Placement;
    }
    if (original.includes('right')) {
      return original.replace('right', 'left') as Placement;
    }
  }
  return original;
};

const calcPosition = (
  pl: Placement,
  targetRect: DOMRect,
  overlayRect: DOMRect,
  offset = 0
): Position => {
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
      return {
        top: targetRect.bottom + offset,
        left: targetRect.left
      };
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
      return {
        top: targetRect.top,
        left: targetRect.right + offset
      };
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
