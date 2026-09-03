// Pure spreadsheet data helpers: value coercion, clipboard (TSV) round-tripping,
// and Excel-style drag-to-fill series inference.
//
// Nothing here touches React or TanStack Table, so every rule below is unit
// testable on its own.

export type CellValue = string | number | boolean | null;

export type CellPatch = {
  rowIndex: number;
  fieldKey: string;
  before: CellValue;
  after: CellValue;
};

export type GridCoordinate = {
  rowIndex: number;
  columnIndex: number;
};

export type GridBounds = {
  minRowIndex: number;
  maxRowIndex: number;
  minColumnIndex: number;
  maxColumnIndex: number;
};

export type FillDirection = 'up' | 'down' | 'left' | 'right';

export type FillPreview = {
  direction: FillDirection;
  // The cells the fill will write into.
  destination: GridBounds;
  // Source plus destination, which becomes the selection after the fill.
  expanded: GridBounds;
};

export function formatCellValue(value: CellValue): string {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/**
 * Coerce editor/clipboard text into a stored value. Table cells round-trip
 * through form field values and Data Hub entries, both of which keep numbers
 * and booleans as themselves rather than as strings.
 */
export function parseInputValue(value: string): CellValue {
  const trimmed = value.trim();

  if (!trimmed) return null;
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }

  return value;
}

export function cellValuesEqual(left: CellValue, right: CellValue): boolean {
  // Empty string and null both render as a blank cell, so a commit that swaps
  // one for the other is not a change worth writing to the backend.
  if (isBlank(left) && isBlank(right)) return true;
  return Object.is(left, right);
}

function isBlank(value: CellValue): boolean {
  return value == null || value === '';
}

/**
 * Escape one value for a TSV clipboard payload. Leading `=`, `+`, `-` and `@`
 * are prefixed with an apostrophe so pasting into Excel or Sheets cannot turn
 * form data into a live formula.
 */
export function escapeTsvValue(value: CellValue): string {
  const text = formatCellValue(value);
  const safeText =
    typeof value === 'string' && /^[\t\r ]*[=+@-]/.test(value)
      ? `'${text}`
      : text;

  return /["\t\n\r]/.test(safeText)
    ? `"${safeText.replace(/"/g, '""')}"`
    : safeText;
}

export function serializeTsv(ranges: CellValue[][][]): string {
  return ranges
    .map((range) =>
      range.map((row) => row.map(escapeTsvValue).join('\t')).join('\n')
    )
    .join('\n\n');
}

export function parseTsv(text: string): string[][] {
  const rows: string[][] = [[]];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];

    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index++;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
      continue;
    }

    if (character === '"' && value.length === 0) {
      quoted = true;
    } else if (character === '\t') {
      rows[rows.length - 1].push(value);
      value = '';
    } else if (character === '\n') {
      rows[rows.length - 1].push(value);
      rows.push([]);
      value = '';
    } else if (character !== '\r') {
      value += character;
    }
  }

  rows[rows.length - 1].push(value);

  const lastRow = rows[rows.length - 1];
  // A trailing newline leaves one empty cell behind, which is not a row.
  if (rows.length > 1 && lastRow.length === 1 && lastRow[0] === '') rows.pop();

  return rows.length ? rows : [['']];
}

/**
 * Work out what dragging the fill handle to `hover` should fill. Excel commits
 * to a single axis: whichever the pointer travelled further along wins.
 */
export function getFillPreview(
  source: GridBounds,
  hover: GridCoordinate
): FillPreview | null {
  const rowDistance =
    hover.rowIndex < source.minRowIndex
      ? hover.rowIndex - source.minRowIndex
      : hover.rowIndex > source.maxRowIndex
      ? hover.rowIndex - source.maxRowIndex
      : 0;
  const columnDistance =
    hover.columnIndex < source.minColumnIndex
      ? hover.columnIndex - source.minColumnIndex
      : hover.columnIndex > source.maxColumnIndex
      ? hover.columnIndex - source.maxColumnIndex
      : 0;

  if (rowDistance === 0 && columnDistance === 0) return null;

  if (Math.abs(rowDistance) >= Math.abs(columnDistance) && rowDistance !== 0) {
    if (rowDistance < 0) {
      return {
        direction: 'up',
        destination: {
          minRowIndex: hover.rowIndex,
          maxRowIndex: source.minRowIndex - 1,
          minColumnIndex: source.minColumnIndex,
          maxColumnIndex: source.maxColumnIndex
        },
        expanded: { ...source, minRowIndex: hover.rowIndex }
      };
    }

    return {
      direction: 'down',
      destination: {
        minRowIndex: source.maxRowIndex + 1,
        maxRowIndex: hover.rowIndex,
        minColumnIndex: source.minColumnIndex,
        maxColumnIndex: source.maxColumnIndex
      },
      expanded: { ...source, maxRowIndex: hover.rowIndex }
    };
  }

  if (columnDistance < 0) {
    return {
      direction: 'left',
      destination: {
        minRowIndex: source.minRowIndex,
        maxRowIndex: source.maxRowIndex,
        minColumnIndex: hover.columnIndex,
        maxColumnIndex: source.minColumnIndex - 1
      },
      expanded: { ...source, minColumnIndex: hover.columnIndex }
    };
  }

  return {
    direction: 'right',
    destination: {
      minRowIndex: source.minRowIndex,
      maxRowIndex: source.maxRowIndex,
      minColumnIndex: source.maxColumnIndex + 1,
      maxColumnIndex: hover.columnIndex
    },
    expanded: { ...source, maxColumnIndex: hover.columnIndex }
  };
}

export function buildFillPatches(options: {
  source: GridBounds;
  preview: FillPreview;
  rowIndices: number[];
  fieldKeys: string[];
  getValue: (rowIndex: number, fieldKey: string) => CellValue;
}): CellPatch[] {
  const { source, preview, rowIndices, fieldKeys, getValue } = options;
  const patches: CellPatch[] = [];
  const vertical = preview.direction === 'up' || preview.direction === 'down';

  for (
    let row = preview.destination.minRowIndex;
    row <= preview.destination.maxRowIndex;
    row++
  ) {
    const rowIndex = rowIndices[row];
    if (rowIndex === undefined) continue;

    for (
      let column = preview.destination.minColumnIndex;
      column <= preview.destination.maxColumnIndex;
      column++
    ) {
      const fieldKey = fieldKeys[column];
      if (fieldKey === undefined) continue;

      const sourceValues = vertical
        ? range(source.minRowIndex, source.maxRowIndex).map((sourceRow) =>
            getValue(rowIndices[sourceRow], fieldKey)
          )
        : range(source.minColumnIndex, source.maxColumnIndex).map(
            (sourceColumn) => getValue(rowIndex, fieldKeys[sourceColumn])
          );

      const after = getFilledValue({
        sourceValues,
        sourceStart: vertical ? source.minRowIndex : source.minColumnIndex,
        sourceEnd: vertical ? source.maxRowIndex : source.maxColumnIndex,
        destinationIndex: vertical ? row : column
      });
      const before = getValue(rowIndex, fieldKey);

      if (!cellValuesEqual(before, after)) {
        patches.push({ rowIndex, fieldKey, before, after });
      }
    }
  }

  return patches;
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function getFilledValue(options: {
  sourceValues: CellValue[];
  sourceStart: number;
  sourceEnd: number;
  destinationIndex: number;
}): CellValue {
  const { sourceValues, sourceStart, sourceEnd, destinationIndex } = options;
  const sequence = inferSequence(sourceValues);

  if (sequence) {
    const forward = destinationIndex > sourceEnd;
    const offset = forward
      ? destinationIndex - sourceEnd
      : destinationIndex - sourceStart;
    const base = forward
      ? sourceValues[sourceValues.length - 1]
      : sourceValues[0];

    if (sequence.type === 'number') {
      return (base as number) + sequence.step * offset;
    }

    const date = parseIsoDate(base as string);
    if (date) {
      date.setUTCDate(date.getUTCDate() + sequence.step * offset);
      return date.toISOString().slice(0, 10);
    }
  }

  // No detectable series, so repeat the source block like Excel does.
  return sourceValues[
    positiveModulo(destinationIndex - sourceStart, sourceValues.length)
  ];
}

type Sequence = { type: 'number' | 'date'; step: number };

function inferSequence(values: CellValue[]): Sequence | null {
  if (values.length < 2 || values.some((value) => value == null)) return null;

  if (values.every((value) => typeof value === 'number')) {
    const numbers = values as number[];
    const step = numbers[1] - numbers[0];
    const isArithmetic = numbers.every(
      (number, index) =>
        index === 0 || Math.abs(number - numbers[index - 1] - step) < 1e-9
    );
    if (Number.isFinite(step) && isArithmetic) {
      return { type: 'number', step };
    }
  }

  const dates = values.map((value) =>
    typeof value === 'string' ? parseIsoDate(value) : null
  );
  if (dates.every((date): date is Date => date != null)) {
    const day = 86_400_000;
    const step = (dates[1].getTime() - dates[0].getTime()) / day;
    const isArithmetic = dates.every(
      (date, index) =>
        index === 0 ||
        (date.getTime() - dates[index - 1].getTime()) / day === step
    );
    if (Number.isInteger(step) && isArithmetic) {
      return { type: 'date', step };
    }
  }

  return null;
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
