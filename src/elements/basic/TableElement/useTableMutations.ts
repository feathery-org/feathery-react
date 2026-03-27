import { useCallback, useRef } from 'react';
import { fieldValues } from '../../../utils/init';
import { Column } from './types';

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
  handleDeleteRow: (rowIndex: number) => void;
  handleCellEdit: (fieldKey: string, rowIndex: number, newValue: any) => void;
  handleCellClear: (fieldKey: string, rowIndex: number) => void;
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

  const handleAddRow = useCallback(() => {
    const updates: Record<string, any> = {};
    columns.forEach((col) => {
      const existing = getFieldArray(col.field_key);
      updates[col.field_key] = ['', ...existing];
    });
    // Clear search so the new row is visible
    if (searchQuery) setSearchQuery('');
    updateFieldValues(updates);
    if (!editMode) submitCustom(updates);
    onMutate();
    // Navigate to first page where the new row appears
    if (enablePagination) setCurrentPage(0);
  }, [
    columns,
    getFieldArray,
    updateFieldValues,
    submitCustom,
    editMode,
    onMutate,
    enablePagination,
    setCurrentPage,
    setSearchQuery,
    searchQuery
  ]);

  const handleDeleteRow = useCallback(
    (rowIndex: number) => {
      const updates: Record<string, any> = {};
      columns.forEach((col) => {
        const existing = getFieldArray(col.field_key);
        updates[col.field_key] = existing.filter((_, i) => i !== rowIndex);
      });
      updateFieldValues(updates);
      if (!editMode) submitCustom(updates);
      onMutate();
    },
    [
      columns,
      getFieldArray,
      updateFieldValues,
      submitCustom,
      editMode,
      onMutate
    ]
  );

  const handleCellEdit = useCallback(
    (fieldKey: string, rowIndex: number, newValue: any) => {
      const existing = getFieldArray(fieldKey);
      const updated = [...existing];
      updated[rowIndex] = newValue;
      const values = { [fieldKey]: updated };
      updateFieldValues(values);
      if (!editMode) submitCustom(values);
      onMutate();
    },
    [getFieldArray, updateFieldValues, submitCustom, editMode, onMutate]
  );

  const handleCellClear = useCallback(
    (fieldKey: string, rowIndex: number) => {
      handleCellEdit(fieldKey, rowIndex, '');
    },
    [handleCellEdit]
  );

  return { handleAddRow, handleDeleteRow, handleCellEdit, handleCellClear };
}
