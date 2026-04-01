import { useLayoutEffect, useRef, useState } from 'react';
import { featheryWindow } from '../../../utils/browser';

/**
 * Measures column widths from the browser's auto layout, then locks them
 * for use with table-layout: fixed. Re-measures when columnCount changes.
 */
export function useColumnWidths(
  tableRef: React.RefObject<HTMLTableElement | null>,
  columnCount: number
): number[] | null {
  const [widths, setWidths] = useState<number[] | null>(null);
  const prevColumnCount = useRef(columnCount);

  if (prevColumnCount.current !== columnCount) {
    prevColumnCount.current = columnCount;
    setWidths(null);
  }

  useLayoutEffect(() => {
    if (widths !== null) return;

    const win = featheryWindow();
    if (!win || typeof win.getComputedStyle !== 'function') return;

    const table = tableRef.current;
    if (!table) return;

    const headerRow =
      table.querySelector('thead tr') ?? table.querySelector('tbody tr');
    if (!headerRow) return;

    const measured: number[] = [];
    for (let i = 0; i < headerRow.children.length; i++) {
      measured.push(
        (headerRow.children[i] as HTMLElement).getBoundingClientRect().width
      );
    }

    if (measured.length > 0) setWidths(measured);
  }, [widths, columnCount]);

  return widths;
}
