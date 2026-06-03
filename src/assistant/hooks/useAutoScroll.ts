import { MutableRefObject, useCallback, useEffect, useRef } from 'react';

import { featheryWindow } from '../../utils/browser';

const BOTTOM_THRESHOLD_PX = 60;

// Pins the message list to the bottom unless the user has scrolled up
export default function useAutoScroll(
  atBottomRef: MutableRefObject<boolean>,
  messages: unknown,
  status: unknown,
  extraDep?: unknown
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = distance < BOTTOM_THRESHOLD_PX;
  }, []);

  useEffect(() => {
    if (!atBottomRef.current) return;
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, extraDep]);

  useEffect(() => {
    if (status !== 'ready') return;
    if (!atBottomRef.current) return;
    const id = featheryWindow().requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'end'
      });
    });
    return () => featheryWindow().cancelAnimationFrame(id);
  }, [status]);

  return { containerRef, endRef, onScroll };
}
