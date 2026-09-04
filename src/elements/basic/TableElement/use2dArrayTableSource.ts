import { useCallback, useEffect, useMemo, useRef } from 'react';
import { fieldValues } from '../../../utils/init';
import { Column } from './types';
import {
  arrayColumnCount,
  deriveArrayColumns,
  deriveArrayFieldValues,
  isRaggedRows,
  normalizeRows,
  ParsedArrayValue,
  parseArrayTableValue
} from './arrayTableSource';

type Use2dArrayTableSourceProps = {
  element: {
    id: string;
    properties: {
      array_field_key?: string;
    };
  };
  updateFieldValues: (values: Record<string, any>) => void;
  submitCustom: (values: Record<string, any>) => void;
  onMutate: () => void;
  dataVersion: number;
  enabled: boolean;
};

type Use2dArrayTableSourceReturn = {
  arrayColumns: Column[];
  arrayFieldValues: Record<string, any[]>;
  errors: string[];
  canAddRow: boolean;
  handleCellEdit: (fieldKey: string, rowIndex: number, newValue: any) => void;
  handleAddRow: () => void;
  handleDeleteRow: (rowIndex: number) => void;
};

const NO_COLUMNS: Column[] = [];
const NO_VALUES: Record<string, any[]> = {};
const NO_ERRORS: string[] = [];
const NO_ROWS: ParsedArrayValue = { rows: [], wasString: false };

export function use2dArrayTableSource({
  element,
  updateFieldValues,
  submitCustom,
  onMutate,
  dataVersion,
  enabled
}: Use2dArrayTableSourceProps): Use2dArrayTableSourceReturn {
  const tableId = element.id;
  const fieldKey = element.properties?.array_field_key ?? '';
  const active = enabled && !!fieldKey;

  // fieldValues is mutated outside React state, so dataVersion is the manual
  // dirty flag that re-reads it after a write (same contract as useTableData).
  const raw = active ? fieldValues[fieldKey] : undefined;
  // A logic rule can mutate the array in place (`value.forEach(r => r.push())`),
  // which leaves the reference untouched. The form-field source picks that up
  // because it only shallow-copies fieldValues and so shares the row arrays;
  // this source derives new arrays, so it needs the content to be the dep.
  const rawSignature = active ? JSON.stringify(raw ?? null) : '';
  const parsed = useMemo(
    () => (active ? parseArrayTableValue(raw, fieldKey) : NO_ROWS),
    [active, raw, rawSignature, fieldKey, dataVersion]
  );

  const rowsRef = useRef(parsed.rows);
  rowsRef.current = parsed.rows;
  const wasStringRef = useRef(parsed.wasString);
  wasStringRef.current = parsed.wasString;

  const { arrayColumns, arrayFieldValues, keyToIndex } = useMemo(() => {
    if (!active) {
      return {
        arrayColumns: NO_COLUMNS,
        arrayFieldValues: NO_VALUES,
        keyToIndex: {} as Record<string, number>
      };
    }
    const columns = deriveArrayColumns(tableId, parsed.rows);
    const indexByKey: Record<string, number> = {};
    columns.forEach((column, index) => {
      indexByKey[column.field_key] = index;
    });
    return {
      arrayColumns: columns,
      arrayFieldValues: deriveArrayFieldValues(columns, parsed.rows),
      keyToIndex: indexByKey
    };
  }, [active, tableId, parsed]);

  const errors = useMemo(
    () => (parsed.error ? [parsed.error] : NO_ERRORS),
    [parsed.error]
  );

  // Writes replace the whole field value, so untouched cells keep their
  // original types and only the edited cell becomes a string.
  const commit = useCallback(
    (rows: any[][], persist: boolean) => {
      const values = {
        [fieldKey]: wasStringRef.current ? JSON.stringify(rows) : rows
      };
      updateFieldValues(values);
      if (persist) submitCustom(values);
      onMutate();
    },
    [fieldKey, updateFieldValues, submitCustom, onMutate]
  );

  const commitRef = useRef(commit);
  commitRef.current = commit;

  // A ragged array is padded for display, so persist that same shape. The
  // write is queued behind the SDK's interaction gate, so a page view alone
  // never writes -- it lands with the visitor's first interaction.
  const needsNormalizing = active && !parsed.error && isRaggedRows(parsed.rows);
  useEffect(() => {
    if (!needsNormalizing) return;
    commitRef.current(normalizeRows(rowsRef.current), true);
  }, [needsNormalizing]);

  const handleCellEdit = useCallback(
    (key: string, rowIndex: number, newValue: any) => {
      const columnIndex = keyToIndex[key];
      if (columnIndex === undefined) return;
      const rows = rowsRef.current.map((row) => [...row]);
      // Row 0 holds the headers, so data row N lives at N + 1.
      const target = rows[rowIndex + 1];
      if (!target) return;
      while (target.length <= columnIndex) target.push('');
      target[columnIndex] = newValue;
      commit(rows, true);
    },
    [keyToIndex, commit]
  );

  const handleAddRow = useCallback(() => {
    const rows = rowsRef.current.map((row) => [...row]);
    if (!rows.length) return;
    // New rows go to the top, matching the other two sources.
    rows.splice(1, 0, Array(arrayColumnCount(rows)).fill(''));
    // No submitCustom: a new row stays provisional until its first edit.
    commit(rows, false);
  }, [commit]);

  const handleDeleteRow = useCallback(
    (rowIndex: number) => {
      const rows = rowsRef.current.map((row) => [...row]);
      if (rowIndex + 1 >= rows.length) return;
      rows.splice(rowIndex + 1, 1);
      commit(rows, true);
    },
    [commit]
  );

  return {
    arrayColumns,
    arrayFieldValues,
    errors,
    // Without a header row nothing defines the columns, so there is no shape
    // to add a row to.
    canAddRow: active && !parsed.error && parsed.rows.length > 0,
    handleCellEdit,
    handleAddRow,
    handleDeleteRow
  };
}
