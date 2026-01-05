import { useMemo, useState, useEffect } from 'react';
import { fieldValues } from '../../../utils/init';
import { stringifyWithNull } from '../../../utils/primitives';
import { Action, Column } from './types';
import { parseSortableValue, compareSortableValues } from './utils';
import { generateExampleData } from './exampleData';

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

type UseTableDataProps = {
  element: {
    properties: {
      columns: Column[];
      actions: Action[];
      search: boolean;
      sort: boolean;
      pagination: number;
      transpose?: boolean;
    };
  };
  editMode?: boolean;
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

  // Computed data
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

  // Handlers
  handleSort: (columnName: string) => void;
  handleTransposedSort: (rowIndex: number) => void;
};

export function useTableData({
  element,
  editMode = false
}: UseTableDataProps): UseTableDataReturn {
  const userColumns: Column[] = element.properties?.columns || [];
  const actions: Action[] = (element.properties?.actions || []).filter(
    (action) => action.label && action.label.trim() !== ''
  );
  const enableSearch = element.properties?.search ?? false;
  const enableSort = element.properties?.sort ?? false;
  const enableTranspose = element.properties?.transpose || true;
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

  // Use example data in edit mode
  const baseFieldValues = useMemo(() => {
    if (editMode) {
      return generateExampleData(baseColumns);
    }
    return fieldValues;
  }, [editMode, baseColumns, userColumns.length]);

  const [searchQuery, setSearchQuery] = useState('');

  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const [currentPage, setCurrentPage] = useState(0);

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

  const filteredBaseRowIndices = useMemo(() => {
    if (!enableTranspose || !enableSearch || !searchQuery.trim()) {
      return allBaseRowIndices;
    }

    return allBaseRowIndices.filter((baseRowIdx) => {
      return baseColumns.some((column) => {
        const fieldValue = baseFieldValues[column.field_key];
        const cellValue = Array.isArray(fieldValue)
          ? fieldValue[baseRowIdx]
          : fieldValue;
        const stringValue = stringifyWithNull(cellValue) ?? '';
        return stringValue
          .toLowerCase()
          .includes(searchQuery.toLowerCase().trim());
      });
    });
  }, [
    enableTranspose,
    allBaseRowIndices,
    baseColumns,
    searchQuery,
    enableSearch,
    baseFieldValues
  ]);

  const [sortedColumnIndex, setSortedColumnIndex] = useState<number | null>(
    null
  );

  const sortedBaseRowIndices = useMemo(() => {
    if (!enableTranspose || !enableSort || sortedColumnIndex === null) {
      return filteredBaseRowIndices;
    }

    const column = baseColumns[sortedColumnIndex];
    if (!column) return filteredBaseRowIndices;

    return [...filteredBaseRowIndices].sort((aIdx, bIdx) => {
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
    filteredBaseRowIndices,
    sortedColumnIndex,
    sortDirection,
    baseColumns,
    baseFieldValues,
    enableSort
  ]);

  const paginatedBaseRowIndices = useMemo(() => {
    if (!enableTranspose || !enablePagination) {
      return sortedBaseRowIndices;
    }

    const startIdx = currentPage * rowsPerPage;
    const endIdx = startIdx + rowsPerPage;
    return sortedBaseRowIndices.slice(startIdx, endIdx);
  }, [
    enableTranspose,
    sortedBaseRowIndices,
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

  const filteredRowIndices = useMemo(() => {
    if (enableTranspose) return allRowIndices; // Already filtered during transpose

    if (!enableSearch || !searchQuery.trim()) return allRowIndices;

    return allRowIndices.filter((rowIndex) => {
      return columns.some((column) => {
        const fieldValue = activeFieldValues[column.field_key];
        const cellValue = Array.isArray(fieldValue)
          ? fieldValue[rowIndex]
          : fieldValue;
        const stringValue = stringifyWithNull(cellValue) ?? '';
        return stringValue
          .toLowerCase()
          .includes(searchQuery.toLowerCase().trim());
      });
    });
  }, [
    enableTranspose,
    allRowIndices,
    columns,
    searchQuery,
    enableSearch,
    activeFieldValues
  ]);

  const sortedRowIndices = useMemo(() => {
    if (enableTranspose) return filteredRowIndices; // Already sorted during transpose

    if (!enableSort || !sortColumn) return filteredRowIndices;

    const column = columns.find((col) => col.name === sortColumn);

    if (!column) return filteredRowIndices;

    return [...filteredRowIndices].sort((aIdx, bIdx) => {
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
    filteredRowIndices,
    sortColumn,
    sortDirection,
    columns,
    enableSort,
    activeFieldValues
  ]);

  const paginatedRowIndices = useMemo(() => {
    if (enableTranspose) return allRowIndices; // Already paginated during transpose

    if (!enablePagination) return sortedRowIndices;

    const startIdx = currentPage * rowsPerPage;
    const endIdx = startIdx + rowsPerPage;
    return sortedRowIndices.slice(startIdx, endIdx);
  }, [
    enableTranspose,
    allRowIndices,
    sortedRowIndices,
    currentPage,
    rowsPerPage,
    enablePagination
  ]);

  // Reset to first page when search or sort changes
  useEffect(() => {
    setCurrentPage(0);
  }, [searchQuery, sortColumn, sortDirection]);

  // For transposed tables, totalRows and totalPages are based on original rows (now columns)
  const totalRows = enableTranspose
    ? sortedBaseRowIndices.length
    : sortedRowIndices.length;
  const totalPages = enablePagination ? Math.ceil(totalRows / rowsPerPage) : 1;

  const handleSort = (columnName: string) => {
    if (!enableSort) return;

    if (sortColumn === columnName) {
      // Cycle through: asc → desc → none
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        setSortColumn(null);
        setSortDirection('asc');
      }
    } else {
      setSortColumn(columnName);
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
    handleTransposedSort,

    enablePagination,
    currentPage,
    paginatedRowIndices,
    rowsPerPage,
    setCurrentPage,

    columns,
    actions,
    isTransposed,
    transposedRowIndices,

    totalRows,
    totalPages,
    hasData,
    activeFieldValues,
    baseColumns,
    baseFieldValues
  };
}
