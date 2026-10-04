// Positional grids: Excel-shaped refs (B3, sum(B2:end)) read a table by
// POSITION, so a plain typed cell joins a sum with no binding. Grids rebuild
// every reconcile; row 1 is the first physical row, columns are span-aware.
import {
  BindingIndex,
  getAt,
  hasOnlyRevisionIds,
  hasRevisionId,
  revisionIdsOfType,
  inlineText,
  isPathPrefix,
  Occurrence
} from './sfdtAdapter';
import { CellRef, FormulaError, isFormulaError, RangeRef } from './formula';
import { isNumericType } from './valueTypes';
import { SfdtDocument, SfdtPath } from './sfdtTypes';

export interface GridCell {
  text: string;
  occ: Occurrence | null;
}
interface Grid {
  /** rows[physicalRow - 1][col] -> cell; a span shares one cell object. */
  rows: Array<Array<GridCell | undefined>>;
}
/** A physical cell position: 1-based row, span-aware 0-based column. */
interface Pos {
  row: number;
  col: number;
}

export function cellLabel(col: number, row: number | 'end'): string {
  let letters = '';
  let c = col + 1;
  while (c > 0) {
    letters = String.fromCharCode(65 + ((c - 1) % 26)) + letters;
    c = Math.floor((c - 1) / 26);
  }
  return row === 'end' ? 'end' : `${letters}${row}`;
}

export const cellRefLabel = (cell: CellRef): string =>
  `${cell.table ? `${cell.table}!` : ''}${cellLabel(cell.col, cell.row)}`;
export const rangeRefLabel = (range: RangeRef): string =>
  `${range.table ? `${range.table}!` : ''}${cellLabel(
    range.startCol,
    range.startRow
  )}:${cellLabel(range.endCol, range.endRow)}`;

/** Lenient numeric read of a plain cell: "$1,200.50" -> "1200.50". */
export function parseLooseNumber(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return '0';
  let cleaned = trimmed.replace(/[$€£\s,]/g, '');
  const negParen = /^\((.*)\)$/.exec(cleaned);
  if (negParen) cleaned = `-${negParen[1]}`;
  return /^-?\d+(\.\d+)?$/.test(cleaned) ? cleaned : null;
}

export interface PositionalGridOptions {
  sfdt: SfdtDocument;
  index: BindingIndex;
  nodeId: (occurrence: Occurrence) => string;
  /** Evaluated formula value by node id; undefined = not evaluated yet. */
  getFormulaResult: (id: string) => string | undefined;
  /** Canonical field value by occurrence key; undefined = no valid value. */
  getFieldValue: (key: string) => string | undefined;
}

export interface PositionalGridReader {
  positionalCellValue(cell: CellRef, occ: Occurrence): string;
  positionalRangeValues(range: RangeRef, occ: Occurrence): string[];
  /** Formula node ids a set of positional refs depends on (errors deferred). */
  positionalDepIds(
    cells: CellRef[],
    ranges: RangeRef[],
    occ: Occurrence
  ): string[];
}

export function createPositionalGrid(
  options: PositionalGridOptions
): PositionalGridReader {
  const { sfdt, index, nodeId, getFormulaResult, getFieldValue } = options;
  const posKey = (row: number, col: number): string => `${row}:${col}`;

  const deletionRevisionIds = revisionIdsOfType(sfdt, 'Deletion');
  const isDeletedInline = (inline: any): boolean =>
    hasOnlyRevisionIds(inline, deletionRevisionIds);

  /** Physical position of an occurrence in a table (span-aware column). */
  function positionIn(
    tablePath: SfdtPath,
    tableNode: any,
    occurrence: Occurrence
  ): Pos | null {
    const rest = occurrence.path.slice(tablePath.length);
    if (String(rest[0]) !== 'rows' || String(rest[2]) !== 'cells') return null;
    const r = Number(rest[1]);
    const c = Number(rest[3]);
    if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
    const row = tableNode.rows?.[r];
    if (!row) return null;
    let col = 0;
    for (let k = 0; k < c; k++)
      col += Number(row.cells?.[k]?.cellFormat?.columnSpan) || 1;
    return { row: r + 1, col };
  }

  const grids = new Map<string, Grid | null>();
  function gridFor(tableId: string): Grid | null {
    if (grids.has(tableId)) return grids.get(tableId) as Grid | null;
    const entry = index.tables.get(tableId);
    const tableNode =
      entry && entry.tablePath
        ? (getAt(sfdt, entry.tablePath) as { rows?: any[] } | undefined)
        : undefined;
    if (!entry || !entry.tablePath || !Array.isArray(tableNode?.rows)) {
      grids.set(tableId, null);
      return null;
    }
    const tableRows = tableNode.rows as any[];
    const byPos = new Map<string, Occurrence>();
    for (const occurrence of index.occurrences) {
      if (!isPathPrefix(entry.tablePath, occurrence.path)) continue;
      const pos = positionIn(entry.tablePath, tableNode, occurrence);
      if (pos) byPos.set(posKey(pos.row, pos.col), occurrence);
    }
    const rows: Array<Array<GridCell | undefined>> = [];
    tableRows.forEach((row: any, r: number) => {
      const line: Array<GridCell | undefined> = [];
      // Preserve physical row numbering without letting deleted rows supply
      // stale text or dependencies to positional formulas.
      if (hasRevisionId(row.rowFormat, deletionRevisionIds)) {
        rows.push(line);
        return;
      }
      let col = 0;
      for (const cell of row.cells || []) {
        const span = Number(cell?.cellFormat?.columnSpan) || 1;
        const gridCell: GridCell = {
          text: inlineText(cell, isDeletedInline).trim(),
          occ: byPos.get(posKey(r + 1, col)) || null
        };
        for (let s = 0; s < span; s++) line[col + s] = gridCell;
        col += span;
      }
      rows.push(line);
    });
    const grid: Grid = { rows };
    grids.set(tableId, grid);
    return grid;
  }

  /** The table that physically contains an occurrence. */
  const owningTableCache = new Map<string, string | null>();
  function owningTableId(occurrence: Occurrence): string | null {
    if (occurrence.tableId) return occurrence.tableId;
    const hit = owningTableCache.get(occurrence.key);
    if (hit !== undefined) return hit;
    let found: string | null = null;
    for (const [tableId, entry] of index.tables) {
      if (entry.tablePath && isPathPrefix(entry.tablePath, occurrence.path)) {
        found = tableId;
        break;
      }
    }
    owningTableCache.set(occurrence.key, found);
    return found;
  }

  function positionalGrid(
    refTable: string | null,
    occ: Occurrence,
    label: string
  ): { grid: Grid; tableId: string } {
    const tableId = refTable ?? owningTableId(occ);
    if (!tableId)
      throw new FormulaError(`${label}: positional reference outside a table`);
    const grid = gridFor(tableId);
    if (!grid) throw new FormulaError(`${label}: unknown table "${tableId}"`);
    return { grid, tableId };
  }

  function ownPosition(occ: Occurrence, tableId: string): Pos | null {
    const entry = index.tables.get(tableId);
    if (!entry || !entry.tablePath) return null;
    if (!isPathPrefix(entry.tablePath, occ.path)) return null;
    return positionIn(entry.tablePath, getAt(sfdt, entry.tablePath), occ);
  }

  // The single formula/field/plain switch every positional read shares. Returns
  // the numeric value string, or null when the cell can't contribute - the
  // caller decides whether that skips (a range) or throws (a single cell).
  function resolveGridCell(gridCell: GridCell, label: string): string | null {
    if (!gridCell.occ) return parseLooseNumber(gridCell.text);
    if (gridCell.occ.def.kind === 'formula') {
      const result = getFormulaResult(nodeId(gridCell.occ));
      if (result === undefined)
        throw new FormulaError(`${label} did not evaluate`);
      return result;
    }
    // A non-numeric bound field (its canonical value is text) can't feed sum.
    if (!isNumericType(gridCell.occ.def.fieldType)) return null;
    return getFieldValue(gridCell.occ.key) ?? null;
  }

  // Visit each unique range cell once. The formula's own cell is self-excluded
  // (Word's SUM(ABOVE)) by two complementary checks: neither alone covers both
  // a spanned own-cell and one whose occurrence isn't grid-mapped.
  function forEachRangeCell(
    range: RangeRef,
    occ: Occurrence,
    label: string,
    visit: (gridCell: GridCell) => void
  ): void {
    const { grid, tableId } = positionalGrid(range.table, occ, label);
    const own = ownPosition(occ, tableId);
    const endRow =
      range.endRow === 'end'
        ? grid.rows.length
        : Math.min(range.endRow, grid.rows.length);
    const seen = new Set<GridCell>();
    for (let row = range.startRow; row <= endRow; row++) {
      for (let col = range.startCol; col <= range.endCol; col++) {
        // by position: fallback, but only knows the own cell's anchor column
        if (own && own.row === row && own.col === col) continue;
        const gridCell = grid.rows[row - 1]?.[col];
        if (!gridCell || seen.has(gridCell)) continue;
        seen.add(gridCell);
        // by identity: covers every column a spanned own-cell occupies
        if (gridCell.occ && nodeId(gridCell.occ) === nodeId(occ)) continue;
        visit(gridCell);
      }
    }
  }

  function positionalCellValue(cell: CellRef, occ: Occurrence): string {
    const label = cellRefLabel(cell);
    const { grid } = positionalGrid(cell.table, occ, label);
    const gridCell = grid.rows[cell.row - 1]?.[cell.col];
    if (!gridCell) throw new FormulaError(`${label} is outside the table`);
    const value = resolveGridCell(gridCell, label);
    if (value === null) {
      const shown = gridCell.text ? ` ("${gridCell.text}")` : ' (empty)';
      throw new FormulaError(`cell ${label}${shown} is not a number`);
    }
    return value;
  }

  function positionalRangeValues(range: RangeRef, occ: Occurrence): string[] {
    const label = rangeRefLabel(range);
    const out: string[] = [];
    forEachRangeCell(range, occ, label, (gridCell) => {
      const value = resolveGridCell(gridCell, label);
      if (value !== null) out.push(value);
    });
    return out;
  }

  function positionalDepIds(
    cells: CellRef[],
    ranges: RangeRef[],
    occ: Occurrence
  ): string[] {
    const ids: string[] = [];
    const addDep = (gridCell: GridCell): void => {
      if (gridCell.occ?.def.kind === 'formula') ids.push(nodeId(gridCell.occ));
    };
    try {
      for (const cell of cells) {
        const { grid } = positionalGrid(cell.table, occ, 'dep');
        const gridCell = grid.rows[cell.row - 1]?.[cell.col];
        if (gridCell) addDep(gridCell);
      }
      for (const range of ranges) forEachRangeCell(range, occ, 'dep', addDep);
    } catch (thrown) {
      if (!isFormulaError(thrown)) throw thrown;
      // Resolution failures resurface at evaluation with a proper message.
    }
    return ids;
  }

  return { positionalCellValue, positionalRangeValues, positionalDepIds };
}
