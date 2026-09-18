import React from 'react';
import {
  DEFAULT_SPREADSHEET_GEOMETRY,
  readSpreadsheetGeometry
} from './geometry';

export const SpreadsheetGeometryContext = React.createContext(
  DEFAULT_SPREADSHEET_GEOMETRY
);

/** Keep the virtual canvas in sync with builder edits and responsive styles. */
export function useSpreadsheetGeometry(
  ref: React.RefObject<HTMLDivElement | null>
) {
  const [geometry, setGeometry] = React.useState(DEFAULT_SPREADSHEET_GEOMETRY);
  const read = React.useCallback(() => {
    const element = ref.current;
    const win = element?.ownerDocument.defaultView;
    if (!element || !win) return;
    const next = readSpreadsheetGeometry(win.getComputedStyle(element));
    setGeometry((previous) =>
      JSON.stringify(previous) === JSON.stringify(next) ? previous : next
    );
  }, [ref]);

  // Emotion can update a stylesheet during any parent render without changing
  // a DOM attribute, so also read once after each committed render.
  React.useLayoutEffect(read);
  React.useLayoutEffect(() => {
    const element = ref.current;
    const win = element?.ownerDocument.defaultView;
    if (!element || !win) return;
    const observer = new MutationObserver(read);
    for (
      let ancestor: HTMLElement | null = element;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      observer.observe(ancestor, {
        attributes: true,
        attributeFilter: ['class', 'style']
      });
    }
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    resizeObserver?.observe(element);
    win.addEventListener('resize', read);
    return () => {
      observer.disconnect();
      resizeObserver?.disconnect();
      win.removeEventListener('resize', read);
    };
  }, [read, ref]);
  return geometry;
}
