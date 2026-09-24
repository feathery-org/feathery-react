import React, { useEffect, useRef, useState } from 'react';
import { featheryWindow } from '../../../../utils/browser';

// Native `title` tooltips only appear after the browser's fixed ~1s hover
// delay. This wrapper suppresses them and shows a styled tooltip near-instantly.
const SHOW_DELAY_MS = 100;

type Tip = { text: string; x: number; y: number; above: boolean };

export default function InstantTooltips(props: { children: React.ReactNode }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const el = anchorRef.current;
    anchorRef.current = null;
    if (el) {
      const stored = el.getAttribute('data-tt');
      el.removeAttribute('data-tt');
      // React may have re-set a fresh title while hovered (e.g. a toggle's
      // label changed on click); never clobber it with the stale one.
      if (stored && !el.hasAttribute('title')) el.setAttribute('title', stored);
    }
    setTip(null);
  };

  useEffect(() => hide, []);

  const showFor = (el: HTMLElement) => {
    const text = el.getAttribute('title');
    if (!text) return;
    hide();
    el.setAttribute('data-tt', text);
    el.removeAttribute('title');
    anchorRef.current = el;
    timerRef.current = setTimeout(() => {
      const win = featheryWindow();
      const r = el.getBoundingClientRect();
      const above = r.bottom + 40 > (win.innerHeight ?? Infinity);
      setTip({
        text,
        x: Math.min(
          Math.max(r.left + r.width / 2, 60),
          (win.innerWidth ?? Infinity) - 60
        ),
        y: above ? r.top - 6 : r.bottom + 6,
        above
      });
    }, SHOW_DELAY_MS);
  };

  const onEnterTarget = (target: EventTarget | null) => {
    const anchor = anchorRef.current;
    if (anchor && anchor.contains(target as Node)) return;
    const el = (target as HTMLElement)?.closest?.(
      '[title]'
    ) as HTMLElement | null;
    if (el) showFor(el);
    else if (anchor) hide();
  };

  return (
    <div
      style={{ display: 'contents' }}
      onMouseOver={(e) => onEnterTarget(e.target)}
      onMouseOut={(e) => {
        const anchor = anchorRef.current;
        if (anchor && !anchor.contains(e.relatedTarget as Node)) hide();
      }}
      onMouseDownCapture={hide}
      onFocus={(e) => onEnterTarget(e.target)}
      onBlur={hide}
    >
      {props.children}
      {tip && (
        <div
          role='tooltip'
          css={{
            position: 'fixed',
            left: tip.x,
            top: tip.y,
            transform: tip.above
              ? 'translate(-50%, -100%)'
              : 'translateX(-50%)',
            zIndex: 10000,
            pointerEvents: 'none',
            background: '#171a1c',
            color: '#fff',
            fontSize: 11,
            lineHeight: '15px',
            padding: '4px 8px',
            borderRadius: 4,
            maxWidth: 260,
            textAlign: 'center',
            whiteSpace: 'pre-line',
            boxShadow: '0 4px 12px rgba(23,26,28,.25)'
          }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}
