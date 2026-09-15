import React from 'react';
import type { Column } from '../types';
import type { CellValue } from './model';
import type { SpreadsheetRow } from './table';
import { formatCellDisplay } from './fieldEditors';
import type { CellRules } from './validation';

export type SearchMatch = {
  rowId: string;
  rowIndex: number;
  columnId: string;
};

export type SearchMatchState = 'match' | 'current';

export const searchMatchKey = (rowIndex: number, fieldKey: string) =>
  `${rowIndex}:${fieldKey}`;

/**
 * Every cell whose displayed text contains `query`, case-insensitively, in
 * reading order (down the rows, left to right). Matching runs on the text the
 * user sees, so a masked tax id or a formatted date is found the way it reads.
 */
export function findMatches(
  rows: SpreadsheetRow[],
  columns: Column[],
  query: string,
  cellRules?: CellRules
): SearchMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches: SearchMatch[] = [];
  rows.forEach((row) => {
    columns.forEach((column) => {
      const text = formatCellDisplay(
        row.cells[column.field_key] as CellValue,
        cellRules?.[column.field_key]
      );
      if (text.toLowerCase().includes(needle)) {
        matches.push({
          rowId: row.id,
          rowIndex: row.rowIndex,
          columnId: column.field_key
        });
      }
    });
  });
  return matches;
}

type UseGridSearchOptions = {
  rows: SpreadsheetRow[];
  columns: Column[];
  cellRules?: CellRules;
  /** Moves the grid's focused cell (and scrolls to it) without taking DOM focus. */
  focusCell: (rowId: string, columnId: string) => void;
};

/**
 * Find-in-grid state: the query, the cells it matches, and which match is
 * current. Typing jumps to the first match; Enter steps through the rest.
 * The list is recomputed as rows change, so an edit that creates or removes a
 * match updates the count without moving the cursor.
 */
export function useGridSearch({
  rows,
  columns,
  cellRules,
  focusCell
}: UseGridSearchOptions) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [cursor, setCursor] = React.useState(0);
  // Bumped on every open request so an already-open bar refocuses its input.
  const [focusToken, setFocusToken] = React.useState(0);

  const matches = React.useMemo(
    () => (open ? findMatches(rows, columns, query, cellRules) : []),
    [open, rows, columns, query, cellRules]
  );
  const safeCursor = matches.length ? Math.min(cursor, matches.length - 1) : -1;

  const matchIndex = React.useMemo(
    () =>
      new Map(
        matches.map((match, index) => [
          searchMatchKey(match.rowIndex, match.columnId),
          index
        ])
      ),
    [matches]
  );

  const matchState = React.useCallback(
    (rowIndex: number, fieldKey: string): SearchMatchState | null => {
      const index = matchIndex.get(searchMatchKey(rowIndex, fieldKey));
      if (index === undefined) return null;
      return index === safeCursor ? 'current' : 'match';
    },
    [matchIndex, safeCursor]
  );

  const focusCellRef = React.useRef(focusCell);
  focusCellRef.current = focusCell;
  const matchesRef = React.useRef(matches);
  matchesRef.current = matches;
  const cursorRef = React.useRef(safeCursor);
  cursorRef.current = safeCursor;

  // A new query starts over at its first match, the way a browser's find does.
  React.useEffect(() => {
    if (!open) return;
    setCursor(0);
    const first = matchesRef.current[0];
    if (first) focusCellRef.current(first.rowId, first.columnId);
  }, [open, query]);

  const step = React.useCallback((delta: 1 | -1) => {
    const list = matchesRef.current;
    if (!list.length) return;
    const from = Math.max(cursorRef.current, 0);
    const next = (from + delta + list.length) % list.length;
    setCursor(next);
    focusCellRef.current(list[next].rowId, list[next].columnId);
  }, []);

  const openSearch = React.useCallback(() => {
    setOpen(true);
    setFocusToken((token) => token + 1);
  }, []);

  const close = React.useCallback(() => {
    setOpen(false);
    setQuery('');
    setCursor(0);
  }, []);

  return {
    open,
    query,
    setQuery,
    matches,
    cursor: safeCursor,
    focusToken,
    matchState,
    step,
    openSearch,
    close
  };
}

export type GridSearch = ReturnType<typeof useGridSearch>;
