import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { featheryDoc } from '../../../../utils/browser';
import { menuPanel } from './styles';

interface MenuProps {
  trigger: (o: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'center' | 'end';
  onClose?: () => void;
}

// Dropdown anchored to its trigger; the panel renders in a portal on
// document.body (see menuPanel in styles.ts for why).
export default function Menu({
  trigger,
  children,
  align = 'start',
  onClose
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const doc = featheryDoc();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      // Ignore clicks on the trigger or inside ANY toolbar menu panel (panels
      // are portaled to body, incl. menus nested inside the "More" panel).
      if (ref.current?.contains(t) || t.closest?.('[data-docx-menu]')) return;
      setOpen(false);
      onClose?.();
    };
    doc.addEventListener('mousedown', onDown);
    return () => doc.removeEventListener('mousedown', onDown);
  }, [open, onClose]);

  const toggle = () => {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({
        top: r.bottom + 4,
        left:
          align === 'start'
            ? r.left
            : align === 'center'
            ? r.left + r.width / 2
            : r.right
      });
    }
    setOpen((o) => !o);
  };

  const close = () => {
    setOpen(false);
    onClose?.();
  };

  return (
    <div css={{ position: 'relative' }} ref={ref}>
      {trigger({ open, toggle })}
      {open &&
        createPortal(
          <div
            data-docx-menu=''
            css={menuPanel(align)}
            style={{ top: pos.top, left: pos.left }}
          >
            {children(close)}
          </div>,
          featheryDoc().body
        )}
    </div>
  );
}
