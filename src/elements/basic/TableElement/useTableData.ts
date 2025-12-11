import { useMemo, useState, useEffect } from 'react';
import { fieldValues } from '../../../utils/init';
import { stringifyWithNull } from '../../../utils/primitives';
import { Action, Column } from './types';
import { parseSortableValue, compareSortableValues } from './utils';
import { generateExampleData } from './exampleData';

type UseTableDataProps = {
  element: {
    properties: {
      columns: Column[];
      actions: Action[];
      search: boolean;
      sort: boolean;
      pagination: number;
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
  const paginationSetting = element.properties?.pagination ?? 0;
  const rowsPerPage =
    typeof paginationSetting === 'number' && paginationSetting > 0
      ? Math.floor(paginationSetting)
      : 0;
  const enablePagination = rowsPerPage > 0;

  // Use example columns if in edit mode and no columns provided
  // Also ensure all columns have field_key in edit mode
  const columns = useMemo(() => {
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
  const activeFieldValues = useMemo(() => {
    if (editMode) {
      return generateExampleData(columns);
    }
    return fieldValues;
  }, [editMode, columns, userColumns.length]);

  const [searchQuery, setSearchQuery] = useState('');

  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const [currentPage, setCurrentPage] = useState(0);

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
