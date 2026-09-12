// Row roles come only from document evidence. The caller owns header detection;
// row-scoped tags identify items and table-dependent formulas identify totals.

import { parseTag } from '../../../elements/components/DocxEditor/bindings/core/tagDsl';
import {
  collectRefs,
  parseExpression
} from '../../../elements/components/DocxEditor/bindings/core/formula';

export type TableRole = 'header' | 'item' | 'aggregate' | 'static';

export interface TableRowRole {
  index: number;
  role: TableRole;
  aggregates?: string[];
  rowId?: string | null;
}

export interface TableStructure {
  tableId: string | null;
  headerRows: number;
  rows: TableRowRole[];
}

const rowsOf = (tableBlock: any): any[] =>
  tableBlock?.rows ?? tableBlock?.r ?? tableBlock?.rw ?? [];
const cellsOf = (row: any): any[] => row?.cells ?? row?.c ?? [];
const blocksOf = (node: any): any[] => node?.blocks ?? node?.b ?? [];
const inlinesOf = (node: any): any[] => node?.inlines ?? node?.i ?? [];

/** Collect nested binding tags from either SFDT dialect. */
function tagsInRow(row: any): string[] {
  const found: string[] = [];
  const addTag = (node: any): void => {
    const tag = node?.contentControlProperties?.tag ?? node?.ccp?.tg ?? null;
    if (typeof tag === 'string') found.push(tag);
  };
  const walkInlines = (inlines: any[]): void => {
    for (const inline of inlines ?? []) {
      addTag(inline);
      walkInlines(inlinesOf(inline));
    }
  };
  const walkBlocks = (blocks: any[]): void => {
    for (const block of blocks ?? []) {
      addTag(block);
      walkInlines(inlinesOf(block));
      walkBlocks(blocksOf(block));
      // A nested table's own rows belong to that table, not to this row.
    }
  };
  for (const cell of cellsOf(row)) {
    addTag(cell);
    walkInlines(inlinesOf(cell));
    walkBlocks(blocksOf(cell));
  }
  return found;
}

/** Resolve direct and transitive formula dependencies without following cycles. */
function dependsOnTable(
  expression: string,
  tableId: string,
  documentFormulas: Map<string, string>,
  seen: Set<string>
): boolean {
  let refs: string[];
  try {
    refs = collectRefs(parseExpression(expression));
  } catch {
    return false;
  }
  for (const ref of refs) {
    const dot = ref.indexOf('.');
    if (dot > 0) {
      if (ref.slice(0, dot) === tableId) return true;
      continue;
    }
    if (seen.has(ref)) continue;
    seen.add(ref);
    const nested = documentFormulas.get(ref);
    if (nested && dependsOnTable(nested, tableId, documentFormulas, seen))
      return true;
  }
  return false;
}

export function deriveTableStructure(input: {
  tableBlock: any;
  headerRows: number;
  tableId: string | null;
  documentFormulas?: Map<string, string>;
}): TableStructure {
  const { tableBlock, headerRows, tableId } = input;
  const documentFormulas = input.documentFormulas ?? new Map<string, string>();
  const rows = rowsOf(tableBlock);

  const parsedRows = rows.map(
    (row) =>
      tagsInRow(row)
        .map((tag) => {
          try {
            return parseTag(tag);
          } catch {
            return null;
          }
        })
        .filter(Boolean) as any[]
  );
  const tableIsBound = parsedRows.some((defs) =>
    defs.some((d) => d.kind !== 'table' && d.options?.row !== undefined)
  );

  const out: TableRowRole[] = rows.map((_row, index) => {
    if (index < headerRows) return { index, role: 'header' as TableRole };

    const defs = parsedRows[index];

    if (tableId) {
      const aggregates = defs
        .filter(
          (d) =>
            d.kind === 'formula' &&
            dependsOnTable(d.expression, tableId, documentFormulas, new Set())
        )
        .map((d) => d.name);
      if (aggregates.length)
        return { index, role: 'aggregate' as TableRole, aggregates };
    }

    const rowScoped = defs.find(
      (d) => d.kind !== 'table' && d.options?.row !== undefined
    );
    if (rowScoped)
      return { index, role: 'item' as TableRole, rowId: rowScoped.options.row };

    // Plain tables have no row bindings, so every non-header row is an item.
    if (!tableIsBound) return { index, role: 'item' as TableRole };

    return { index, role: 'static' as TableRole };
  });

  return { tableId, headerRows, rows: out };
}
