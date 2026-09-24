import { useCallback, useMemo, useState } from 'react';
import type { Column } from '../types';
import {
  candidateValues,
  CellTextOf,
  ColumnFilter,
  ColumnFilters,
  EMPTY_FILTER,
  filterRows,
  isFilterActive
} from './columnFilters';

/**
 * The grid's column filters, handed to the header menu and the filter popover.
 * Filters are session-local, like column widths: nothing is written to the
 * element or the data source.
 */
export type SpreadsheetFilters = {
  /** Whether any column is filtered. */
  active: boolean;
  get: (fieldKey: string) => ColumnFilter;
  isFiltered: (fieldKey: string) => boolean;
  set: (fieldKey: string, filter: ColumnFilter) => void;
  clear: (fieldKey: string) => void;
  clearAll: () => void;
  /** The values a column's popover lists (see `candidateValues`). */
  candidates: (fieldKey: string) => string[];
};

type UseColumnFiltersOptions<R> = {
  rows: R[];
  columns: Column[];
  textOf: CellTextOf<R>;
};

export function useColumnFilters<R>({
  rows,
  columns,
  textOf
}: UseColumnFiltersOptions<R>) {
  const [stored, setStored] = useState<ColumnFilters>({});

  // A filter on a column that is no longer rendered (a Hub schema reloaded,
  // say) would match every row against '' and hide the whole sheet.
  const filters = useMemo<ColumnFilters>(() => {
    const present = new Set(columns.map((column) => column.field_key));
    return Object.fromEntries(
      Object.entries(stored).filter(([fieldKey]) => present.has(fieldKey))
    );
  }, [stored, columns]);

  const visibleRows = useMemo(
    () => filterRows(rows, filters, textOf),
    [rows, filters, textOf]
  );

  const set = useCallback((fieldKey: string, filter: ColumnFilter) => {
    setStored((prev) => {
      if (!isFilterActive(filter)) {
        return Object.fromEntries(
          Object.entries(prev).filter(([key]) => key !== fieldKey)
        );
      }
      return { ...prev, [fieldKey]: filter };
    });
  }, []);

  const api = useMemo<SpreadsheetFilters>(
    () => ({
      active: Object.values(filters).some(isFilterActive),
      get: (fieldKey) => filters[fieldKey] ?? EMPTY_FILTER,
      isFiltered: (fieldKey) => isFilterActive(filters[fieldKey]),
      set,
      clear: (fieldKey) => set(fieldKey, EMPTY_FILTER),
      clearAll: () => setStored({}),
      candidates: (fieldKey) => candidateValues(rows, fieldKey, filters, textOf)
    }),
    [filters, rows, textOf, set]
  );

  return { filters: api, visibleRows };
}
