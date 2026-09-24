import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fieldValues } from '../../../utils/init';
import { CellWrite, Column, ColumnDraft } from './types';
import {
  CellRules,
  CellValueType,
  EDITABLE_CELL_VALUE_TYPES,
  isEditableCellValueType,
  validateCellValue,
  validateGrid
} from './spreadsheet/validation';
import { parseCellInput } from './spreadsheet/fieldEditors';
import { CellValue } from './spreadsheet/model';

/**
 * A hidden field-backed table stores the whole grid in one hidden field, as an
 * object with its columns — one `{ name, field_type }` each, where
 * `field_type` is any cell type the grid can edit (every type the Data Hub and
 * field-backed sources use, less `file`), or text when it is left out — and its
 * values, an array of rows where each row is an array of cells. A column may also set `canEdit` or `canDelete` to allow or prevent
 * changing or removing it, overriding the table's own column settings,
 * `required` to flag its blank cells the way a required Data Hub field is, and
 * a `default`, the value a newly added row starts with in that column:
 *
 *   {
 *     columns: [
 *       { name: "Name", field_type: "text", required: true, canDelete: false },
 *       { name: "Age", field_type: "number", default: 18 }
 *     ],
 *     values: [["Alice", 30], ["Bob", 41]]
 *   }
 *
 * The rest of the table works column by column (one array of cell values per
 * field key), so this source exposes each grid column under a virtual field key
 * and folds cell writes back into `values` before storing the whole object.
 */

const COLUMN_KEY_PREFIX = '__hidden_field_column_';

export type HiddenFieldColumn = {
  name: string;
  field_type?: CellValueType;
  canEdit?: boolean;
  canDelete?: boolean;
  required?: boolean;
  default?: CellValue;
};

/** A column's own overrides of the table's column edit and delete settings. */
export type ColumnPermissions = { canEdit?: boolean; canDelete?: boolean };

const PERMISSION_FLAGS = ['canEdit', 'canDelete'] as const;

// Every flag a column may set, each true, false or left out.
const COLUMN_FLAGS = [...PERMISSION_FLAGS, 'required'] as const;

const isOptionalBoolean = (value: unknown) =>
  value === undefined || typeof value === 'boolean';

// A column that does not name a type holds text.
const DEFAULT_COLUMN_TYPE: CellValueType = 'text';

const hasNoType = (fieldType: unknown) =>
  fieldType === undefined || fieldType === null || fieldType === '';

const columnType = (column: HiddenFieldColumn): CellValueType =>
  hasNoType(column.field_type)
    ? DEFAULT_COLUMN_TYPE
    : (column.field_type as CellValueType);

export const INVALID_FORMAT_MESSAGE =
  'This table\'s hidden field must hold an object with "columns", a list of ' +
  '{ "name": ..., "field_type": ... }, and "values", a list of rows that are ' +
  'each a list of cell values, e.g. { "columns": [{ "name": "Name", ' +
  '"field_type": "text" }], "values": [["Alice"]] }.';

const columnKey = (index: number) => `${COLUMN_KEY_PREFIX}${index}`;

const columnIndexOf = (fieldKey: string): number => {
  if (!fieldKey.startsWith(COLUMN_KEY_PREFIX)) return -1;
  const index = Number(fieldKey.slice(COLUMN_KEY_PREFIX.length));
  return Number.isInteger(index) && index >= 0 ? index : -1;
};

const columnName = (column: HiddenFieldColumn, index: number) =>
  column.name.trim() || `Column ${index + 1}`;

const isCell = (cell: unknown) =>
  cell === null ||
  ['string', 'number', 'boolean', 'undefined'].includes(typeof cell);

const isObject = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const columnRule = (column: HiddenFieldColumn, index: number) => ({
  label: columnName(column, index),
  type: columnType(column),
  required: column.required === true
});

/** Why a column's `default` cannot start a new row, or null when it can. */
const defaultProblem = (column: HiddenFieldColumn, index: number) => {
  const value = column.default;
  if (value === undefined) return null;
  if (!isCell(value)) return 'Must be text, a number or true/false';
  // An empty default only means there is none, even in a required column.
  return validateCellValue(value, {
    ...columnRule(column, index),
    required: false
  });
};

const isColumn = (entry: any, index: number): entry is HiddenFieldColumn =>
  isObject(entry) &&
  typeof entry.name === 'string' &&
  (hasNoType(entry.field_type) || isEditableCellValueType(entry.field_type)) &&
  COLUMN_FLAGS.every((flag) => isOptionalBoolean(entry[flag])) &&
  !defaultProblem(entry as HiddenFieldColumn, index);

// What a new row holds in a column: its default, or a blank cell.
const newCell = (column: HiddenFieldColumn) =>
  column.default === undefined || column.default === null ? '' : column.default;

/**
 * A draft's `required`, stored only when set so an optional column keeps the
 * shape it had.
 */
const withRequired = (
  column: HiddenFieldColumn,
  required: boolean | undefined
): HiddenFieldColumn => {
  const { required: _, ...rest } = column;
  return required ? { ...rest, required: true } : rest;
};

/**
 * A draft's default, left out when it is empty so a column without one is
 * stored without the key.
 */
const withDefault = (
  column: HiddenFieldColumn,
  value: CellValue | undefined
): HiddenFieldColumn => {
  const { default: _, ...rest } = column;
  return value === undefined || value === null || value === ''
    ? rest
    : { ...rest, default: value };
};

export type ParsedHiddenField = {
  header: HiddenFieldColumn[];
  rows: any[][];
  /** Why the value is not a grid, or null when it is (or holds nothing). */
  error: string | null;
};

const invalid = (detail: string): ParsedHiddenField => ({
  header: [],
  rows: [],
  error: `${INVALID_FORMAT_MESSAGE} ${detail}`
});

const describeColumnProblem = (entry: any, index: number) => {
  const column = `Column ${index + 1}`;
  if (!isObject(entry)) {
    return `${column} is not a { name, field_type } object.`;
  }
  if (typeof entry.name !== 'string') {
    return `${column} needs a text "name".`;
  }
  const badFlag = COLUMN_FLAGS.find((flag) => !isOptionalBoolean(entry[flag]));
  if (badFlag) {
    return `${column} has ${badFlag} ${JSON.stringify(
      entry[badFlag]
    )}; use true or false.`;
  }
  if (
    isEditableCellValueType(entry.field_type) ||
    hasNoType(entry.field_type)
  ) {
    const problem = defaultProblem(entry as HiddenFieldColumn, index);
    if (problem) {
      return `${column} has default ${JSON.stringify(
        entry.default
      )}: ${problem}.`;
    }
  }
  return `${column} has field_type ${JSON.stringify(
    entry.field_type
  )}; use one of ${Object.keys(EDITABLE_CELL_VALUE_TYPES).join(', ')}.`;
};

/**
 * Reads a stored value as its columns (`header`) and rows. A JSON string is
 * accepted as well as an object, and a missing `values` is a table with no
 * rows yet. No value at all is an empty grid; anything else that does not have
 * the documented shape is reported rather than guessed at.
 */
export function parseHiddenFieldRows(value: unknown): ParsedHiddenField {
  if (value === undefined || value === null || value === '') {
    return { header: [], rows: [], error: null };
  }
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return invalid('The value is not valid JSON.');
    }
  }
  if (!isObject(parsed)) return invalid('The value is not an object.');

  const { columns: header, values: rows = [] } = parsed;
  if (!Array.isArray(header)) {
    return invalid('"columns" is not a list of columns.');
  }
  const badColumn = header.findIndex((entry, index) => !isColumn(entry, index));
  if (badColumn !== -1) {
    return invalid(describeColumnProblem(header[badColumn], badColumn));
  }
  if (!Array.isArray(rows)) return invalid('"values" is not a list of rows.');

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const label = `Row ${index + 1}`;
    if (!Array.isArray(row)) return invalid(`${label} is not an array.`);
    if (!row.every(isCell)) {
      return invalid(
        `${label} holds a value that is not text, a number or true/false.`
      );
    }
    if (row.length > header.length) {
      return invalid(
        `${label} has ${row.length} cells but there are only ${header.length} columns.`
      );
    }
  }

  return { header, rows, error: null };
}

/**
 * The value as JSON, or null when it has none (a cycle, a BigInt) and can only
 * be compared by identity.
 */
const snapshotValue = (value: unknown): string | null => {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
};

const readSnapshot = (snapshot: string | null, value: unknown) =>
  snapshot === null
    ? value
    : snapshot === ''
    ? undefined
    : JSON.parse(snapshot);

const buildColumns = (header: HiddenFieldColumn[]): Column[] =>
  header.map((entry, index) => ({
    name: columnName(entry, index),
    field_id: columnKey(index),
    field_type: columnType(entry),
    field_key: columnKey(index)
  }));

const NO_COLUMNS: HiddenFieldColumn[] = [];

type UseHiddenFieldTableSourceProps = {
  hiddenFieldKey?: string;
  enabled: boolean;
  editMode: boolean;
  /**
   * Whether cells already stored when the grid first loads are checked and
   * listed with the refused edits. The spreadsheet flags every cell against
   * its rule itself, so only the classic table needs the list.
   */
  reportLoadErrors?: boolean;
  updateFieldValues: (values: Record<string, any>) => void;
  submitCustom: (values: Record<string, any>) => void;
  onMutate: () => void;
};

export function useHiddenFieldTableSource({
  hiddenFieldKey,
  enabled,
  editMode,
  reportLoadErrors = true,
  updateFieldValues,
  submitCustom,
  onMutate
}: UseHiddenFieldTableSourceProps) {
  const rawValue =
    enabled && hiddenFieldKey && !editMode
      ? fieldValues[hiddenFieldKey]
      : undefined;
  // Keyed by content rather than identity: a logic rule can change the stored
  // object in place through the field's proxy (`field.value.values = [...]`)
  // and then rerender the form, leaving the same object with new rows. The
  // grid is parsed from that snapshot, so a later in-place change can't reach
  // into arrays the table already holds.
  const snapshot = snapshotValue(rawValue);
  const parsed = useMemo(
    () => parseHiddenFieldRows(readSnapshot(snapshot, rawValue)),
    // rawValue only matters when it could not be snapshotted
    [snapshot, snapshot === null ? rawValue : null]
  );
  const { rows, error: formatError } = parsed;
  // The builder has no submitted value to read, so it has no columns either;
  // useTableData supplies the preview's sample columns.
  const header = editMode ? NO_COLUMNS : parsed.header;

  const hiddenFieldColumns = useMemo(
    () => (enabled ? buildColumns(header) : []),
    [enabled, header]
  );

  // Each column's type is its validation rule, so the spreadsheet picks the
  // matching editor, flags bad cells and holds back a save that has any.
  const cellRules = useMemo<CellRules>(() => {
    const rules: CellRules = {};
    header.forEach((entry, index) => {
      rules[columnKey(index)] = columnRule(entry, index);
    });
    return rules;
  }, [header]);

  // Only the flags a column sets; the rest fall back to the table's settings.
  const columnPermissions = useMemo(() => {
    const permissions: Record<string, ColumnPermissions> = {};
    header.forEach((entry, index) => {
      const own: ColumnPermissions = {};
      PERMISSION_FLAGS.forEach((flag) => {
        if (typeof entry[flag] === 'boolean') own[flag] = entry[flag];
      });
      permissions[columnKey(index)] = own;
    });
    return permissions;
  }, [header]);

  const hiddenFieldValues = useMemo(() => {
    const values: Record<string, any[]> = {};
    header.forEach((_, index) => {
      values[columnKey(index)] = rows.map((row) => row[index] ?? '');
    });
    return values;
  }, [rows, header]);

  // Edits refused because they do not match their column's type. The classic
  // table has no per-cell error display, so they are listed on the table.
  const [editErrors, setEditErrors] = useState<string[]>([]);

  // The first readable grid is checked once, so values that were stored
  // before the table loaded (a prefill, a logic rule, an earlier session) are
  // flagged without waiting for an edit. Later writes are checked as they are
  // made, so only a new hidden field loads — and is checked — again.
  const loadValidatedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || editMode || !hiddenFieldKey || formatError) return;
    if (!header.length || loadValidatedKey.current === hiddenFieldKey) return;
    loadValidatedKey.current = hiddenFieldKey;
    if (!reportLoadErrors) return;
    const errors = validateGrid({
      rowIndices: rows.map((_, index) => index),
      fieldKeys: header.map((_, index) => columnKey(index)),
      getValue: (rowIndex, fieldKey) =>
        rows[rowIndex][columnIndexOf(fieldKey)] ?? null,
      rules: cellRules
    });
    setEditErrors(
      Object.entries(errors).map(([key, message]) => {
        const separator = key.indexOf(':');
        const rowIndex = Number(key.slice(0, separator));
        const label = cellRules[key.slice(separator + 1)]?.label;
        return `${label}, row ${rowIndex + 1}: ${message}`;
      })
    );
  }, [
    enabled,
    editMode,
    hiddenFieldKey,
    formatError,
    header,
    rows,
    cellRules,
    reportLoadErrors
  ]);

  // Mutations read the stored value afresh rather than the render's snapshot,
  // so two writes in quick succession don't each start from the same grid.
  const currentGrid = useCallback(() => {
    const current = hiddenFieldKey
      ? parseHiddenFieldRows(fieldValues[hiddenFieldKey])
      : null;
    return current && !current.error ? current : null;
  }, [hiddenFieldKey]);

  const store = useCallback(
    (grid: { header: HiddenFieldColumn[]; rows: any[][] }, submit: boolean) => {
      if (!hiddenFieldKey) return;
      const updates = {
        [hiddenFieldKey]: { columns: grid.header, values: grid.rows }
      };
      updateFieldValues(updates);
      if (submit && !editMode) submitCustom(updates);
      onMutate();
    },
    [hiddenFieldKey, updateFieldValues, submitCustom, editMode, onMutate]
  );

  // New rows are not submitted: like a field-backed table, a row stays
  // provisional until one of its cells is edited.
  const handleInsertRow = useCallback(
    (atIndex: number) => {
      // Never overwrite a value this table could not read.
      const grid = currentGrid();
      if (!grid || !grid.header.length) return;
      const at = Math.max(0, Math.min(atIndex, grid.rows.length));
      // Each cell starts from its column's default, if it has one.
      const newRow = grid.header.map(newCell);
      store(
        {
          header: grid.header,
          rows: [...grid.rows.slice(0, at), newRow, ...grid.rows.slice(at)]
        },
        false
      );
    },
    [currentGrid, store]
  );

  const handleAddRow = useCallback(() => handleInsertRow(0), [handleInsertRow]);

  const removeRow = useCallback(
    (rowIndex: number, submit: boolean) => {
      const grid = currentGrid();
      if (!grid) return;
      store(
        {
          header: grid.header,
          rows: grid.rows.filter((_, i) => i !== rowIndex)
        },
        submit
      );
    },
    [currentGrid, store]
  );

  const handleDeleteRow = useCallback(
    (rowIndex: number) => removeRow(rowIndex, true),
    [removeRow]
  );

  const handleRemoveRowLocal = useCallback(
    (rowIndex: number) => removeRow(rowIndex, false),
    [removeRow]
  );

  /**
   * Every write is checked against its column's type before it is stored. A
   * typed-in number or true/false is stored as that value rather than as text,
   * and a write that still does not fit is refused and reported; the rest of
   * the batch is kept.
   */
  const handleCellsEdit = useCallback(
    (writes: CellWrite[]) => {
      if (!writes.length) return;
      const grid = currentGrid();
      if (!grid) return;
      const nextRows = grid.rows.map((row) => [...row]);
      const refused: string[] = [];
      let accepted = 0;

      writes.forEach(({ fieldKey, rowIndex, value }) => {
        const colIndex = columnIndexOf(fieldKey);
        const column = grid.header[colIndex];
        if (!column || rowIndex < 0) return;
        const rule = columnRule(column, colIndex);
        const cell =
          typeof value === 'string' && value.trim()
            ? parseCellInput(value, rule)
            : value;
        const problem = validateCellValue(cell, rule);
        if (problem) {
          refused.push(`${rule.label}, row ${rowIndex + 1}: ${problem}`);
          return;
        }
        while (nextRows.length <= rowIndex) nextRows.push([]);
        const row = nextRows[rowIndex];
        // Short rows are padded so the cell lands in its own column.
        while (row.length < colIndex) row.push('');
        row[colIndex] = cell;
        accepted++;
      });

      setEditErrors(refused);
      if (accepted) store({ header: grid.header, rows: nextRows }, true);
      else onMutate();
    },
    [currentGrid, store, onMutate]
  );

  /**
   * Column changes rewrite `columns` and, for a delete, the matching cell of
   * every row. Each one is submitted straight away, like a row delete: there is
   * no provisional state for a column.
   */
  const handleAddColumn = useCallback(
    (draft: ColumnDraft, atIndex?: number) => {
      const grid = currentGrid();
      if (!grid) return;
      // The default only fills rows added from now on; rows already there get
      // a blank cell, like any new column.
      const column = withDefault(
        withRequired(
          { name: draft.name, field_type: draft.field_type },
          draft.required
        ),
        draft.default
      );
      const at =
        atIndex === undefined
          ? grid.header.length
          : Math.max(0, Math.min(atIndex, grid.header.length));
      // Rows may be shorter than the columns, so only a row that reaches past
      // the new column needs a cell for it.
      store(
        {
          header: [
            ...grid.header.slice(0, at),
            column,
            ...grid.header.slice(at)
          ],
          rows: grid.rows.map((row) =>
            row.length > at ? [...row.slice(0, at), '', ...row.slice(at)] : row
          )
        },
        true
      );
    },
    [currentGrid, store]
  );

  const handleEditColumn = useCallback(
    (fieldKey: string, draft: ColumnDraft) => {
      const grid = currentGrid();
      const colIndex = columnIndexOf(fieldKey);
      if (!grid || !grid.header[colIndex]) return;
      // Cells that no longer fit a changed type, or are blank in a column
      // now required, are kept, and flagged by the column's new rule rather
      // than silently cleared.
      const header = grid.header.map((column, index) =>
        index === colIndex
          ? withDefault(
              withRequired(
                { ...column, name: draft.name, field_type: draft.field_type },
                draft.required
              ),
              draft.default
            )
          : column
      );
      store({ header, rows: grid.rows }, true);
    },
    [currentGrid, store]
  );

  const handleDeleteColumn = useCallback(
    (fieldKey: string) => {
      const grid = currentGrid();
      const colIndex = columnIndexOf(fieldKey);
      if (!grid || !grid.header[colIndex]) return;
      setEditErrors([]);
      store(
        {
          header: grid.header.filter((_, index) => index !== colIndex),
          rows: grid.rows.map((row) =>
            row.filter((_, index) => index !== colIndex)
          )
        },
        true
      );
    },
    [currentGrid, store]
  );

  /** A column's current name and type, to start its editor from. */
  const getColumnDraft = useCallback(
    (fieldKey: string): ColumnDraft | null => {
      const colIndex = columnIndexOf(fieldKey);
      const column = header[colIndex];
      return column
        ? {
            name: columnName(column, colIndex),
            field_type: columnType(column),
            required: column.required === true,
            default: column.default
          }
        : null;
    },
    [header]
  );

  const handleCellEdit = useCallback(
    (fieldKey: string, rowIndex: number, value: any) =>
      handleCellsEdit([{ fieldKey, rowIndex, value }]),
    [handleCellsEdit]
  );

  return {
    // Set when the stored value is not a grid; the table shows it and stays
    // read-only so no edit replaces the value.
    formatError,
    editErrors,
    cellRules,
    columnPermissions,
    hiddenFieldColumns,
    hiddenFieldValues,
    handleAddRow,
    handleInsertRow,
    handleDeleteRow,
    handleRemoveRowLocal,
    handleCellEdit,
    handleCellsEdit,
    handleAddColumn,
    handleEditColumn,
    handleDeleteColumn,
    getColumnDraft
  };
}
