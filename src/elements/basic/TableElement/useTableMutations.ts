import { useCallback, useRef } from 'react';
import { fieldValues } from '../../../utils/init';
import { CellWrite, Column } from './types';

type UseTableMutationsProps = {
  columns: Column[];
  updateFieldValues: (values: Record<string, any>) => void;
  submitCustom: (values: Record<string, any>) => void;
  editMode: boolean;
  editModeFieldValues: Record<string, any>;
  enablePagination: boolean;
  setCurrentPage: (page: number) => void;
  setSearchQuery: (query: string) => void;
  searchQuery: string;
  onMutate: () => void;
};

type UseTableMutationsReturn = {
  handleAddRow: () => void;
  handleInsertRow: (atIndex: number) => void;
  handleDeleteRow: (rowIndex: number) => void;
  handleRemoveRowLocal: (rowIndex: number) => void;
  handleCellEdit: (fieldKey: string, rowIndex: number, newValue: any) => void;
  handleCellsEdit: (writes: CellWrite[]) => void;
};

export function useTableMutations({
  columns,
  updateFieldValues,
  submitCustom,
  editMode,
  editModeFieldValues,
  enablePagination,
  setCurrentPage,
  setSearchQuery,
  searchQuery,
  onMutate
}: UseTableMutationsProps): UseTableMutationsReturn {
  const editModeFieldValuesRef = useRef(editModeFieldValues);
  editModeFieldValuesRef.current = editModeFieldValues;

  const getFieldArray = useCallback(
    (fieldKey: string): any[] => {
      const source = editMode ? editModeFieldValuesRef.current : fieldValues;
      const val = source[fieldKey];
      return Array.isArray(val) ? val : [];
    },
    [editMode]
  );

  const handleInsertRow = useCallback(
    (atIndex: number) => {
      const updates: Record<string, any> = {};
      columns.forEach((col) => {
        const existing = getFieldArray(col.field_key);
        const at = Math.max(0, Math.min(atIndex, existing.length));
        updates[col.field_key] = [
          ...existing.slice(0, at),
          '',
          ...existing.slice(at)
        ];
      });
      // No submitCustom — a new row stays provisional until the user edits a
      // cell, so an empty row is never pushed to the backend.
      updateFieldValues(updates);
      onMutate();
    },
    [columns, getFieldArray, updateFieldValues, onMutate]
  );

  const handleAddRow = useCallback(() => {
    const updates: Record<string, any> = {};
    columns.forEach((col) => {
      const existing = getFieldArray(col.field_key);
      updates[col.field_key] = ['', ...existing];
    });
    // Clear search so the new row is visible
    if (searchQuery) setSearchQuery('');
    // No submitCustom — new rows are provisional until the user edits a cell,
    // avoiding empty-row noise in the backend
    updateFieldValues(updates);
    onMutate();
    // Navigate to first page where the new row appears
    if (enablePagination) setCurrentPage(0);
  }, [
    columns,
    getFieldArray,
    updateFieldValues,
    onMutate,
    enablePagination,
    setCurrentPage,
    setSearchQuery,
    searchQuery
  ]);

  const buildRowRemovalUpdates = useCallback(
    (rowIndex: number) => {
      const updates: Record<string, any> = {};
      columns.forEach((col) => {
        const existing = getFieldArray(col.field_key);
        updates[col.field_key] = existing.filter((_, i) => i !== rowIndex);
      });
      return updates;
    },
    [columns, getFieldArray]
  );

  const handleDeleteRow = useCallback(
    (rowIndex: number) => {
      const updates = buildRowRemovalUpdates(rowIndex);
      updateFieldValues(updates);
      if (!editMode) submitCustom(updates);
      onMutate();
    },
    [
      buildRowRemovalUpdates,
      updateFieldValues,
      submitCustom,
      editMode,
      onMutate
    ]
  );

  const handleRemoveRowLocal = useCallback(
    (rowIndex: number) => {
      const updates = buildRowRemovalUpdates(rowIndex);
      updateFieldValues(updates);
      onMutate();
    },
    [buildRowRemovalUpdates, updateFieldValues, onMutate]
  );

  /**
   * Commit any number of cells as ONE update. Spreadsheet mode edits whole
   * rectangles at a time (paste, drag-fill, clear, undo), and submitting those
   * cell by cell would fire a request per cell and let a later write clobber
   * an earlier one, since each rebuilds its column array from `fieldValues`.
   */
  const handleCellsEdit = useCallback(
    (writes: CellWrite[]) => {
      if (!writes.length) return;

      const updates: Record<string, any[]> = {};
      writes.forEach(({ fieldKey, rowIndex, value }) => {
        // Each column's array is copied once and then written in place, so
        // several cells in the same column land in the same submitted array.
        if (!updates[fieldKey])
          updates[fieldKey] = [...getFieldArray(fieldKey)];
        updates[fieldKey][rowIndex] = value;
      });

      updateFieldValues(updates);
      if (!editMode) submitCustom(updates);
      onMutate();
    },
    [getFieldArray, updateFieldValues, submitCustom, editMode, onMutate]
  );

  const handleCellEdit = useCallback(
    (fieldKey: string, rowIndex: number, newValue: any) => {
      handleCellsEdit([{ fieldKey, rowIndex, value: newValue }]);
    },
    [handleCellsEdit]
  );

  return {
    handleAddRow,
    handleInsertRow,
    handleDeleteRow,
    handleRemoveRowLocal,
    handleCellEdit,
    handleCellsEdit
  };
}
