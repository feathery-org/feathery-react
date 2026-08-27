// What a table's rows MEAN, derived from evidence the document already carries.
//
// A structural op is a composition of human-shaped primitives - split_table is
// "copy the table, delete what should not be in the copy, delete the complement
// from the source". For those primitives to stay dumb and safe, something has to
// know which rows are the header band, which are the data, and which are totals
// computed FROM that data. That is this module, and it is the input to the
// planner rather than anything the model ever sees.
//
// Nothing here guesses. Each role comes from a specific piece of evidence:
//
//   header     the caller's header-row count. NOT re-derived here - see below.
//   item       a row-scoped binding (`row=` in the tag).
//   aggregate  a formula that depends on this table's own column, directly or
//              through other formulas.
//   static     everything that is none of those.
//
// ONE OWNER FOR HEADER ROWS. `headerRows` is an input, not a computation. The
// question "how many leading rows are the header" already has an owner in
// effectiveHeaderRows, which weighs stated header flags against what the page
// actually shows. Asking it a second way here would let a style-only header and
// a filled header disagree, and every stripe below the disagreement lands one
// row out of phase - the exact defect that had to be fixed in the split
// restripe, where header rows were being re-inferred instead of taken from the
// plan.

import { parseTag } from '../../../elements/components/DocxEditor/bindings/core/tagDsl';
import {
  collectRefs,
  parseExpression
} from '../../../elements/components/DocxEditor/bindings/core/formula';

export type TableRole = 'header' | 'item' | 'aggregate' | 'static';

export interface TableRowRole {
  /** Physical row index within the table. */
  index: number;
  role: TableRole;
  /** For an aggregate row, the formula names that made it one. */
  aggregates?: string[];
  /** For an item row, the binding row id when it has one. */
  rowId?: string | null;
}

export interface TableStructure {
  tableId: string | null;
  headerRows: number;
  rows: TableRowRole[];
}

const rowsOf = (tableBlock: any): any[] =>
  tableBlock?.rows ?? tableBlock?.rw ?? [];
const cellsOf = (row: any): any[] => row?.cells ?? row?.c ?? [];
const blocksOf = (node: any): any[] => node?.blocks ?? node?.b ?? [];
const inlinesOf = (node: any): any[] => node?.inlines ?? node?.i ?? [];

/**
 * Every binding tag in one row, in both SFDT dialects.
 *
 * Content controls nest, and a bound run is an inline that CONTAINS inlines, so
 * this recurses rather than reading one level: a tag one wrapper deeper than
 * expected is exactly the kind of thing that silently reads as an unbound table.
 */
function tagsInRow(row: any): string[] {
  const found: string[] = [];
  const walkInlines = (inlines: any[]): void => {
    for (const inline of inlines ?? []) {
      const tag =
        inline?.contentControlProperties?.tag ?? inline?.ccp?.tg ?? null;
      if (typeof tag === 'string') found.push(tag);
      walkInlines(inlinesOf(inline));
    }
  };
  const walkBlocks = (blocks: any[]): void => {
    for (const block of blocks ?? []) {
      const tag =
        block?.contentControlProperties?.tag ?? block?.ccp?.tg ?? null;
      if (typeof tag === 'string') found.push(tag);
      walkInlines(inlinesOf(block));
      walkBlocks(blocksOf(block));
      // A nested table's own rows belong to that table, not to this row.
    }
  };
  for (const cell of cellsOf(row)) walkBlocks(blocksOf(cell));
  return found;
}

/**
 * Does `expression` depend on `tableId`'s own rows, directly or transitively?
 *
 * Directly is the easy half: `sum(costs.line_total)` names the table outright.
 * The hard half is the one a real document is full of - `mul(subtotal,
 * tax_rate)` mentions no table at all, but `subtotal` is itself
 * `sum(costs.line_total)`, so the value is wholly determined by the table's rows.
 * A rule that only looked for a dotted ref would call that row static, and a
 * fragment that carried the item rows away while leaving the tax behind would
 * strand a number that silently no longer means anything.
 *
 * `seen` makes a formula cycle terminate rather than recurse forever; a cycle is
 * the binding engine's problem to report, not a reason to hang here.
 */
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
    // An unparseable expression is the binding engine's diagnostic to raise. It
    // is not evidence of a dependency, so it cannot promote a row to aggregate.
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
  /** The SFDT table block, in either dialect. */
  tableBlock: any;
  /** From effectiveHeaderRows. This module never re-derives it. */
  headerRows: number;
  /** The id from the table's marker tag, or null for an unbound table. */
  tableId: string | null;
  /** Every formula name -> expression in the document, for transitive deps. */
  documentFormulas?: Map<string, string>;
}): TableStructure {
  const { tableBlock, headerRows, tableId } = input;
  const documentFormulas = input.documentFormulas ?? new Map<string, string>();
  const rows = rowsOf(tableBlock);

  // Whether the table carries ANY row-scoped binding decides which item rule
  // applies, so it is answered once over the whole table rather than per row.
  const parsedRows = rows.map(
    (row) =>
      tagsInRow(row)
        .map((tag) => {
          try {
            return parseTag(tag);
          } catch {
            // A malformed tag is a diagnostic the binding scanner owns. Here it
            // simply carries no evidence.
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

    // UNBOUND FALLBACK, and its limit stated rather than implied. A table with
    // no row-scoped bindings has no binding evidence to separate data rows from
    // decoration, so every non-header row is treated as an item. The design
    // calls for banding-majority here instead, which needs the appearance facts
    // that only reach this seam once the finalizer exists; until then this is a
    // deliberate simplification, not a claim that banding is being consulted.
    if (!tableIsBound) return { index, role: 'item' as TableRole };

    return { index, role: 'static' as TableRole };
  });

  return { tableId, headerRows, rows: out };
}
