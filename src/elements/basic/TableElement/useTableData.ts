import { useMemo, useState, useEffect } from 'react';
import { fieldValues } from '../../../utils/init';
import { stringifyWithNull } from '../../../utils/primitives';
import { Action, Column } from './types';
import { parseSortableValue, compareSortableValues } from './utils';
import { EXAMPLE_COLUMNS, generateExampleData } from './exampleData';

type UseTableDataProps = {
  element: {
    properties: {
      columns: Column[];
      actions: Action[];
      search: boolean;
      sort: boolean;
      pagination: boolean;
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
  const enablePagination = element.properties?.pagination ?? false;
  const rowsPerPage = 10;

  // Use example columns if in edit mode and no columns provided
  // Also ensure all columns have field_key in edit mode
  const columns = useMemo(() => {
    let cols = userColumns;

    if (editMode && userColumns.length === 0) {
      cols = EXAMPLE_COLUMNS;
    }

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
  const activeFieldValues = useMemo(() => {
    if (editMode) {
      const numExampleRows = 3;
      if (userColumns.length === 0) {
        return generateExampleData(EXAMPLE_COLUMNS, numExampleRows);
      } else {
        return generateExampleData(columns, numExampleRows);
      }
    }
    return fieldValues;
  }, [editMode, columns, userColumns.length]);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Sort state
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(0);

  // Calculate total number of rows
  const numRows = useMemo(() => {
    return columns.reduce((maxRows, column) => {
      const fieldValue = activeFieldValues[column.field_key];
      if (Array.isArray(fieldValue)) {
        return Math.max(maxRows, fieldValue.length);
      }
      return maxRows;
    }, 0);
  }, [columns, activeFieldValues]);

  // Generate all row indices
  const allRowIndices = useMemo(
    () => Array.from({ length: numRows }, (_, i) => i),
    [numRows]
  );

  // Filter rows based on search query
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

  // Sort filtered rows
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

  // Paginate sorted rows
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

  // Calculate total pages
  const totalPages = enablePagination
    ? Math.ceil(sortedRowIndices.length / rowsPerPage)
    : 1;

  // Handle sort column click
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
    // State
    searchQuery,
    setSearchQuery,
    sortColumn,
    sortDirection,
    currentPage,
    setCurrentPage,

    // Properties
    columns,
    actions,
    enableSearch,
    enableSort,
    enablePagination,

    // Computed data
    paginatedRowIndices,
    totalRows: sortedRowIndices.length,
    totalPages,
    rowsPerPage,
    hasData,
    hasSearchResults,
    activeFieldValues,

    // Handlers
    handleSort
  };
}
