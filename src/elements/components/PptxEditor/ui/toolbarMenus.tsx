import React, { useEffect, useRef, useState } from 'react';
import { featheryWindow } from '../../../../utils/browser';
import { ZINC } from '../../DocxEditor/DocxToolbar/styles';
import { AMBER, styles } from './toolbarStyles';
import { useOutsideClose } from './useOutsideClose';

// Left edge for a fixed popover, kept within the viewport gutter.
const clampLeft = (preferredLeft: number, width: number) => {
  const vw = featheryWindow().innerWidth ?? Infinity;
  return Math.max(8, Math.min(preferredLeft, vw - width - 8));
};

// A toolbar dropdown: click-open panel that closes on outside click or Escape.
// The panel is position:fixed so the scrollable toolbar row cannot clip it.
export function MenuButton(props: {
  label: React.ReactNode;
  title: string;
  disabled?: boolean;
  width?: number;
  amber?: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const width = props.width ?? 230;
  const close = () => setOpen(false);

  useOutsideClose(
    open,
    close,
    (t) => !!btnRef.current?.contains(t) || !!panelRef.current?.contains(t)
  );

  return (
    <span css={{ display: 'inline-flex' }}>
      <button
        ref={btnRef}
        type='button'
        title={props.title}
        aria-label={props.title}
        aria-haspopup='true'
        aria-expanded={open}
        disabled={props.disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!open) {
            const r = btnRef.current?.getBoundingClientRect();
            if (r)
              setPos({ left: clampLeft(r.left, width), top: r.bottom + 4 });
          }
          setOpen(!open);
        }}
        css={{
          ...styles.btn(open, props.disabled),
          ...(props.amber ? { color: AMBER } : {})
        }}
      >
        {props.label}
        <span css={{ fontSize: 9, color: ZINC[500] }}>▾</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          role='group'
          aria-label={props.title}
          css={styles.menuPanel(pos.left, pos.top, width)}
        >
          {props.children(close)}
        </div>
      )}
    </span>
  );
}

// A nested menu row inside a MenuButton panel: hovering opens a flyout beside
// it (flipping left near the viewport edge). Collapses the shape list and grid.
export function SubMenu(props: {
  label: React.ReactNode;
  icon?: React.ReactNode;
  title: string;
  width?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const rowRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const width = props.width ?? 200;

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  useEffect(() => cancelClose, []);

  const openFlyout = () => {
    cancelClose();
    const r = rowRef.current?.getBoundingClientRect();
    if (!r) return;
    const overflowRight =
      r.right + width + 8 > (featheryWindow().innerWidth ?? Infinity);
    // Overlap the row by 1px so the pointer never crosses a dead gap that would
    // fire mouseleave and close the flyout.
    const preferred = overflowRight ? r.left - width + 1 : r.right - 1;
    setPos({ left: clampLeft(preferred, width), top: r.top - 6 });
    setOpen(true);
  };
  // Delay closing so a brief transit off the row does not dismiss the flyout.
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  };

  return (
    <span
      css={{ display: 'block', position: 'relative' }}
      onMouseEnter={openFlyout}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={rowRef}
        type='button'
        css={styles.menuItem}
        title={props.title}
        aria-haspopup='true'
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? setOpen(false) : openFlyout())}
      >
        {props.icon}
        {props.label}
        <span css={{ marginLeft: 'auto', fontSize: 10, color: ZINC[500] }}>
          ▸
        </span>
      </button>
      {open && (
        <div
          role='group'
          aria-label={props.title}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          css={styles.menuPanel(pos.left, pos.top, width)}
        >
          {props.children}
        </div>
      )}
    </span>
  );
}
