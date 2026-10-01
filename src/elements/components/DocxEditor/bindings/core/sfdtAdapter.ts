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
  FieldDefinition,
  FieldType,
  formatTag,
  FormulaDefinition,
  isTagError,
  parseTag,
  TagOptions
} from './tagDsl';
import {
  Ast,
  bareCellRef,
  collectPositional,
  collectRefs,
  isFormulaError,
  parseExpression
} from './formula';
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
  SfdtBlock,
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

/** Every formula occurrence, including row-scoped formulas stored by tables. */
export function formulaOccurrences(
  index: BindingIndex,
  name?: string
): Occurrence[] {
  return index.occurrences.filter(
    (occurrence) =>
      occurrence.def.kind === 'formula' &&
      (name === undefined || occurrence.name === name)
  );
}

/** Logical formula identity, independent of where scanBindings stores it. */
export function formulaScopeKey(occurrence: Occurrence): string {
  if (occurrence.def.isGlobal) return `global:${occurrence.name}`;
  if (occurrence.tableId && occurrence.rowId)
    return `row:${occurrence.tableId}:${occurrence.rowId}:${occurrence.name}`;
  return `document:${occurrence.name}`;
}

export type ColumnExpressionKind = 'range' | 'table-column' | null;

/** Does this node BY ITSELF yield a whole column - a bare range or aggregate? */
/** Facts about a bare reference; each caller applies its own precedence. */
interface RefFacts {
  /** Text before the last '.', else null. */
  dottedPrefix: string | null;
  /** Names a document-level field or formula. */
  isDocName: boolean;
  /** Shaped like a positional cell (B3). */
  isCellShaped: boolean;
}
function refFacts(ref: string, index: BindingIndex): RefFacts {
  const dot = ref.lastIndexOf('.');
  return {
    dottedPrefix: dot === -1 ? null : ref.slice(0, dot),
    isDocName: index.fields.has(ref) || index.formulas.has(ref),
    isCellShaped: bareCellRef(ref) !== null
  };
}

function nodeColumnKind(ast: Ast, index: BindingIndex): ColumnExpressionKind {
  if ('range' in ast) return 'range';
  if (!('ref' in ast)) return null; // cell, literal, or a call (a scalar)
  const facts = refFacts(ast.ref, index);
  if (facts.dottedPrefix === null || facts.isDocName) return null;
  return index.tables.has(facts.dottedPrefix) ? 'table-column' : null;
}

/**
 * The first place the expression uses a whole column where a value is required -
 * as the whole expression, or as an argument to anything but sum() - or null if
 * it can yield a value. `sum(costs.amount)` is fine; a bare `costs.amount`,
 * `mul(costs.amount, 2)`, or a bare range is not. Catches the case that would
 * otherwise pass create_binding and then fail every reconcile.
 */
export function expressionResolvesToColumn(
  index: BindingIndex,
  expression: string
): ColumnExpressionKind {
  let ast: Ast;
  try {
    ast = parseExpression(expression);
  } catch (thrown) {
    if (!isFormulaError(thrown)) throw thrown;
    return null;
  }
  const walk = (node: Ast): ColumnExpressionKind => {
    if (!('op' in node)) return nodeColumnKind(node, index);
    for (const arg of node.args) {
      const argColumn = nodeColumnKind(arg, index);
      if (argColumn) {
        if (node.op !== 'sum') return argColumn; // mul/sub can't take a column
      } else {
        const nested = walk(arg); // a column misused deeper in, e.g. mul inside
        if (nested) return nested;
      }
    }
    return null; // a call yields a value
  };
  return walk(ast);
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
export function isPathPrefix(prefix: SfdtPath, path: SfdtPath): boolean {
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

function hasRevisionId(node: any, ids: Set<string>): boolean {
  return (
    Array.isArray(node?.revisionIds) &&
    node.revisionIds.some((id: unknown) => ids.has(String(id)))
  );
}

function ccText(node: any, deletedRevisionIds: Set<string>): string {
  let out = '';
  const inlines =
    node.inlines ||
    (node.blocks || []).flatMap((block: any) => block?.inlines || []);
  for (const inline of inlines) {
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
    ccNode: any,
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
      if (!inline) return;
      const path = [...basePath, i];
      // A shape/text box is an inline carrying a textFrame; its content is a
      // block list scoped like the body (doc-level), not the table row it sits
      // in, so recurse with a fresh context.
      walkTextFrames(inline, path);
      if (!inline.contentControlProperties) return;
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

  // A text box's editable content lives at node.textFrame.blocks (an inline
  // shape) and, defensively, at block.floatingElements[k].textFrame.blocks
  // (some SFDT serializations anchor a floating shape on the paragraph). Both
  // are doc-level block lists.
  function walkTextFrames(node: any, basePath: SfdtPath): void {
    const frame = node && node.textFrame;
    if (frame && Array.isArray(frame.blocks)) {
      walkBlocks(
        frame.blocks,
        [...basePath, 'textFrame', 'blocks'],
        null,
        null
      );
    }
    (node && Array.isArray(node.floatingElements)
      ? node.floatingElements
      : []
    ).forEach((shape: any, k: number) => {
      if (shape && shape.textFrame && Array.isArray(shape.textFrame.blocks)) {
        walkBlocks(
          shape.textFrame.blocks,
          [...basePath, 'floatingElements', k, 'textFrame', 'blocks'],
          null,
          null
        );
      }
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
              hasRevisionId(row.rowFormat, deletedRevisionIds)
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
          if (hasRevisionId(row.rowFormat, deletedRevisionIds)) return;
          const currentRowPath = [...path, 'rows', r];
          (row.cells || []).forEach((cell, c) => {
            if ((cell as any).contentControlProperties) {
              const cellPath = [...currentRowPath, 'cells', c];
              const rawTag = String(
                (cell as any).contentControlProperties.tag || ''
              );
              const def = parseTagOrDiagnose(rawTag, cellPath);
              if (def && (def.kind === 'field' || def.kind === 'formula'))
                record(def, rawTag, cellPath, cell, tableCtx, currentRowPath);
            }
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
      // A floating text box may be anchored on the paragraph rather than sitting
      // in its inlines; walkTextFrames covers block.floatingElements too.
      if (block.floatingElements) walkTextFrames(block, path);
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
        g: occurrence.def.isGlobal,
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
          `occurrences of "${name}" disagree on kind/type/global scope/expression`,
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
function withCcText(node: any, text: string): any {
  // Read and write the same representation. A cell-level content control can
  // carry both the cell's ordinary paragraph blocks and its own control
  // inlines. `ccText` prefers the latter, so writing the blocks would leave the
  // binding's canonical value unchanged even though visible cell text moved.
  // Syncfusion produces this shape when a row cloned by an earlier operation
  // becomes the prototype for a later insert.
  if (Array.isArray(node.inlines)) {
    const first = node.inlines.find(
      (inline: SfdtInline) => inline && typeof inline.text === 'string'
    );
    const run: SfdtInline = { text: String(text) };
    if (first?.characterFormat) run.characterFormat = first.characterFormat;
    return { ...node, inlines: [run] };
  }
  if (Array.isArray(node.blocks) && node.blocks.length) {
    const blocks = [...node.blocks];
    const paragraph = blocks[0] || {};
    const first = (paragraph.inlines || []).find(
      (inline: SfdtInline) => inline && typeof inline.text === 'string'
    );
    const run: SfdtInline = { text: String(text) };
    if (first?.characterFormat) run.characterFormat = first.characterFormat;
    blocks[0] = { ...paragraph, inlines: [run] };
    return { ...node, blocks };
  }
  return { ...node, inlines: [{ text: String(text) }] };
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

// Cloning never changes a binding's KIND: a field stays a field (reset to its
// default), a formula (row-local or mirror) stays the same formula.
export function rewriteRowClone(node: any, newRowId: string): void {
  if (Array.isArray(node)) {
    node.forEach((entry) => rewriteRowClone(entry, newRowId));
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (node.contentControlProperties) {
    const def = rowScopedDef(node.contentControlProperties.tag);
    if (def) {
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
  rowId: string = freshRowId(),
  /**
   * Where the new row goes, as an index into the table's rows. Defaults to
   * right after the prototype. The prototype is only the row to CLONE: a line
   * item can be placed anywhere - above the first item, after the totals row -
   * and it still copies a bound data row.
   */
  insertAt?: number
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
  const at =
    insertAt !== undefined
      ? Math.max(0, Math.min(rows.length, insertAt))
      : Number(prototype.path[prototype.path.length - 1]) + 1;
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

/** Visible text of a node, descending into control wrappers; `skip` drops inlines. */
export function inlineText(node: any, skip?: (inline: any) => boolean): string {
  if (!node || typeof node !== 'object') return '';
  let out = '';
  const inlines =
    node.inlines || (node.blocks || []).flatMap((b: any) => b?.inlines || []);
  for (const inline of inlines || []) {
    if (skip?.(inline)) continue;
    if (typeof inline?.text === 'string' && !inline.contentControlProperties)
      out += inline.text;
    else if (inline && typeof inline === 'object')
      out += inlineText(inline, skip);
  }
  return out;
}

// Not inlineText: adoption must read only user-typed text, never control content.
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

/** A row-scoped field/formula parsed from a control tag, else null. */
export function rowScopedDef(tag: unknown): BoundDefinition | null {
  let def: Definition | null = null;
  try {
    def = parseTag(String(tag || ''));
  } catch {
    def = null;
  }
  return def &&
    (def.kind === 'field' || def.kind === 'formula') &&
    def.options.row
    ? def
    : null;
}

interface CellBinding {
  /** Path from the cell to the control node (descends through foreign wrappers). */
  path: SfdtPath;
  def: BoundDefinition;
}

/** Display text for an adopted field cell: typed input normalized, else default. */
function adoptedFieldText(def: FieldDefinition, typedRaw: string): string {
  const typed = typedRaw.trim();
  if (typed === '') return renderDisplay(def.fieldType, defaultValue(def));
  try {
    return renderDisplay(def.fieldType, parseDisplay(def.fieldType, typed));
  } catch (thrown) {
    if (!isValueError(thrown)) throw thrown;
    // Invalid: keep it visible and let the engine diagnose it.
    return typed;
  }
}

/**
 * First row-scoped binding control in a cell, with the path to it. Descends
 * through foreign/non-row content controls like the scanner, so a binding
 * nested inside a foreign wrapper is found (and can be stamped through the path).
 */
function findCellBinding(cell: SfdtCell): CellBinding | null {
  let found: CellBinding | null = null;
  const visit = (node: any, path: SfdtPath): void => {
    if (found || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((entry, idx) => visit(entry, [...path, idx]));
      return;
    }
    if (node.contentControlProperties) {
      const def = rowScopedDef(node.contentControlProperties.tag);
      if (def) {
        found = { path, def };
        return;
      }
      // A foreign or non-row control: descend to find a binding wrapped inside.
    }
    for (const key of Object.keys(node)) visit(node[key], [...path, key]);
  };
  visit(cell, []);
  return found;
}

export interface AdoptedRowMutation {
  kind: 'adopt-row';
  tableId: string;
  tablePath: SfdtPath;
  rowIndex: number;
  rowId: string;
  row: SfdtRow;
}

export interface AdoptionResult {
  sfdt: SfdtDocument;
  adopted: string[];
  mutations: AdoptedRowMutation[];
  skipped: Array<{ rowIndex: number; reason: string }>;
}

export interface InsertRowMutation extends Omit<AdoptedRowMutation, 'kind'> {
  kind: 'insert-row';
  afterRowId: string | null;
}
export interface DeleteRowMutation {
  kind: 'delete-row';
  tableId: string;
  rowId: string;
  tag: string;
}
export interface InsertTableMutation {
  kind: 'insert-table';
  afterTag: string;
  blocks: SfdtBlock[];
}
export interface DeleteTableMutation {
  kind: 'delete-table';
  tag: string;
}
interface ReplaceTableMutation {
  kind: 'replace-table';
  tag: string;
  blocks: SfdtBlock[];
}
/**
 * A control's identity rewritten in place, tag for tag.
 *
 * The one structural mutation that changes no content. A formula's EXPRESSION
 * lives in its tag, so rewriting an expression in an existing control is a
 * retag - and SyncFusion revisions content, never tags, which is why the change
 * set that issues one also binds an inverse to its revision group.
 */
interface RetagControlMutation {
  kind: 'retag-control';
  fromTag: string;
  toTag: string;
}
export type NativeStructuralMutation =
  | AdoptedRowMutation
  | InsertRowMutation
  | DeleteRowMutation
  | InsertTableMutation
  | DeleteTableMutation
  | ReplaceTableMutation
  | RetagControlMutation;

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

// A MIRROR reads only values outside its own row (expr=A, sum(beta)). A
// row-local formula reads an own-row column (mul(quantity,unit_cost)), any
// positional ref (sum(B2:end) or a bare unbound cell like B3), or its own
// table's column (sum(costs.amount) - a self-total); those are structural and
// block adoption, while a typed mirror column becomes a field.
function isMirrorFormula(
  def: FormulaDefinition,
  ownColumnNames: ReadonlySet<string>,
  ownTableId: string,
  index: BindingIndex
): boolean {
  let ast;
  try {
    ast = parseExpression(def.expression);
  } catch (thrown) {
    if (!isFormulaError(thrown)) throw thrown;
    return false; // Unparseable: treat as structural, leave it be.
  }
  const positional = collectPositional(ast);
  if (positional.cells.length || positional.ranges.length) return false;
  return !collectRefs(ast).some((ref) => {
    if (ownColumnNames.has(ref)) return true; // own-row column
    const facts = refFacts(ref, index);
    if (facts.dottedPrefix !== null) return facts.dottedPrefix === ownTableId; // own-table aggregate
    // A doc field/formula name is an external mirror; a cell-shaped name that
    // binds nothing is a positional cell, which is structural.
    if (facts.isDocName) return false;
    return facts.isCellShaped;
  });
}

/** The editable field a new row gets where a mirror column was typed into. */
function mirrorColumnField(
  def: FormulaDefinition,
  rowId: string
): FieldDefinition {
  const options: TagOptions = { row: rowId };
  if (def.options.default !== undefined) options.default = def.options.default;
  if (def.options.label !== undefined) options.label = def.options.label;
  return {
    version: def.version,
    kind: 'field',
    name: def.name,
    fieldType: def.fieldType,
    isEditable: true,
    isDeletable: true,
    isGlobal: false,
    options
  };
}

/**
 * Every row-scoped binding name in a template row (its column names). Descends
 * through foreign wrappers like the scanner does, so a binding nested in a
 * foreign content control still counts - otherwise a row-local formula whose
 * input is wrapped would be misread as a mirror.
 */
function templateColumnNames(templateCells: SfdtCell[]): Set<string> {
  const names = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = node as { contentControlProperties?: { tag?: unknown } };
    if (record.contentControlProperties) {
      const def = rowScopedDef(record.contentControlProperties.tag);
      if (def) {
        names.add(def.name);
        return; // A row binding holds a value, not further bindings.
      }
    }
    for (const value of Object.values(record)) visit(value);
  };
  templateCells.forEach(visit);
  return names;
}

/** The row-scoped id a row's bindings carry, or null if it has none. */
function rowBindingId(row: SfdtRow): string | null {
  for (const cell of row.cells || []) {
    const binding = findCellBinding(cell);
    if (binding && binding.def.options.row) return binding.def.options.row;
  }
  return null;
}

const rowHasControls = (row: SfdtRow): boolean =>
  JSON.stringify(row).includes('contentControlProperties');

// A data row holds at least one INPUT column - a field, or a mirror. A row whose
// only bound columns are structural formulas (a totals row: sum(B2:end) or a
// self-aggregate) is not a data row and makes a poor adoption template.
function rowHasInputColumn(
  entry: TableRowEntry,
  tableId: string,
  index: BindingIndex
): boolean {
  const names = new Set(entry.bindings.keys());
  for (const occurrence of entry.bindings.values()) {
    if (occurrence.def.kind === 'field') return true;
    if (
      occurrence.def.kind === 'formula' &&
      isMirrorFormula(occurrence.def, names, tableId, index)
    )
      return true;
  }
  return false;
}

// A table with no bound row can still adopt: a formula that CONSUMES its
// columns positionally (sum(B2:end), summary!B2:B9) marks those columns as
// input. Mint a template whose consumed columns carry fresh row-scoped field
// controls typed from the consuming formula; other columns stay unbound so an
// adopted row keeps the user's own cells.
function syntheticColumnTemplate(
  sfdt: SfdtDocument,
  tableId: string,
  index: BindingIndex
): SfdtRow | undefined {
  const table = index.tables.get(tableId);
  if (!table || !table.tablePath) return undefined;
  const consumed = new Map<number, FieldType>();
  for (const occurrence of index.occurrences) {
    if (occurrence.def.kind !== 'formula') continue;
    let ast: Ast;
    try {
      ast = parseExpression(occurrence.def.expression);
    } catch (thrown) {
      if (!isFormulaError(thrown)) throw thrown;
      continue;
    }
    for (const range of collectPositional(ast).ranges) {
      const consumesThisTable =
        range.table === tableId ||
        (range.table === null &&
          isPathPrefix(table.tablePath, occurrence.path));
      if (!consumesThisTable) continue;
      for (let col = range.startCol; col <= range.endCol; col++)
        if (!consumed.has(col)) consumed.set(col, occurrence.def.fieldType);
    }
  }
  if (!consumed.size) return undefined;
  const tableNode = getAt(sfdt, table.tablePath) as { rows?: SfdtRow[] };
  const mold = (tableNode.rows || []).find(
    (row) => row && !(row.rowFormat && row.rowFormat.isHeader)
  );
  if (!mold || !mold.cells || !mold.cells.length) return undefined;
  // Span-aware: which CELL of the mold covers each consumed grid column.
  const cellOfCol = new Map<number, number>();
  let col = 0;
  mold.cells.forEach((cell, c) => {
    const span = Number(cell?.cellFormat?.columnSpan) || 1;
    for (let s = 0; s < span; s++) cellOfCol.set(col + s, c);
    col += span;
  });
  const letters = (c: number): string => {
    let out = '';
    let n = c + 1;
    while (n > 0) {
      out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  };
  const freshName = (c: number): string => {
    let name = `col${letters(c)}`;
    while (index.fields.has(name) || index.formulas.has(name))
      name = `${name}_`;
    return name;
  };
  const cells = mold.cells.map((moldCell) => ({
    ...(moldCell.cellFormat
      ? { cellFormat: deepClone(moldCell.cellFormat) }
      : {}),
    blocks: [{ inlines: [] as SfdtInline[] }]
  })) as SfdtCell[];
  for (const [consumedCol, fieldType] of consumed) {
    const c = cellOfCol.get(consumedCol);
    if (c === undefined) continue;
    const def: FieldDefinition = {
      version: 2,
      kind: 'field',
      name: freshName(consumedCol),
      fieldType,
      isEditable: true,
      isDeletable: true,
      isGlobal: false,
      options: { row: 'tpl' }
    };
    cells[c].blocks![0].inlines = [
      {
        contentControlProperties: {
          lockContentControl: true,
          lockContents: false,
          tag: formatTag(def),
          title: def.name,
          type: 'Text',
          hasPlaceHolderText: false,
          multiline: false,
          isTemporary: false,
          color: '#00000000',
          appearance: 'BoundingBox'
        },
        inlines: [{ text: '' }]
      } as unknown as SfdtInline
    ];
  }
  return { cells, rowFormat: {} } as unknown as SfdtRow;
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
  if (!table || !table.tablePath)
    return { sfdt, adopted: [], mutations: [], skipped: [] };
  // Prefer the last DATA row as the template; a row-scoped totals row is a bound
  // row too, but cloning it would give a new row a structural aggregate instead
  // of an input control. Fall back to the last bound row when none has inputs.
  const inputRows = table.rows.filter((entry) =>
    rowHasInputColumn(entry, tableId, index)
  );
  const lastBoundRow = inputRows.length
    ? inputRows[inputRows.length - 1]
    : table.rows.length
    ? table.rows[table.rows.length - 1]
    : undefined;
  const templateRow =
    lastBoundRow && lastBoundRow.path
      ? (getAt(sfdt, lastBoundRow.path) as SfdtRow)
      : fallbackTemplate ?? syntheticColumnTemplate(sfdt, tableId, index);
  if (!templateRow) {
    // Nothing to copy from. Report it rather than leaving rows plain in silence.
    const unbound = countAdoptableRows(sfdt, table.tablePath);
    return {
      sfdt,
      adopted: [],
      mutations: [],
      skipped: unbound.map((rowIndex) => ({
        rowIndex,
        reason: 'the table has no bound row to copy, and none was remembered'
      }))
    };
  }
  const tableNode = getAt(sfdt, table.tablePath) as { rows?: SfdtRow[] };
  let next = sfdt;
  const adopted: string[] = [];
  const mutations: AdoptedRowMutation[] = [];
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
  const columnNames = templateColumnNames(templateCells);

  // Classify each template column once. A mirror column accepts a typed value
  // (it becomes a field); a field column takes input as always; a row-local or
  // positional formula column is engine output and blocks adoption when a row
  // has text there.
  const mirrorColumn = templateCells.map((templateCell) => {
    const binding = findCellBinding(templateCell);
    return (
      !!binding &&
      binding.def.kind === 'formula' &&
      isMirrorFormula(binding.def, columnNames, tableId, index)
    );
  });

  // With no non-mirror bound column (the summary/mirror case), a new row's
  // mirror cell becomes an editable field on insert (row=auto style); with input
  // columns present, an empty mirror cell instead stays a mirror and propagates.
  const templateHasNonMirrorColumn = templateCells.some((templateCell, c) => {
    const binding = findCellBinding(templateCell);
    return !!binding && !mirrorColumn[c];
  });

  const firstBoundRowIndex = table.rows
    .map((entry) => Number(entry.path?.[entry.path.length - 1]))
    .filter(Number.isInteger)
    .sort((left, right) => left - right)[0];

  // Syncfusion's insert-row copies an editable control into the new row, so it
  // arrives with a row id duplicating a sibling. One occurrence of the id is the
  // real bound row; the other is the copy, re-adopted fresh. By default the
  // LATER occurrence is the copy, but an insert-above places the copy BEFORE the
  // original, so an explicit inserted-row hint overrides which one is the copy.
  const copyIndices = new Set<number>();
  const indicesById = new Map<string, number[]>();
  allRows.forEach((row, r) => {
    const id = row ? rowBindingId(row) : null;
    if (row && id !== null && rowHasControls(row))
      indicesById.set(id, [...(indicesById.get(id) || []), r]);
  });
  for (const indices of indicesById.values()) {
    if (indices.length < 2) continue;
    for (const idx of indices.slice(1)) copyIndices.add(idx);
  }

  for (let r = 0; r < allRows.length; r++) {
    const row = allRows[r];
    if (!row) continue;
    if (row.rowFormat && row.rowFormat.isHeader) continue;
    const hasControls = rowHasControls(row);
    if (hasControls && !copyIndices.has(r)) {
      // A real bound row, an intact totals row, or a foreign control - not ours
      // to touch.
      continue;
    }
    // A copied row (in copyIndices) falls through to be re-adopted fresh. Its
    // value lives inside the copied control, invisible to cellPlainText below,
    // so every cell reads as empty and the new row starts from defaults.
    const cells = row.cells || [];
    if (!cells.length) continue;
    if (cells.length !== templateCells.length) {
      skipped.push({
        rowIndex: r,
        reason: `has ${cells.length} cells, template has ${templateCells.length}`
      });
      continue;
    }
    // Text in a row-local/positional formula column means a totals, damaged, or
    // unflagged-header row: block adoption. Text in a mirror column is a typed
    // value (adopted as a field), unless it fails to parse - then it's a header.
    let blockingReason: string | null = null;
    let parsedFieldCells = 0;
    let fieldParseFailure: string | null = null;
    for (let c = 0; c < templateCells.length && !blockingReason; c++) {
      const binding = findCellBinding(templateCells[c]);
      if (!binding) continue;
      const text = cellPlainText(cells[c]).trim();
      if (text === '') continue;
      if (binding.def.kind === 'formula') {
        if (!mirrorColumn[c]) {
          blockingReason = `cell ${c} holds text where the template has a formula`;
        } else {
          try {
            parseDisplay(binding.def.fieldType, text);
          } catch (thrown) {
            if (!isValueError(thrown)) throw thrown;
            blockingReason = `cell ${c} holds text that does not parse as ${binding.def.fieldType.kind}`;
          }
        }
      } else {
        try {
          parseDisplay(binding.def.fieldType, text);
          parsedFieldCells++;
        } catch (thrown) {
          if (!isValueError(thrown)) throw thrown;
          fieldParseFailure = `cell ${c} holds text that does not parse as ${binding.def.fieldType.kind}`;
        }
      }
    }
    // A row whose every typed input cell fails to parse is a label (Shipping |
    // included): keep it plain, counted as 0 by ranges, instead of minting a
    // field that blocks save. A row where some cells parse is a data row with
    // a typo: adopt it and let validation flag the bad cell.
    if (blockingReason === null && fieldParseFailure !== null && !parsedFieldCells)
      blockingReason = fieldParseFailure;
    if (blockingReason !== null) {
      if (Number.isInteger(firstBoundRowIndex) && r < firstBoundRowIndex)
        continue;
      skipped.push({ rowIndex: r, reason: blockingReason });
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
      const control = getAt(cell, binding.path);
      const def = binding.def;
      const typedText = cellPlainText(cells[c]).trim();
      const first = (control.inlines || []).find(
        (inline: SfdtInline) => inline && typeof inline.text === 'string'
      );
      const run: Partial<SfdtInline> =
        first && first.characterFormat
          ? { characterFormat: first.characterFormat }
          : {};
      // A mirror column becomes an editable field on a new row when the user
      // typed into it, or always in a mirror-only table (immediate control);
      // otherwise an empty mirror cell stays a mirror and propagates.
      const convertMirror =
        def.kind === 'formula' &&
        mirrorColumn[c] &&
        (typedText !== '' || !templateHasNonMirrorColumn);
      if (convertMirror) {
        const fieldDef = mirrorColumnField(def as FormulaDefinition, rowId);
        control.contentControlProperties = {
          ...control.contentControlProperties,
          tag: formatTag(fieldDef),
          lockContents: false
        };
        control.inlines = [
          { ...run, text: adoptedFieldText(fieldDef, typedText) }
        ];
        return;
      }
      def.options.row = rowId;
      // `value` describes the row it was authored on; a new row starts from
      // `default` instead, so carrying it over would clone stale data.
      delete def.options.value;
      control.contentControlProperties = {
        ...control.contentControlProperties,
        tag: formatTag(def)
      };
      if (def.kind === 'field') {
        control.inlines = [{ ...run, text: adoptedFieldText(def, typedText) }];
      } else {
        // Pending; the engine computes it in this same transaction. Mirrors
        // with no typed value clone as mirrors and propagate.
        control.inlines = [{ ...run, text: '…' }];
      }
    });
    next = setAt(next, [...(table.tablePath as SfdtPath), 'rows', r], newRow);
    adopted.push(rowId);
    mutations.push({
      kind: 'adopt-row',
      tableId,
      tablePath: [...table.tablePath],
      rowIndex: r,
      rowId,
      row: deepClone(newRow)
    });
  }

  return { sfdt: next, adopted, mutations, skipped };
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
