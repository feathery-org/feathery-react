import React from 'react';
import { featheryDoc } from '../../../../utils/browser';
import { rowMenuItemStyle, rowMenuStyle } from './styles';

export type ContextMenuItem = {
  label: string;
  run: () => void;
};

// Breathing room kept between the menu and the viewport edge, in px.
const VIEWPORT_MARGIN = 8;

type ContextMenuProps = {
  x: number;
  y: number;
  label: string;
  className: string;
  itemClassName: string;
  items: ContextMenuItem[];
  onClose: () => void;
};

/**
 * Positions a fixed popover at (x, y) and dismisses it like a menu: it keeps
 * itself inside the viewport and closes on any click elsewhere, a scroll
 * outside it, or Escape. Shared by the context menus and the filter popover.
 */
export function useAnchoredPopover(
  ref: React.RefObject<HTMLElement | null>,
  x: number,
  y: number,
  onClose: () => void
) {
  // The popover opens at the pointer, which near the bottom or right edge of
  // the viewport would put part of it off screen. Measured once it exists and
  // pulled back inside; until then it renders where it was asked to.
  const [position, setPosition] = React.useState({ x, y });
  React.useLayoutEffect(() => {
    const popover = ref.current;
    if (!popover) return;
    const { width, height } = popover.getBoundingClientRect();
    const view = featheryDoc().defaultView;
    if (!view) return;
    setPosition({
      x: Math.max(
        VIEWPORT_MARGIN,
        Math.min(x, view.innerWidth - width - VIEWPORT_MARGIN)
      ),
      y: Math.max(
        VIEWPORT_MARGIN,
        Math.min(y, view.innerHeight - height - VIEWPORT_MARGIN)
      )
    });
  }, [ref, x, y]);

  // `mousedown` rather than `click` so the popover is gone before the grid
  // handles a selection on the same gesture. A scroll inside the popover (a
  // long value list) is its own business and does not dismiss it.
  React.useEffect(() => {
    const doc = featheryDoc();
    const isInside = (target: EventTarget | null) =>
      target instanceof Node && Boolean(ref.current?.contains(target));
    const onPointerDown = (event: MouseEvent) => {
      if (!isInside(event.target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onScroll = (event: Event) => {
      if (!isInside(event.target)) onClose();
    };
    doc.addEventListener('mousedown', onPointerDown);
    doc.addEventListener('keydown', onKeyDown);
    doc.addEventListener('scroll', onScroll, true);
    return () => {
      doc.removeEventListener('mousedown', onPointerDown);
      doc.removeEventListener('keydown', onKeyDown);
      doc.removeEventListener('scroll', onScroll, true);
    };
  }, [ref, onClose]);

  return position;
}

/**
 * A right-click menu anchored at the pointer. Shared by the row and column
 * header menus.
 */
export function ContextMenu({
  x,
  y,
  label,
  className,
  itemClassName,
  items,
  onClose
}: ContextMenuProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const position = useAnchoredPopover(ref, x, y, onClose);

  if (!items.length) return null;

  return (
    <div
      ref={ref}
      role='menu'
      aria-label={label}
      className={className}
      css={{ ...rowMenuStyle, left: position.x, top: position.y }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type='button'
          role='menuitem'
          className={itemClassName}
          css={rowMenuItemStyle}
          onClick={() => {
            item.run();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
