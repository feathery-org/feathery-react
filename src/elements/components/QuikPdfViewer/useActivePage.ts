import { RefObject, useCallback, useEffect, useRef, useState } from 'react';

export const pageKey = (pdfUrl: string, pageIndex: number) =>
  `${pdfUrl}-${pageIndex}`;

export function useActivePage(
  rootRef: RefObject<HTMLElement | null>,
  pageOrder: string[]
) {
  const [activeKey, setActiveKey] = useState('');
  const pageOrderRef = useRef(pageOrder);
  pageOrderRef.current = pageOrder;
  const ratiosRef = useRef<Record<string, number>>({});
  const keyByElement = useRef<Map<Element, string>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const key = keyByElement.current.get(entry.target);
          if (key !== undefined)
            ratiosRef.current[key] = entry.intersectionRatio;
        });
        let bestKey = '';
        let bestRatio = 0;
        pageOrderRef.current.forEach((key) => {
          const ratio = ratiosRef.current[key] ?? 0;
          if (ratio > bestRatio) {
            bestKey = key;
            bestRatio = ratio;
          }
        });
        if (bestKey) setActiveKey(bestKey);
      },
      { root: rootRef.current, threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    observerRef.current = observer;
    keyByElement.current.forEach((_, el) => observer.observe(el));
    return () => {
      observerRef.current = null;
      observer.disconnect();
    };
    // The root element exists by the time effects run; keys register via
    // observePage which handles both before- and after-mount ordering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const observePage = useCallback((key: string, el: HTMLElement | null) => {
    keyByElement.current.forEach((existingKey, existingEl) => {
      if (existingKey === key && existingEl !== el) {
        observerRef.current?.unobserve(existingEl);
        keyByElement.current.delete(existingEl);
      }
    });
    if (el && !keyByElement.current.has(el)) {
      keyByElement.current.set(el, key);
      observerRef.current?.observe(el);
    }
  }, []);

  const activeIndex = pageOrder.indexOf(activeKey);
  return {
    activeKey,
    activePageNumber: activeIndex >= 0 ? activeIndex + 1 : 1,
    observePage
  };
}
