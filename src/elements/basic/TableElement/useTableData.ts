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
  numRows: number
): {
  transposedColumns: Column[];
  transposedFieldValues: Record<string, any>;
} {
  // Create new columns: one for field names, then one for each original row
  const transposedColumns: Column[] = [
    {
      name: 'Field',
      field_id: '_transpose_field_name',
      field_type: 'text',
      field_key: '_transpose_field_name'
    }
  ];

  // Add a column for each original row
  for (let rowIdx = 0; rowIdx < numRows; rowIdx++) {
    transposedColumns.push({
      name: `Row ${rowIdx}`,
      field_id: `_transpose_row_${rowIdx}`,
      field_type: 'text',
      field_key: `_transpose_row_${rowIdx}`
    });
  }

  // Create transposed field values
  const transposedFieldValues: Record<string, any> = {
    _transpose_field_name: columns.map((col) => col.name)
  };

  // For each original row, create an array of values from all columns
  for (let rowIdx = 0; rowIdx < numRows; rowIdx++) {
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
    transposedFieldValues
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
  currentPage: number;
  setCurrentPage: (page: number) => void;

  // Properties
  columns: Column[];
  actions: Action[];
  enableSort: boolean;
  enableSearch: boolean;
  enablePagination: boolean;

  // Computed data
  paginatedRowIndices: number[];
  totalRows: number;
  totalPages: number;
  rowsPerPage: number;
  hasData: boolean;
  hasSearchResults: boolean;
  activeFieldValues: Record<string, any>;

  // Handlers
  handleSort: (columnName: string) => void;
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
  const enableTranspose = element.properties?.transpose ?? true;
  const paginationSetting = element.properties?.pagination ?? 0;
  const rowsPerPage =
    typeof paginationSetting === 'number' && paginationSetting > 0
      ? Math.floor(paginationSetting)
      : 0;
  const enablePagination = rowsPerPage > 0;

  // Use example columns if in edit mode and no columns provided
  // Also ensure all columns have field_key in edit mode
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

  // Calculate number of rows from base data (before transpose)
  const baseNumRows = useMemo(() => {
    return baseColumns.reduce((maxRows, column) => {
      const fieldValue = baseFieldValues[column.field_key];
      if (Array.isArray(fieldValue)) {
        return Math.max(maxRows, fieldValue.length);
      }
      return maxRows;
    }, 0);
  }, [baseColumns, baseFieldValues]);

  // Apply transposition if enabled
  const { columns, activeFieldValues } = useMemo(() => {
    if (!enableTranspose || baseNumRows === 0) {
      return {
        columns: baseColumns,
        activeFieldValues: baseFieldValues
      };
    }

    const { transposedColumns, transposedFieldValues } = transposeTableData(
      baseColumns,
      baseFieldValues,
      baseNumRows
    );

    return {
      columns: transposedColumns,
      activeFieldValues: transposedFieldValues
    };
  }, [enableTranspose, baseColumns, baseFieldValues, baseNumRows]);

  // Calculate number of rows from (possibly transposed) data
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
  }, [allRowIndices, columns, searchQuery, enableSearch, activeFieldValues]);

  const sortedRowIndices = useMemo(() => {
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
    filteredRowIndices,
    sortColumn,
    sortDirection,
    columns,
    enableSort,
    activeFieldValues
  ]);

  const paginatedRowIndices = useMemo(() => {
    if (!enablePagination) return sortedRowIndices;

    const startIdx = currentPage * rowsPerPage;
    const endIdx = startIdx + rowsPerPage;
    return sortedRowIndices.slice(startIdx, endIdx);
  }, [sortedRowIndices, currentPage, rowsPerPage, enablePagination]);

  // Reset to first page when search or sort changes
  useEffect(() => {
    setCurrentPage(0);
  }, [searchQuery, sortColumn, sortDirection]);

  const totalPages = enablePagination
    ? Math.ceil(sortedRowIndices.length / rowsPerPage)
    : 1;

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

  const hasData = numRows > 0;
  const hasSearchResults = filteredRowIndices.length > 0;

  return {
    enableSearch,
    searchQuery,
    hasSearchResults,
    setSearchQuery,

    enableSort,
    sortColumn,
    sortDirection,
    handleSort,

    enablePagination,
    currentPage,
    paginatedRowIndices,
    rowsPerPage,
    setCurrentPage,

    columns,
    actions,

    totalRows: sortedRowIndices.length,
    totalPages,
    hasData,
    activeFieldValues
  };
}
