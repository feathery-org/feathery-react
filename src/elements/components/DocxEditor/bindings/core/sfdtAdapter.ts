// SFDT adapter: the only module that knows the raw SFDT JSON shape.
//
// Everything here is a pure function over the verbose (optimizeSfdt:false) SFDT
// document. Mutating operations return a NEW document that shares every untouched
// subtree with the input (structural sharing), so a failed transform can never
// partially corrupt the displayed snapshot, and callers can use reference
// identity as an O(1) "did anything change?" check.
//
// Shapes this module relies on, verified against the pinned EJ2 build in the
// Phase 0 spikes:
//   paragraph block:  { paragraphFormat?, inlines: [...] }
//   table block:      { rows: [{ cells: [{ blocks: [...] }] }], ... }
//   inline CC:        { contentControlProperties: {tag, title, lockContents,
//                       lockContentControl, color, ...}, inlines: [{text, characterFormat?}] }
//   block CC wrapper: { contentControlProperties: {...}, blocks: [...] }

import {
  BoundDefinition,
  Definition,
  formatTag,
  isTagError,
  parseTag
} from './tagDsl';
import {
  defaultValue,
  isValueError,
  parseDisplay,
  renderDisplay
} from './valueTypes';
import {
  Diagnostic,
  DiagnosticSeverity,
  isOptimizedSfdt,
  SfdtCell,
  SfdtDocument,
  SfdtInline,
  SfdtPath,
  SfdtRow
} from './sfdtTypes';

/* ---------------- index types ---------------- */

export interface Occurrence {
  /** Stable within one scan: "<scope>:<name>#<ordinal>". */
  key: string;
  name: string;
  def: BoundDefinition;
  tag: string;
  path: SfdtPath;
  text: string;
  tableId: string | null;
  rowId: string | null;
  lockContents: boolean;
}

export interface TableRowEntry {
  rowId: string | null;
  path: SfdtPath | null;
  bindings: Map<string, Occurrence>;
}

export interface TableEntry {
  tableId: string;
  markerPath: SfdtPath;
  tablePath: SfdtPath | null;
  columnDefs: Map<string, BoundDefinition>;
  rows: TableRowEntry[];
}

export interface BindingIndex {
  occurrences: Occurrence[];
  /** Document-level field name -> occurrences. */
  fields: Map<string, Occurrence[]>;
  /** Document-level (incl. aggregate) formula name -> occurrences. */
  formulas: Map<string, Occurrence[]>;
  tables: Map<string, TableEntry>;
  diagnostics: Diagnostic[];
}

export interface CellValue {
  text: string;
  canonical: string | null;
  error: string | null;
  kind: BoundDefinition['kind'];
}

export interface LineItem {
  rowId: string | null;
  values: Record<string, CellValue>;
}

/* ---------------- path utilities (immutable updates) ---------------- */

export function getAt(doc: unknown, path: SfdtPath): any {
  let node: any = doc;
  for (const key of path) node = node[key];
  return node;
}

/** Rebuild the spine from root to `path`, replacing the leaf with `value`. */
export function setAt<T>(doc: T, path: SfdtPath, value: unknown): T {
  if (path.length === 0) return value as T;
  const [head, ...rest] = path;
  const source = doc as any;
  const copy: any = Array.isArray(source) ? source.slice() : { ...source };
  copy[head] = setAt(source[head], rest, value);
  return copy as T;
}

/** True when `prefix` addresses an ancestor of (or the same node as) `path`. */
function isPathPrefix(prefix: SfdtPath, path: SfdtPath): boolean {
  if (prefix.length > path.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (String(prefix[i]) !== String(path[i])) return false;
  }
  return true;
}

function deepClone<T>(node: T): T {
  return JSON.parse(JSON.stringify(node));
}

/* ---------------- scanning ---------------- */

function revisionIdsOfType(
  sfdt: SfdtDocument,
  type: 'Insertion' | 'Deletion'
): Set<string> {
  const ids = new Set<string>();
  const revisions = Array.isArray(sfdt.revisions) ? sfdt.revisions : [];
  for (const revision of revisions) {
    if (!revision || String(revision.revisionType) !== type) continue;
    const id = revision.revisionId ?? revision.revisionID;
    if (id != null) ids.add(String(id));
  }
  return ids;
}

function hasOnlyRevisionIds(node: any, ids: Set<string>): boolean {
  const revisionIds = node?.revisionIds;
  return (
    Array.isArray(revisionIds) &&
    revisionIds.length > 0 &&
    revisionIds.every((id) => ids.has(String(id)))
  );
}

function ccText(node: SfdtInline, deletedRevisionIds: Set<string>): string {
  let out = '';
  for (const inline of node.inlines || []) {
    if (hasOnlyRevisionIds(inline, deletedRevisionIds)) continue;
    if (typeof inline.text === 'string' && !inline.contentControlProperties)
      out += inline.text;
    else if (inline.contentControlProperties)
      out += ccText(inline, deletedRevisionIds);
  }
  return out;
}

function diag(
  list: Diagnostic[],
  severity: DiagnosticSeverity,
  code: string,
  message: string,
  path: SfdtPath
): void {
  list.push({ severity, code, message, path });
}

interface TableContext {
  tableId: string;
}

/**
 * Walks every block list in the document (body, header/footer, table cells,
 * block-CC wrappers) and builds the binding index.
 */
export function scanBindings(sfdt: SfdtDocument): BindingIndex {
  const index: BindingIndex = {
    occurrences: [],
    fields: new Map(),
    formulas: new Map(),
    tables: new Map(),
    diagnostics: []
  };
  const ordinals = new Map<string, number>();
  const deletedRevisionIds = revisionIdsOfType(sfdt, 'Deletion');

  // Minified SFDT has none of the keys below, so it would otherwise scan as a
  // document with zero bindings - indistinguishable from an unbound template.
  if (isOptimizedSfdt(sfdt)) {
    diag(
      index.diagnostics,
      'error',
      'optimized-sfdt',
      'document is minified SFDT: bindings are unreadable. Construct the editor with documentEditorSettings.optimizeSfdt = false.',
      []
    );
    return index;
  }

  function record(
    def: BoundDefinition,
    tag: string,
    path: SfdtPath,
    ccNode: SfdtInline,
    tableCtx: TableContext | null,
    rowPath: SfdtPath | null
  ): void {
    const rowId = (def.options && def.options.row) || null;
    const tableId = tableCtx && rowId ? tableCtx.tableId : null;
    const scope = tableId ? `${tableId}/${rowId}` : 'doc';
    const ordinalKey = `${scope}:${def.name}`;
    const ordinal = ordinals.get(ordinalKey) || 0;
    ordinals.set(ordinalKey, ordinal + 1);
    const occurrence: Occurrence = {
      key: `${ordinalKey}#${ordinal}`,
      name: def.name,
      def,
      tag,
      path,
      text: ccText(ccNode, deletedRevisionIds),
      tableId,
      rowId,
      lockContents: !!(
        ccNode.contentControlProperties &&
        ccNode.contentControlProperties.lockContents
      )
    };
    index.occurrences.push(occurrence);
    if (tableId) {
      const table = index.tables.get(tableId);
      if (!table) return;
      let row = table.rows.find((entry) => entry.rowId === rowId);
      if (!row) {
        row = { rowId, path: rowPath, bindings: new Map() };
        table.rows.push(row);
      }
      if (row.bindings.has(def.name)) {
        diag(
          index.diagnostics,
          'error',
          'duplicate-column',
          `duplicate binding "${def.name}" in row ${rowId} of table ${tableId}`,
          path
        );
      }
      row.bindings.set(def.name, occurrence);
      if (!table.columnDefs.has(def.name)) table.columnDefs.set(def.name, def);
    } else {
      const bucket = def.kind === 'field' ? index.fields : index.formulas;
      if (!bucket.has(def.name)) bucket.set(def.name, []);
      (bucket.get(def.name) as Occurrence[]).push(occurrence);
    }
  }

  function parseTagOrDiagnose(
    rawTag: string,
    path: SfdtPath
  ): Definition | null {
    try {
      return parseTag(rawTag);
    } catch (error) {
      if (isTagError(error)) {
        diag(index.diagnostics, 'error', 'malformed-tag', error.message, path);
        return null;
      }
      throw error;
    }
  }

  function walkInlines(
    inlines: SfdtInline[] | undefined,
    basePath: SfdtPath,
    tableCtx: TableContext | null,
    rowPath: SfdtPath | null
  ): void {
    (inlines || []).forEach((inline, i) => {
      if (!inline || !inline.contentControlProperties) return;
      const path = [...basePath, i];
      const rawTag = String(inline.contentControlProperties.tag || '');
      const def = parseTagOrDiagnose(rawTag, path);
      if (def && (def.kind === 'field' || def.kind === 'formula')) {
        if (def.options.row && !(tableCtx && rowPath)) {
          diag(
            index.diagnostics,
            'error',
            'orphan-row-binding',
            `binding "${def.name}" has row=${def.options.row} but is not inside a configured table row`,
            path
          );
        } else {
          record(def, rawTag, path, inline, tableCtx, rowPath);
        }
      } else if (def && def.kind === 'table') {
        diag(
          index.diagnostics,
          'error',
          'misplaced-table-tag',
          'table tags belong on a block-level content control wrapping the table',
          path
        );
      }
      // Nested content controls inside a content control.
      walkInlines(inline.inlines, [...path, 'inlines'], tableCtx, rowPath);
    });
  }

  function walkBlocks(
    blocks: any[] | undefined,
    basePath: SfdtPath,
    tableCtx: TableContext | null,
    rowPath: SfdtPath | null = null
  ): void {
    (blocks || []).forEach((block, i) => {
      if (!block) return;
      const path = [...basePath, i];
      if (block.contentControlProperties && Array.isArray(block.blocks)) {
        // Block-level CC wrapper; a table tag makes its inner table configured.
        const def = parseTagOrDiagnose(
          String(block.contentControlProperties.tag || ''),
          path
        );
        let innerCtx = tableCtx;
        if (def && def.kind === 'table') {
          const rawTable = block.blocks.find(
            (candidate: any) => candidate && Array.isArray(candidate.rows)
          );
          if (
            rawTable?.rows?.length &&
            rawTable.rows.every((row: SfdtRow) =>
              hasOnlyRevisionIds(row.rowFormat, deletedRevisionIds)
            )
          )
            return;
          if (index.tables.has(def.tableId)) {
            diag(
              index.diagnostics,
              'error',
              'duplicate-table',
              `table id "${def.tableId}" appears more than once`,
              path
            );
          } else {
            const tableIndex = block.blocks.findIndex(
              (candidate: any) => candidate && Array.isArray(candidate.rows)
            );
            index.tables.set(def.tableId, {
              tableId: def.tableId,
              markerPath: path,
              tablePath:
                tableIndex === -1 ? null : [...path, 'blocks', tableIndex],
              columnDefs: new Map(),
              rows: []
            });
            if (tableIndex === -1) {
              diag(
                index.diagnostics,
                'error',
                'empty-table-marker',
                `table marker "${def.tableId}" does not contain a table`,
                path
              );
            }
            innerCtx = { tableId: def.tableId };
          }
        }
        walkBlocks(block.blocks, [...path, 'blocks'], innerCtx, rowPath);
      } else if (Array.isArray(block.rows)) {
        block.rows.forEach((row: SfdtRow, r: number) => {
          if (hasOnlyRevisionIds(row.rowFormat, deletedRevisionIds)) return;
          const currentRowPath = [...path, 'rows', r];
          (row.cells || []).forEach((cell, c) => {
            walkBlocks(
              cell.blocks,
              [...currentRowPath, 'cells', c, 'blocks'],
              tableCtx,
              currentRowPath
            );
          });
        });
      } else if (Array.isArray(block.inlines)) {
        walkInlines(block.inlines, [...path, 'inlines'], tableCtx, rowPath);
      }
    });
  }

  (sfdt.sections || []).forEach((section, s) => {
    walkBlocks(section.blocks, ['sections', s, 'blocks'], null);
    const headersFooters = section.headersFooters || {};
    for (const key of Object.keys(headersFooters)) {
      const headerFooter = headersFooters[key];
      if (headerFooter && Array.isArray(headerFooter.blocks)) {
        walkBlocks(
          headerFooter.blocks,
          ['sections', s, 'headersFooters', key, 'blocks'],
          null
        );
      }
    }
  });

  // Rows in document order.
  for (const table of index.tables.values()) {
    table.rows.sort((a, b) => {
      const indexA = a.path ? Number(a.path[a.path.length - 1]) : 0;
      const indexB = b.path ? Number(b.path[b.path.length - 1]) : 0;
      return indexA - indexB;
    });
  }

  // Consistency: the same doc-level name must not mix kinds or types.
  const named = [...index.fields, ...index.formulas];
  for (const [name, occurrences] of named) {
    const signature = (occurrence: Occurrence) =>
      JSON.stringify({
        k: occurrence.def.kind,
        t: occurrence.def.fieldType,
        e:
          occurrence.def.kind === 'formula'
            ? occurrence.def.expression
            : undefined
      });
    const first = signature(occurrences[0]);
    for (const occurrence of occurrences.slice(1)) {
      if (signature(occurrence) !== first) {
        diag(
          index.diagnostics,
          'error',
          'conflicting-definition',
          `occurrences of "${name}" disagree on kind/type/expression`,
          occurrence.path
        );
      }
    }
  }
  return index;
}

/* ---------------- reading ---------------- */

export function readTaggedValue(
  sfdt: SfdtDocument,
  name: string,
  index: BindingIndex = scanBindings(sfdt)
): string | undefined {
  const occurrences = index.fields.get(name) || index.formulas.get(name);
  if (!occurrences || !occurrences.length) return undefined;
  return parseDisplay(occurrences[0].def.fieldType, occurrences[0].text);
}

export function readLineItems(
  sfdt: SfdtDocument,
  tableId: string,
  index: BindingIndex = scanBindings(sfdt)
): LineItem[] {
  const table = index.tables.get(tableId);
  if (!table) return [];
  return table.rows.map((row) => {
    const values: Record<string, CellValue> = {};
    for (const [column, occurrence] of row.bindings) {
      let canonical: string | null = null;
      let error: string | null = null;
      try {
        canonical = parseDisplay(occurrence.def.fieldType, occurrence.text);
      } catch (thrown) {
        if (isValueError(thrown)) error = thrown.message;
        else throw thrown;
      }
      values[column] = {
        text: occurrence.text,
        canonical,
        error,
        kind: occurrence.def.kind
      };
    }
    return { rowId: row.rowId, values };
  });
}

/* ---------------- writing ---------------- */

/**
 * Replace a content control's displayed text with one run, keeping the first
 * run's characterFormat so styling survives the rewrite.
 */
function withCcText(node: SfdtInline, text: string): SfdtInline {
  const first = (node.inlines || []).find(
    (inline) => inline && typeof inline.text === 'string'
  );
  const run: SfdtInline = { text: String(text) };
  if (first && first.characterFormat)
    run.characterFormat = first.characterFormat;
  return { ...node, inlines: [run] };
}

export function setOccurrenceText(
  sfdt: SfdtDocument,
  occurrence: Occurrence,
  text: string
): SfdtDocument {
  // Identity-preserving when nothing changes: callers rely on `next === prev`
  // to skip touching the editor at all.
  if (occurrence.text === String(text)) return sfdt;
  return setAt(
    sfdt,
    occurrence.path,
    withCcText(getAt(sfdt, occurrence.path), text)
  );
}

/** Set a document-level field's canonical value on every occurrence. */
export function setTaggedValue(
  sfdt: SfdtDocument,
  name: string,
  canonicalValue: string,
  index: BindingIndex = scanBindings(sfdt)
): SfdtDocument {
  const occurrences = index.fields.get(name);
  if (!occurrences || !occurrences.length)
    throw new Error(`no field named ${JSON.stringify(name)}`);
  let next = sfdt;
  for (const occurrence of occurrences) {
    next = setOccurrenceText(
      next,
      occurrence,
      renderDisplay(occurrence.def.fieldType, canonicalValue)
    );
  }
  return next;
}

/** Engine-computed output for one formula/field occurrence. */
export function setCalculatedValue(
  sfdt: SfdtDocument,
  occurrence: Occurrence,
  canonicalValue: string
): SfdtDocument {
  return setOccurrenceText(
    sfdt,
    occurrence,
    renderDisplay(occurrence.def.fieldType, canonicalValue)
  );
}

/* ---------------- row identity ---------------- */

const ID_RANDOM_RANGE = 1679616; // 36^4, spelled out to avoid `**`

/**
 * Row ids are minted per generator, not from a module-global counter, so a
 * second document (or a test) cannot influence another's identity sequence.
 */
export function createRowIdGenerator(
  random: () => number = Math.random
): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `r-${counter.toString(36)}-${Math.floor(
      random() * ID_RANDOM_RANGE
    ).toString(36)}`;
  };
}

/** The default generator, used when a caller does not supply one. */
export const freshRowId = createRowIdGenerator();

/* ---------------- row operations ---------------- */

function rewriteRowClone(node: any, newRowId: string): void {
  if (Array.isArray(node)) {
    node.forEach((entry) => rewriteRowClone(entry, newRowId));
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (node.contentControlProperties) {
    let def: Definition | null = null;
    try {
      def = parseTag(String(node.contentControlProperties.tag || ''));
    } catch {
      def = null;
    }
    if (
      def &&
      (def.kind === 'field' || def.kind === 'formula') &&
      def.options.row
    ) {
      def.options.row = newRowId;
      node.contentControlProperties = {
        ...node.contentControlProperties,
        tag: formatTag(def)
      };
      if (def.kind === 'field') {
        const rendered = renderDisplay(def.fieldType, defaultValue(def));
        const first = (node.inlines || []).find(
          (inline: SfdtInline) => inline && typeof inline.text === 'string'
        );
        const run: SfdtInline = { text: rendered };
        if (first && first.characterFormat)
          run.characterFormat = first.characterFormat;
        node.inlines = [run];
      }
      return; // Do not descend into this content control again.
    }
  }
  for (const key of Object.keys(node)) rewriteRowClone(node[key], newRowId);
}

/**
 * Clone a data row's layout/formatting with fresh identity and default values.
 * Formula cells keep their (stale) text; the engine recomputes them in the same
 * transaction.
 */
export function addLineItem(
  sfdt: SfdtDocument,
  tableId: string,
  afterRowId: string | null = null,
  index: BindingIndex = scanBindings(sfdt),
  rowId: string = freshRowId()
): { sfdt: SfdtDocument; rowId: string } {
  const table = index.tables.get(tableId);
  if (!table || !table.rows.length)
    throw new Error(
      `table ${JSON.stringify(tableId)} has no data rows to clone`
    );
  const prototype = afterRowId
    ? table.rows.find((row) => row.rowId === afterRowId)
    : table.rows[table.rows.length - 1];
  if (!prototype || !prototype.path)
    throw new Error(
      `row ${JSON.stringify(afterRowId)} not found in table ${JSON.stringify(
        tableId
      )}`
    );
  const clone = deepClone(getAt(sfdt, prototype.path));
  rewriteRowClone(clone, rowId);
  const rowsPath = prototype.path.slice(0, -1);
  const rows = getAt(sfdt, rowsPath) as SfdtRow[];
  const at = Number(prototype.path[prototype.path.length - 1]) + 1;
  const nextRows = [...rows.slice(0, at), clone, ...rows.slice(at)];
  return { sfdt: setAt(sfdt, rowsPath, nextRows), rowId };
}

/**
 * Remove a data row. Rejects if the row hosts a non-deletable document-level
 * binding (a doc-scoped formula parked in that row).
 */
export function removeLineItem(
  sfdt: SfdtDocument,
  tableId: string,
  rowId: string,
  index: BindingIndex = scanBindings(sfdt)
): SfdtDocument {
  const table = index.tables.get(tableId);
  const row = table && table.rows.find((entry) => entry.rowId === rowId);
  if (!row || !row.path)
    throw new Error(
      `row ${JSON.stringify(rowId)} not found in table ${JSON.stringify(
        tableId
      )}`
    );
  for (const occurrence of index.occurrences) {
    if (occurrence.tableId) continue; // Row-scoped bindings die with their row.
    // Compare paths element-wise. The POC compared JSON prefixes, which made
    // row 1 look like an ancestor of row 12 and blocked unrelated deletes.
    if (
      !occurrence.def.isDeletable &&
      isPathPrefix(row.path, occurrence.path)
    ) {
      throw new Error(
        `row ${rowId} contains non-deletable binding "${occurrence.name}"`
      );
    }
  }
  const rowsPath = row.path.slice(0, -1);
  const rows = getAt(sfdt, rowsPath) as SfdtRow[];
  const at = Number(row.path[row.path.length - 1]);
  return setAt(sfdt, rowsPath, [...rows.slice(0, at), ...rows.slice(at + 1)]);
}

/* ---------------- native-row adoption ---------------- */

// The engine's answer to rows inserted with the editor's own table tools: a data
// row that carries no bindings at all is "adopted" by inferring each column's
// binding from the last bound data row above it (the template). Field columns
// keep whatever the user already typed (normalized when it parses); formula
// columns get the template's formula with fresh row identity and a pending
// placeholder the engine computes in the same transaction. Cells under unbound
// columns keep the user's content.

function cellPlainText(cell: SfdtCell): string {
  let out = '';
  for (const block of cell.blocks || []) {
    for (const inline of block.inlines || []) {
      if (typeof inline.text === 'string' && !inline.contentControlProperties)
        out += inline.text;
    }
  }
  return out;
}

interface CellBinding {
  b: number;
  i: number;
  def: BoundDefinition;
}

/** First row-scoped binding content control in a cell. */
function findCellBinding(cell: SfdtCell): CellBinding | null {
  const blocks = cell.blocks || [];
  for (let b = 0; b < blocks.length; b++) {
    const inlines = blocks[b].inlines || [];
    for (let i = 0; i < inlines.length; i++) {
      const inline = inlines[i];
      if (!inline || !inline.contentControlProperties) continue;
      let def: Definition | null = null;
      try {
        def = parseTag(String(inline.contentControlProperties.tag || ''));
      } catch {
        continue;
      }
      if (
        def &&
        (def.kind === 'field' || def.kind === 'formula') &&
        def.options.row
      ) {
        return { b, i, def };
      }
    }
  }
  return null;
}

export interface AdoptionResult {
  sfdt: SfdtDocument;
  adopted: string[];
  skipped: Array<{ rowIndex: number; reason: string }>;
}

/**
 * Indexes of rows that look like the user's own additions: not a header, and
 * carrying no content control. Used only to report rows that could not be
 * adopted for want of a template.
 */
function countAdoptableRows(sfdt: SfdtDocument, tablePath: SfdtPath): number[] {
  const tableNode = getAt(sfdt, tablePath) as { rows?: SfdtRow[] } | undefined;
  const rows = (tableNode && tableNode.rows) || [];
  const out: number[] = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row || (row.rowFormat && row.rowFormat.isHeader)) continue;
    if (!(row.cells || []).length) continue;
    if (JSON.stringify(row).includes('contentControlProperties')) continue;
    out.push(r);
  }
  return out;
}

export function adoptUnboundRows(
  sfdt: SfdtDocument,
  tableId: string,
  index: BindingIndex = scanBindings(sfdt),
  rowIdGen: () => string = freshRowId,
  /**
   * Row shape from an earlier reconcile, used when the user has deleted every
   * bound row - the document then holds no copy of it at all.
   */
  fallbackTemplate?: SfdtRow
): AdoptionResult {
  const table = index.tables.get(tableId);
  if (!table || !table.tablePath) return { sfdt, adopted: [], skipped: [] };
  const lastBoundRow = table.rows.length
    ? table.rows[table.rows.length - 1]
    : undefined;
  const templateRow =
    lastBoundRow && lastBoundRow.path
      ? (getAt(sfdt, lastBoundRow.path) as SfdtRow)
      : fallbackTemplate;
  if (!templateRow) {
    // Nothing to copy from. Report it rather than leaving rows plain in silence.
    const unbound = countAdoptableRows(sfdt, table.tablePath);
    return {
      sfdt,
      adopted: [],
      skipped: unbound.map((rowIndex) => ({
        rowIndex,
        reason: 'the table has no bound row to copy, and none was remembered'
      }))
    };
  }
  const tableNode = getAt(sfdt, table.tablePath) as { rows?: SfdtRow[] };
  let next = sfdt;
  const adopted: string[] = [];
  const skipped: Array<{ rowIndex: number; reason: string }> = [];

  // Adoption REPLACES a row with a clone of the bound template row, so it has to
  // be certain the row is one the user added. The dangerous case is a totals row
  // that has lost its content control - a .docx round trip, or a selection that
  // swallowed a control boundary, can do that - because it then looks like a new
  // row and gets silently overwritten with a fabricated line item. That is the
  // "duplicate rows" report.
  //
  // What separates the two is CONTENT, not position. A row the user just inserted
  // is empty where the engine's own output would go; a totals row is not, because
  // its computed value is still sitting there as plain text. So the guard below
  // reads the row rather than its index.
  //
  // Position deliberately is NOT used. Bounding the scan to the data block also
  // excluded a row inserted above the first bound row and a row appended below
  // the totals, both of which are ordinary ways to add a line item, and it broke
  // inserting rows entirely.
  const allRows = tableNode.rows || [];
  const templateCells = templateRow.cells || [];

  for (let r = 0; r < allRows.length; r++) {
    const row = allRows[r];
    if (!row) continue;
    if (row.rowFormat && row.rowFormat.isHeader) continue;
    // Any content control (bound row, intact totals row, foreign control) is not
    // ours to touch.
    if (JSON.stringify(row).includes('contentControlProperties')) continue;
    const cells = row.cells || [];
    if (!cells.length) continue;
    if (cells.length !== templateCells.length) {
      skipped.push({
        rowIndex: r,
        reason: `has ${cells.length} cells, template has ${templateCells.length}`
      });
      continue;
    }
    // A formula column holds engine output, never anything the user typed. Text
    // sitting there means this is a totals row or a damaged one, not a new line
    // item - adopting would overwrite it with a pending placeholder.
    const occupiedFormula = templateCells.findIndex((templateCell, c) => {
      const binding = findCellBinding(templateCell);
      return (
        !!binding &&
        binding.def.kind === 'formula' &&
        cellPlainText(cells[c]).trim() !== ''
      );
    });
    if (occupiedFormula !== -1) {
      skipped.push({
        rowIndex: r,
        reason: `cell ${occupiedFormula} holds text where the template has a formula`
      });
      continue;
    }

    const rowId = rowIdGen();
    const newRow = deepClone(templateRow);
    (newRow.cells || []).forEach((cell, c) => {
      const binding = findCellBinding(cell);
      if (!binding) {
        // Unbound column: keep the user's own cell.
        (newRow.cells as SfdtCell[])[c] = deepClone(cells[c]);
        return;
      }
      const controls = (cell.blocks as any[])[binding.b].inlines;
      const control = controls[binding.i];
      const def = binding.def;
      def.options.row = rowId;
      // `value` describes the row it was authored on; a new row starts from
      // `default` instead, so carrying it over would clone stale data.
      delete def.options.value;
      control.contentControlProperties = {
        ...control.contentControlProperties,
        tag: formatTag(def)
      };
      const first = (control.inlines || []).find(
        (inline: SfdtInline) => inline && typeof inline.text === 'string'
      );
      const run: Partial<SfdtInline> =
        first && first.characterFormat
          ? { characterFormat: first.characterFormat }
          : {};
      if (def.kind === 'field') {
        const typed = cellPlainText(cells[c]).trim();
        let text: string;
        if (typed === '') {
          text = renderDisplay(def.fieldType, defaultValue(def));
        } else {
          try {
            text = renderDisplay(
              def.fieldType,
              parseDisplay(def.fieldType, typed)
            );
          } catch (thrown) {
            if (!isValueError(thrown)) throw thrown;
            // Invalid: keep it visible and let the engine diagnose it.
            text = typed;
          }
        }
        control.inlines = [{ ...run, text }];
      } else {
        // Pending; the engine computes it in this same transaction.
        control.inlines = [{ ...run, text: '…' }];
      }
    });
    next = setAt(next, [...(table.tablePath as SfdtPath), 'rows', r], newRow);
    adopted.push(rowId);
  }

  return { sfdt: next, adopted, skipped };
}

/* ---------------- validation ---------------- */

export function validateSfdt(sfdt: SfdtDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (isOptimizedSfdt(sfdt)) {
    return scanBindings(sfdt).diagnostics;
  }
  if (!sfdt || typeof sfdt !== 'object' || !Array.isArray(sfdt.sections)) {
    diagnostics.push({
      severity: 'error',
      code: 'malformed-sfdt',
      message: 'document has no sections array',
      path: []
    });
    return diagnostics;
  }
  const index = scanBindings(sfdt);
  diagnostics.push(...index.diagnostics);
  for (const occurrence of index.occurrences) {
    if (occurrence.def.kind === 'field') {
      try {
        parseDisplay(occurrence.def.fieldType, occurrence.text);
      } catch (thrown) {
        if (!isValueError(thrown)) throw thrown;
        diagnostics.push({
          severity: 'error',
          code: 'invalid-input',
          message: `"${occurrence.name}" (${
            occurrence.tableId
              ? `table ${occurrence.tableId}, row ${occurrence.rowId}`
              : 'document'
          }): ${thrown.message}`,
          path: occurrence.path
        });
      }
    }
  }
  return diagnostics;
}
