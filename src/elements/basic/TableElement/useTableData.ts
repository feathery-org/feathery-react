import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fieldValues } from '../../../utils/init';
import { stringifyWithNull } from '../../../utils/primitives';
import { Action, Column } from './types';
import { compareSortableValues, parseSortableValue } from './utils';
import { generateExampleData } from './exampleData';
import { CellRules } from './spreadsheet/validation';
import { formatCellDisplay } from './spreadsheet/fieldEditors';

/**
 * Transpose table data: columns become rows, rows become columns
 * Returns new columns and transposed field values
 */
function transposeTableData(
  columns: Column[],
  activeFieldValues: Record<string, any>,
  numRows: number,
  rowIndicesToInclude?: number[]
): {
  transposedColumns: Column[];
  transposedFieldValues: Record<string, any>;
  includedRowIndices: number[];
} {
  const includedRowIndices =
    rowIndicesToInclude || Array.from({ length: numRows }, (_, i) => i);

  const transposedColumns: Column[] = [
    {
      name: '',
      field_id: '_transpose_field_name',
      field_type: 'text',
      field_key: '_transpose_field_name'
    }
  ];

  // Add a column for each original row
  for (const rowIdx of includedRowIndices) {
    transposedColumns.push({
      name: '',
      field_id: `_transpose_row_${rowIdx}`,
      field_type: 'text',
      field_key: `_transpose_row_${rowIdx}`,
      originalRowIndex: rowIdx
    } as Column & { originalRowIndex: number });
  }

  const transposedFieldValues: Record<string, any> = {
    _transpose_field_name: columns.map((col) => col.name)
  };

  for (const rowIdx of includedRowIndices) {
    const transposedRowValues: any[] = [];

    for (const column of columns) {
      const fieldValue = activeFieldValues[column.field_key];
      const cellValue = Array.isArray(fieldValue)
        ? fieldValue[rowIdx]
        : fieldValue;
      transposedRowValues.push(cellValue);
    }

    transposedFieldValues[`_transpose_row_${rowIdx}`] = transposedRowValues;
  }

  return {
    transposedColumns,
    transposedFieldValues,
    includedRowIndices
  };
}

const TABLE_PAGE_CACHE_KEY_PREFIX = '__feathery_table_page_';

function getTablePageCacheKey(elementId: string): string {
  return `${TABLE_PAGE_CACHE_KEY_PREFIX}${elementId}`;
}

function getCachedPage(elementId: string): number {
  const key = getTablePageCacheKey(elementId);
  const cached = sessionStorage.getItem(key);
  if (!cached) return 0;
  const page = parseInt(cached, 10);
  return Number.isInteger(page) && page >= 0 ? page : 0;
}

function setCachedPage(elementId: string, page: number): void {
  const key = getTablePageCacheKey(elementId);
  sessionStorage.setItem(key, page.toString());
}

type UseTableDataProps = {
  element: {
    id: string;
    properties: {
      columns: Column[];
      actions: Action[];
      search: boolean;
      sort: boolean;
      pagination: number;
      transpose?: boolean;
      enable_editing?: boolean;
      add_delete_rows?: boolean;
    };
  };
  editMode?: boolean;
  // How many sample rows the builder preview shows (edit mode only).
  exampleRows?: number;
  dataVersion?: number;
  // When set (Data Hub-backed table), rows come from this map instead of the
  // global form `fieldValues`.
  externalFieldValues?: Record<string, any>;
  // Column rules, so a search matches what a cell SHOWS (an option's label, a
  // readable date) as well as what it stores.
  cellRules?: CellRules;
};

type UseTableDataReturn = {
  // State
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  sortedColumnIndex: number | null;
  currentPage: number;
  setCurrentPage: (page: number) => void;

  // Properties
  columns: Column[];
  actions: Action[];
  enableSort: boolean;
  enableSearch: boolean;
  enablePagination: boolean;
  isTransposed: boolean;
  enableEditing: boolean;
  enableAddDeleteRows: boolean;

  // Computed data
  sortedRowIndices: number[];
  sortedBaseRowIndices: number[];
  paginatedRowIndices: number[];
  transposedRowIndices: number[];
  totalRows: number;
  totalPages: number;
  rowsPerPage: number;
  hasData: boolean;
  hasSearchResults: boolean;
  activeFieldValues: Record<string, any>;
  baseColumns: Column[];
  baseFieldValues: Record<string, any>;
  baseNumRows: number;

  // Handlers
  handleSort: (columnName: string) => void;
  /** Sets the sort outright; `null` clears it. */
  setSort: (columnName: string | null, direction?: 'asc' | 'desc') => void;
  handleTransposedSort: (rowIndex: number) => void;
};

/**
 * What a sort is keyed by. The storage key is unique per column where a display
 * name is not; a column without one falls back to its position.
 */
export const columnSortKey = (fieldKey: string, index: number): string =>
  fieldKey || `#${index}`;

export function useTableData({
  element,
  editMode = false,
  exampleRows,
  dataVersion = 0,
  externalFieldValues,
  cellRules
}: UseTableDataProps): UseTableDataReturn {
  const userColumns: Column[] = element.properties?.columns || [];
  const actions: Action[] = (element.properties?.actions || []).filter(
    (action) => action.label && action.label.trim() !== ''
  );
  const enableSearch = element.properties?.search ?? false;
  const enableSort = element.properties?.sort ?? false;
  const enableTranspose = element.properties?.transpose ?? false;
  const enableEditing = element.properties?.enable_editing ?? false;
  const enableAddDeleteRows = element.properties?.add_delete_rows ?? false;
  const paginationSetting = element.properties?.pagination ?? 0;
  const rowsPerPage =
    typeof paginationSetting === 'number' && paginationSetting > 0
      ? Math.floor(paginationSetting)
      : 0;
  const enablePagination = rowsPerPage > 0;

  const baseColumns = useMemo(() => {
    let cols = userColumns;

    // In edit mode, replace field_key with a unique example key
    if (editMode) {
      cols = cols.map((col, index) => ({
        ...col,
        field_key: `example_column_${index}`
      }));
    }

    return cols;
  }, [editMode, userColumns]);

  // fieldValues is mutated outside React state, so we need dataVersion
  // as a manual dirty flag to trigger re-snapshots
  const baseFieldValues = useMemo(() => {
    if (editMode) {
      return generateExampleData(baseColumns, exampleRows);
    }
    if (externalFieldValues) {
      return externalFieldValues;
    }
    return { ...fieldValues };
  }, [editMode, exampleRows, baseColumns, dataVersion, externalFieldValues]);

  const [searchQuery, setSearchQuery] = useState('');

  // Keyed by `columnSortKey`, not display name: two columns may share a name.
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const [currentPage, setCurrentPage] = useState(() =>
    getCachedPage(element.id)
  );

  const baseNumRows = useMemo(() => {
    return baseColumns.reduce((maxRows, column) => {
      const fieldValue = baseFieldValues[column.field_key];
      if (Array.isArray(fieldValue)) {
        return Math.max(maxRows, fieldValue.length);
      }
      return maxRows;
    }, 0);
  }, [baseColumns, baseFieldValues]);

  const allBaseRowIndices = useMemo(
    () => Array.from({ length: baseNumRows }, (_, i) => i),
    [baseNumRows]
  );

  const [sortedColumnIndex, setSortedColumnIndex] = useState<number | null>(
    null
  );

  const sortedBaseRowIndices = useMemo(() => {
    if (!enableTranspose || !enableSort || sortedColumnIndex === null) {
      return allBaseRowIndices;
    }

    const column = baseColumns[sortedColumnIndex];
    if (!column) return allBaseRowIndices;

    return [...allBaseRowIndices].sort((aIdx, bIdx) => {
      const fieldValue = baseFieldValues[column.field_key];
      const aValue = Array.isArray(fieldValue) ? fieldValue[aIdx] : fieldValue;
      const bValue = Array.isArray(fieldValue) ? fieldValue[bIdx] : fieldValue;

      const aParsed = parseSortableValue(aValue);
      const bParsed = parseSortableValue(bValue);

      const comparison = compareSortableValues(aParsed, bParsed);
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [
    enableTranspose,
    allBaseRowIndices,
    sortedColumnIndex,
    sortDirection,
    baseColumns,
    baseFieldValues,
    enableSort
  ]);

  // A search hits a cell by what it stores or by what it shows: "Jul" finds a
  // date shown as "Jul 19, 1982", "Open" a status stored as "o".
  const matchesSearch = useCallback(
    (cellValue: any, fieldKey: string) => {
      const needle = searchQuery.toLowerCase().trim();
      const stored = stringifyWithNull(cellValue) ?? '';
      if (stored.toLowerCase().includes(needle)) return true;
      const rule = cellRules?.[fieldKey];
      return (
        !!rule &&
        formatCellDisplay(cellValue, rule).toLowerCase().includes(needle)
      );
    },
    [searchQuery, cellRules]
  );

  const filteredBaseRowIndices = useMemo(() => {
    if (!enableTranspose || !enableSearch || !searchQuery.trim()) {
      return sortedBaseRowIndices;
    }

    return sortedBaseRowIndices.filter((baseRowIdx) => {
      return baseColumns.some((column) => {
        const fieldValue = baseFieldValues[column.field_key];
        const cellValue = Array.isArray(fieldValue)
          ? fieldValue[baseRowIdx]
          : fieldValue;
        return matchesSearch(cellValue, column.field_key);
      });
    });
  }, [
    enableTranspose,
    sortedBaseRowIndices,
    baseColumns,
    searchQuery,
    enableSearch,
    baseFieldValues
  ]);

  const paginatedBaseRowIndices = useMemo(() => {
    if (!enableTranspose || !enablePagination) {
      return filteredBaseRowIndices;
    }

    const startIdx = currentPage * rowsPerPage;
    const endIdx = startIdx + rowsPerPage;
    return filteredBaseRowIndices.slice(startIdx, endIdx);
  }, [
    enableTranspose,
    filteredBaseRowIndices,
    currentPage,
    rowsPerPage,
    enablePagination
  ]);

  const { columns, activeFieldValues, transposedRowIndices } = useMemo(() => {
    if (!enableTranspose || baseNumRows === 0) {
      return {
        columns: baseColumns,
        activeFieldValues: baseFieldValues,
        transposedRowIndices: []
      };
    }

    const { transposedColumns, transposedFieldValues, includedRowIndices } =
      transposeTableData(
        baseColumns,
        baseFieldValues,
        baseNumRows,
        paginatedBaseRowIndices
      );

    return {
      columns: transposedColumns,
      activeFieldValues: transposedFieldValues,
      transposedRowIndices: includedRowIndices
    };
  }, [
    enableTranspose,
    baseColumns,
    baseFieldValues,
    baseNumRows,
    paginatedBaseRowIndices
  ]);

  const numRows = useMemo(() => {
    return columns.reduce((maxRows, column) => {
      const fieldValue = activeFieldValues[column.field_key];
      if (Array.isArray(fieldValue)) {
        return Math.max(maxRows, fieldValue.length);
      }
      return maxRows;
    }, 0);
  }, [columns, activeFieldValues]);

  const allRowIndices = useMemo(
    () => Array.from({ length: numRows }, (_, i) => i),
    [numRows]
  );

  const sortedRowIndices = useMemo(() => {
    if (enableTranspose) return allRowIndices; // Already sorted during transpose

    if (!enableSort || !sortColumn) return allRowIndices;

    const column = columns.find(
      (col, index) => columnSortKey(col.field_key, index) === sortColumn
    );

    if (!column) return allRowIndices;

    return [...allRowIndices].sort((aIdx, bIdx) => {
      const fieldValue = activeFieldValues[column.field_key];
      const aValue = Array.isArray(fieldValue) ? fieldValue[aIdx] : fieldValue;
      const bValue = Array.isArray(fieldValue) ? fieldValue[bIdx] : fieldValue;

      const aParsed = parseSortableValue(aValue);
      const bParsed = parseSortableValue(bValue);

      const comparison = compareSortableValues(aParsed, bParsed);
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [
    enableTranspose,
    allRowIndices,
    sortColumn,
    sortDirection,
    columns,
    enableSort,
    activeFieldValues
  ]);

  const filteredRowIndices = useMemo(() => {
    if (enableTranspose) return sortedRowIndices; // Already filtered during transpose

    if (!enableSearch || !searchQuery.trim()) return sortedRowIndices;

    return sortedRowIndices.filter((rowIndex) => {
      return columns.some((column) => {
        const fieldValue = activeFieldValues[column.field_key];
        const cellValue = Array.isArray(fieldValue)
          ? fieldValue[rowIndex]
          : fieldValue;
        return matchesSearch(cellValue, column.field_key);
      });
    });
  }, [
    enableTranspose,
    sortedRowIndices,
    columns,
    searchQuery,
    enableSearch,
    activeFieldValues
  ]);

  const paginatedRowIndices = useMemo(() => {
    if (enableTranspose) return allRowIndices; // Already paginated during transpose

    if (!enablePagination) return filteredRowIndices;

    const startIdx = currentPage * rowsPerPage;
    const endIdx = startIdx + rowsPerPage;
    return filteredRowIndices.slice(startIdx, endIdx);
  }, [
    enableTranspose,
    allRowIndices,
    filteredRowIndices,
    currentPage,
    rowsPerPage,
    enablePagination
  ]);

  // Reset to first page when search or sort *change* (not on initial mount, so cached page is preserved)
  const searchParamRef = useRef({
    initialMount: true,
    search: '',
    sortColumn: '',
    sortDirection: ''
  });
  useEffect(() => {
    const cur = searchParamRef.current;
    if (cur.initialMount) {
      cur.initialMount = false;
      cur.search = searchQuery;
      cur.sortColumn = sortColumn as any;
      cur.sortDirection = sortDirection;
      return;
    }
    if (
      searchQuery !== cur.search ||
      sortColumn !== cur.sortColumn ||
      sortDirection !== cur.sortDirection
    ) {
      setCurrentPage(0);
      cur.search = searchQuery;
      cur.sortColumn = sortColumn as any;
      cur.sortDirection = sortDirection;
    }
  }, [searchQuery, sortColumn, sortDirection]);

  // For transposed tables, totalRows and totalPages are based on original rows (now columns)
  const totalRows = enableTranspose
    ? filteredBaseRowIndices.length
    : filteredRowIndices.length;
  const totalPages = enablePagination ? Math.ceil(totalRows / rowsPerPage) : 1;

  // Persist page to window cache when user navigates (keyed by element.id)
  useEffect(() => {
    if (element.id) setCachedPage(element.id, currentPage);
  }, [element.id, currentPage]);

  // Clamp cached page to valid range when totalPages is known
  useEffect(() => {
    if (totalPages > 0 && currentPage >= totalPages) {
      setCurrentPage(totalPages - 1);
    }
  }, [totalPages]);

  const setSort = (
    columnKey: string | null,
    direction: 'asc' | 'desc' = 'asc'
  ) => {
    if (!enableSort) return;
    setSortColumn(columnKey);
    setSortDirection(direction);
  };

  const handleSort = (columnKey: string) => {
    if (!enableSort) return;

    if (sortColumn === columnKey) {
      // Cycle through: asc → desc → none
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        setSortColumn(null);
        setSortDirection('asc');
      }
    } else {
      setSortColumn(columnKey);
      setSortDirection('asc');
    }
  };

  const handleTransposedSort = (rowIndex: number) => {
    if (!enableSort || !enableTranspose) return;

    if (sortedColumnIndex === rowIndex) {
      // Cycle through: asc → desc → none
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        setSortedColumnIndex(null);
        setSortDirection('asc');
      }
    } else {
      setSortedColumnIndex(rowIndex);
      setSortDirection('asc');
    }
  };

  const hasData = numRows > 0;
  const hasSearchResults = enableTranspose
    ? filteredBaseRowIndices.length > 0
    : filteredRowIndices.length > 0;
  const isTransposed = enableTranspose && baseNumRows > 0;

  return {
    enableSearch,
    searchQuery,
    hasSearchResults,
    setSearchQuery,

    enableSort,
    sortColumn,
    sortDirection,
    sortedColumnIndex,
    handleSort,
    setSort,
    handleTransposedSort,

    enablePagination,
    currentPage,
    sortedRowIndices,
    sortedBaseRowIndices,
    paginatedRowIndices,
    rowsPerPage,
    setCurrentPage,

    columns,
    actions,
    isTransposed,
    transposedRowIndices,
    enableEditing,
    enableAddDeleteRows,

    totalRows,
    totalPages,
    hasData,
    activeFieldValues,
    baseColumns,
    baseFieldValues,
    baseNumRows
  };
}
