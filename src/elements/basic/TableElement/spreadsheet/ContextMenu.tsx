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
 * A right-click menu anchored at the pointer. Shared by the row and column
 * header menus: it keeps itself inside the viewport and closes on any click
 * elsewhere, a scroll, or Escape.
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

  // The menu opens at the pointer, which near the bottom or right edge of the
  // viewport would put part of it off screen. Measured once it exists and
  // pulled back inside; until then it renders where it was asked to.
  const [position, setPosition] = React.useState({ x, y });
  React.useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
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
  }, [x, y]);

  // `mousedown` rather than `click` so the menu is gone before the grid
  // handles a selection on the same gesture.
  React.useEffect(() => {
    const doc = featheryDoc();
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    doc.addEventListener('mousedown', onPointerDown);
    doc.addEventListener('keydown', onKeyDown);
    doc.addEventListener('scroll', onClose, true);
    return () => {
      doc.removeEventListener('mousedown', onPointerDown);
      doc.removeEventListener('keydown', onKeyDown);
      doc.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

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
