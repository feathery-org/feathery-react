// The single frontend authority for the document read/edit vocabulary the Robin
// assistant drives over the live SyncFusion editor. The ai-services
// `getDocumentInventory` / `applyDocumentEdits` tools are client-forwarded (no
// server execute) and defer to THIS file for the actual implementation and the
// field each op consumes.
//
// Two halves:
//   1. Pure inventory/index builders over the editor's serialized SFDT JSON.
//      These are side-effect free and unit tested with fixture SFDT.
//   2. A live apply engine that resolves anchors to SyncFusion hierarchical
//      selection indices and mutates the editor, with track-changes forced on
//      around the batch and an `expect` compare-and-swap guard.
//
// Anchor scheme: an anchor IS the SyncFusion hierarchical index prefix of a
// block, with the trailing character offset omitted. A top-level paragraph is
// `"{sectionIndex};{blockIndex}"`; a table-cell paragraph is
// `"{sectionIndex};{blockIndex};{rowIndex};{cellIndex};{cellBlockIndex}"`. To
// address a character range inside the block we append `;{offset}` -> the exact
// string `documentEditor.selection.select(start, end)` consumes.

// This module is the only document-editing engine that ships in the SDK. Keep
// fixes here rather than forking a copy into a host application, so the in-form
// editor container and every assistant tool stay on one implementation.
import {
  AdvertisedDocumentOp,
  AnchoredDocumentOp,
  AnchorlessDocumentOp,
  DOCUMENT_EDITOR_CAPABILITIES,
  OpParams
} from '../capabilities/registry';
import {
  classifyNumericText,
  parseNumericCell,
  SkippedCell
} from './numericCells';
import {
  collectFormulaAggregates,
  evaluateFormula,
  FormulaEvaluationSuccess,
  FormulaReference,
  FormulaRenderSuccess,
  FormulaResolver,
  renderFormulaResult,
  ROUNDING_MODES,
  RoundingMode
} from './cellFormula';
import {
  buildNoOpWriteReport,
  describeTextChange,
  NoOpWriteReport,
  writeIsNoOp
} from './writeNoOp';

export const FULL_INVENTORY_BLOCK_LIMIT = 800;
export const SELECTION_TEXT_LIMIT = 500;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type InventoryScope =
  | 'outline'
  | 'structure'
  | 'section'
  | 'full'
  | 'table_facts'
  | 'table_column';

export interface DocFormat {
  styleName?: string;
  alignment?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontName?: string;
  fontSize?: number;
  leftIndent?: number;
  rightIndent?: number;
  firstLineIndent?: number;
  beforeSpacing?: number;
  afterSpacing?: number;
  lineSpacing?: number;
  lineSpacingType?: string;
  spaceBeforeAuto?: boolean;
  spaceAfterAuto?: boolean;
  listLevel?: number;
}

type FormatBag = Record<string, any>;

export interface OutlineSection {
  anchor: string;
  heading: string;
  level: number;
  blockCount: number;
}

export interface InventoryEntry {
  anchor: string;
  kind: string;
  text: string;
  format?: DocFormat;
}

export interface IndexBlock {
  anchor: string;
  kind: string;
  text: string;
  format?: DocFormat;
}

// A refusal that names what to do instead of what went wrong. `retry` is the
// loop breaker: 'never' means resending cannot succeed, 'after_remedy' means
// retry only after performing the named remedy, 'modified_input' means the
// input itself was wrong. Every refusal this module returns must carry one -
// a refusal without a remedy is an invitation to resend the identical call.
export interface InventoryRemedy {
  action: string;
  tool: string;
  input?: Record<string, unknown>;
}

export interface InventoryRefusal {
  error: string;
  message: string;
  remedy?: InventoryRemedy;
  retry?: 'never' | 'after_remedy' | 'modified_input';
}

// One table in the document skeleton: where it is and its shape, plus the text
// of its FIRST ROW (enough to recognise "the Location Schedule table").
//
// The field is `firstRowCells`, not `headerCells`, deliberately: row 0 being a
// header is an INTERPRETATION, and plenty of real documents put a title row, a
// merged banner or immediate data there. The engine states which row it read;
// deciding what that row means - and therefore which rows are data - is the
// model's job, from a `table_facts` read.
export interface StructureTable {
  anchor: string;
  rows: number;
  columns: number;
  firstRowCells: string[];
  firstRowCellsTruncated?: boolean;
}

// One SFDT section (the spans between section breaks), by 0-based index.
export interface StructureSectionBoundary {
  section: number;
  firstAnchor: string;
  blockCount: number;
}

// The document's skeleton: headings, tables and section boundaries, no body
// text. A navigation answer ("where is the Location Schedule") costs this
// instead of a full read.
export interface DocumentStructure {
  blockCount: number;
  headings: OutlineSection[];
  tables: StructureTable[];
  sections: StructureSectionBoundary[];
}

// The completeness contract for capped reads: a clipped list must say how
// many of how many, in data. A partial read that looks complete is how a
// 94-row table got summed from 60 rows and an anchor got guessed.
export interface InventoryTruncation {
  returned: number;
  total: number;
  message: string;
}

// One cell of a table column, as data: its row, its first paragraph's anchor
// (the writable locator) and its verbatim text. `text: null` with no anchor
// means the row has no cell at that column (short/merged row) - reported,
// never silently skipped.
export interface TableColumnCell {
  row: number;
  anchor?: string;
  text: string | null;
}

// A whole table column returned as data. `rowCount` is the table's true row
// count; `returned` and `truncated` make any capped read visibly partial.
export interface TableColumnRead {
  tableAnchor: string;
  column: number;
  columns: number;
  rowCount: number;
  returned: number;
  truncated: boolean;
  cells: TableColumnCell[];
}

// ---------------------------------------------------------------------------
// table_facts: observable facts about ONE table's layout, and nothing else.
//
// The three-way split this read exists to enforce:
//   1. the ENGINE reports FACTS - dimensions, which rows are short, which cells
//      are merged, which cells are bold, which are blank, which parse as
//      numbers, what each cell says;
//   2. the MODEL INTERPRETS - "row 0 and row 1 are stacked header rows", "this
//      bold row at 47 is a regional subtotal so exclude it", "Premium is
//      column 3", "the data is rows 2..93";
//   3. the ENGINE COMPUTES over exactly the ranges the model then names.
//
// So there is deliberately NO `headerRow`, NO `dataRows`, NO `subtotalRows` and
// no "is this a total?" arithmetic anywhere in this result. Guessing a header
// row is how a 94-row schedule gets summed from row 1 when its data starts at
// row 2; inferring a subtotal arithmetically is how a subtotal gets counted
// twice. Facts are cheap and cannot be wrong; interpretation belongs to the one
// participant that can read the document's language.
// ---------------------------------------------------------------------------

/** Per-cell text is bounded so one prose-heavy table cannot blow the turn. */
export const TABLE_FACTS_CELL_TEXT_CHARS = 200;

export interface TableCellFact {
  row: number;
  column: number;
  /** Anchor of the cell's first paragraph - the anchor a formula references. */
  anchor: string;
  /** Verbatim text (multi-paragraph cells joined with \n), possibly clipped. */
  text: string;
  /** Present only when `text` was clipped at TABLE_FACTS_CELL_TEXT_CHARS. */
  textTruncated?: true;
  /** More than one paragraph in the cell. */
  paragraphs: number;
  blank: boolean;
  /** Parses as a single number under the engine's numeric grammar. */
  numeric: boolean;
  /**
   * Numeric AND formatted as an amount - carries a unit, decimals or observed
   * thousands grouping. `$36,803` and `12.5%` are quantities; `0093` and `9999`
   * are numeric but not quantities (identifier shape).
   */
  quantity: boolean;
  /** The unit token, when numeric ('' for a bare number). */
  unit?: string;
  /** Decimal places as written, when numeric. */
  decimals?: number;
  /** Only when > 1. A horizontally merged cell. */
  columnSpan?: number;
  /** Only when > 1. A vertically merged cell. */
  rowSpan?: number;
  bold?: true;
  italic?: true;
  styleName?: string;
}

export interface TableRowFact {
  row: number;
  /** Cells physically present in this row (a short/merged row has fewer). */
  cellCount: number;
  /** Cells with any non-whitespace text. */
  filledCells: number;
  /** Every present cell is blank. */
  blankRow?: true;
  /** Every non-blank cell in the row is bold. A FACT, not "this is a header". */
  allBold?: true;
  /** Some cell in this row spans columns or rows. */
  hasMergedCells?: true;
  cells: TableCellFact[];
}

export interface TableColumnFact {
  column: number;
  /** Rows that actually have a cell at this column. */
  presentCells: number;
  filledCells: number;
  numericCells: number;
  quantityCells: number;
  /** Distinct unit tokens observed, in first-seen order. */
  units: string[];
  /** Distinct decimal widths observed, ascending. */
  decimals: number[];
}

export interface TableFacts {
  tableAnchor: string;
  rowCount: number;
  /** The widest row's cell count; shorter rows exist and are listed as such. */
  columnCount: number;
  /** True when every row has exactly `columnCount` cells. */
  uniformRows: boolean;
  /** Every cell whose columnSpan/rowSpan exceeds 1, named. */
  mergedCells: Array<{
    row: number;
    column: number;
    anchor: string;
    columnSpan: number;
    rowSpan: number;
  }>;
  rows: TableRowFact[];
  columns: TableColumnFact[];
  /**
   * Always false. A facts read has no maxEntries and is never capped: layout
   * facts are small even for a table whose contents are not, and a partial
   * layout is exactly what makes a model guess a range.
   */
  truncated: false;
}

export type InventoryResult =
  | { sections: OutlineSection[]; truncation?: InventoryTruncation }
  | { structure: DocumentStructure; truncation?: InventoryTruncation }
  | { inventory: InventoryEntry[]; truncation?: InventoryTruncation }
  | { column: TableColumnRead; truncation?: InventoryTruncation }
  | { table: TableFacts }
  | InventoryRefusal;

export interface EditOp {
  op: string;
  anchor?: string;
  expect?: string;
  [field: string]: any;
}

export type MutationGuardCoverage = {
  op: string;
  cas: 'block_expect' | 'selection_content' | 'find_content' | 'not_applicable';
  numberProvenance:
    | 'model_authored_text_checked'
    | 'engine_computed'
    | 'not_applicable';
};

// Test-only observation point for the registry-exhaustive contract suite. The
// production path never installs one; keeping the hook at the common boundary
// lets the suite prove every advertised op actually crosses it.
let mutationGuardObserver:
  | ((coverage: MutationGuardCoverage) => void)
  | undefined;
export const _setMutationGuardObserver = (
  observer?: (coverage: MutationGuardCoverage) => void
): void => {
  mutationGuardObserver = observer;
};

const MODEL_AUTHORED_CELL_TEXT_OPS = new Set([
  'replace_text',
  'replace_selection',
  'replace_all',
  'insert_text',
  'set_cell_text'
]);
const ENGINE_COMPUTED_CELL_TEXT_OPS = new Set([
  'set_cell_formula',
  'set_column_formula'
]);

function observeMutationGuardBoundary(
  op: EditOp,
  cas: MutationGuardCoverage['cas']
): void {
  mutationGuardObserver?.({
    op: op.op,
    cas,
    numberProvenance: MODEL_AUTHORED_CELL_TEXT_OPS.has(op.op)
      ? 'model_authored_text_checked'
      : ENGINE_COMPUTED_CELL_TEXT_OPS.has(op.op)
      ? 'engine_computed'
      : 'not_applicable'
  });
}

/**
 * The auditable record of one engine-evaluated formula write. Same trust
 * design as the retired set_cell_computed report: the receipt is the one line to relay, the
 * signal is coverage plus NAMED skips plus the resolved references, and the
 * rounding - if any - is stated, never inferred.
 */
/**
 * What one reference resolved to, in resolved terms - the receipt's evidence.
 * A range states its span and its coverage; a single cell states the verbatim
 * text that was read, because for `[cell] * 1.13` the only way to see that the
 * engine read the WRONG cell is to see what it read.
 */
export type FormulaResolvedTerm =
  | {
      kind: 'cell';
      reference: string;
      tableAnchor: string;
      row: number;
      column: number;
      /** Verbatim text of the cell, as read from the document. */
      text: string;
      description: string;
    }
  | {
      kind: 'range';
      reference: string;
      operation: string;
      tableAnchor: string;
      column: number;
      startRow: number;
      endRow: number;
      /** Cells in the span (every row is accounted for). */
      cellsRead: number;
      /** Cells whose values entered the arithmetic. */
      counted: number;
      description: string;
    };

export interface FormulaCellReport {
  /** The formula as the model sent it, verbatim. */
  formula: string;
  /**
   * The model's own plain-English description of what it computed, echoed back
   * unchanged beside the resolved facts so a wrong INTERPRETATION ("the Premium
   * column") is checkable against what was actually read (column 3, rows 2-93).
   */
  label?: string;
  /** Every reference the engine resolved, as text, in source order. */
  references: string[];
  /** What each reference resolved to - the anti-"wrong cells" evidence. */
  resolved: FormulaResolvedTerm[];
  /** The cell the result was written into. */
  targetAnchor: string;
  /** The exact bytes written to the target cell. */
  renderedValue: string;
  /** Cells whose values entered the arithmetic. */
  counted: number;
  /** Every considered cell excluded from the arithmetic, named. */
  skipped: SkippedCell[];
  /** Where the render format came from. */
  formatSource: 'target_cell' | 'column_majority';
  /** Decimal places the result was written at. */
  decimals: number;
  /** True when the exact result did not fit `decimals` and was rounded. */
  rounded: boolean;
  /** The mode that did the rounding; null when the result was exact. */
  roundingMode: RoundingMode | null;
  /** True when the formula reads the cell it writes (read-then-write). */
  selfReferencing: boolean;
  /** The post-write re-read reproduced the same value and bytes. */
  verifiedByReRead: true;
  receipt: string;
}

/** One row's outcome in a column-wide recompute. */
export interface ColumnRowOutcome {
  row: number;
  anchor: string;
  /**
   * `written` - the computed value differed and a tracked revision was created.
   * `unchanged` - the computed value was already there, byte for byte, so
   *   nothing was written (the no-op rule; this is what makes bulk safe).
   * `skipped` - the formula could not be evaluated for this row because a cell
   *   it references is blank, missing or not a number. A header row, a blank
   *   separator and a section-label row all land here, which is why the row
   *   bounds of a column recompute stop mattering.
   */
  outcome: 'written' | 'unchanged' | 'skipped';
  /** Verbatim text before the op ran. */
  previousText: string;
  /** The value computed for this row; absent when the row was skipped. */
  renderedValue?: string;
  /** Why the row was skipped: the refusal code and its message. */
  reason?: string;
  detail?: string;
}

/**
 * The auditable record of one column-wide recompute. Coverage AND what moved:
 * a bulk operation that reports only its writes hides the far more important
 * number, which is how many rows it looked at.
 */
export interface ColumnFormulaReport {
  /** The per-row formula template as the model sent it, verbatim. */
  formula: string;
  /** The model's own description of what the column holds. */
  label?: string;
  tableAnchor: string;
  /** The column every write landed in. */
  column: number;
  /** The row span actually evaluated, after defaulting to the whole table. */
  startRow: number;
  endRow: number;
  /** True when the span was the whole table because no `rows` was given. */
  wholeTable: boolean;
  /** Rows evaluated = rowsChanged + rowsUnchanged + rowsSkipped. */
  rowsEvaluated: number;
  rowsChanged: number;
  rowsUnchanged: number;
  rowsSkipped: number;
  rows: ColumnRowOutcome[];
  /** True for every written row: each was verified by post-write re-read. */
  verifiedByReRead: true;
  receipt: string;
}

/**
 * A numeric `set_cell_text` that got through the model-authored-number gate by
 * declaring `literal: true`. Recorded on the result so the exception is
 * auditable in the change set instead of being indistinguishable from a
 * computed write.
 */
export interface LiteralNumberWrite {
  text: string;
  /** What the cell held before, when it held a number. */
  previousText: string;
  note: string;
}

export interface EditResult {
  ok: boolean;
  anchor?: string;
  op: string;
  error?: string;
  /**
   * The refusal's own words: what went wrong and what to do instead. Codes are
   * for branching, this is the remedy - a refusal the model cannot read is a
   * refusal it will simply retry, so it travels with every failed result.
   */
  message?: string;
  // Formatting inheritance is resolved by SyncFusion after styles are applied.
  // Keep any mismatch evidence on the affected op so a caller can retry the
  // precise anchor without having to re-inventory the whole document.
  details?: string[];
  // 'never' marks a failure no retry can fix (the op is not in the vocabulary),
  // so the assistant stops resending it instead of looping.
  retry?: 'never';
  // Present on a successful `set_cell_formula`: the formula, the references it
  // resolved, where it rounded, and the receipt line to relay.
  formula?: FormulaCellReport;
  // Present on a `set_cell_text` that wrote a number verbatim under the
  // user-dictated exception: the engine's record that this number was NOT
  // engine-computed, so a reviewer can see which is which.
  literalNumber?: LiteralNumberWrite;
  // Present on a successful `set_column_formula`: coverage (how many rows were
  // recomputed) and what actually moved.
  column?: ColumnFormulaReport;
  // Present when the op wrote NOTHING because the value it would have written
  // is already there, byte for byte. `ok` is still true - the requested state
  // is the state - but there is no revision and no change card. See writeNoOp.
  noOp?: NoOpWriteReport;
}

export interface ApplyEditsResult {
  results: EditResult[];
  warnings: string[];
  inventory?: InventoryEntry[];
  changeSet?: {
    id: string;
    status: 'applied' | 'failed';
    // This bridge binds the native card callbacks, but does not create a
    // first-class grouped card in the revisions UI.
    revisionGrouping: 'bridge_bound_revision_cards' | 'no_revisions';
    uiGrouping: 'requires_cross_layer_group_card';
    /**
     * What this change set touched, in resolved terms, derived by the ENGINE
     * from the ops. Always present, so "which columns moved" is a property of
     * the result rather than something the model may forget to mention.
     */
    announcement: string;
    /**
     * The model's own statement of what it was about to do, echoed back.
     * Required (and therefore always present) whenever the batch writes into
     * more than one column of one table - see detectUnannouncedChain.
     */
    plan?: string;
  };
}

export interface SelectionContext {
  anchor: string;
  text: string;
  isCollapsed: boolean;
  // The selection's full extent. `anchor` alone is only the block the selection
  // STARTS in, so on its own it describes a multi-paragraph or cross-cell
  // selection as if it were a single block - the model then has no way to name
  // what the user actually pointed at. These are the public offsets verbatim;
  // `replace_selection` takes them back verbatim, so the model copies rather
  // than counts.
  startOffset: string;
  endOffset: string;
  endAnchor: string;
  // `text` is capped at SELECTION_TEXT_LIMIT for prompt budget. When it is
  // capped the model cannot supply the whole selected text as `expect`, so it
  // sends `expectLength` (this number, copied) alongside the prefix it does
  // have and the compare-and-swap runs on prefix + exact length.
  textLength: number;
  truncated: boolean;
  spansBlocks: boolean;
}

export interface DocumentOccurrence {
  anchor: string;
  kind: string;
  blockText: string;
  matchText: string;
  start: number;
  end: number;
}

export interface FindDocumentOccurrencesResult {
  ok: boolean;
  query: { text: string; matchCase: boolean; wholeWord: boolean };
  count: number;
  truncated: boolean;
  occurrences: DocumentOccurrence[];
  source: 'live_syncfusion';
  // Writable coverage. Header/footer search is public, but SyncFusion does not
  // complete a tracked range replacement there in the real editor; keep those
  // story classes explicitly out of the writable contract.
  storyCoverage: {
    body: true;
    tables: true;
    headersFooters: false;
    footnotesEndnotes: true;
    textFrames: true;
  };
  searchStoryCoverage: {
    body: true;
    tables: true;
    headersFooters: true;
    footnotesEndnotes: true;
    textFrames: true;
  };
  error?: string;
}

export interface FindDocumentOccurrencesBatchResult {
  ok: boolean;
  results: FindDocumentOccurrencesResult[];
  truncated: boolean;
  source: 'live_syncfusion';
  storyCoverage: {
    body: true;
    tables: true;
    headersFooters: false;
    footnotesEndnotes: true;
    textFrames: true;
  };
  searchStoryCoverage: {
    body: true;
    tables: true;
    headersFooters: true;
    footnotesEndnotes: true;
    textFrames: true;
  };
  error?: string;
}

// Structural subset of the SyncFusion DocumentEditor instance handed to us via
// `DocxEditor`'s `onEditorReady`. Typed loosely because the real API surface is
// large and only exercised in a browser; unit tests supply a fake.
export interface LiveEditor {
  serialize(): string;
  enableTrackChanges: boolean;
  selection: {
    select(start: string, end: string): void;
    text: string;
    startOffset: string;
    endOffset: string;
    characterFormat: any;
    paragraphFormat: any;
    isEmpty?: boolean;
    [k: string]: any;
  };
  editor: {
    insertText(text: string): void;
    delete(): void;
    [k: string]: any;
  };
  // The collection interface is declared below with the other revision types.
  // eslint-disable-next-line no-use-before-define
  revisions?: LiveRevisionCollection;
  editorHistory?: { undo?(): void; redo?(): void; [k: string]: any };
  search?: any;
  [k: string]: any;
}

// A single SyncFusion tracked-change revision. We only lean on its per-card
// accept/reject; everything else is opaque.
export interface LiveRevision {
  revisionType?: string;
  revisionID?: string;
  accept?(): void;
  reject?(): void;
  [k: string]: any;
}

// SyncFusion's `documentEditor.revisions` (RevisionCollection). It exposes both
// an array (`changes`) and an indexed accessor (`get`/`length`); we read either.
export interface LiveRevisionCollection {
  length?: number;
  changes?: LiveRevision[];
  get?(index: number): LiveRevision;
  acceptAll?(): void;
  rejectAll?(): void;
  [k: string]: any;
}

// A block flattened out of the SFDT with everything the inventory + apply engine
// needs. `length` is the block's character count (offset span within the para).
interface FlatBlock {
  anchor: string;
  kind: string;
  text: string;
  format?: DocFormat;
  characterFormat?: FormatBag;
  paragraphFormat?: FormatBag;
  isHeading: boolean;
  level: number;
  length: number;
}

// ---------------------------------------------------------------------------
// SFDT walking (pure)
// ---------------------------------------------------------------------------

const HEADING_STYLE = /heading\s*(\d+)/i;

// SyncFusion serializes an OPTIMIZED SFDT with abbreviated keys (sec/b/i/tlp/
// pf/cf/...), while imported/full SFDT and our test fixtures use the long keys
// (sections/blocks/inlines/text/paragraphFormat/...). Every accessor below reads
// both so the engine is format-agnostic.
function pick(obj: any, ...keys: string[]): any {
  if (!obj) return undefined;
  for (const k of keys) if (obj[k] !== undefined) return obj[k];
  return undefined;
}

function getInlines(block: any): any[] {
  const inlines = pick(block, 'inlines', 'i');
  return Array.isArray(inlines) ? inlines : [];
}

function getBlocks(container: any): any[] {
  const blocks = pick(container, 'blocks', 'b');
  return Array.isArray(blocks) ? blocks : [];
}

function getRows(block: any): any[] | undefined {
  // Optimized-SFDT row key is 'r' (SyncFusion keywords.js: rowsProperty=['rows','r']).
  // The live editor ALWAYS serializes optimized SFDT, so probing the wrong key
  // made every table walk as one empty paragraph - tables invisible to
  // inventory, index, and cell-anchored edits. 'rw' kept as a defensive probe.
  const rows = pick(block, 'rows', 'r', 'rw');
  return Array.isArray(rows) ? rows : undefined;
}

// SyncFusion serializes a revision type as a number in optimized SFDT and as a
// string in full SFDT: Insertion is 1/"Insertion", Deletion is 2/"Deletion".
function revisionIdsOfType(sfdt: any, code: number, name: string): Set<string> {
  const ids = new Set<string>();
  const revisions = pick(sfdt, 'revisions', 'r');
  if (!Array.isArray(revisions)) return ids;
  for (const revision of revisions) {
    const type = pick(revision, 'revisionType', 'rt');
    if (type !== code && String(type).toLowerCase() !== name) continue;
    const id = pick(revision, 'revisionID', 'revisionId', 'rid');
    if (id != null) ids.add(String(id));
  }
  return ids;
}

// Exclude pending deletions from the bridge's current-text view while retaining
// the tracked revision itself for Accept/Reject.
function deletedRevisionIds(sfdt: any): Set<string> {
  return revisionIdsOfType(sfdt, 2, 'deletion');
}

// The mirror image: dropping pending insertions (and keeping pending deletions)
// projects what the document would read if every revision were rejected.
function insertedRevisionIds(sfdt: any): Set<string> {
  return revisionIdsOfType(sfdt, 1, 'insertion');
}

function inlineText(
  inlines: any[],
  deletedIds: Set<string> = new Set()
): string {
  if (!Array.isArray(inlines)) return '';
  let out = '';
  for (const inline of inlines) {
    if (inline == null) continue;
    const revisionIds = pick(inline, 'revisionIds', 'rids');
    if (
      Array.isArray(revisionIds) &&
      revisionIds.length > 0 &&
      revisionIds.every((id) => deletedIds.has(String(id)))
    )
      continue;
    const text = pick(inline, 'text', 'tlp');
    if (typeof text === 'string') out += text;
    // Tabs render as whitespace in the offset stream.
    else if (inline.name === 'Tab' || inline.tlp === undefined) continue;
  }
  return out;
}

// optimized textAlignment is numeric (0 Left,1 Center,2 Right,3 Justify).
const ALIGN = ['Left', 'Center', 'Right', 'Justify'];
function normalizeAlignment(v: any): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'number') return ALIGN[v] ?? undefined;
  return String(v);
}

function readStyleName(pf: any, cf: any): string | undefined {
  // optimized SFDT stores the paragraph style under pf.stn (full SFDT: styleName).
  const paraStyle = pick(pf, 'styleName', 'sty', 'stn');
  if (paraStyle) return String(paraStyle);
  // Fall back to the inline's linked character style ("Heading 1 Char").
  const charStyle = pick(cf, 'styleName', 'stn');
  if (charStyle) return String(charStyle).replace(/\s+Char$/i, '');
  return undefined;
}

const CHARACTER_FORMAT_KEYS = [
  { prop: 'bold', keys: ['bold', 'b'] },
  { prop: 'italic', keys: ['italic', 'i'] },
  { prop: 'fontSize', keys: ['fontSize', 'fsz'] },
  { prop: 'fontFamily', keys: ['fontFamily', 'ff'] },
  { prop: 'underline', keys: ['underline', 'u'] },
  { prop: 'underlineColor', keys: ['underlineColor', 'uc'] },
  { prop: 'strikethrough', keys: ['strikethrough', 'st'] },
  { prop: 'baselineAlignment', keys: ['baselineAlignment', 'ba'] },
  { prop: 'highlightColor', keys: ['highlightColor', 'hc'] },
  { prop: 'fontColor', keys: ['fontColor', 'fc'] },
  { prop: 'bidi', keys: ['bidi', 'bi'] },
  { prop: 'allCaps', keys: ['allCaps', 'ac'] },
  { prop: 'characterSpacing', keys: ['characterSpacing', 'csp'] },
  { prop: 'scaling', keys: ['scaling', 'sc'] }
];

const PARAGRAPH_FORMAT_KEYS = [
  { prop: 'styleName', keys: ['styleName', 'sty', 'stn'] },
  { prop: 'leftIndent', keys: ['leftIndent', 'lin'] },
  { prop: 'rightIndent', keys: ['rightIndent', 'rin'] },
  { prop: 'firstLineIndent', keys: ['firstLineIndent', 'fin'] },
  { prop: 'textAlignment', keys: ['textAlignment', 'ta'] },
  { prop: 'afterSpacing', keys: ['afterSpacing', 'as'] },
  { prop: 'beforeSpacing', keys: ['beforeSpacing', 'bs'] },
  { prop: 'spaceAfterAuto', keys: ['spaceAfterAuto', 'saa'] },
  { prop: 'spaceBeforeAuto', keys: ['spaceBeforeAuto', 'sba'] },
  { prop: 'lineSpacing', keys: ['lineSpacing', 'ls'] },
  { prop: 'lineSpacingType', keys: ['lineSpacingType', 'lst'] },
  { prop: 'keepWithNext', keys: ['keepWithNext', 'kwn'] },
  { prop: 'widowControl', keys: ['widowControl', 'wc'] },
  { prop: 'keepLinesTogether', keys: ['keepLinesTogether', 'klt'] },
  { prop: 'outlineLevel', keys: ['outlineLevel', 'ol'] },
  { prop: 'contextualSpacing', keys: ['contextualSpacing', 'cs'] },
  { prop: 'bidi', keys: ['bidi', 'bi'] }
];

type FormatMapping = { prop: string; keys: string[] };

function readMappedFormat(source: any, mappings: FormatMapping[]) {
  const out: FormatBag = {};
  for (const { prop, keys } of mappings) {
    const value = pick(source, ...keys);
    if (value !== undefined) out[prop] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

function readFormat(block: any): DocFormat | undefined {
  const pf = pick(block, 'paragraphFormat', 'pf') ?? {};
  const firstInline = getInlines(block)[0];
  const cf =
    pick(firstInline, 'characterFormat', 'cf') ??
    pick(block, 'characterFormat', 'cf') ??
    {};
  const fmt: DocFormat = {};
  const styleName = readStyleName(pf, cf);
  if (styleName) fmt.styleName = styleName;
  const alignment = normalizeAlignment(pick(pf, 'textAlignment', 'ta'));
  if (alignment) fmt.alignment = alignment;
  const bold = pick(cf, 'bold', 'b');
  if (bold != null) fmt.bold = !!bold;
  const italic = pick(cf, 'italic', 'i');
  if (italic != null) fmt.italic = !!italic;
  const underline = pick(cf, 'underline', 'u');
  if (underline != null && underline !== 'None' && underline !== 0)
    fmt.underline = true;
  const fontName = pick(cf, 'fontFamily', 'ff');
  if (fontName) fmt.fontName = String(fontName);
  const fontSize = pick(cf, 'fontSize', 'fsz');
  if (typeof fontSize === 'number') fmt.fontSize = fontSize;
  const leftIndent = pick(pf, 'leftIndent', 'lin');
  if (typeof leftIndent === 'number') fmt.leftIndent = leftIndent;
  const rightIndent = pick(pf, 'rightIndent', 'rin');
  if (typeof rightIndent === 'number') fmt.rightIndent = rightIndent;
  const firstLineIndent = pick(pf, 'firstLineIndent', 'fin');
  if (typeof firstLineIndent === 'number')
    fmt.firstLineIndent = firstLineIndent;
  const beforeSpacing = pick(pf, 'beforeSpacing', 'bs');
  if (typeof beforeSpacing === 'number') fmt.beforeSpacing = beforeSpacing;
  const afterSpacing = pick(pf, 'afterSpacing', 'as');
  if (typeof afterSpacing === 'number') fmt.afterSpacing = afterSpacing;
  const lineSpacing = pick(pf, 'lineSpacing', 'ls');
  if (typeof lineSpacing === 'number') fmt.lineSpacing = lineSpacing;
  const lineSpacingType = pick(pf, 'lineSpacingType', 'lst');
  if (lineSpacingType !== undefined && lineSpacingType !== '')
    fmt.lineSpacingType = String(lineSpacingType);
  const spaceBeforeAuto = pick(pf, 'spaceBeforeAuto', 'sba');
  if (typeof spaceBeforeAuto === 'boolean')
    fmt.spaceBeforeAuto = spaceBeforeAuto;
  const spaceAfterAuto = pick(pf, 'spaceAfterAuto', 'saa');
  if (typeof spaceAfterAuto === 'boolean') fmt.spaceAfterAuto = spaceAfterAuto;
  const listFormat = pick(pf, 'listFormat', 'lif');
  const listLevel = pick(listFormat, 'listLevelNumber', 'llv');
  if (typeof listLevel === 'number') fmt.listLevel = listLevel;
  return Object.keys(fmt).length ? fmt : undefined;
}

function readBlockFormats(block: any): {
  characterFormat?: FormatBag;
  paragraphFormat?: FormatBag;
} {
  const pf = pick(block, 'paragraphFormat', 'pf') ?? {};
  const firstInline = getInlines(block)[0];
  const cf =
    pick(firstInline, 'characterFormat', 'cf') ??
    pick(block, 'characterFormat', 'cf') ??
    {};
  return {
    characterFormat: readMappedFormat(cf, CHARACTER_FORMAT_KEYS),
    paragraphFormat: readMappedFormat(pf, PARAGRAPH_FORMAT_KEYS)
  };
}

function headingLevel(fmt: DocFormat | undefined): number {
  const style = (fmt?.styleName ?? '').trim();
  if (/^title(\s+char)?$/i.test(style)) return 0;
  const m = style.match(HEADING_STYLE);
  return m ? Number(m[1]) : -1;
}

// Walk the SFDT into a flat, in-order list of addressable blocks. Paragraphs
// (top-level and inside table cells) become blocks; a table contributes its
// cell paragraphs. Anchors follow the SyncFusion hierarchical scheme.
export function flattenSfdt(
  sfdt: any,
  dropRevisionIds?: Set<string>
): FlatBlock[] {
  const out: FlatBlock[] = [];
  const sections: any[] = pick(sfdt, 'sections', 'sec') ?? [];
  const deletedIds = dropRevisionIds ?? deletedRevisionIds(sfdt);

  sections.forEach((section, si) => {
    getBlocks(section).forEach((block, bi) => {
      const rows = getRows(block);
      if (rows) {
        // Table: descend into each cell's blocks.
        rows.forEach((row: any, ri: number) => {
          const cells: any[] = pick(row, 'cells', 'c') ?? [];
          cells.forEach((cell, ci) => {
            getBlocks(cell).forEach((cb, cbi) => {
              const text = inlineText(getInlines(cb), deletedIds);
              out.push({
                anchor: `${si};${bi};${ri};${ci};${cbi}`,
                kind: 'table_cell',
                text,
                format: readFormat(cb),
                ...readBlockFormats(cb),
                isHeading: false,
                level: -1,
                length: text.length
              });
            });
          });
        });
      } else {
        const text = inlineText(getInlines(block), deletedIds);
        const format = readFormat(block);
        const level = headingLevel(format);
        out.push({
          anchor: `${si};${bi}`,
          kind: level >= 0 ? 'heading' : 'paragraph',
          text,
          format,
          ...readBlockFormats(block),
          isHeading: level >= 0,
          level,
          length: text.length
        });
      }
    });
  });

  return out;
}

function toInventoryEntry(b: FlatBlock): InventoryEntry {
  const entry: InventoryEntry = {
    anchor: b.anchor,
    kind: b.kind,
    text: b.text
  };
  if (b.format) entry.format = b.format;
  return entry;
}

// Headings with the block count each governs - the outline walk, shared by
// the `outline` and `structure` scopes.
function collectOutlineSections(blocks: FlatBlock[]): OutlineSection[] {
  const sections: OutlineSection[] = [];
  const headingIdx: number[] = [];
  blocks.forEach((b, i) => {
    if (b.isHeading) headingIdx.push(i);
  });
  headingIdx.forEach((idx, n) => {
    const next = headingIdx[n + 1] ?? blocks.length;
    sections.push({
      anchor: blocks[idx].anchor,
      heading: blocks[idx].text,
      level: blocks[idx].level,
      blockCount: next - idx - 1
    });
  });
  return sections;
}

// Cell text kept per header cell; a header longer than this is recognisable
// from its prefix and not worth the context.
const STRUCTURE_HEADER_CELL_CHARS = 60;
const STRUCTURE_MAX_HEADER_CELLS = 16;

interface TableAccumulator {
  anchor: string;
  rows: number;
  columns: number;
  headerByCell: Map<number, string[]>;
}

function collectStructureTables(blocks: FlatBlock[]): StructureTable[] {
  const order: TableAccumulator[] = [];
  const byAnchor = new Map<string, TableAccumulator>();
  for (const b of blocks) {
    if (b.kind !== 'table_cell') continue;
    const parts = b.anchor.split(';');
    if (parts.length !== 5) continue;
    const tableAnchor = `${parts[0]};${parts[1]}`;
    const row = Number(parts[2]);
    const cell = Number(parts[3]);
    if (!Number.isInteger(row) || !Number.isInteger(cell)) continue;
    let table = byAnchor.get(tableAnchor);
    if (!table) {
      table = {
        anchor: tableAnchor,
        rows: 0,
        columns: 0,
        headerByCell: new Map()
      };
      byAnchor.set(tableAnchor, table);
      order.push(table);
    }
    table.rows = Math.max(table.rows, row + 1);
    table.columns = Math.max(table.columns, cell + 1);
    if (row === 0 && b.text.trim()) {
      const texts = table.headerByCell.get(cell) ?? [];
      texts.push(b.text.trim());
      table.headerByCell.set(cell, texts);
    }
  }
  return order.map((t) => {
    const cellCount = Math.min(t.columns, STRUCTURE_MAX_HEADER_CELLS);
    const firstRowCells: string[] = [];
    for (let ci = 0; ci < cellCount; ci++) {
      const text = (t.headerByCell.get(ci) ?? []).join(' ');
      firstRowCells.push(
        text.length > STRUCTURE_HEADER_CELL_CHARS
          ? `${text.slice(0, STRUCTURE_HEADER_CELL_CHARS)}...`
          : text
      );
    }
    const table: StructureTable = {
      anchor: t.anchor,
      rows: t.rows,
      columns: t.columns,
      firstRowCells
    };
    // Never truncate silently: a capped header row must say it is capped.
    if (t.columns > STRUCTURE_MAX_HEADER_CELLS)
      table.firstRowCellsTruncated = true;
    return table;
  });
}

function collectSectionBoundaries(
  blocks: FlatBlock[]
): StructureSectionBoundary[] {
  const order: StructureSectionBoundary[] = [];
  const bySection = new Map<number, StructureSectionBoundary>();
  for (const b of blocks) {
    const section = Number(b.anchor.split(';')[0]);
    if (!Number.isInteger(section)) continue;
    const existing = bySection.get(section);
    if (existing) existing.blockCount++;
    else {
      const boundary = { section, firstAnchor: b.anchor, blockCount: 1 };
      bySection.set(section, boundary);
      order.push(boundary);
    }
  }
  return order;
}

/**
 * Every cell of one table column, complete and in row order. Shared by the
 * `table_column` inventory scope and the `set_cell_formula` engine
 * computation, so what the model reads and what the engine sums are the same
 * cells by construction. Returns null when no table answers to `tableAnchor`.
 */
export function collectTableColumnCells(
  blocks: FlatBlock[],
  tableAnchor: string,
  column: number
): { columns: number; rowCount: number; cells: TableColumnCell[] } | null {
  let rowCount = 0;
  let columns = 0;
  // (row -> cell paragraphs in order) for the requested column only.
  const paragraphsByRow = new Map<number, FlatBlock[]>();
  let found = false;
  for (const b of blocks) {
    if (b.kind !== 'table_cell') continue;
    const parts = b.anchor.split(';');
    if (parts.length !== 5) continue;
    if (`${parts[0]};${parts[1]}` !== tableAnchor) continue;
    const row = Number(parts[2]);
    const cell = Number(parts[3]);
    if (!Number.isInteger(row) || !Number.isInteger(cell)) continue;
    found = true;
    rowCount = Math.max(rowCount, row + 1);
    columns = Math.max(columns, cell + 1);
    if (cell !== column) continue;
    const list = paragraphsByRow.get(row) ?? [];
    list.push(b);
    paragraphsByRow.set(row, list);
  }
  if (!found) return null;
  const cells: TableColumnCell[] = [];
  for (let row = 0; row < rowCount; row++) {
    const paragraphs = paragraphsByRow.get(row);
    if (!paragraphs?.length) {
      cells.push({ row, text: null });
      continue;
    }
    cells.push({
      row,
      anchor: paragraphs[0].anchor,
      text: paragraphs.map((p) => p.text).join('\n')
    });
  }
  return { columns, rowCount, cells };
}

/**
 * Observable facts about one table. Reads the RAW SFDT (not just the flattened
 * block stream) because merge spans live on `cellFormat.columnSpan` /
 * `rowSpan`, and a merged cell is precisely the layout fact a model cannot
 * infer from cell text - it is why a row has fewer cells than the table has
 * columns.
 *
 * Reports facts only. Anything that would amount to an opinion about the
 * table's meaning - which row is a header, which row is a subtotal, where the
 * data starts - is deliberately absent.
 */
export function collectTableFacts(
  blocks: FlatBlock[],
  sfdt: any,
  tableAnchor: string
): TableFacts | null {
  const [sectionIndex, blockIndex] = tableAnchor.split(';').map(Number);
  const sections: any[] = pick(sfdt, 'sections', 'sec') ?? [];
  const tableBlock = getBlocks(sections[sectionIndex] ?? {})[blockIndex];
  const rawRows = tableBlock ? getRows(tableBlock) : undefined;
  if (!rawRows) return null;

  const byAnchor = new Map(blocks.map((block) => [block.anchor, block]));
  const rows: TableRowFact[] = [];
  const mergedCells: TableFacts['mergedCells'] = [];
  let columnCount = 0;

  rawRows.forEach((rawRow: any, row: number) => {
    const rawCells: any[] = pick(rawRow, 'cells', 'c') ?? [];
    columnCount = Math.max(columnCount, rawCells.length);
    const cells: TableCellFact[] = [];
    rawCells.forEach((rawCell: any, column: number) => {
      const anchor = `${sectionIndex};${blockIndex};${row};${column};0`;
      // A cell's paragraphs are separate flattened blocks; join them the same
      // way collectTableColumnCells does so text is identical across reads.
      const paragraphs: FlatBlock[] = [];
      for (let p = 0; ; p++) {
        const paragraph = byAnchor.get(
          `${sectionIndex};${blockIndex};${row};${column};${p}`
        );
        if (!paragraph) break;
        paragraphs.push(paragraph);
      }
      const fullText = paragraphs.map((paragraph) => paragraph.text).join('\n');
      const clipped = fullText.length > TABLE_FACTS_CELL_TEXT_CHARS;
      const classified = classifyNumericText(fullText);
      const cellFormat = pick(rawCell, 'cellFormat', 'cf') ?? {};
      const columnSpan = Number(pick(cellFormat, 'columnSpan', 'colSpan') ?? 1);
      const rowSpan = Number(pick(cellFormat, 'rowSpan') ?? 1);
      const first = paragraphs[0];
      const fact: TableCellFact = {
        row,
        column,
        anchor,
        text: clipped
          ? `${fullText.slice(0, TABLE_FACTS_CELL_TEXT_CHARS)}...`
          : fullText,
        ...(clipped ? { textTruncated: true as const } : {}),
        paragraphs: paragraphs.length,
        blank: fullText.trim() === '',
        numeric: classified.numeric,
        quantity: classified.quantity,
        ...(classified.numeric
          ? { unit: classified.unit ?? '', decimals: classified.decimals ?? 0 }
          : {}),
        ...(Number.isFinite(columnSpan) && columnSpan > 1
          ? { columnSpan }
          : {}),
        ...(Number.isFinite(rowSpan) && rowSpan > 1 ? { rowSpan } : {}),
        ...(first?.characterFormat?.bold ? { bold: true as const } : {}),
        ...(first?.characterFormat?.italic ? { italic: true as const } : {}),
        ...(first?.format?.styleName
          ? { styleName: first.format.styleName }
          : {})
      };
      if (fact.columnSpan || fact.rowSpan) {
        mergedCells.push({
          row,
          column,
          anchor,
          columnSpan: fact.columnSpan ?? 1,
          rowSpan: fact.rowSpan ?? 1
        });
      }
      cells.push(fact);
    });
    const filled = cells.filter((cell) => !cell.blank);
    rows.push({
      row,
      cellCount: cells.length,
      filledCells: filled.length,
      ...(filled.length === 0 ? { blankRow: true as const } : {}),
      ...(filled.length > 0 && filled.every((cell) => cell.bold)
        ? { allBold: true as const }
        : {}),
      ...(cells.some((cell) => cell.columnSpan || cell.rowSpan)
        ? { hasMergedCells: true as const }
        : {}),
      cells
    });
  });

  const columns: TableColumnFact[] = [];
  for (let column = 0; column < columnCount; column++) {
    const present = rows
      .map((row) => row.cells[column])
      .filter((cell): cell is TableCellFact => cell != null);
    const units: string[] = [];
    const decimals: number[] = [];
    for (const cell of present) {
      if (cell.unit != null && units.indexOf(cell.unit) < 0)
        units.push(cell.unit);
      if (cell.decimals != null && decimals.indexOf(cell.decimals) < 0)
        decimals.push(cell.decimals);
    }
    columns.push({
      column,
      presentCells: present.length,
      filledCells: present.filter((cell) => !cell.blank).length,
      numericCells: present.filter((cell) => cell.numeric).length,
      quantityCells: present.filter((cell) => cell.quantity).length,
      units,
      decimals: decimals.sort((a, b) => a - b)
    });
  }

  return {
    tableAnchor,
    rowCount: rows.length,
    columnCount,
    uniformRows: rows.every((row) => row.cellCount === columnCount),
    mergedCells,
    rows,
    columns,
    truncated: false
  };
}

/** `0;7`, or any cell anchor `0;7;r;c;p`, names the table at `0;7`. */
function normalizeTableAnchor(raw: unknown): string | null {
  const parts = String(raw ?? '')
    .trim()
    .split(';');
  if (parts.length !== 2 && parts.length !== 5) return null;
  if (parts.slice(0, 2).some((p) => !/^\d+$/.test(p))) return null;
  return `${parts[0]};${parts[1]}`;
}

const partialReadMessage = (returned: number, total: number): string =>
  `PARTIAL READ: returned ${returned} of ${total} entries (maxEntries cap). ` +
  'Do not treat this as the complete list - re-read with a larger maxEntries or omit maxEntries.';

// Build the response for a given scope from an already-parsed SFDT.
export function buildInventoryFromBlocks(
  blocks: FlatBlock[],
  input: {
    scope: InventoryScope;
    sectionAnchor?: string;
    maxEntries?: number;
    tableAnchor?: string;
    column?: number;
  },
  // The `table_facts` scope needs the raw SFDT: merge spans live on cellFormat
  // and do not survive flattening. Every other scope reads only `blocks`.
  sfdt?: any
): InventoryResult {
  const { scope, sectionAnchor, maxEntries } = input;
  const cap = <T>(list: T[]): T[] =>
    maxEntries && maxEntries > 0 ? list.slice(0, maxEntries) : list;

  if (scope === 'outline') {
    const sections = collectOutlineSections(blocks);
    const capped = cap(sections);
    if (capped.length < sections.length) {
      return {
        sections: capped,
        truncation: {
          returned: capped.length,
          total: sections.length,
          message: partialReadMessage(capped.length, sections.length)
        }
      };
    }
    return { sections: capped };
  }

  if (scope === 'structure') {
    // The document's skeleton - headings, tables, section boundaries - at a
    // token cost that is a rounding error next to the content. This is the
    // cheap leg for navigation questions and the remedy the too-large refusal
    // names, so it must stay text-free apart from headings and header cells.
    const headings = collectOutlineSections(blocks);
    const tables = collectStructureTables(blocks);
    const cappedHeadings = cap(headings);
    const cappedTables = cap(tables);
    const result: InventoryResult = {
      structure: {
        blockCount: blocks.length,
        headings: cappedHeadings,
        tables: cappedTables,
        sections: collectSectionBoundaries(blocks)
      }
    };
    const clipped =
      cappedHeadings.length < headings.length ||
      cappedTables.length < tables.length;
    if (clipped) {
      result.truncation = {
        returned: cappedHeadings.length + cappedTables.length,
        total: headings.length + tables.length,
        message: `PARTIAL READ: returned ${cappedHeadings.length} of ${headings.length} headings and ${cappedTables.length} of ${tables.length} tables (maxEntries cap). Re-read with a larger maxEntries or omit it.`
      };
    }
    return result;
  }

  if (scope === 'table_facts') {
    const tableAnchor = normalizeTableAnchor(input.tableAnchor);
    if (!tableAnchor) {
      return {
        error: 'missing_table_anchor',
        message:
          'scope "table_facts" requires `tableAnchor` (a table anchor from a structure read, e.g. "0;7", or any of its cell anchors).',
        remedy: {
          action: 're-read',
          tool: 'getDocumentInventory',
          input: { scope: 'structure' }
        },
        retry: 'modified_input'
      };
    }
    if (!sfdt) {
      return {
        error: 'table_facts_unavailable',
        message:
          'scope "table_facts" needs the live document and cannot be served from a pre-flattened block list. This is an engine wiring fault, not a bad request.',
        retry: 'never'
      };
    }
    const facts = collectTableFacts(blocks, sfdt, tableAnchor);
    if (!facts) {
      return {
        error: 'table_not_found',
        message: `No table found at anchor "${tableAnchor}". The document may have changed since it was read; re-read the structure and use a current table anchor.`,
        remedy: {
          action: 're-read',
          tool: 'getDocumentInventory',
          input: { scope: 'structure' }
        },
        retry: 'after_remedy'
      };
    }
    // Deliberately no `cap()`: see TableFacts.truncated.
    return { table: facts };
  }

  if (scope === 'table_column') {
    const tableAnchor = normalizeTableAnchor(input.tableAnchor);
    if (!tableAnchor) {
      return {
        error: 'missing_table_anchor',
        message:
          'scope "table_column" requires `tableAnchor` (the table anchor from a structure read, e.g. "0;7", or any of its cell anchors).',
        remedy: {
          action: 're-read',
          tool: 'getDocumentInventory',
          input: { scope: 'structure' }
        },
        retry: 'modified_input'
      };
    }
    const column =
      typeof input.column === 'number' && Number.isInteger(input.column)
        ? input.column
        : -1;
    if (column < 0) {
      return {
        error: 'missing_column',
        message:
          'scope "table_column" requires `column`, the 0-based column index (match it against the column facts from a table_facts read).',
        remedy: {
          action: 're-read',
          tool: 'getDocumentInventory',
          input: { scope: 'structure' }
        },
        retry: 'modified_input'
      };
    }
    const collected = collectTableColumnCells(blocks, tableAnchor, column);
    if (!collected) {
      return {
        error: 'table_not_found',
        message: `No table found at anchor "${tableAnchor}". The document may have changed since it was read; re-read the structure and use a current table anchor.`,
        remedy: {
          action: 're-read',
          tool: 'getDocumentInventory',
          input: { scope: 'structure' }
        },
        retry: 'after_remedy'
      };
    }
    if (column >= collected.columns) {
      return {
        error: 'column_out_of_range',
        message: `The table at "${tableAnchor}" has ${
          collected.columns
        } columns (0-${
          collected.columns - 1
        }); column ${column} does not exist.`,
        remedy: {
          action: 're-read',
          tool: 'getDocumentInventory',
          input: { scope: 'structure' }
        },
        retry: 'modified_input'
      };
    }
    const capped = cap(collected.cells);
    const truncated = capped.length < collected.rowCount;
    const columnRead: TableColumnRead = {
      tableAnchor,
      column,
      columns: collected.columns,
      rowCount: collected.rowCount,
      returned: capped.length,
      truncated,
      cells: capped
    };
    if (truncated) {
      return {
        column: columnRead,
        truncation: {
          returned: capped.length,
          total: collected.rowCount,
          message: `PARTIAL COLUMN: returned ${capped.length} of ${collected.rowCount} rows (maxEntries cap). Any total or anchor derived from this read covers only these rows - re-read with maxEntries >= ${collected.rowCount} or omit maxEntries.`
        }
      };
    }
    return { column: columnRead };
  }

  if (scope === 'section') {
    if (!sectionAnchor) {
      return {
        error: 'missing_section_anchor',
        message:
          'scope "section" requires a sectionAnchor from a prior outline or structure read.',
        remedy: {
          action: 're-read',
          tool: 'getDocumentInventory',
          input: { scope: 'structure' }
        },
        retry: 'modified_input'
      };
    }
    const start = blocks.findIndex((b) => b.anchor === sectionAnchor);
    if (start < 0) {
      return {
        error: 'section_not_found',
        message: `No block found for sectionAnchor "${sectionAnchor}". The document may have changed since it was read; re-read the structure and use a current heading anchor.`,
        remedy: {
          action: 're-read',
          tool: 'getDocumentInventory',
          input: { scope: 'structure' }
        },
        retry: 'after_remedy'
      };
    }
    let end = blocks.length;
    for (let i = start + 1; i < blocks.length; i++) {
      if (blocks[i].isHeading) {
        end = i;
        break;
      }
    }
    const section = blocks.slice(start, end);
    const slice = cap(section);
    if (slice.length < section.length) {
      // The live bug this guards: a 94-row table read at maxEntries 60 looked
      // complete, so the model summed 60 rows and GUESSED the last anchor.
      return {
        inventory: slice.map(toInventoryEntry),
        truncation: {
          returned: slice.length,
          total: section.length,
          message: partialReadMessage(slice.length, section.length)
        }
      };
    }
    return { inventory: slice.map(toInventoryEntry) };
  }

  // full - the whole-document path keeps its hard limit, and past it the
  // refusal is honest and carries its remedy: reading a fraction and answering
  // confidently would be a wrong answer that looks right.
  if (blocks.length > FULL_INVENTORY_BLOCK_LIMIT) {
    return {
      error: 'document_too_large',
      message:
        `Document has ${blocks.length} blocks (> ${FULL_INVENTORY_BLOCK_LIMIT}); reading it whole would exceed what fits. ` +
        'Read scope "structure" for the skeleton (headings, tables, section boundaries), then scope "section" with a heading anchor for the parts you need. Do not retry scope "full".',
      remedy: {
        action: 'narrow',
        tool: 'getDocumentInventory',
        input: { scope: 'structure' }
      },
      retry: 'after_remedy'
    };
  }
  const all = cap(blocks);
  if (all.length < blocks.length) {
    return {
      inventory: all.map(toInventoryEntry),
      truncation: {
        returned: all.length,
        total: blocks.length,
        message: partialReadMessage(all.length, blocks.length)
      }
    };
  }
  return { inventory: all.map(toInventoryEntry) };
}

// Blocks POSTed to /assistant/document-index. The index endpoint validates each
// block against `{anchor: string.min(1), text: string}`, so a single malformed
// block poisons the whole POST. Real docs (images, image-only paragraphs, empty
// table cells) produce blocks with no text - and a hostile/edge SFDT could yield
// a block with an empty anchor or a non-string text - so this is the
// belt-and-suspenders client guard (ai-services hardens the endpoint too):
//   - drop any block whose anchor is empty/whitespace (would fail min(1)),
//   - coerce a missing/non-string text to "" so `text` is always a string,
//   - skip text-less blocks (empty paragraphs, images, empty cells): not worth
//     embedding and not required by the index.
// The invariant: every emitted block has a non-empty anchor and a string text.
export function buildIndexBlocksFromBlocks(blocks: FlatBlock[]): IndexBlock[] {
  const out: IndexBlock[] = [];
  for (const b of blocks) {
    const anchor = typeof b.anchor === 'string' ? b.anchor : '';
    if (anchor.trim().length === 0) continue;
    const text = typeof b.text === 'string' ? b.text : '';
    if (text.trim().length === 0) continue;
    const block: IndexBlock = { anchor, kind: b.kind, text };
    if (b.format) block.format = b.format;
    out.push(block);
  }
  return out;
}

function parseSfdt(raw: string): any {
  if (!raw) return { sections: [] };
  try {
    return JSON.parse(raw);
  } catch {
    return { sections: [] };
  }
}

// ---------------------------------------------------------------------------
// Live editor reads
// ---------------------------------------------------------------------------

export function getDocumentInventory(
  editor: LiveEditor,
  input: {
    scope: InventoryScope;
    sectionAnchor?: string;
    maxEntries?: number;
    tableAnchor?: string;
    column?: number;
  }
): InventoryResult {
  const sfdt = parseSfdt(editor.serialize());
  return buildInventoryFromBlocks(flattenSfdt(sfdt), input, sfdt);
}

export function buildIndexBlocks(editor: LiveEditor): IndexBlock[] {
  return buildIndexBlocksFromBlocks(flattenSfdt(parseSfdt(editor.serialize())));
}

export const MAX_LIVE_OCCURRENCE_QUERIES = 20;
export const MAX_LIVE_OCCURRENCES_PER_QUERY = 200;

function findOption(matchCase: boolean, wholeWord: boolean): string {
  if (matchCase && wholeWord) return 'CaseSensitiveWholeWord';
  if (matchCase) return 'CaseSensitive';
  if (wholeWord) return 'WholeWord';
  return 'None';
}

function offsetParts(offset: string): { anchor: string; offset: number } {
  const parts = String(offset ?? '').split(';');
  const value = Number(parts.pop());
  return {
    anchor: parts.join(';'),
    offset: Number.isFinite(value) ? value : 0
  };
}

function kindFromLiveAnchor(anchor: string, block?: FlatBlock): string {
  if (block) return block.kind;
  const story = liveStoryMarker(anchor);
  if (story === 'H') return 'header';
  if (story === 'F') return 'footer';
  if (story === 'FN') return 'footnote';
  if (story === 'EN') return 'endnote';
  if (story === 'S') return 'text_frame';
  return 'story';
}

function liveStoryMarker(anchor: string): string | undefined {
  return String(anchor ?? '')
    .split(';')
    .find((part) => ['H', 'F', 'FN', 'EN', 'S'].includes(part));
}

function currentQueryOffsets(
  text: string,
  query: string,
  matchCase: boolean
): number[] {
  const haystack = matchCase ? text : text.toLocaleLowerCase();
  const needle = matchCase ? query : query.toLocaleLowerCase();
  if (!needle) return [];
  const offsets: number[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const offset = haystack.indexOf(needle, from);
    if (offset < 0) break;
    offsets.push(offset);
    from = offset + Math.max(1, needle.length);
  }
  return offsets;
}

function isWholeWordAt(text: string, start: number, length: number): boolean {
  // Match SyncFusion's documented WholeWord intent, but against the current
  // text projection where tracked deletions have been removed. `\b` is the
  // same ASCII word-boundary model SyncFusion uses for these name/token calls.
  const word = /[A-Za-z0-9_]/;
  return (
    !word.test(text.charAt(start - 1)) &&
    !word.test(text.charAt(start + length))
  );
}

// Search exposes deleted tracked text in a text frame, while SFDT's current
// projection retains the frame payload but (correctly) marks that old run as a
// deletion. The frame's public hierarchical anchor is rooted at its host
// paragraph: `host;S;shapeOrdinal;frameParagraph`. We use this serialized
// projection only to exclude deleted search hits; selection/search remains the
// authority for locating and writing the range.
function currentTextFrameText(sfdt: any, anchor: string): string | undefined {
  const parts = String(anchor ?? '').split(';');
  const marker = parts.indexOf('S');
  if (marker < 0) return undefined;
  const shapeOrdinal = Number(parts[marker + 1]);
  const frameBlockIndex = Number(parts[marker + 2]);
  if (
    !Number.isInteger(shapeOrdinal) ||
    shapeOrdinal < 1 ||
    !Number.isInteger(frameBlockIndex) ||
    frameBlockIndex < 0
  )
    return undefined;
  const hostAnchor = parts.slice(0, marker).join(';');
  const deletedIds = deletedRevisionIds(sfdt);
  const sections: any[] = pick(sfdt, 'sections', 'sec') ?? [];

  const visitBlocks = (blocks: any[], prefix: string): string | undefined => {
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
      const block = blocks[blockIndex];
      const blockAnchor = `${prefix};${blockIndex}`;
      const rows = getRows(block);
      if (rows) {
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
          const cells: any[] = pick(rows[rowIndex], 'cells', 'c') ?? [];
          for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
            const found = visitBlocks(
              getBlocks(cells[cellIndex]),
              `${blockAnchor};${rowIndex};${cellIndex}`
            );
            if (found !== undefined) return found;
          }
        }
        continue;
      }
      if (blockAnchor !== hostAnchor) continue;
      let ordinal = 0;
      for (const inline of getInlines(block)) {
        const textFrame = pick(inline, 'textFrame', 'tf');
        if (!textFrame) continue;
        ordinal++;
        if (ordinal !== shapeOrdinal) continue;
        const frameBlock = getBlocks(textFrame)[frameBlockIndex];
        return frameBlock
          ? inlineText(getInlines(frameBlock), deletedIds)
          : undefined;
      }
    }
    return undefined;
  };

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const found = visitBlocks(
      getBlocks(sections[sectionIndex]),
      `${sectionIndex}`
    );
    if (found !== undefined) return found;
  }
  return undefined;
}

// Search the current DocumentEditor model via SyncFusion's public Search API.
// SearchResults#getTextSearchResultsOffset returns the actual hierarchical
// selection offsets, including supported header/footer and note stories. Every
// story advertised by storyCoverage is also writable by applyDocumentEdits:
// body/table anchors use their SFDT block and story anchors use this public
// search range directly. SFDT is used only to attach block context for ordinary
// body/table anchors; it is never an embedding/index source and is deliberately
// not used to decide matches.
function findOneDocumentOccurrences(
  editor: LiveEditor,
  input: {
    text?: string;
    matchCase?: boolean;
    wholeWord?: boolean;
    maxResults?: number;
  }
): FindDocumentOccurrencesResult {
  const text = typeof input?.text === 'string' ? input.text : '';
  const matchCase = !!input?.matchCase;
  const wholeWord = !!input?.wholeWord;
  const maxResults = Math.max(
    1,
    Math.min(
      MAX_LIVE_OCCURRENCES_PER_QUERY,
      Number.isFinite(input?.maxResults)
        ? Number(input.maxResults)
        : MAX_LIVE_OCCURRENCES_PER_QUERY
    )
  );
  const base = {
    query: { text, matchCase, wholeWord },
    count: 0,
    truncated: false,
    occurrences: [] as DocumentOccurrence[],
    source: 'live_syncfusion' as const,
    storyCoverage: {
      body: true as const,
      tables: true as const,
      headersFooters: false as const,
      footnotesEndnotes: true as const,
      textFrames: true as const
    },
    searchStoryCoverage: {
      body: true as const,
      tables: true as const,
      headersFooters: true as const,
      footnotesEndnotes: true as const,
      textFrames: true as const
    }
  };
  if (!text) return { ok: false, ...base, error: 'missing_text' };

  let search: any;
  try {
    search = editor.search;
  } catch {
    return { ok: false, ...base, error: 'search_unavailable' };
  }
  if (!search?.findAll || !search?.searchResults?.getTextSearchResultsOffset)
    return { ok: false, ...base, error: 'search_unavailable' };

  const previousStart = editor.selection?.startOffset;
  const previousEnd = editor.selection?.endOffset;
  try {
    // WholeWord cannot be delegated to SyncFusion while a tracked deletion is
    // adjacent to an insertion: replacing `Marlow` with `Torrey` leaves the two
    // runs neighbours, so its raw stream sees the single token `MarlowTorrey`
    // and neither word looks whole.
    // Always obtain public, selection-ready candidate ranges without the word
    // constraint, then evaluate word boundaries against current SFDT text.
    search.findAll(text, findOption(matchCase, false));
    // A zero-match findAll never populates the internal result list, and on a
    // fresh editor getTextSearchResultsOffset() then crashes on the undefined
    // list. An unpopulated list is an honest zero-occurrence result, not a
    // search failure.
    const offsets = (search as any).textSearchResults?.innerList
      ? search.searchResults.getTextSearchResultsOffset() ?? []
      : [];
    const sfdt = parseSfdt(editor.serialize());
    const byAnchor = new Map(
      flattenSfdt(sfdt).map((block) => [block.anchor, block] as const)
    );
    const occurrences: DocumentOccurrence[] = [];
    const rawCandidateOrdinals = new Map<string, number>();
    let count = 0;
    for (const result of offsets) {
      const startOffset = String(result?.startOffset ?? '');
      const endOffset = String(result?.endOffset ?? '');
      const start = offsetParts(startOffset);
      const end = offsetParts(endOffset);
      if (!start.anchor || start.anchor !== end.anchor) continue;
      const block = byAnchor.get(start.anchor);
      const rawOrdinal = rawCandidateOrdinals.get(start.anchor) ?? 0;
      rawCandidateOrdinals.set(start.anchor, rawOrdinal + 1);
      // `findAll` can expose a tracked deletion. For body/table stories we have
      // the serialized current-text projection, so reject a result that exists
      // only in deleted revision text. Header/footer/text-frame offsets remain
      // public and selectable even when SFDT lacks a stable story/page anchor.
      const frameText = !block
        ? currentTextFrameText(sfdt, start.anchor)
        : undefined;
      const currentText = block?.text ?? frameText;
      if (currentText !== undefined) {
        const currentOffsets = currentQueryOffsets(
          currentText,
          text,
          matchCase
        );
        const currentOffset = currentOffsets[rawOrdinal];
        if (
          currentOffset === undefined ||
          (wholeWord && !isWholeWordAt(currentText, currentOffset, text.length))
        )
          continue;
      }
      count++;
      if (occurrences.length >= maxResults) continue;
      editor.selection.select(startOffset, endOffset);
      const matchText = String(editor.selection.text ?? '');
      occurrences.push({
        anchor: start.anchor,
        kind: kindFromLiveAnchor(start.anchor, block),
        // Header/footer/note public offsets are selection-ready, but SFDT does
        // not expose their runtime page index. Return the exact matched span as
        // context in those stories rather than fabricate a non-selectable anchor.
        blockText: block?.text ?? matchText,
        matchText,
        start: start.offset,
        end: end.offset
      });
    }
    return {
      ok: true,
      ...base,
      count,
      truncated: count > occurrences.length,
      occurrences
    };
  } catch {
    return { ok: false, ...base, error: 'search_failed' };
  } finally {
    if (typeof previousStart === 'string' && typeof previousEnd === 'string')
      editor.selection.select(previousStart, previousEnd);
  }
}

// A bounded, live-editor-only occurrence API. `queries` batches candidate
// spellings from AI-side reconciliation into one bridge request; every result
// still comes from SyncFusion's current editor model and is independently
// anchored. No generated-document index or embedding result participates here.
type OccurrenceQuery = {
  text?: string;
  matchCase?: boolean;
  wholeWord?: boolean;
  maxResults?: number;
};

export function findDocumentOccurrences(
  editor: LiveEditor,
  input: OccurrenceQuery
): FindDocumentOccurrencesResult;
export function findDocumentOccurrences(
  editor: LiveEditor,
  input: OccurrenceQuery & {
    queries: Array<string | OccurrenceQuery>;
  }
): FindDocumentOccurrencesBatchResult;
export function findDocumentOccurrences(
  editor: LiveEditor,
  input: OccurrenceQuery & { queries?: Array<string | OccurrenceQuery> }
): FindDocumentOccurrencesResult | FindDocumentOccurrencesBatchResult {
  if (!Array.isArray(input?.queries))
    return findOneDocumentOccurrences(editor, input);
  const supplied = input.queries;
  const queries = supplied.slice(0, MAX_LIVE_OCCURRENCE_QUERIES);
  const results = queries.map((query) =>
    findOneDocumentOccurrences(
      editor,
      typeof query === 'string'
        ? {
            text: query,
            matchCase: input.matchCase,
            wholeWord: input.wholeWord,
            maxResults: input.maxResults
          }
        : {
            text: query?.text,
            matchCase: query?.matchCase ?? input.matchCase,
            wholeWord: query?.wholeWord ?? input.wholeWord,
            maxResults: query?.maxResults ?? input.maxResults
          }
    )
  );
  return {
    ok: results.every((result) => result.ok),
    results,
    truncated:
      supplied.length > queries.length ||
      results.some((result) => result.truncated),
    source: 'live_syncfusion',
    storyCoverage: {
      body: true,
      tables: true,
      headersFooters: false,
      footnotesEndnotes: true,
      textFrames: true
    },
    searchStoryCoverage: {
      body: true,
      tables: true,
      headersFooters: true,
      footnotesEndnotes: true,
      textFrames: true
    }
  };
}

// Strip the trailing offset from a SyncFusion hierarchical index to get the
// block anchor. "0;3;5" -> "0;3"; a table cell "0;2;0;1;0;4" -> "0;2;0;1;0".
export function anchorFromOffset(offset: string): string {
  const parts = String(offset ?? '').split(';');
  if (parts.length <= 1) return offset ?? '';
  parts.pop();
  return parts.join(';');
}

// Selection context sent with an assistant request: the caret's anchor, up to
// 500 characters of selected text, whether the selection is collapsed, and the
// selection's full public extent (start/end offsets, end block, untruncated
// length). The extent is what makes a selection addressable: a selection is the
// strongest statement of intent a user can make, and reporting only its start
// block reduced "these three paragraphs" to "somewhere in this one".
export function readSelection(editor: LiveEditor): SelectionContext | null {
  const sel = editor?.selection;
  if (!sel || typeof sel.startOffset !== 'string') return null;
  const anchor = anchorFromOffset(sel.startOffset);
  if (!anchor) return null;
  const text = typeof sel.text === 'string' ? sel.text : '';
  const startOffset = sel.startOffset;
  const endOffset =
    typeof sel.endOffset === 'string' ? sel.endOffset : startOffset;
  const endAnchor = anchorFromOffset(endOffset) || anchor;
  const isCollapsed =
    sel.isEmpty != null ? !!sel.isEmpty : startOffset === endOffset;
  return {
    anchor,
    text: text.slice(0, SELECTION_TEXT_LIMIT),
    isCollapsed,
    startOffset,
    endOffset,
    endAnchor,
    textLength: text.length,
    truncated: text.length > SELECTION_TEXT_LIMIT,
    spansBlocks: endAnchor !== anchor
  };
}

// ---------------------------------------------------------------------------
// Live apply engine
// ---------------------------------------------------------------------------

// Anchorless ops, derived from the registry (requiresAnchor: false) minus the
// executor-special-cased replace_all. The two unadvertised global-history ops
// keep their membership by hand: the executor refuses undo/redo before any
// dispatch (UNSAFE_CHANGE_SET_OPS), but batch-shape classification
// (hasStructuralEdits) still consults this set for every submitted op, so
// dropping them would relabel preflight failures in batches that contain one.
const ANCHORLESS_OPS: ReadonlySet<string> = new Set<string>([
  'undo',
  'redo',
  ...DOCUMENT_EDITOR_CAPABILITIES.filter(
    (entry) => !entry.requiresAnchor && entry.op !== 'replace_all'
  ).map((entry) => entry.op)
]);

// This executor is exposed only to the assistant tool bridge. SyncFusion undo
// and redo operate on global editor history, so an AI repair could erase a
// user's unrelated earlier work. Human toolbar undo/redo calls SyncFusion
// directly and is intentionally unaffected.
const UNSAFE_CHANGE_SET_OPS = new Set(['undo', 'redo']);

class OpError extends Error {
  code: string;
  details?: string[];
  retry?: 'never';
  constructor(
    code: string,
    message?: string,
    details?: string[],
    retry?: 'never'
  ) {
    super(message ?? code);
    // The shipped ES5 emit runs `Error.call(this, message) || this`, and
    // Error-as-a-function returns a fresh plain Error, so without this the
    // constructed object is not an OpError instance at runtime and every
    // structured code degrades to a bare `op_failed` in the browser.
    Object.setPrototypeOf(this, OpError.prototype);
    this.name = 'OpError';
    this.code = code;
    this.details = details;
    this.retry = retry;
  }
}

// instanceof alone is not trusted for OpError: the ES5 build defect above
// shipped exactly that way, and a double-loaded module (cjs + esm) breaks
// instanceof across copies too. The name+code brand survives both.
function isOpError(err: unknown): err is OpError {
  return (
    err instanceof OpError ||
    (err instanceof Error &&
      err.name === 'OpError' &&
      typeof (err as OpError).code === 'string')
  );
}

// A non-OpError throw is a defect surfacing through SyncFusion or the engine
// itself. The result must still carry enough to diagnose and adapt - the
// error's type and message - without leaking a stack trace into a prompt.
const UNEXPECTED_ERROR_MESSAGE_LIMIT = 300;
function describeUnexpectedError(err: unknown): string {
  const name =
    err instanceof Error && err.name && err.name !== 'Error'
      ? `${err.name}: `
      : '';
  const message =
    err instanceof Error
      ? err.message || 'unknown error'
      : String(err ?? 'unknown error');
  const described = `${name}${message.split('\n', 1)[0]}`;
  return described.length > UNEXPECTED_ERROR_MESSAGE_LIMIT
    ? `${described.slice(0, UNEXPECTED_ERROR_MESSAGE_LIMIT - 1)}…`
    : described;
}

// ---------------------------------------------------------------------------
// The `expect` compare-and-swap guard
// ---------------------------------------------------------------------------
//
// `expect` is the text the model believes is still at an anchor. On mismatch the
// op writes nothing, so an edit cannot land on content that moved or changed
// under it. That protection is the point and is not relaxed here.
//
// What IS fixed is two ways the guard refused correct work, plus its name.
// Live evidence (2026-07-27): every refusal in a 30-minute window but one was a
// misfire, and the name sent three investigations hunting positional anchor
// drift that this module has never measured - there is no anchor-revision map
// anywhere in it. Worse, the name made the advice wrong: the model was told to
// re-read the inventory and correct the anchor, which cannot help when the anchor
// was right, so it burned round trips re-reading unchanged content.

/**
 * A paragraph mark is not content.
 *
 * `editor.selection.text` for a whole-paragraph selection ends with `\r`;
 * inventory/block text never does. So the selection the client hands the model -
 * the designed zero-read fast path for "rewrite this" - produced an `expect`
 * that could not satisfy the guard no matter how faithfully it was copied.
 *
 * Only trailing paragraph marks are normalised. A trailing SPACE is real content
 * and still counts as a difference; forgiving whitespace generally would be
 * weakening the guard rather than un-breaking it.
 */
const withoutParagraphMark = (text: string): string =>
  text.replace(/[\r\n]+$/, '');

const expectTextMatches = (expected: unknown, live: string): boolean =>
  withoutParagraphMark(String(expected)) === withoutParagraphMark(live);

/**
 * Whether the compare-and-swap must refuse this write.
 *
 * One decision function for every guard site, because four hand-copied
 * conditions is how they drift apart.
 *
 * An empty `expect` is treated as ABSENT. The declared op object carries every
 * field on every op, so the model fills the ones an op does not use with neutral
 * placeholders, and `expect: ""` arrived on structural ops that have no
 * expectation to state - refusing them against any non-empty reference block.
 * This module already accepted that reasoning for formatting ops (see the
 * `formatExpectMismatch` branch below, whose comment says exactly this); the
 * same placeholder now means the same thing everywhere. Note that an empty
 * `expect` against a genuinely empty block passed before and passes now, so no
 * satisfiable expectation is being discarded - and the surviving guards
 * (anchor resolution, the `find`-text check, and the tracked-write reject
 * projection) are untouched.
 */
function expectGuardRefuses(expected: unknown, live: string): boolean {
  if (expected == null) return false;
  const wanted = String(expected);
  if (wanted === '') return false;
  return !expectTextMatches(wanted, live);
}

// An expect_mismatch refusal must name what actually mismatched, or the model
// re-reads the inventory, gets the same anchor back, and re-sends the same
// request forever (observed live: 7+ identical round trips). The live text is
// the one fact that lets the next attempt differ.
const STALE_TEXT_EXCERPT_LIMIT = 300;
function staleAnchorDetails(expected: unknown, live: string): string[] {
  const cap = (text: string) =>
    text.length > STALE_TEXT_EXCERPT_LIMIT
      ? `${text.slice(0, STALE_TEXT_EXCERPT_LIMIT - 1)}…`
      : text;
  return [
    `expect: ${JSON.stringify(cap(String(expected)))}`,
    `live text at this anchor: ${JSON.stringify(cap(live))}`,
    'The live text is authoritative. If this edit is still intended, resend it with `expect` copied from the live text above (or omit `expect`). Re-sending the same `expect` will fail identically every time.'
  ];
}

// Selects the whole block described by a FlatBlock and returns the live text.
function selectBlock(editor: LiveEditor, block: FlatBlock): string {
  editor.selection.select(
    `${block.anchor};0`,
    `${block.anchor};${block.length}`
  );
  return editor.selection.text ?? '';
}

// A text-only range does not necessarily include the paragraph mark. SyncFusion
// applies paragraph properties to paragraphs covered by that mark, so include it
// whenever we read or write paragraph formatting. Character formatting continues
// to use selectBlock/selectRange and therefore cannot spill into the next block.
function selectParagraph(editor: LiveEditor, block: FlatBlock): void {
  editor.selection.select(
    `${block.anchor};0`,
    `${block.anchor};${block.length + 1}`
  );
}

function selectRange(
  editor: LiveEditor,
  anchor: string,
  startOffset: number,
  endOffset: number
): void {
  editor.selection.select(`${anchor};${startOffset}`, `${anchor};${endOffset}`);
}

function freshBlock(editor: LiveEditor, anchor: string): FlatBlock | undefined {
  return flattenSfdt(parseSfdt(editor.serialize())).find(
    (block) => block.anchor === anchor
  );
}

// What the whole document would read if every revision were rejected: pending
// insertions dropped, pending deletions restored, and a paragraph whose mark is
// itself a pending insertion merged into its successor - because that is what
// rejecting the mark does. This is the exact projection the byte-for-byte
// integrity tests assert globally, evaluated as one content stream so a single
// write can be proven reversible the moment it lands. A per-anchor comparison
// is NOT equivalent: a paragraph-splitting insert (position "before" / any
// offset short of the block end) legitimately moves the pre-existing text off
// its index, so the anchor's new occupant is a different logical block.
//
// Text-frame content is included. It lives in the serialized SFDT exactly like
// any other content - as `inline.textFrame.blocks`, which is where
// currentTextFrameText already reads it - but this walk used to skip it, so a
// text-frame write had no projection to be proven by and fell back to a
// revision-type guess: the very heuristic this projection was introduced to
// replace, carrying the very false negative it was introduced to fix.
// Exported for its own test: this projection IS the tracked-write proof, so
// "does it actually see the content it claims to cover" has to be assertable
// directly. A projection blind to a story would pass every write in it
// vacuously - which is exactly how text-frame writes went unverified.
export function rejectProjectionStream(sfdt: any): string {
  const dropIds = insertedRevisionIds(sfdt);
  const allDropped = (rids: unknown): boolean =>
    Array.isArray(rids) &&
    rids.length > 0 &&
    rids.every((id) => dropIds.has(String(id)));
  const out: string[] = [];
  const pushParagraph = (block: any) => {
    const inlines = getInlines(block);
    out.push(inlineText(inlines, dropIds));
    const markRevisionIds = pick(
      pick(block, 'characterFormat', 'cf'),
      'revisionIds',
      'rids'
    );
    // Rejecting an inserted paragraph mark joins this paragraph with the next
    // one, so an inserted mark contributes no separator to the projection.
    if (!allDropped(markRevisionIds)) out.push('\n');
    // A shape anchored in this paragraph carries its own block stream. Emitted
    // after the host paragraph and fenced by a control character, so frame
    // content can never read as body content and a frame boundary that moved
    // cannot look like an unchanged stream.
    for (const inline of inlines) {
      const textFrame = pick(inline, 'textFrame', 'tf');
      if (!textFrame) continue;
      out.push('\u000e');
      for (const frameBlock of getBlocks(textFrame)) pushParagraph(frameBlock);
      out.push('\u000e');
    }
  };
  const sections: any[] = pick(sfdt, 'sections', 'sec') ?? [];
  for (const section of sections) {
    for (const block of getBlocks(section)) {
      const rows = getRows(block);
      if (rows) {
        for (const row of rows) {
          const cells: any[] = pick(row, 'cells', 'c') ?? [];
          for (const cell of cells) {
            for (const cellBlock of getBlocks(cell)) pushParagraph(cellBlock);
            // Word's cell-end control character: keeps a moved cell boundary
            // from reading as an unchanged text stream.
            out.push('\u0007');
          }
          out.push('\r');
        }
      } else {
        pushParagraph(block);
      }
    }
    out.push('\f');
  }
  return out.join('');
}

interface LiveStoryTarget {
  anchor: string;
  startOffset: string;
  endOffset: string;
  start: number;
  end: number;
  text: string;
}

function isLiveStoryAnchor(anchor: string): boolean {
  return !!liveStoryMarker(anchor);
}

function isUnverifiedStoryWriteAnchor(anchor: string): boolean {
  const marker = liveStoryMarker(anchor);
  return marker === 'H' || marker === 'F';
}

// A shape/text-frame anchor. Its content is serialized into the SFDT (as
// `inline.textFrame.blocks`), so unlike other live stories it can be proven
// reversible by the whole-document reject projection.
function isTextFrameAnchor(anchor: string): boolean {
  return liveStoryMarker(anchor) === 'S';
}

function isLiveStoryTarget(
  target: FlatBlock | LiveStoryTarget
): target is LiveStoryTarget {
  return 'startOffset' in target;
}

// Story/page anchors are intentionally absent from serialized SFDT. Resolve
// them from the exact public range which live search supplied instead of trying
// to synthesize a parallel SFDT anchor space. `start`/`end` identify a specific
// occurrence when the story contains the same spelling more than once.
function resolveLiveStoryTarget(
  editor: LiveEditor,
  op: EditOp
): LiveStoryTarget {
  const anchor = String(op.anchor ?? '');
  const find = String(op.find ?? '');
  if (!isLiveStoryAnchor(anchor))
    throw new OpError(
      'anchor_not_found',
      `No block found for anchor "${anchor}".`
    );
  if (!find)
    throw new OpError(
      'missing_find',
      'Story replacement needs the searched match text in `find`.'
    );

  let search: any;
  try {
    search = editor.search;
  } catch {
    search = undefined;
  }
  if (!search?.findAll || !search?.searchResults?.getTextSearchResultsOffset)
    throw new OpError(
      'search_unavailable',
      'Story replacement requires SyncFusion Search in the live editor.'
    );

  try {
    search.findAll(find, 'CaseSensitive');
    const matches = (search.searchResults.getTextSearchResultsOffset() ?? [])
      .map((result: any) => {
        const startOffset = String(result?.startOffset ?? '');
        const endOffset = String(result?.endOffset ?? '');
        const start = offsetParts(startOffset);
        const end = offsetParts(endOffset);
        return { startOffset, endOffset, start, end };
      })
      .filter(
        (range: any) =>
          range.start.anchor === anchor && range.end.anchor === anchor
      );
    if (!matches.length)
      throw new OpError(
        'stale_anchor',
        `The searched range at story anchor "${anchor}" changed since it was read.`
      );
    // Same rule as the body path: `start` separates several occurrences of one
    // spelling, it does not invalidate the single range search resolved. `end`
    // is fully determined by `find` and the match start, so a model-counted
    // `end` never gets a vote. See pickOffsetDisambiguatedMatch.
    const match =
      matches.length === 1
        ? matches[0]
        : (() => {
            const byModelStart =
              typeof op.start === 'number'
                ? matches.filter(
                    (range: any) => range.start.offset === op.start
                  )
                : ([] as any[]);
            if (byModelStart.length === 1) return byModelStart[0];
            throw new OpError(
              'story_range_ambiguous',
              `Story anchor "${anchor}" has ${matches.length} matching public search ranges.`,
              [
                `candidate start offsets: ${matches
                  .map((range: any) => range.start.offset)
                  .join(', ')}`,
                'Send `start` set to the character offset of the occurrence you mean, or narrow `find` until it is unique in this story.'
              ]
            );
          })();
    editor.selection.select(match.startOffset, match.endOffset);
    const text = String(editor.selection.text ?? '');
    if (text !== find)
      throw new OpError(
        'exact_match_range_mismatch',
        `SyncFusion selected ${JSON.stringify(
          text
        )} instead of ${JSON.stringify(find)} at "${anchor}".`
      );
    if (expectGuardRefuses(op.expect, text))
      throw new OpError(
        'expect_mismatch',
        'The live text at this anchor does not match `expect`.',
        staleAnchorDetails(op.expect, text)
      );
    return {
      anchor,
      startOffset: match.startOffset,
      endOffset: match.endOffset,
      start: match.start.offset,
      end: match.end.offset,
      text
    };
  } catch (error) {
    if (isOpError(error)) throw error;
    throw new OpError(
      'search_failed',
      `SyncFusion could not resolve the searched story range for "${find}".`
    );
  }
}

function verifyLiveStoryWrite(
  editor: LiveEditor,
  target: LiveStoryTarget,
  replacement: string
): void {
  // Story offsets are public selection addresses, but cannot safely be rebuilt
  // from a character count (text frames add story-local segments). Re-search
  // the written text and select SyncFusion's returned range instead.
  const search = editor.search;
  if (!search?.findAll || !search?.searchResults?.getTextSearchResultsOffset)
    throw new OpError(
      'search_unavailable',
      'Story post-write verification requires SyncFusion Search.'
    );
  search.findAll(replacement, 'CaseSensitive');
  const matches = (
    search.searchResults.getTextSearchResultsOffset() ?? []
  ).filter((result: any) => {
    const start = offsetParts(String(result?.startOffset ?? ''));
    const end = offsetParts(String(result?.endOffset ?? ''));
    return start.anchor === target.anchor && end.anchor === target.anchor;
  });
  if (matches.length !== 1)
    throw new OpError(
      'text_verification_failed',
      `Text verification failed at "${target.anchor}".`,
      [
        `expected: ${JSON.stringify(replacement)}`,
        `matching public ranges: ${matches.length}`
      ]
    );
  const match = matches[0];
  editor.selection.select(String(match.startOffset), String(match.endOffset));
  const actual = String(editor.selection.text ?? '');
  if (actual !== replacement)
    throw new OpError(
      'text_verification_failed',
      `Text verification failed at "${target.anchor}".`,
      [
        `expected: ${JSON.stringify(replacement)}`,
        `actual: ${JSON.stringify(actual)}`
      ]
    );
}

function applyLiveStoryTextOp(
  editor: LiveEditor,
  op: EditOp,
  target: LiveStoryTarget
): void {
  observeMutationGuardBoundary(op, 'find_content');
  if (op.op !== 'replace_text' && op.op !== 'delete_text')
    throw new OpError(
      'unsupported_story_op',
      `${op.op} is not supported for a live story range.`
    );
  const find = String(op.find ?? '');
  if (!find) throw new OpError('missing_find', `${op.op} needs find.`);

  // Select the search range that preflight read. This is the public
  // Selection API counterpart of the exact range, not an SFDT-derived range.
  //
  // This one keeps the name `stale_anchor`, and now deserves it: both sides of
  // this comparison are read by the engine itself - what preflight resolved
  // versus what is there at write time - so a mismatch really is the target
  // moving underneath a resolved range. It is never a model-supplied value, so
  // it cannot misfire the way the `expect` guard did.
  editor.selection.select(target.startOffset, target.endOffset);
  if (String(editor.selection.text ?? '') !== target.text)
    throw new OpError(
      'stale_anchor',
      'The text at this anchor changed between preflight and the write.',
      staleAnchorDetails(target.text, String(editor.selection.text ?? ''))
    );
  const replacement =
    op.op === 'delete_text'
      ? ''
      : String(op.replace ?? op.text ?? op.newText ?? '');
  replaceSelectedText(editor, replacement);
  verifyLiveStoryWrite(editor, target, replacement);
}

function replaceSelectedText(editor: LiveEditor, replacement: string): void {
  // `insertText` is SyncFusion's public replacement primitive for an active
  // selection. Do not split a replace into delete()+insertText(): in a live
  // table/story selection, delete() can consume structural content outside the
  // text span and (critically) bypass track changes before the insert occurs.
  // A single selected-range insert creates the paired deletion/insertion
  // revisions atomically.
  editor.editor.insertText(replacement);
}

// `start`/`end` are a DISAMBIGUATOR among several matches of the same spelling,
// never a validity test on a match SyncFusion already resolved.
//
// They used to be an equality filter, and that is what killed the captain's
// selection rewrite (2026-07-27 14:2x EDT, ai-services-3002.log line 26661):
// the model sent a 457-character `find` with `end: 0` on the first attempt
// (the tool schema fills every field, so an unset `end` arrives as 0) and
// `end: 451` on the two retries - it tried to count the characters and was off
// by six. Search had found the range perfectly, at 0..457, all three times.
// The filter threw it away and reported `exact_match_range_not_found`, so a
// paragraph that was sitting right there under the user's own selection was
// declared missing three times and the turn ended in "please do it by hand".
//
// A character offset is a value the model has to COUNT, and it cannot count.
// The live search result is authoritative for WHERE the text is; `expect` -
// which the model COPIES, and which stays exactly as strict as it was - remains
// the guard for WHETHER the text is still what it thought. So a single
// candidate wins outright, and several occurrences of one spelling are
// separated by `start` if it names one of them, otherwise by the offset
// preflight itself found. `end` never gets a vote: it is fully determined by
// `find` plus the match start, so a model-counted `end` can only ever be noise.
function pickOffsetDisambiguatedMatch(
  candidates: any[],
  index: number,
  op: EditOp
): any {
  if (candidates.length <= 1) return candidates[0];
  const startsAt = (offset: number) =>
    candidates.find(
      (result: any) =>
        offsetParts(String(result?.startOffset ?? '')).offset === offset
    );
  return (
    (typeof op.start === 'number' ? startsAt(op.start) : undefined) ??
    startsAt(index)
  );
}

// SyncFusion's public search result offsets are the only reliable way to
// select an exact match which crosses text runs. Constructing an end offset
// from a string length is not equivalent in every story/run shape (and can
// select a neighbouring character). Keep a small compatibility fallback for
// lightweight test doubles that do not inject Search; live editor writes use
// the public search result range.
function selectExactMatch(
  editor: LiveEditor,
  block: FlatBlock,
  find: string,
  index: number,
  op: EditOp
): boolean {
  let search: any;
  try {
    search = editor.search;
  } catch {
    search = undefined;
  }
  if (!search?.findAll || !search?.searchResults?.getTextSearchResultsOffset) {
    // A mounted DocumentEditor must have public Search before an assistant can
    // perform a scoped replacement. Refuse the write rather than manufacture
    // an ambiguous range; only small non-DOM test doubles use the fallback.
    if ((editor as any).element || (editor as any).documentHelper)
      throw new OpError(
        'search_unavailable',
        'Scoped replacement requires SyncFusion Search in the live editor.'
      );
    selectRange(editor, block.anchor, index, index + find.length);
    return false;
  }

  try {
    search.findAll(find, 'CaseSensitive');
    const candidates = (
      search.searchResults.getTextSearchResultsOffset() ?? []
    ).filter((result: any) => {
      const start = offsetParts(String(result?.startOffset ?? ''));
      const end = offsetParts(String(result?.endOffset ?? ''));
      return start.anchor === block.anchor && end.anchor === block.anchor;
    });
    const match = pickOffsetDisambiguatedMatch(candidates, index, op);
    if (!match)
      throw new OpError(
        'exact_match_range_not_found',
        `SyncFusion could not resolve an exact selected range for "${find}" at "${block.anchor}".`
      );
    editor.selection.select(String(match.startOffset), String(match.endOffset));
    // Some DocumentEditor stories represent the public result end as the
    // following insertion position, so Selection includes a following visible
    // delimiter. Preserve that explicitly instead of silently deleting it.
    // (The replacement is still performed only through delete()+insertText().)
    const selected = String(editor.selection.text ?? '');
    if (!selected.startsWith(find))
      throw new OpError(
        'exact_match_range_mismatch',
        `SyncFusion selected ${JSON.stringify(
          selected
        )} instead of the requested ${JSON.stringify(find)} at "${
          block.anchor
        }".`
      );
    return true;
  } catch (error) {
    if (isOpError(error)) throw error;
    throw new OpError(
      'search_failed',
      `SyncFusion could not resolve an exact selected range for "${find}".`
    );
  }
}

// ---------------------------------------------------------------------------
// replace_selection: the user's own range as the edit target.
// ---------------------------------------------------------------------------

interface SelectionRange {
  startOffset: string;
  endOffset: string;
  startAnchor: string;
  endAnchor: string;
  text: string;
}

// Numeric, part-by-part comparison of two hierarchical indices. Lexicographic
// string comparison is wrong here ("0;10" sorts before "0;9").
function compareOffsets(left: string, right: string): number {
  const a = String(left).split(';').map(Number);
  const b = String(right).split(';').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? -1;
    const y = b[i] ?? -1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// A cell anchor is `section;block;row;cell;paragraph`; a body block is
// `section;block`. The container is what a text range may not cross: SyncFusion
// has no tracked, reversible way to replace a span that swallows a cell or table
// boundary, so those shapes are refused by name instead of written and hoped for.
function rangeContainer(anchor: string): string {
  const parts = String(anchor).split(';');
  return parts.length >= 5 ? parts.slice(0, 4).join(';') : parts[0] ?? '';
}

function offsetString(value: unknown): string {
  return typeof value === 'string' && /^\d+(;\d+)+$/.test(value.trim())
    ? value.trim()
    : '';
}

function resolveSelectionRange(
  editor: LiveEditor,
  op: EditOp,
  block: FlatBlock,
  byAnchor: Map<string, FlatBlock>
): SelectionRange {
  // Schema-shaped tool calls carry every field on every op, so an unusable
  // offset (empty string, or a malformed one) means "not supplied" rather than
  // "supplied wrongly". Falling back to the anchored block is the honest
  // reading: that block IS the selection when the selection sits inside one.
  const startOffset = offsetString(op.startOffset) || `${block.anchor};0`;
  const endOffset =
    offsetString(op.endOffset) || `${block.anchor};${block.length}`;
  const start = offsetParts(startOffset);
  const end = offsetParts(endOffset);
  if (start.anchor !== block.anchor)
    throw new OpError(
      'selection_anchor_mismatch',
      `startOffset "${startOffset}" is in block "${start.anchor}", but the op's anchor is "${block.anchor}".`,
      [
        "Set `anchor` to the selection's start block - the `anchor` field of the selection context - and `startOffset`/`endOffset` to its offsets, all copied verbatim."
      ]
    );
  const endBlock =
    end.anchor === block.anchor ? block : byAnchor.get(end.anchor);
  if (!endBlock)
    throw new OpError(
      'selection_range_unresolvable',
      `endOffset "${endOffset}" names block "${end.anchor}", which is not in the document.`,
      [
        'Re-read the selection context (or the section inventory) and resend `startOffset`/`endOffset` copied verbatim from it.'
      ]
    );
  if (compareOffsets(startOffset, endOffset) > 0)
    throw new OpError(
      'selection_range_unresolvable',
      `startOffset "${startOffset}" comes after endOffset "${endOffset}".`,
      [
        'Send the offsets in document order, copied verbatim from the selection.'
      ]
    );
  // The paragraph mark is a legal end position, hence length + 1.
  if (start.offset < 0 || start.offset > block.length)
    throw new OpError(
      'selection_range_unresolvable',
      `startOffset "${startOffset}" is outside block "${block.anchor}" (length ${block.length}).`,
      ['Re-read the selection and resend its offsets verbatim.']
    );
  if (end.offset < 0 || end.offset > endBlock.length + 1)
    throw new OpError(
      'selection_range_unresolvable',
      `endOffset "${endOffset}" is outside block "${end.anchor}" (length ${endBlock.length}).`,
      ['Re-read the selection and resend its offsets verbatim.']
    );
  if (rangeContainer(block.anchor) !== rangeContainer(endBlock.anchor))
    throw new OpError(
      'selection_spans_table_boundary',
      `The selection runs from "${block.anchor}" to "${endBlock.anchor}", crossing a table-cell boundary. SyncFusion cannot replace such a span as one reversible tracked range.`,
      [
        `selection start block: "${block.anchor}"; selection end block: "${endBlock.anchor}"`,
        'Rewrite one cell at a time: use replace_selection (or set_cell_text) per cell anchor.',
        'A selection that starts in the body and ends inside a table - or spans two cells - has to be split this way; there is no single tracked range that covers it.'
      ]
    );
  editor.selection.select(startOffset, endOffset);
  const text = String(editor.selection.text ?? '');
  if (!text)
    throw new OpError(
      'selection_empty',
      `The range ${startOffset}..${endOffset} selects no text.`,
      [
        'Select the text to rewrite before asking for a rewrite, or use insert_text at this anchor to add text instead of replacing it.'
      ]
    );
  return {
    startOffset,
    endOffset,
    startAnchor: block.anchor,
    endAnchor: endBlock.anchor,
    text
  };
}

// The compare-and-swap for a selection range. It is exactly as strict as the
// block-level `expect` guard, just scoped to the range the user actually
// selected rather than to the start block (whose text is not the selection when
// the selection spans paragraphs).
//
// `expectLength` exists because the selection text delivered to the model is
// capped at SELECTION_TEXT_LIMIT: past that the model CANNOT supply the whole
// text, and a guard nothing can satisfy is the defect this whole change is
// about. Prefix + exact length is still a real compare-and-swap - it pins every
// delivered character and the total size - not a wildcard.
function assertSelectionGuard(op: EditOp, range: SelectionRange): void {
  const expect =
    op.expect != null && String(op.expect) !== '' ? String(op.expect) : null;
  // A schema-filled 0 is indistinguishable from an unset length, and a
  // zero-length range is already refused as selection_empty.
  const expectLength =
    typeof op.expectLength === 'number' && op.expectLength > 0
      ? op.expectLength
      : null;
  if (expect == null && expectLength == null)
    throw new OpError(
      'missing_selection_guard',
      'replace_selection must state what it believes it is replacing.',
      [
        `live text at this range: ${JSON.stringify(
          range.text.length > STALE_TEXT_EXCERPT_LIMIT
            ? `${range.text.slice(0, STALE_TEXT_EXCERPT_LIMIT - 1)}…`
            : range.text
        )}`,
        "Resend with `expect` set to the selected text (copy it from the selection context), or with `expectLength` set to the selection's `textLength` when that text was truncated."
      ]
    );
  if (expectLength != null && range.text.length !== expectLength)
    throw new OpError(
      'stale_anchor',
      `The selected range is ${range.text.length} characters; \`expectLength\` says ${expectLength}.`,
      [
        `the selected range is ${range.text.length} characters, \`expectLength\` says ${expectLength}`,
        ...staleAnchorDetails(
          expect ?? `<${expectLength} characters>`,
          range.text
        )
      ]
    );
  if (expect == null) return;
  // With a length pin the delivered prefix is authoritative for its own extent;
  // without one the whole text must match exactly, as it always has.
  const matches =
    expectLength != null
      ? range.text.startsWith(expect)
      : range.text === expect;
  if (!matches)
    throw new OpError(
      'stale_anchor',
      'The live text in the selected range does not match `expect`.',
      staleAnchorDetails(expect, range.text)
    );
}

// Proof the replacement is readable in the document after the write. A range
// that spanned paragraphs collapses them, so the text may land on any block of
// the original span (SyncFusion keeps the deleted paragraph marks as tracked
// deletions until the revision is accepted) - the span, not one anchor, is what
// can be asserted. Reversibility itself is proven separately and globally by
// assertTrackedMutation's reject-projection comparison.
function verifySelectionWrite(
  editor: LiveEditor,
  range: SelectionRange,
  replacement: string
): void {
  if (!replacement) return;
  const blocks = flattenSfdt(parseSfdt(editor.serialize()));
  const startIndex = blocks.findIndex(
    (block) => block.anchor === range.startAnchor
  );
  if (startIndex < 0)
    throw new OpError(
      'post_write_anchor_not_found',
      `The edited anchor "${range.startAnchor}" disappeared after the write.`
    );
  const endIndex = blocks.findIndex(
    (block) => block.anchor === range.endAnchor
  );
  const span = blocks
    .slice(startIndex, Math.max(endIndex, startIndex) + 1)
    .map((block) => block.text)
    .join('\n');
  if (!span.includes(replacement))
    throw new OpError(
      'text_verification_failed',
      `Text verification failed across "${range.startAnchor}".."${range.endAnchor}".`,
      [
        `expected to contain: ${JSON.stringify(replacement)}`,
        `actual: ${JSON.stringify(span)}`
      ]
    );
}

function verifyWrittenText(
  editor: LiveEditor,
  anchor: string,
  expected: string
): void {
  const current = freshBlock(editor, anchor);
  if (!current)
    throw new OpError(
      'post_write_anchor_not_found',
      `The edited anchor "${anchor}" disappeared after the write.`
    );
  // The selection API includes deleted tracked-revision runs in its raw text.
  // `freshBlock` projects the live SFDT to current text (skipping Deletion
  // revisions), so this verifies what the document resolves to while preserving
  // the native insertion/deletion revisions for review.
  const actual = current.text;
  if (actual !== expected) {
    throw new OpError(
      'text_verification_failed',
      `Text verification failed at "${anchor}".`,
      [
        `expected: ${JSON.stringify(expected)}`,
        `actual: ${JSON.stringify(actual)}`
      ]
    );
  }
}

// SyncFusion's table structure methods default a missing/invalid count to 1.
function positiveCount(value: unknown): number {
  const n = typeof value === 'number' ? Math.floor(value) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function changeCase(text: string, caseType: string): string {
  switch (caseType) {
    case 'uppercase':
    case 'UPPERCASE':
      return text.toUpperCase();
    case 'lowercase':
      return text.toLowerCase();
    case 'capitalize':
    case 'titlecase':
      return text.replace(/\b\w/g, (c) => c.toUpperCase());
    case 'sentencecase':
      return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    default:
      return text;
  }
}

// ---------------------------------------------------------------------------
// Typed op handlers (S5)
//
// One handler per registry entry, typed against that entry: the handler's op
// parameter is derived from the entry's `params` block, so a handler that
// consumes a param the registry does not declare - or a registry entry with no
// handler, or a handler for an op the registry does not advertise - fails to
// compile. The registry is the single source of truth; before S5 the dispatch
// switch was a parallel universe kept in agreement only by a test.
//
// Ops still arrive at the executor as untyped model-authored JSON (EditOp).
// The untyped->typed transition happens once, at each dispatch site, behind
// the runtime `unknown op` refusal - handlers stay defensive about field
// VALUES (String(...)/coercions), while field NAMES and declared types are the
// compiler's job.
// ---------------------------------------------------------------------------

/**
 * Cross-op fields every op may carry, per the registry's reserved-key list:
 * they have one canonical meaning and are deliberately not repeated in each
 * entry's `params`.
 */
interface ReservedOpFields {
  anchor?: string;
  expect?: string;
  start?: number;
  end?: number;
  inheritFormatFrom?: string;
  /**
   * Belt-and-braces nested variant tolerated for model variance: when a flat
   * formatting field is absent, fmtField also reads `op.format.<key>`. Not
   * advertised in the registry.
   */
  format?: Record<string, unknown>;
  /**
   * Engine-internal: the preflight-captured source-format snapshot the
   * executor attaches to a formatting op before phase-3 dispatch.
   */
  __inheritedFormat?: {
    characterFormat?: FormatBag;
    paragraphFormat?: FormatBag;
  };
}

/**
 * Runtime tolerance BEYOND the declaration, spelled out per op so it stays
 * visible in the type system instead of hiding behind an index signature.
 * These fields are not advertised: the registry remains the declared truth,
 * and this interface is the complete list of undeclared fields any handler
 * consumes.
 */
interface RuntimeToleratedFields {
  /** Model-variance aliases for `replace`; `replace` wins when present. */
  replace_text: { text?: unknown; newText?: unknown };
}

type ToleratedFields<K extends AdvertisedDocumentOp> =
  K extends keyof RuntimeToleratedFields ? RuntimeToleratedFields[K] : unknown;

/** One op as its registry entry declares it, plus the reserved fields. */
export type TypedEditOp<K extends AdvertisedDocumentOp> = {
  op: K;
} & OpParams<K> &
  ToleratedFields<K> &
  ReservedOpFields;

interface AnchoredOpContext<K extends AnchoredDocumentOp> {
  editor: LiveEditor;
  op: TypedEditOp<K>;
  /** The freshly-resolved target block. */
  block: FlatBlock;
  byAnchor: Map<string, FlatBlock>;
  /** The block's live selection text, read by the CAS guard before dispatch. */
  liveText: string;
}

/**
 * Extra success payload a handler may attach to its ok result (receipts and
 * structured computation reports). Most handlers return nothing.
 */
interface OpSuccessExtras {
  details?: string[];
  formula?: FormulaCellReport;
  column?: ColumnFormulaReport;
  literalNumber?: LiteralNumberWrite;
  /**
   * Set when the op wrote nothing because the value was already there. The
   * executor reads this field to skip the tracked-mutation assertion (there IS
   * no revision to assert) and to report the op as done-without-a-change.
   */
  noOp?: NoOpWriteReport;
}

type AnchoredOpHandler<K extends AnchoredDocumentOp> = (
  ctx: AnchoredOpContext<K>
) => OpSuccessExtras | void;

interface AnchorlessOpContext<K extends AnchorlessDocumentOp> {
  editor: LiveEditor;
  op: TypedEditOp<K>;
}

type AnchorlessOpHandler<K extends AnchorlessDocumentOp> = (
  ctx: AnchorlessOpContext<K>
) => void;

function insertionPoint(
  op: TypedEditOp<'insert_text'>,
  block: FlatBlock
): number {
  const position =
    typeof op.position === 'string' ? op.position.toLowerCase() : '';
  if (position === 'after' || position === 'end') return block.length;
  if (position === 'before' || position === 'start') return 0;
  if (typeof op.offset === 'number' && Number.isFinite(op.offset)) {
    return Math.max(0, Math.min(block.length, Math.floor(op.offset)));
  }
  return 0;
}

function insertionText(op: TypedEditOp<'insert_text'>): string {
  let text = String(op.text ?? '');
  const position =
    typeof op.position === 'string' ? op.position.toLowerCase() : '';
  if (position === 'after' && text && !/^[\r\n]/.test(text)) text = `\n${text}`;
  if (position === 'before' && text && !/[\r\n]$/.test(text))
    text = `${text}\n`;
  return text;
}

// ---------------------------------------------------------------------------
// Engine-evaluated formula writes (set_cell_formula)
//
// The model supplies an expression over cell REFERENCES; the engine resolves
// them against the live document, reads the verbatim text, evaluates in exact
// rational arithmetic (cellFormula.ts) and writes the result rendered in the
// target cell's own number format. Chaining is free: the executor refreshes the
// block map after every write, so a formula whose range covers a cell an
// earlier op in the same change set wrote resolves to the NEW text.
// ---------------------------------------------------------------------------

/** Reference resolution against a block map - the whole "no hallucinated
 * value can enter the calculation" guarantee lives here: the model supplies
 * only anchors, and every number is read out of `blocks`. */
function makeFormulaResolver(blocks: FlatBlock[]): FormulaResolver {
  const byAnchor = new Map(blocks.map((block) => [block.anchor, block]));
  return {
    cell: (anchor) => {
      const block = byAnchor.get(anchor);
      if (!block || block.kind !== 'table_cell') return null;
      return block.text;
    },
    range: (reference) => {
      const collected = collectTableColumnCells(
        blocks,
        reference.tableAnchor,
        reference.column
      );
      if (!collected) return null;
      return {
        cells: collected.cells.filter(
          (cellEntry) =>
            cellEntry.row >= reference.startRow &&
            cellEntry.row <= reference.endRow
        ),
        rowCount: collected.rowCount,
        columns: collected.columns
      };
    }
  };
}

const referenceText = (reference: FormulaReference): string =>
  reference.kind === 'cell'
    ? `[${reference.anchor}]`
    : `[${reference.tableAnchor};${reference.startRow}..${reference.endRow};${reference.column}]`;

/** True when `anchor` is a cell the reference covers. */
function referenceCovers(reference: FormulaReference, anchor: string): boolean {
  if (reference.kind === 'cell') return reference.anchor === anchor;
  const parts = anchor.split(';');
  if (parts.length !== 5) return false;
  return (
    `${parts[0]};${parts[1]}` === reference.tableAnchor &&
    Number(parts[3]) === reference.column &&
    Number(parts[2]) >= reference.startRow &&
    Number(parts[2]) <= reference.endRow
  );
}

const SKIP_NAME_LIMIT = 8;

/** Name the cells that did NOT enter the arithmetic, up to a limit, then say
 * how many more - a hidden skip is the wrong-total generator this engine
 * exists to prevent, so it is never merely counted. */
function describeSkippedCells(skipped: SkippedCell[]): string {
  if (!skipped.length) return '';
  const named = skipped.slice(0, SKIP_NAME_LIMIT).map((s) => {
    if (s.reason === 'missing_cell') return `row ${s.row} (no cell)`;
    if (s.reason === 'blank') return `row ${s.row} (blank)`;
    return `row ${s.row} (${JSON.stringify(s.text)})`;
  });
  const more = skipped.length - named.length;
  return `; skipped ${skipped.length} non-numeric cell${
    skipped.length === 1 ? '' : 's'
  }: ${named.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

/**
 * Resolve the evaluator's reads into the terms the receipt states. A range
 * describes its own span; a single cell quotes what it held.
 */
function resolveFormulaTerms(
  evaluation: FormulaEvaluationSuccess
): FormulaResolvedTerm[] {
  return evaluation.reads.map((read): FormulaResolvedTerm => {
    if (read.reference.kind === 'cell') {
      const parts = read.reference.anchor.split(';');
      const text = read.readCells[0]?.text ?? '';
      return {
        kind: 'cell',
        reference: read.text,
        tableAnchor: `${parts[0]};${parts[1]}`,
        row: Number(parts[2]),
        column: Number(parts[3]),
        text,
        description: `cell ${read.reference.anchor} (row ${parts[2]}, column ${
          parts[3]
        }) read ${JSON.stringify(text)}`
      };
    }
    const { tableAnchor, column, startRow, endRow } = read.reference;
    const operation = read.fn ?? 'sum';
    const span =
      startRow === endRow ? `row ${startRow}` : `rows ${startRow}-${endRow}`;
    return {
      kind: 'range',
      reference: read.text,
      operation,
      tableAnchor,
      column,
      startRow,
      endRow,
      cellsRead: read.readCells.length,
      counted: read.counted,
      description:
        `${operation} over ${span} of column ${column} of the table at ` +
        `${tableAnchor} - ${read.readCells.length} cell${
          read.readCells.length === 1 ? '' : 's'
        } read, ${read.counted} numeric`
    };
  });
}

/**
 * The one line to relay. It states, in this order: what the model said it was
 * computing, the value, and then what the engine ACTUALLY resolved and read.
 *
 * That last part is the whole point. A total that is arithmetically perfect over
 * the wrong rows looks exactly like a correct one, so the receipt never merely
 * announces the answer: it names the resolved span, the coverage, every skipped
 * cell, and any rounding, so the failure mode is visible without re-reading the
 * document.
 */
function buildFormulaReceipt(
  report: Omit<FormulaCellReport, 'receipt'>
): string {
  const roundingClause = report.rounded
    ? `; rounded ${String(report.roundingMode).replace(/_/g, '-')} to ${
        report.decimals
      } decimal place${report.decimals === 1 ? '' : 's'}`
    : '';
  const selfClause = report.selfReferencing
    ? "; the formula read this cell's own previous value before overwriting it"
    : '';
  const what = report.label?.trim()
    ? `${report.label.trim()} (${report.formula})`
    : report.formula;
  const resolved = report.resolved
    .map((term) => term.description)
    .join('; then ');
  return (
    `Computed ${what} = ${report.renderedValue} into cell ${report.targetAnchor}. ` +
    `Resolved: ${resolved}` +
    describeSkippedCells(report.skipped) +
    `${roundingClause}${selfClause}. ` +
    'Post-write re-read reproduced this exact value.'
  );
}

/**
 * Write one evaluated formula result and prove it landed, in two parts.
 *
 * 1. Input integrity: re-read every referenced cell from the post-write
 *    document. Any of them (other than the target itself) reading differently
 *    than it did pre-write means the write landed in the wrong place or an
 *    input changed under us.
 * 2. Reproduction: when the formula does NOT read its own target, re-evaluate
 *    the whole formula against the post-write document - it must reproduce the
 *    identical value and identical bytes. When it DOES read its own target, a
 *    re-evaluation would legitimately differ (the input just changed), so the
 *    proof is instead that the written bytes parse back to exactly the value
 *    that was computed - which, together with (1), is the same guarantee.
 *
 * Shared by the single-cell and the column-wide write so a column recompute
 * proves every one of its writes exactly as strictly as one cell does. Returns
 * the post-write block stream so a caller writing several cells can carry on
 * from it instead of serializing again.
 */
function writeAndVerifyFormulaResult(
  editor: LiveEditor,
  args: {
    formulaText: string;
    evaluation: FormulaEvaluationSuccess;
    rendered: FormulaRenderSuccess;
    /** The freshly-resolved target cell block. */
    target: FlatBlock;
    selfReferencing: boolean;
    round: RoundingMode | null;
    decimals?: number;
  }
): FlatBlock[] {
  const { formulaText, evaluation, rendered, target, selfReferencing } = args;
  const targetAnchor = target.anchor;
  const targetTextBefore = target.text;
  const renderOptions = {
    round: args.round,
    ...(args.decimals != null ? { decimals: args.decimals } : {})
  };

  // Snapshot every cell the formula READ, so the post-write check can prove no
  // input moved under the write.
  const readBefore = new Map<string, string | null>();
  for (const read of evaluation.reads) {
    for (const cellRead of read.readCells) {
      if (cellRead.anchor) readBefore.set(cellRead.anchor, cellRead.text);
    }
  }

  selectBlock(editor, target);
  replaceSelectedText(editor, rendered.renderedValue);
  verifyWrittenText(editor, targetAnchor, rendered.renderedValue);

  const freshBlocks = flattenSfdt(parseSfdt(editor.serialize()));
  const freshResolver = makeFormulaResolver(freshBlocks);
  const freshByAnchor = new Map(
    freshBlocks.map((block) => [block.anchor, block])
  );
  for (const [anchor, before] of Array.from(readBefore.entries())) {
    if (anchor === targetAnchor) continue;
    const after = freshByAnchor.get(anchor)?.text ?? null;
    if (after !== before) {
      throw new OpError(
        'post_write_verification_failed',
        'A cell the formula read changed while the result was being written, so the written value is no longer the value of the formula. Nothing is reported as success.',
        [
          `reference cell: ${anchor}`,
          `read before the write: ${JSON.stringify(before)}`,
          `read after the write: ${JSON.stringify(after)}`
        ]
      );
    }
  }
  if (selfReferencing) {
    const written = parseNumericCell(
      freshByAnchor.get(targetAnchor)?.text ?? ''
    );
    if (
      !written ||
      written.value.units !== rendered.value.units ||
      written.value.scale !== rendered.value.scale
    ) {
      throw new OpError(
        'post_write_verification_failed',
        'The value written into the target cell does not parse back to the computed result. Nothing is reported as success.',
        [
          `computed: ${JSON.stringify(rendered.renderedValue)}`,
          `parsed back: ${JSON.stringify(
            freshByAnchor.get(targetAnchor)?.text ?? null
          )}`
        ]
      );
    }
  } else {
    const recheck = evaluateFormula(formulaText, freshResolver);
    const reRendered = recheck.ok
      ? renderFormulaResult(recheck, targetTextBefore, renderOptions)
      : null;
    if (
      !recheck.ok ||
      !reRendered?.ok ||
      reRendered.value.units !== rendered.value.units ||
      reRendered.value.scale !== rendered.value.scale ||
      reRendered.renderedValue !== rendered.renderedValue
    ) {
      throw new OpError(
        'post_write_verification_failed',
        'Re-reading the referenced cells after the write did not reproduce the computed value; the write may have landed in the wrong cell. Nothing is reported as success.',
        [
          `computed: ${JSON.stringify(rendered.renderedValue)}`,
          `re-read: ${
            !recheck.ok
              ? recheck.message
              : reRendered?.ok
              ? JSON.stringify(reRendered.renderedValue)
              : reRendered?.message ?? 'the result could not be re-rendered'
          }`
        ]
      );
    }
  }
  return freshBlocks;
}

function runFormulaCellWrite(
  editor: LiveEditor,
  op: TypedEditOp<'set_cell_formula'>,
  block: FlatBlock,
  byAnchor: Map<string, FlatBlock>
): OpSuccessExtras {
  if (block.kind !== 'table_cell' || block.anchor.split(';').length !== 5) {
    throw new OpError(
      'not_a_table_cell',
      'set_cell_formula must anchor the target table cell (section;block;row;cell;paragraph).'
    );
  }
  const formulaText = String(op.formula ?? '').trim();
  const round = op.round != null ? String(op.round) : '';
  if (round && ROUNDING_MODES.indexOf(round as RoundingMode) < 0) {
    throw new OpError(
      'unsupported_rounding_mode',
      `Unsupported rounding mode "${round}". Supported: ${ROUNDING_MODES.join(
        ', '
      )}.`
    );
  }
  const roundingMode = (round || null) as RoundingMode | null;

  const blocks = Array.from(byAnchor.values());
  const evaluation = evaluateFormula(formulaText, makeFormulaResolver(blocks));
  if (!evaluation.ok) {
    throw new OpError(evaluation.error, evaluation.message, evaluation.details);
  }

  // Circularity. A single-cell self-reference is well defined - read the cell,
  // compute, write it back - and is how "add 13% to this premium" reads in
  // place, so it is allowed (with a narrowed post-write proof, below). A
  // reference RANGE that covers the target is not: the aggregate would change
  // the moment the write lands, so no value written could be the value of the
  // formula.
  const coveringRanges = evaluation.references.filter(
    (reference) =>
      reference.kind === 'range' && referenceCovers(reference, block.anchor)
  );
  if (coveringRanges.length) {
    throw new OpError(
      'circular_reference',
      `The formula aggregates a range that includes the target cell "${
        block.anchor
      }" (${coveringRanges
        .map(referenceText)
        .join(
          ', '
        )}), so writing the result would change the very range it was computed from. Narrow the row range to exclude the target row.`
    );
  }
  const selfReferencing = evaluation.references.some((reference) =>
    referenceCovers(reference, block.anchor)
  );

  const rendered = renderFormulaResult(evaluation, block.text, {
    round: roundingMode,
    ...(op.decimals != null ? { decimals: op.decimals } : {})
  });
  if (!rendered.ok) {
    throw new OpError(rendered.error, rendered.message, rendered.details);
  }

  // THE NO-OP RULE at the point the formula's value first exists. `0.00`
  // recomputed as `0.00` is not a change and must not become a change card;
  // `$0.00` recomputed as `0.00` is, and is written. See writeNoOp.
  if (writeIsNoOp(block.text, rendered.renderedValue)) {
    const report = buildNoOpWriteReport(
      'set_cell_formula',
      block.anchor,
      block.text,
      `the result of ${formulaText}`
    );
    return {
      noOp: report,
      details: resolveFormulaTerms(evaluation).map((term) => term.description)
    };
  }

  writeAndVerifyFormulaResult(editor, {
    formulaText,
    evaluation,
    rendered,
    target: block,
    selfReferencing,
    round: roundingMode,
    ...(op.decimals != null ? { decimals: op.decimals } : {})
  });

  const label = typeof op.label === 'string' ? op.label.trim() : '';
  const withoutReceipt: Omit<FormulaCellReport, 'receipt'> = {
    formula: formulaText,
    ...(label ? { label } : {}),
    references: evaluation.references.map(referenceText),
    resolved: resolveFormulaTerms(evaluation),
    targetAnchor: block.anchor,
    renderedValue: rendered.renderedValue,
    counted: evaluation.counted,
    skipped: evaluation.skipped,
    formatSource: rendered.formatSource,
    decimals: rendered.decimals,
    rounded: rendered.rounded,
    roundingMode: rendered.roundingMode,
    selfReferencing,
    verifiedByReRead: true
  };
  return {
    formula: { ...withoutReceipt, receipt: buildFormulaReceipt(withoutReceipt) }
  };
}

// ---------------------------------------------------------------------------
// Column-wide recompute (set_column_formula)
//
// The failure this exists to remove: the model picks the row range and gets it
// wrong. Live on 2026-07-27 it wrote two totals into the same row of one table
// over DIFFERENT spans - sum(rows 1..3) for one column and sum(rows 1..4) for
// the one beside it. One of those is wrong by construction, and nothing in the
// output said which.
//
// So let a formula apply down a WHOLE column. The engine evaluates it for every
// row in the span and - because of the no-op rule - writes only the cells whose
// value actually moves. That is what makes bulk safe: without no-op skipping a
// column recompute would produce a change card per row and drown the review
// pane; with it you get exactly the cells that moved. It also removes the
// range-guessing failure outright, because the bounds stop mattering: the
// default span is the whole table, and a header row, a blank separator or a
// section label simply cannot produce a value, so it is skipped and named.
//
// `{row}` in the formula is substituted with each row index before parsing, so
// the grammar itself is untouched: one notation, evaluated N times.
// ---------------------------------------------------------------------------

const ROW_PLACEHOLDER = '{row}';

/**
 * Formula refusals that describe ONE ROW rather than the request. A header cell
 * holding "Coverage", a blank separator and a short row all land here; skipping
 * and naming them is what lets the span default to the whole table. Every other
 * refusal - a syntax error, mixed currencies, an undeclared rounding decision,
 * an overflow, a circular range - is about the FORMULA, so it fails the whole
 * op rather than quietly thinning the column.
 */
const ROW_SKIPPABLE_FORMULA_ERRORS: ReadonlyArray<string> = [
  'reference_not_found',
  'cell_not_numeric',
  'no_numeric_cells',
  'column_not_numeric'
];

const NAMED_ROW_LIMIT = 8;

function nameRowOutcomes(
  outcomes: ColumnRowOutcome[],
  describe: (outcome: ColumnRowOutcome) => string
): string {
  const named = outcomes.slice(0, NAMED_ROW_LIMIT).map(describe);
  const more = outcomes.length - named.length;
  return `${named.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

/**
 * Coverage first, then what moved. A bulk op that reports only its writes hides
 * the more important number: how many rows it looked at. "recomputed 12 rows of
 * the Tax column, 3 changed" is the shape - a reader can see both that the
 * whole column was covered and that only three cells were touched.
 */
function buildColumnFormulaReceipt(
  report: Omit<ColumnFormulaReport, 'receipt'>
): string {
  const scope = report.label
    ? `${report.label} (column ${report.column} of the table at ${report.tableAnchor})`
    : `column ${report.column} of the table at ${report.tableAnchor}`;
  const span =
    report.startRow === report.endRow
      ? `row ${report.startRow}`
      : `rows ${report.startRow}-${report.endRow}`;
  const changed = report.rows.filter((row) => row.outcome === 'written');
  const skipped = report.rows.filter((row) => row.outcome === 'skipped');
  const changedClause = changed.length
    ? ` Changed: ${nameRowOutcomes(
        changed,
        (row) =>
          `row ${row.row} (${describeTextChange(
            row.previousText,
            row.renderedValue ?? ''
          )})`
      )}.`
    : '';
  const skippedClause = skipped.length
    ? ` Skipped (no value could be computed): ${nameRowOutcomes(
        skipped,
        (row) => `row ${row.row} (${row.reason})`
      )}.`
    : '';
  return (
    `Recomputed ${report.rowsEvaluated} row${
      report.rowsEvaluated === 1 ? '' : 's'
    } of ${scope}, ${report.rowsChanged} changed. ` +
    `Formula ${report.formula} evaluated over ${span}${
      report.wholeTable ? ' (every row of the table)' : ''
    }: ${report.rowsChanged} written, ${
      report.rowsUnchanged
    } already correct and left untouched, ${report.rowsSkipped} skipped.` +
    changedClause +
    skippedClause +
    ' Every written cell keeps its own number format and was verified by ' +
    'post-write re-read; the unchanged cells produced no revision.'
  );
}

function integerParam(value: unknown, name: string): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 0)
    throw new OpError(
      'bad_row_bound',
      `\`${name}\` must be a whole row index (0 or greater); received ${JSON.stringify(
        value
      )}. Omit both \`startRow\` and \`endRow\` to recompute every row of the table - rows that cannot produce a value are skipped and named.`
    );
  return n;
}

function runColumnFormulaWrite(
  editor: LiveEditor,
  op: TypedEditOp<'set_column_formula'>,
  block: FlatBlock,
  byAnchor: Map<string, FlatBlock>
): OpSuccessExtras {
  const parts = block.anchor.split(';');
  if (block.kind !== 'table_cell' || parts.length !== 5) {
    throw new OpError(
      'not_a_table_cell',
      'set_column_formula must anchor ANY cell of the column to recompute (section;block;row;cell;paragraph); the table and the column are read from that anchor.'
    );
  }
  const tableAnchor = `${parts[0]};${parts[1]}`;
  const column = Number(parts[3]);
  const cellParagraph = parts[4];

  const template = String(op.formula ?? '').trim();
  if (!template)
    throw new OpError(
      'missing_formula',
      `set_column_formula needs a \`formula\`: a per-row expression in which ${ROW_PLACEHOLDER} stands for the row being computed, e.g. "[${parts[0]};${parts[1]};${ROW_PLACEHOLDER};1;0] * 13%".`
    );
  // A template that does not vary by row would write one identical value down
  // the whole column. That is never what "recompute this column" means, and it
  // is cheap to catch here rather than after N identical writes.
  if (template.indexOf(ROW_PLACEHOLDER) < 0)
    throw new OpError(
      'row_invariant_column_formula',
      `The formula ${JSON.stringify(
        template
      )} does not mention ${ROW_PLACEHOLDER}, so it would write the same value into every row of the column. Put ${ROW_PLACEHOLDER} in the row slot of each reference that should follow the row being computed, e.g. "[${
        parts[0]
      };${
        parts[1]
      };${ROW_PLACEHOLDER};1;0] * 13%". For a single cell use set_cell_formula instead.`
    );
  const round = op.round != null ? String(op.round) : '';
  if (round && ROUNDING_MODES.indexOf(round as RoundingMode) < 0) {
    throw new OpError(
      'unsupported_rounding_mode',
      `Unsupported rounding mode "${round}". Supported: ${ROUNDING_MODES.join(
        ', '
      )}.`
    );
  }
  const roundingMode = (round || null) as RoundingMode | null;
  const decimals = op.decimals != null ? { decimals: op.decimals } : {};

  let blocks = Array.from(byAnchor.values());
  const collected = collectTableColumnCells(blocks, tableAnchor, column);
  if (!collected)
    throw new OpError(
      'reference_not_found',
      `No table answers to the anchor "${tableAnchor}". Copy a cell anchor of the target column from a current structure or table_facts read.`
    );
  if (column >= collected.columns)
    throw new OpError(
      'reference_not_found',
      `The table at ${tableAnchor} has ${collected.columns} column${
        collected.columns === 1 ? '' : 's'
      } (0-${collected.columns - 1}); the anchor names column ${column}.`
    );

  const requestedStart = integerParam(op.startRow, 'startRow');
  const requestedEnd = integerParam(op.endRow, 'endRow');
  const wholeTable = requestedStart == null && requestedEnd == null;
  const startRow = requestedStart ?? 0;
  const endRow = requestedEnd ?? collected.rowCount - 1;
  if (endRow < startRow)
    throw new OpError(
      'bad_row_bound',
      `\`endRow\` (${endRow}) is before \`startRow\` (${startRow}).`
    );
  // An over-long span is never silently shortened - same contract as a range
  // reference. It means the model is working from a stale row count.
  if (endRow > collected.rowCount - 1)
    throw new OpError(
      'reference_not_found',
      `The table at ${tableAnchor} has ${collected.rowCount} row${
        collected.rowCount === 1 ? '' : 's'
      } (0-${
        collected.rowCount - 1
      }); the requested span ends at row ${endRow}. Re-read table_facts, or omit \`startRow\`/\`endRow\` to cover every row.`
    );

  const rows: ColumnRowOutcome[] = [];
  for (let row = startRow; row <= endRow; row++) {
    const targetAnchor = `${tableAnchor};${row};${column};${cellParagraph}`;
    const target = blocks.find(
      (candidate) => candidate.anchor === targetAnchor
    );
    if (!target) {
      // A short or merged row simply has no cell here. Reported, never guessed.
      rows.push({
        row,
        anchor: targetAnchor,
        outcome: 'skipped',
        previousText: '',
        reason: 'missing_cell',
        detail: `The table at ${tableAnchor} has no cell at row ${row}, column ${column} (a short or merged row).`
      });
      continue;
    }
    const source = template.split(ROW_PLACEHOLDER).join(String(row));
    const evaluation = evaluateFormula(source, makeFormulaResolver(blocks));
    if (!evaluation.ok) {
      if (ROW_SKIPPABLE_FORMULA_ERRORS.indexOf(evaluation.error) >= 0) {
        rows.push({
          row,
          anchor: targetAnchor,
          outcome: 'skipped',
          previousText: target.text,
          reason: evaluation.error,
          detail: evaluation.message
        });
        continue;
      }
      throw new OpError(
        evaluation.error,
        `Row ${row} of the column recompute (${source}): ${evaluation.message}`,
        evaluation.details
      );
    }
    const coveringRanges = evaluation.references.filter(
      (reference) =>
        reference.kind === 'range' && referenceCovers(reference, targetAnchor)
    );
    if (coveringRanges.length)
      throw new OpError(
        'circular_reference',
        `Row ${row} of the column recompute aggregates a range that includes the cell it writes ("${targetAnchor}": ${coveringRanges
          .map(referenceText)
          .join(
            ', '
          )}), so no value written could be the value of the formula. A column recompute must be a per-row expression; use set_cell_formula for a total.`
      );
    const rendered = renderFormulaResult(evaluation, target.text, {
      round: roundingMode,
      ...decimals
    });
    if (!rendered.ok)
      throw new OpError(
        rendered.error,
        `Row ${row} of the column recompute (${source}): ${rendered.message}`,
        rendered.details
      );

    // THE NO-OP RULE, per row. This is the line that makes a column recompute
    // safe to run over a whole table: the rows that already hold the right
    // value produce no revision and no change card.
    if (writeIsNoOp(target.text, rendered.renderedValue)) {
      rows.push({
        row,
        anchor: targetAnchor,
        outcome: 'unchanged',
        previousText: target.text,
        renderedValue: rendered.renderedValue
      });
      continue;
    }

    const selfReferencing = evaluation.references.some((reference) =>
      referenceCovers(reference, targetAnchor)
    );
    // Every write is proven exactly as strictly as a single-cell write, and the
    // post-write stream becomes the input map for the next row - so a column
    // whose formula reads an earlier row of itself still sees written values.
    blocks = writeAndVerifyFormulaResult(editor, {
      formulaText: source,
      evaluation,
      rendered,
      target,
      selfReferencing,
      round: roundingMode,
      ...decimals
    });
    rows.push({
      row,
      anchor: targetAnchor,
      outcome: 'written',
      previousText: target.text,
      renderedValue: rendered.renderedValue
    });
  }

  const label = typeof op.label === 'string' ? op.label.trim() : '';
  const withoutReceipt: Omit<ColumnFormulaReport, 'receipt'> = {
    formula: template,
    ...(label ? { label } : {}),
    tableAnchor,
    column,
    startRow,
    endRow,
    wholeTable,
    rowsEvaluated: rows.length,
    rowsChanged: rows.filter((row) => row.outcome === 'written').length,
    rowsUnchanged: rows.filter((row) => row.outcome === 'unchanged').length,
    rowsSkipped: rows.filter((row) => row.outcome === 'skipped').length,
    rows,
    verifiedByReRead: true
  };
  const report: ColumnFormulaReport = {
    ...withoutReceipt,
    receipt: buildColumnFormulaReceipt(withoutReceipt)
  };
  // Nothing moved: report it as the no-op it is, so the model says "already
  // correct" rather than "recomputed" and no change card is implied.
  if (!report.rowsChanged) {
    return {
      column: report,
      noOp: {
        anchor: `${tableAnchor} column ${column}`,
        op: 'set_column_formula',
        text: '',
        skipped: true,
        receipt: `Nothing written: ${report.receipt}`
      }
    };
  }
  return { column: report };
}

// ---------------------------------------------------------------------------
// The model-authored-number gate at the common anchored-write boundary
//
// A prompt instruction is not a guarantee - proven on this very stack, where
// the "always name the rule you are invoking" instruction went live and the
// model ignored it. So the engine, not the prompt, refuses the route that let
// "$95,139.18" into a document: any caller-authored numeric replacement aimed
// at a numeric slot in a numeric column is rejected, and the refusal names the
// engine-computed route.
// ---------------------------------------------------------------------------

/**
 * The gate's quantity test: see `classifyNumericText` for the three-tier
 * classification and why an identifier is deliberately not a quantity.
 */
function isQuantityText(text: string): boolean {
  return classifyNumericText(text).quantity;
}

/**
 * How many cells of the target's own column are quantity-formatted. Two is the
 * threshold for calling the column a quantity column: one lone formatted cell
 * could be the header or a stray.
 */
function quantitySiblingCount(blocks: FlatBlock[], cellAnchor: string): number {
  const parts = cellAnchor.split(';');
  if (parts.length !== 5) return 0;
  const collected = collectTableColumnCells(
    blocks,
    `${parts[0]};${parts[1]}`,
    Number(parts[3])
  );
  if (!collected) return 0;
  return collected.cells.filter(
    (cellEntry) =>
      cellEntry.anchor !== cellAnchor &&
      cellEntry.text != null &&
      isQuantityText(cellEntry.text)
  ).length;
}

const LITERAL_NUMBER_NOTE =
  'Written verbatim as a literal figure (literal: true), NOT computed by the engine. Only valid for a figure the user stated; anything derived from other cells must go through set_cell_formula.';

/**
 * The gate. Returns the audit record when a numeric write is allowed through
 * the user-dictated exception, `undefined` when the write is not numeric at
 * all, and throws the refusal otherwise.
 */
function modelAuthoredCellText(op: EditOp): string | undefined {
  switch (op.op) {
    case 'set_cell_text':
      return String(op.text ?? '');
    case 'replace_text':
    case 'replace_selection':
    case 'replace_all':
      return String(op.replace ?? op.text ?? op.newText ?? '');
    case 'insert_text':
      return insertionText(op as TypedEditOp<'insert_text'>);
    default:
      return undefined;
  }
}

function guardModelAuthoredNumber(
  op: EditOp,
  block: FlatBlock,
  byAnchor: Map<string, FlatBlock>
): LiteralNumberWrite | undefined {
  const text = modelAuthoredCellText(op);
  if (text === undefined) return undefined;
  if (block.kind !== 'table_cell') return undefined;
  if (!isQuantityText(text)) return undefined;
  // A QUANTITY SLOT IN A QUANTITY COLUMN: either the cell already holds a
  // quantity, or it is empty and sits in a column that plainly holds them - the
  // freshly-inserted Total cell, which is exactly where a fabricated total
  // lands, so leaving the empty case open would leave the gate open.
  const existing = block.text.trim();
  const existingIsQuantity = existing !== '' && isQuantityText(existing);
  const emptyInQuantityColumn =
    existing === '' &&
    quantitySiblingCount(Array.from(byAnchor.values()), block.anchor) >= 2;
  if (!existingIsQuantity && !emptyInQuantityColumn) return undefined;
  if (op.op === 'set_cell_text' && op.literal === true) {
    return {
      text: text.trim(),
      previousText: existing,
      note: LITERAL_NUMBER_NOTE
    };
  }
  throw new OpError(
    'model_authored_number',
    `Refusing to write the number ${JSON.stringify(text.trim())} into ${
      existingIsQuantity
        ? 'a cell that already holds a formatted amount'
        : 'an empty cell in a column of formatted amounts'
    } through ${
      op.op
    }: a value in a quantity column is almost always derived from other cells, and a number in the response body is unverifiable - the engine cannot tell a correct total from a plausible one. Use set_cell_formula with a \`formula\` that REFERENCES the cells the value comes from (e.g. "[${
      block.anchor
    }] * 1.13", or "sum([0;7;1..93;3])"): the engine reads those cells, computes exactly, renders in this cell's own number format and verifies by re-reading. If this figure is not derived - the user dictated this exact number - use set_cell_text with \`literal: true\`, which records it as a verbatim user-stated figure rather than a computed one.`,
    [
      `target cell: ${block.anchor}`,
      `current content: ${JSON.stringify(block.text)}`
    ]
  );
}

// Exported for the registry parity spec: the spec re-asserts at runtime what
// the mapped types already guarantee at compile time, guarding the emitted JS
// against an `as any` regression at the table itself.
export const ANCHORED_OP_HANDLERS: {
  [K in AnchoredDocumentOp]: AnchoredOpHandler<K>;
} = {
  replace_text: ({ editor, op, block, liveText }) => {
    const find = op.find != null ? String(op.find) : '';
    const replacement = op.replace ?? op.text ?? op.newText;
    if (!find) {
      // No `find`: if a full replacement value was given, overwrite the whole
      // anchored block with it. Otherwise the op has no actionable content.
      if (replacement != null) {
        selectBlock(editor, block);
        replaceSelectedText(editor, String(replacement));
        verifyWrittenText(editor, block.anchor, String(replacement));
        return;
      }
      throw new OpError(
        'missing_find',
        'replace_text needs `find` and `replace`.'
      );
    }
    const idx = liveText.indexOf(find);
    if (idx < 0)
      throw new OpError('text_not_found', `"${find}" not found at anchor.`);
    const hasLiveSearchRange = selectExactMatch(editor, block, find, idx, op);
    // A field paragraph has two valid projections: serialized SFDT includes
    // its field instructions while Selection exposes the rendered result.
    // The public search offsets select the latter; retain the former for the
    // CAS/post-write proof so a TOC/hyperlink field is never misclassified as
    // a stale document merely because those projections differ.
    const serializedIndex =
      typeof op.start === 'number' &&
      block.text.slice(op.start, op.start + find.length) === find
        ? op.start
        : block.text.indexOf(find);
    if (serializedIndex < 0)
      throw new OpError(
        'text_not_found',
        `"${find}" not found in the serialized block at anchor.`
      );
    const next =
      block.text.slice(0, serializedIndex) +
      String(replacement ?? '') +
      block.text.slice(serializedIndex + find.length);
    if (!hasLiveSearchRange) {
      // Test doubles and older integrations without SyncFusion Search retain
      // their legacy selected-range replacement primitive. Production search
      // is required and always takes the guarded delete/read/insert path.
      editor.editor.insertText(String(replacement ?? ''));
      verifyWrittenText(editor, block.anchor, next);
      return;
    }
    replaceSelectedText(editor, String(replacement ?? ''));
    verifyWrittenText(editor, block.anchor, next);
  },
  replace_selection: ({ editor, op, block, byAnchor }) => {
    const replacement = op.replace ?? (op as any).text ?? (op as any).newText;
    if (replacement == null)
      throw new OpError(
        'missing_replace',
        'replace_selection needs `replace`.',
        [
          'Send `replace` set to the text that should stand in place of the selection.'
        ]
      );
    const range = resolveSelectionRange(editor, op, block, byAnchor);
    assertSelectionGuard(op, range);
    // resolveSelectionRange left exactly this range selected. One selected-range
    // insertText, so SyncFusion authors the paired deletion/insertion revisions
    // atomically - see replaceSelectedText on why this must not be split.
    replaceSelectedText(editor, String(replacement));
    verifySelectionWrite(editor, range, String(replacement));
  },
  delete_text: ({ editor, op, block, liveText }) => {
    const find = String(op.find ?? '');
    if (!find) throw new OpError('missing_find', 'delete_text needs `find`.');
    const idx = liveText.indexOf(find);
    if (idx < 0)
      throw new OpError('text_not_found', `"${find}" not found at anchor.`);
    selectRange(editor, block.anchor, idx, idx + find.length);
    editor.editor.delete();
  },
  insert_text: ({ editor, op, block }) => {
    const offset = insertionPoint(op, block);
    selectRange(editor, block.anchor, offset, offset);
    editor.editor.insertText(insertionText(op));
  },
  set_cell_text: ({ editor, op, block }) => {
    // Overwrite the (cell) block's content.
    selectBlock(editor, block);
    const replacement = String(op.text ?? '');
    replaceSelectedText(editor, replacement);
    verifyWrittenText(editor, block.anchor, replacement);
  },
  set_cell_formula: ({ editor, op, block, byAnchor }) =>
    runFormulaCellWrite(editor, op, block, byAnchor),
  set_column_formula: ({ editor, op, block, byAnchor }) =>
    runColumnFormulaWrite(editor, op, block, byAnchor),
  change_case: ({ editor, op, block, liveText }) => {
    selectBlock(editor, block);
    editor.editor.insertText(changeCase(liveText, String(op.caseType ?? '')));
  },
  apply_style: ({ editor, op, block, byAnchor }) => {
    const styleName = fmtField(op, 'styleName');
    const inheritAnchor =
      typeof op.inheritFormatFrom === 'string'
        ? op.inheritFormatFrom.trim()
        : '';
    if (!inheritAnchor && !isMeaningfulFormatValue(styleName))
      throw new OpError('missing_style_name', 'apply_style needs a styleName.');
    applyInheritedFormat(editor, op, byAnchor, {
      styleName: isMeaningfulFormatValue(styleName)
        ? String(styleName)
        : undefined
    });
    if (!inheritAnchor && isMeaningfulFormatValue(styleName)) {
      // Non-inheriting styles still need paragraph selection semantics.
      selectParagraph(editor, block);
      callEditor(editor, 'applyStyle', String(styleName));
    }
  },
  clear_formatting: ({ editor, block }) => {
    selectBlock(editor, block);
    callEditor(editor, 'clearFormatting');
  },
  set_char_format: ({ editor, op, block, byAnchor }) => {
    selectBlock(editor, block);
    const inherited = applyInheritedFormat(editor, op, byAnchor);
    applyCharFormat(editor, op, { requireField: !inherited });
  },
  set_para_format: ({ editor, op, block, byAnchor }) => {
    selectBlock(editor, block);
    const inherited = applyInheritedFormat(editor, op, byAnchor);
    applyParaFormat(editor, op, { requireField: !inherited });
  },
  indent_step: ({ editor, op, block }) => {
    selectBlock(editor, block);
    if (op.direction === 'decrease') callEditor(editor, 'decreaseIndent');
    else callEditor(editor, 'increaseIndent');
  },
  apply_bullets: ({ editor, op, block }) => {
    selectBlock(editor, block);
    callEditor(editor, 'applyBullet', String(op.bullet ?? '•'), 'Arial');
  },
  apply_numbering: ({ editor, op, block }) => {
    selectBlock(editor, block);
    callEditor(
      editor,
      'applyNumbering',
      String(op.numberFormat ?? '%1.'),
      'Arabic'
    );
  },
  clear_list: ({ editor, block }) => {
    selectBlock(editor, block);
    callEditor(editor, 'clearList');
  },
  insert_comment: ({ editor, op, block }) => {
    selectBlock(editor, block);
    callEditor(editor, 'insertComment', String(op.text ?? ''));
  },
  insert_bookmark: ({ editor, op, block }) => {
    selectBlock(editor, block);
    callEditor(editor, 'insertBookmark', String(op.name ?? ''));
  },
  insert_hyperlink: ({ editor, op, block }) => {
    selectBlock(editor, block);
    callEditor(
      editor,
      'insertHyperlink',
      String(op.address ?? ''),
      String(op.displayText ?? op.address ?? ''),
      op.screenTip
    );
  },
  remove_hyperlink: ({ editor, block }) => {
    selectBlock(editor, block);
    callEditor(editor, 'removeHyperlink');
  },
  insert_page_break: ({ editor, block }) => {
    selectRange(editor, block.anchor, 0, 0);
    callEditor(editor, 'insertPageBreak');
  },
  insert_column_break: ({ editor, block }) => {
    selectRange(editor, block.anchor, 0, 0);
    callEditor(editor, 'insertColumnBreak');
  },
  insert_page_number: ({ editor, op, block }) => {
    selectBlock(editor, block);
    callEditor(editor, 'insertPageNumber', op.numberFormat);
  },
  // Table structure. These once fell to a generic snake_case->camelCase
  // dispatch that called the SyncFusion method with no arguments at all, so
  // `above`, `count`, `rows` and `columns` were advertised in the tool schema
  // and silently dropped: every insert_row was one row below, every
  // insert_table was 1x1. Every op maps its arguments explicitly now.
  insert_row: ({ editor, op }) => {
    callEditor(editor, 'insertRow', op.above === true, positiveCount(op.count));
  },
  insert_table: ({ editor, op }) => {
    callEditor(
      editor,
      'insertTable',
      positiveCount(op.rows),
      positiveCount(op.columns)
    );
  },
  // Structural table removal. SyncFusion operates on the table or row
  // containing the selection, which selectBlock placed at the anchor.
  // `delete_column`, `merge_cells` and `insert_column` are deliberately
  // absent: SyncFusion has no tracked route for any of them under track
  // changes (the first two pop a blocking "wont be marked as change" dialog;
  // insert_column silently applies with ZERO revisions, so it survives
  // reject-all - probed on a real DocumentEditor, S5). This engine applies
  // every change set tracked, so all three fall to the vocabulary refusal in
  // the dispatch wrapper instead of mutating without a reviewable card.
  delete_table: ({ editor }) => {
    callEditor(editor, 'deleteTable');
  },
  delete_row: ({ editor }) => {
    callEditor(editor, 'deleteRow');
  },
  insert_section_break: ({ editor, op }) => {
    callEditor(editor, 'insertSectionBreak', sectionBreakType(op));
  }
};

// SyncFusion's SectionBreakType enum spells the Word "Continuous" break
// "NoBreak" at runtime; accept both. An absent/blank type falls through to
// SyncFusion's own default (NewPage).
function sectionBreakType(
  op: TypedEditOp<'insert_section_break'>
): string | undefined {
  const raw =
    typeof op.sectionBreakType === 'string' ? op.sectionBreakType.trim() : '';
  if (!raw) return undefined;
  return raw === 'Continuous' ? 'NoBreak' : raw;
}

function requireSectionFormat(editor: LiveEditor): any {
  const sf = editor.selection?.sectionFormat;
  if (!sf) throw new OpError('unsupported_op', 'Section format unavailable.');
  return sf;
}

// Exported for the registry parity spec, like ANCHORED_OP_HANDLERS above.
// `undo`/`redo` have no handlers on purpose: they are unadvertised global
// history ops the executor refuses before dispatch (UNSAFE_CHANGE_SET_OPS).
export const ANCHORLESS_OP_HANDLERS: {
  [K in AnchorlessDocumentOp]: AnchorlessOpHandler<K>;
} = {
  set_track_changes: ({ editor, op }) => {
    editor.enableTrackChanges = op.enabled !== false;
  },
  accept_all_revisions: ({ editor }) => {
    if (editor.revisions?.acceptAll) editor.revisions.acceptAll();
    else throw new OpError('unsupported_op', 'No revisions to accept.');
  },
  reject_all_revisions: ({ editor }) => {
    if (editor.revisions?.rejectAll) editor.revisions.rejectAll();
    else throw new OpError('unsupported_op', 'No revisions to reject.');
  },
  go_to_body: ({ editor }) => {
    // selection.goToBody does not exist in ej2-documenteditor (verified on
    // 34.1.31: absent from Selection.prototype and selection.d.ts), so this
    // op failed with unsupported_op since the day it shipped - found by the
    // S2 tracked-revision probe, repaired in S5. closeHeaderFooter is the
    // public route back to the body story.
    callSelection(editor, 'closeHeaderFooter');
  },
  enter_header: ({ editor }) => {
    callSelection(editor, 'goToHeader');
  },
  enter_footer: ({ editor }) => {
    callSelection(editor, 'goToFooter');
  },
  delete_bookmark: ({ editor, op }) => {
    callEditor(editor, 'deleteBookmark', String(op.name ?? ''));
  },
  delete_all_comments: ({ editor }) => {
    callEditor(editor, 'deleteAllComments');
  },
  set_orientation: ({ editor, op }) => {
    const sf = requireSectionFormat(editor);
    if (op.orientation) sf.pageOrientation = op.orientation;
  },
  set_page_size: ({ editor, op }) => {
    const sf = requireSectionFormat(editor);
    if (op.width != null) sf.pageWidth = Number(op.width);
    if (op.height != null) sf.pageHeight = Number(op.height);
  },
  set_page_margins: ({ editor, op }) => {
    const sf = requireSectionFormat(editor);
    if (op.left != null) sf.leftMargin = Number(op.left);
    if (op.right != null) sf.rightMargin = Number(op.right);
    if (op.top != null) sf.topMargin = Number(op.top);
    if (op.bottom != null) sf.bottomMargin = Number(op.bottom);
  }
};

// ---------------------------------------------------------------------------
// The universal no-op rule (see writeNoOp.ts for the rule itself)
//
// Every op whose complete post-write block text is knowable BEFORE the write is
// checked here, centrally, so the rule is a property of the write path rather
// than a feature of one op. `set_cell_formula` and `set_column_formula` cannot
// be checked here - their value does not exist until the formula has been
// evaluated - so they apply the same predicate at the point where it does
// (runFormulaCellWrite / runColumnFormulaWrite).
// ---------------------------------------------------------------------------

/**
 * The exact text this op would leave in `block`, or null when that is not
 * knowable up front (in which case no central skip is attempted - the rule
 * never guesses).
 */
function intendedBlockText(
  op: EditOp,
  block: FlatBlock,
  liveText: string
): string | null {
  switch (op.op) {
    case 'set_cell_text':
      return String(op.text ?? '');
    case 'replace_text': {
      const find = op.find != null ? String(op.find) : '';
      const replacement = op.replace ?? op.text ?? op.newText;
      // No `find`: the handler overwrites the whole block with `replacement`.
      if (!find) return replacement != null ? String(replacement) : null;
      // With a `find`, only one occurrence is rewritten and which one depends
      // on live search, so the resulting text is not knowable here - EXCEPT in
      // the one case where it is: replacing a string with itself cannot change
      // the block, whichever occurrence is chosen.
      return replacement != null && String(replacement) === find
        ? block.text
        : null;
    }
    case 'change_case':
      // Pending tracked deletions make the selection text (what the handler
      // rewrites) differ from the block's projected text (what a no-op must
      // preserve), so only the unambiguous case is judged.
      return liveText === block.text
        ? changeCase(block.text, String(op.caseType ?? ''))
        : null;
    case 'insert_text':
      // Inserting nothing is the one insertion that changes nothing.
      return insertionText(op as TypedEditOp<'insert_text'>) === ''
        ? block.text
        : null;
    default:
      return null;
  }
}

// Applies one anchored op. `block` is the freshly-resolved block. Throws OpError
// on a recoverable failure (surfaced as {ok:false, error}).
function applyAnchoredOp(
  editor: LiveEditor,
  op: EditOp,
  block: FlatBlock,
  byAnchor: Map<string, FlatBlock>
): OpSuccessExtras | void {
  const liveText = selectBlock(editor, block);
  observeMutationGuardBoundary(
    op,
    op.op === 'replace_selection' ? 'selection_content' : 'block_expect'
  );

  // Compare-and-swap guard: `expect` is the whole-block text the model believes
  // is still present. On mismatch we write nothing.
  //
  // replace_selection is exempt because for it `expect` means the SELECTED
  // text, which is not the block's text whenever the selection is a sub-range
  // or spans paragraphs. Its guard is not weaker - assertSelectionGuard applies
  // the same compare-and-swap to the range the user actually selected, and
  // refuses outright when the op supplies no guard at all.
  if (
    op.op !== 'replace_selection' &&
    expectGuardRefuses(op.expect, liveText) &&
    expectGuardRefuses(op.expect, block.text)
  ) {
    throw new OpError(
      'expect_mismatch',
      'The live text at this anchor does not match `expect`.',
      staleAnchorDetails(op.expect, liveText)
    );
  }

  // THE NO-OP RULE, before any handler runs and therefore before any write:
  // a value identical to what is already there costs no revision and produces
  // no change card. Deliberately ahead of the model-authored-number gate too -
  // that gate exists to stop a fabricated number ENTERING the document, and a
  // write that changes nothing enters nothing.
  const intended = intendedBlockText(op, block, liveText);
  if (intended !== null && writeIsNoOp(block.text, intended)) {
    return {
      noOp: buildNoOpWriteReport(op.op, block.anchor, block.text)
    };
  }

  // The engine, not an individual handler, keeps model arithmetic out of
  // numeric cells. Every registered anchored op crosses this point before its
  // handler can write.
  const literalNumber = guardModelAuthoredNumber(op, block, byAnchor);

  const handler = ANCHORED_OP_HANDLERS[op.op as AnchoredDocumentOp];
  if (!handler)
    throw new OpError(
      'unsupported_op',
      `Unknown op "${op.op}". It is not in the document-edit vocabulary.`,
      undefined,
      'never'
    );
  // The single untyped->typed boundary for anchored ops: `op` is model-authored
  // JSON. The handlers are compile-time-locked to the registry; runtime
  // validity of each field value remains the handler's own defensive job.
  const extras = (
    handler as unknown as (ctx: {
      editor: LiveEditor;
      op: EditOp;
      block: FlatBlock;
      byAnchor: Map<string, FlatBlock>;
      liveText: string;
    }) => OpSuccessExtras | void
  )({ editor, op, block, byAnchor, liveText });
  return literalNumber ? { ...(extras ?? {}), literalNumber } : extras;
}

function applyAnchorlessOp(editor: LiveEditor, op: EditOp): void {
  observeMutationGuardBoundary(op, 'not_applicable');
  const handler = ANCHORLESS_OP_HANDLERS[op.op as AnchorlessDocumentOp];
  if (!handler)
    throw new OpError(
      'unsupported_op',
      `Unknown anchorless op "${op.op}". It is not in the document-edit vocabulary.`,
      undefined,
      'never'
    );
  // The single untyped->typed boundary for anchorless ops (see above).
  (handler as unknown as (ctx: { editor: LiveEditor; op: EditOp }) => void)({
    editor,
    op
  });
}

// Read a formatting field from the flat op (`op.bold`) or, as a belt-and-braces
// fallback against model variance, from a nested `op.format` object
// (`op.format.bold`). The flat value wins when both are present. The key is
// constrained to the op's own (registry-derived) keys, so a handler cannot
// read a field its registry entry does not declare.
function fmtField<T extends { format?: Record<string, unknown> }>(
  op: T,
  key: keyof T & string
): any {
  const record = op as Record<string, unknown>;
  if (record[key] != null) return record[key];
  const nested = op.format;
  if (nested && typeof nested === 'object' && nested[key] != null)
    return nested[key];
  return undefined;
}

function isMeaningfulFormatValue(value: any): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'boolean') return value;
  return true;
}

function isMeaningfulInheritedFormatValue(prop: string, value: any): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return false;
    // SyncFusion reports 0 for unresolved/mixed character sizing. Paragraph
    // spacing and indents can legitimately be 0 and must be preserved.
    return prop === 'fontSize' || prop === 'fontSizeBidi' ? value > 0 : true;
  }
  if (typeof value === 'boolean') return true;
  return true;
}

function fmtMeaningfulField<T extends { format?: Record<string, unknown> }>(
  op: T,
  key: keyof T & string
): any {
  const value = fmtField(op, key);
  return isMeaningfulFormatValue(value) ? value : undefined;
}

function normalizeInheritedCharValue(prop: string, value: any): any {
  if (prop === 'underline' && value === true) return 'Single';
  if (prop === 'underline' && value === false) return 'None';
  if (prop === 'strikethrough' && value === true) return 'SingleStrike';
  if (prop === 'strikethrough' && value === false) return 'None';
  return value;
}

function readSelectionFormat(
  source: any,
  mappings: FormatMapping[]
): FormatBag {
  const out: FormatBag = {};
  for (const { prop } of mappings) {
    const value = source?.[prop];
    if (isMeaningfulInheritedFormatValue(prop, value)) out[prop] = value;
  }
  return out;
}

function readEffectiveSourceFormat(
  editor: LiveEditor,
  source: FlatBlock
): {
  characterFormat?: FormatBag;
  paragraphFormat?: FormatBag;
} {
  const startOffset = editor.selection?.startOffset;
  const endOffset = editor.selection?.endOffset;

  try {
    selectBlock(editor, source);
    const characterFormat = readSelectionFormat(
      editor.selection?.characterFormat,
      CHARACTER_FORMAT_KEYS
    );
    selectParagraph(editor, source);
    const paragraphFormat = readSelectionFormat(
      editor.selection?.paragraphFormat,
      PARAGRAPH_FORMAT_KEYS
    );
    return {
      characterFormat: Object.keys(characterFormat).length
        ? characterFormat
        : source.characterFormat,
      paragraphFormat: Object.keys(paragraphFormat).length
        ? paragraphFormat
        : source.paragraphFormat
    };
  } finally {
    if (typeof startOffset === 'string' && typeof endOffset === 'string') {
      editor.selection.select(startOffset, endOffset);
    }
  }
}

function comparableFormatValue(value: any): any {
  if (value && typeof value === 'object' && 'name' in value) return value.name;
  return value;
}

function formatValuesMatch(expected: any, actual: any): boolean {
  const lhs = comparableFormatValue(expected);
  const rhs = comparableFormatValue(actual);
  if (typeof lhs === 'number' && typeof rhs === 'number')
    return Math.abs(lhs - rhs) < 0.0001;
  return lhs === rhs;
}

function formatEvidence(
  group: string,
  expected: FormatBag,
  actual: any
): string[] {
  return Object.entries(expected).flatMap(([prop, value]) => {
    // The style name is the mechanism used to resolve paragraph formatting, not
    // a visible resolved field. In an explicit apply_style op it may correctly
    // differ from the source while every rendered property matches.
    if (prop === 'styleName') return [];
    if (!isMeaningfulInheritedFormatValue(prop, value)) return [];
    const resolved = actual?.[prop];
    return formatValuesMatch(value, resolved)
      ? []
      : [
          `${group}.${prop}: expected ${JSON.stringify(
            comparableFormatValue(value)
          )}, got ${JSON.stringify(comparableFormatValue(resolved))}`
        ];
  });
}

// Verify only the source and target anchors just involved in this operation.
// SyncFusion can resolve a named style after applyStyle(), so no-op success is
// not sufficient evidence that the target now has the source's visible format.
function verifyInheritedFormat(
  editor: LiveEditor,
  source: FlatBlock,
  target: FlatBlock,
  inherited: { characterFormat?: FormatBag; paragraphFormat?: FormatBag }
): void {
  const startOffset = editor.selection?.startOffset;
  const endOffset = editor.selection?.endOffset;
  try {
    selectBlock(editor, target);
    const characterEvidence = formatEvidence(
      'characterFormat',
      inherited.characterFormat ?? {},
      editor.selection?.characterFormat
    );
    selectParagraph(editor, target);
    const paragraphEvidence = formatEvidence(
      'paragraphFormat',
      inherited.paragraphFormat ?? {},
      editor.selection?.paragraphFormat
    );
    const details = [...characterEvidence, ...paragraphEvidence];
    if (details.length) {
      throw new OpError(
        'inherited_format_mismatch',
        `Inherited formatting from ${source.anchor} did not resolve at ${target.anchor}.`,
        details
      );
    }
  } finally {
    if (typeof startOffset === 'string' && typeof endOffset === 'string') {
      editor.selection.select(startOffset, endOffset);
    }
  }
}

// SyncFusion's selection format setters do not ASSIGN every property inside a
// table cell: `bidi` and `contextualSpacing` TOGGLE there, so writing the value
// a cell paragraph already has flips it to the opposite (verified on a real
// DocumentEditor; body paragraphs assign normally). That toggle is what made
// every cell-target inherit fail verification and corrupted cell alignment
// during the compensating rollback. Writing only real differences sidesteps the
// toggle - a differing value still lands correctly in a cell - and is a pure
// no-op everywhere else.
function writeFormatPropIfDifferent(bag: any, prop: string, value: any): void {
  if (!bag) return;
  if (formatValuesMatch(value, bag[prop])) return;
  bag[prop] = value;
}

// The write half of format inheritance, after source/target/inherited have been
// resolved. Shared by the explicit `inheritFormatFrom` ops and the computed
// insert-time default so both go through the identical guarded write path and
// the identical read-back verification.
function applyResolvedInheritedFormat(
  editor: LiveEditor,
  source: FlatBlock,
  target: FlatBlock,
  inherited: { characterFormat?: FormatBag; paragraphFormat?: FormatBag },
  options: { styleName?: string } = {}
): void {
  // Styles are resolved last by SyncFusion. Apply the chosen paragraph style
  // first, then restore the reference paragraph's resolved/direct properties so
  // a 20 pt named style cannot overwrite its visible 11 pt override.
  const sourceStyleName = inherited.paragraphFormat?.styleName;
  const styleName = options.styleName ?? sourceStyleName;
  if (typeof styleName === 'string' && styleName.trim()) {
    selectParagraph(editor, target);
    callEditor(editor, 'applyStyle', styleName);
  }

  // Character properties must be applied to text only; paragraph properties
  // must include the paragraph mark (see selectParagraph above).
  selectBlock(editor, target);
  const cf = editor.selection.characterFormat;
  for (const [prop, value] of Object.entries(inherited.characterFormat ?? {})) {
    if (!isMeaningfulInheritedFormatValue(prop, value)) continue;
    writeFormatPropIfDifferent(
      cf,
      prop,
      normalizeInheritedCharValue(prop, value)
    );
  }

  selectParagraph(editor, target);
  const pf = editor.selection.paragraphFormat;
  for (const [prop, value] of Object.entries(inherited.paragraphFormat ?? {})) {
    if (!isMeaningfulInheritedFormatValue(prop, value)) continue;
    if (prop === 'styleName') continue;
    writeFormatPropIfDifferent(pf, prop, value);
  }

  verifyInheritedFormat(editor, source, target, inherited);
}

// The reserved cross-op fields explicit format inheritance consumes; every
// TypedEditOp satisfies this structurally.
interface InheritSourcedOp {
  anchor?: string;
  inheritFormatFrom?: string;
  __inheritedFormat?: {
    characterFormat?: FormatBag;
    paragraphFormat?: FormatBag;
  };
}

function applyInheritedFormat(
  editor: LiveEditor,
  op: InheritSourcedOp,
  byAnchor: Map<string, FlatBlock>,
  options: {
    styleName?: string;
    inherited?: { characterFormat?: FormatBag; paragraphFormat?: FormatBag };
  } = {}
): boolean {
  const inheritAnchor =
    typeof op.inheritFormatFrom === 'string' ? op.inheritFormatFrom.trim() : '';
  if (!inheritAnchor) return false;

  const source = byAnchor.get(inheritAnchor);
  if (!source) {
    throw new OpError(
      'inherit_anchor_not_found',
      `No block found for inheritFormatFrom "${inheritAnchor}". Re-read the inventory and retry.`
    );
  }
  // An empty paragraph is not a format reference: copying it verbatim restyles
  // real content down to document defaults (the silent heading->Normal case).
  if (!source.text.trim()) {
    throw new OpError(
      'inherit_source_empty',
      `inheritFormatFrom "${inheritAnchor}" is an empty block; it carries no formatting worth copying. Choose a non-empty reference block.`
    );
  }

  // In a multi-edit change set this snapshot was captured during preflight,
  // before any structural mutation can shift a source or alter selection state.
  const inherited =
    options.inherited ??
    op.__inheritedFormat ??
    readEffectiveSourceFormat(editor, source);
  const targetAnchor = op.anchor;
  if (!targetAnchor)
    throw new OpError(
      'missing_anchor',
      'Inherited formatting needs a target anchor.'
    );
  const target = byAnchor.get(targetAnchor);
  if (!target) {
    throw new OpError(
      'anchor_not_found',
      `No block found for anchor "${op.anchor}".`
    );
  }

  applyResolvedInheritedFormat(editor, source, target, inherited, {
    styleName: options.styleName
  });

  return true;
}

function applyCharFormat(
  editor: LiveEditor,
  op: TypedEditOp<'set_char_format'>,
  options: { requireField?: boolean } = {}
): boolean {
  const bold = fmtMeaningfulField(op, 'bold');
  const italic = fmtMeaningfulField(op, 'italic');
  const underline = fmtMeaningfulField(op, 'underline');
  const strikethrough = fmtMeaningfulField(op, 'strikethrough');
  const allCaps = fmtMeaningfulField(op, 'allCaps');
  const fontName = fmtMeaningfulField(op, 'fontName');
  const fontSize = fmtMeaningfulField(op, 'fontSize');
  const fontColor = fmtMeaningfulField(op, 'fontColor');
  const highlightColor = fmtMeaningfulField(op, 'highlightColor');
  const baseline = fmtMeaningfulField(op, 'baseline');

  // A styling op with no recognized field must FAIL, not silently succeed - a
  // silent no-op makes Assist falsely report "Done." A thrown missing_format is
  // self-correcting: the model can re-emit with real fields.
  const hasField =
    bold != null ||
    italic != null ||
    underline != null ||
    strikethrough != null ||
    allCaps != null ||
    fontSize != null ||
    !!fontName ||
    !!fontColor ||
    !!highlightColor ||
    !!baseline;
  if (!hasField)
    if (options.requireField !== false) {
      throw new OpError(
        'missing_format',
        'set_char_format needs at least one formatting field (bold/fontColor/fontSize/...).'
      );
    } else {
      return false;
    }

  const cf = editor.selection.characterFormat;
  if (!cf) return false;
  if (bold != null) cf.bold = !!bold;
  if (italic != null) cf.italic = !!italic;
  if (underline != null) cf.underline = underline ? 'Single' : 'None';
  if (strikethrough != null)
    cf.strikethrough = strikethrough ? 'SingleStrike' : 'None';
  if (allCaps != null) cf.allCaps = !!allCaps;
  if (fontName) cf.fontFamily = fontName;
  if (fontSize != null) cf.fontSize = Number(fontSize);
  if (fontColor) cf.fontColor = fontColor;
  if (highlightColor) cf.highlightColor = highlightColor;
  if (baseline) cf.baselineAlignment = baseline;
  return true;
}

function applyParaFormat(
  editor: LiveEditor,
  op: TypedEditOp<'set_para_format'>,
  options: { requireField?: boolean } = {}
): boolean {
  const styleName = fmtMeaningfulField(op, 'styleName');
  const alignment = fmtMeaningfulField(op, 'alignment');
  const leftIndent = fmtMeaningfulField(op, 'leftIndent');
  const rightIndent = fmtMeaningfulField(op, 'rightIndent');
  const firstLineIndent = fmtMeaningfulField(op, 'firstLineIndent');
  const lineSpacing = fmtMeaningfulField(op, 'lineSpacing');
  const beforeSpacing = fmtMeaningfulField(op, 'beforeSpacing');
  const afterSpacing = fmtMeaningfulField(op, 'afterSpacing');

  const hasField =
    !!styleName ||
    !!alignment ||
    leftIndent != null ||
    rightIndent != null ||
    firstLineIndent != null ||
    lineSpacing != null ||
    beforeSpacing != null ||
    afterSpacing != null;
  if (!hasField)
    if (options.requireField !== false) {
      throw new OpError(
        'missing_format',
        'set_para_format needs at least one formatting field (alignment/leftIndent/lineSpacing/...).'
      );
    } else {
      return false;
    }

  const pf = editor.selection.paragraphFormat;
  if (!pf) return false;
  if (styleName) callEditor(editor, 'applyStyle', String(styleName));
  if (alignment) pf.textAlignment = alignment;
  if (leftIndent != null) pf.leftIndent = Number(leftIndent);
  if (rightIndent != null) pf.rightIndent = Number(rightIndent);
  if (firstLineIndent != null) pf.firstLineIndent = Number(firstLineIndent);
  if (lineSpacing != null) pf.lineSpacing = Number(lineSpacing);
  if (beforeSpacing != null) pf.beforeSpacing = Number(beforeSpacing);
  if (afterSpacing != null) pf.afterSpacing = Number(afterSpacing);
  return true;
}

function readPostEditInventory(
  editor: LiveEditor,
  warnings: string[]
): InventoryEntry[] | undefined {
  const result = getDocumentInventory(editor, { scope: 'full' });
  if ('inventory' in result) return result.inventory;
  if ('error' in result) {
    warnings.push(`post_edit_inventory: ${result.message}`);
  }
  return undefined;
}

// replace_all runs across the whole document via the search module (anchorless
// in effect - it ignores the op's anchor by design).
function applyReplaceAll(
  editor: LiveEditor,
  op: TypedEditOp<'replace_all'>,
  blocks: FlatBlock[],
  byAnchor: Map<string, FlatBlock>
): number {
  observeMutationGuardBoundary(op, 'find_content');
  const find = String(op.find ?? '');
  if (!find) throw new OpError('missing_find', 'replace_all needs `find`.');
  // replace_all is the one executor-special-cased mutation. Preflight every
  // matching table block through the same number-provenance gate before the
  // search module can write any of them.
  if (String(op.replace ?? '') !== find) {
    for (const block of blocks) {
      if (block.text.includes(find))
        guardModelAuthoredNumber(op, block, byAnchor);
    }
  }
  const search = editor.search;
  if (!search?.findAll)
    throw new OpError('unsupported_op', 'Search module unavailable.');
  search.findAll(find);
  const results = search.searchResults;
  const count = results?.length ?? 0;
  if (count > 0 && results?.replaceAll)
    results.replaceAll(String(op.replace ?? ''));
  return count;
}

function callEditor(editor: LiveEditor, method: string, ...args: any[]): void {
  const fn = (editor.editor as any)?.[method];
  if (typeof fn !== 'function')
    throw new OpError('unsupported_op', `editor.${method} unavailable.`);
  fn.apply(editor.editor, args);
}

function callSelection(
  editor: LiveEditor,
  method: string,
  ...args: any[]
): void {
  const fn = (editor.selection as any)?.[method];
  if (typeof fn !== 'function')
    throw new OpError('unsupported_op', `selection.${method} unavailable.`);
  fn.apply(editor.selection, args);
}

// ---------------------------------------------------------------------------
// Atomic revision grouping (content-loss guard)
// ---------------------------------------------------------------------------
//
// Under track changes a `replace_text` is authored as TWO revisions: a Deletion
// of the old run plus an Insertion of the new run. Resolving them together
// (acceptAll / rejectAll) is always safe, but resolving them individually per
// card in a contradictory order - reject the insertion (drop the new text) AND
// accept the deletion (drop the old text) - deletes BOTH and the paragraph's
// content is lost. (Reproduced live: a General Liability quote paragraph
// vanished entirely after a multi-op edit followed by per-card rejects.)
//
// Fix: bind the delete+insert revisions of one logical edit into a group and
// make each member's accept/reject cascade to the whole group, so the FIRST
// per-card action decides the outcome for the whole logical edit and there is no
// contradictory-order path. Accepting the group accepts every member (keep the
// replacement); rejecting the group rejects every member (keep the original) -
// the only two internally-consistent outcomes. Neither can ever empty the block.

// Read the editor's current revisions as a plain array (order preserved).
function snapshotRevisions(editor: LiveEditor): LiveRevision[] {
  const col = editor.revisions;
  if (!col) return [];
  if (Array.isArray(col.changes)) return col.changes.slice();
  if (typeof col.length === 'number' && typeof col.get === 'function') {
    const out: LiveRevision[] = [];
    for (let i = 0; i < col.length; i++) {
      const rev = col.get(i);
      if (rev) out.push(rev);
    }
    return out;
  }
  return [];
}

function revisionCollectionIsObservable(editor: LiveEditor): boolean {
  const collection = editor.revisions;
  return !!(
    Array.isArray(collection?.changes) ||
    (typeof collection?.length === 'number' &&
      typeof collection?.get === 'function')
  );
}

function createdRevisions(
  editor: LiveEditor,
  before: LiveRevision[]
): LiveRevision[] {
  const beforeSet = new Set(before);
  return snapshotRevisions(editor).filter(
    (revision) => !beforeSet.has(revision)
  );
}

// A full-document projection would drown the model; report only the first
// divergence with enough surrounding context to identify the location.
function describeStreamDivergence(expected: string, actual: string): string[] {
  let start = 0;
  const comparable = Math.min(expected.length, actual.length);
  while (start < comparable && expected[start] === actual[start]) start++;
  const from = Math.max(0, start - 60);
  const excerpt = (stream: string) =>
    JSON.stringify(stream.slice(from, start + 80));
  return [
    `after rejecting every revision the document would read ${excerpt(
      actual
    )} where it previously read ${excerpt(expected)}`
  ];
}

const TRACKED_TEXT_OPS = new Set([
  'replace_text',
  'replace_selection',
  'delete_text',
  'insert_text',
  'set_cell_text',
  'set_cell_formula',
  'set_column_formula',
  'change_case'
]);

// A structural table edit is content just as much as text is, so it carries the
// same requirement: SyncFusion must author a rejectable card of the right kind.
const TRACKED_STRUCTURAL_OPS = new Map([
  ['insert_row', 'insertion'],
  ['delete_row', 'deletion']
]);

// A write is reviewable only when it can be undone from the Changes pane. This
// check runs immediately after the public write, before an op is reported
// successful.
//
// For text ops the property asserted is the one that actually matters and the
// one the byte-for-byte integrity tests assert globally: *rejecting every
// revision must restore exactly what this anchor read before the write*. The
// previous formulation guessed at that property from revision types instead,
// demanding an Insertion/Deletion pair for `set_cell_text`. SyncFusion authors
// no Deletion when the cell was empty and no revision at all when the text
// being overwritten is itself an unaccepted insertion, so writing into a row the
// assistant had just inserted was always reported `untracked_write` even though
// the write was fully tracked - and the compensating rollback then rejected the
// row insertion, making the new row appear and vanish.
function assertTrackedMutation(
  editor: LiveEditor,
  before: LiveRevision[],
  op: EditOp,
  priorRejectStream?: string
): void {
  const structural = TRACKED_STRUCTURAL_OPS.get(op.op);
  if (
    (!TRACKED_TEXT_OPS.has(op.op) && !structural) ||
    !revisionCollectionIsObservable(editor)
  )
    return;
  const revisions = createdRevisions(editor, before);
  if (revisions.some((revision) => typeof revision.reject !== 'function'))
    throw new OpError(
      'untracked_write',
      `SyncFusion created a revision for ${op.op} which cannot be rejected.`
    );
  const types = new Set(
    revisions.map((revision) =>
      String(revision.revisionType ?? '').toLowerCase()
    )
  );

  if (structural) {
    if (!revisions.length || !types.has(structural))
      throw new OpError(
        'untracked_write',
        `SyncFusion did not create a rejectable tracked ${structural} for ${op.op}.`
      );
    return;
  }

  if (priorRejectStream !== undefined) {
    const nowRejectsTo = rejectProjectionStream(parseSfdt(editor.serialize()));
    if (nowRejectsTo !== priorRejectStream)
      throw new OpError(
        'untracked_write',
        `${op.op} changed text which rejecting the tracked revisions would not restore.`,
        describeStreamDivergence(priorRejectStream, nowRejectsTo)
      );
    return;
  }

  // Live story ranges (text frames, page-specific headers/footers) are absent
  // from serialized SFDT, so the projection above cannot be evaluated for them.
  // Those anchors keep the revision-type assertion.
  if (
    !revisions.length ||
    (!types.has('insertion') &&
      String(op.replace ?? op.text ?? op.newText ?? '').length > 0) ||
    !types.has('deletion')
  )
    throw new OpError(
      'untracked_write',
      `SyncFusion did not create the required tracked revision pair for ${op.op}.`
    );
}

// Revert only cards created after `before`; never touch unrelated human
// revisions and never use global history or rejectAll. This is the safety net
// for a post-write verification failure.
function rejectCreatedRevisions(
  editor: LiveEditor,
  before: LiveRevision[]
): void {
  const revisions = createdRevisions(editor, before);
  if (!revisions.length) return;
  if (revisions.some((revision) => typeof revision.reject !== 'function'))
    throw new OpError(
      'compensating_rollback_failed',
      'A failed change set created a revision that could not be rejected.'
    );
  for (const revision of revisions) {
    const reject = revision.reject;
    if (typeof reject === 'function') reject.call(revision);
  }
}

// Bind a set of revisions authored by ONE logical edit so per-card accept/reject
// is all-or-nothing. The first accept/reject on any member resolves the whole
// group with that single decision; later clicks on already-resolved members are
// no-ops. Each native handler is wrapped in try/catch so a stale-range throw on a
// later member cannot undo the first member's (safe) result.
function groupRevisionsAtomic(
  group: LiveRevision[],
  changeSetId?: string
): void {
  if (group.length < 2) return;
  const natives = group.map((rev) => ({
    accept: typeof rev.accept === 'function' ? rev.accept.bind(rev) : undefined,
    reject: typeof rev.reject === 'function' ? rev.reject.bind(rev) : undefined
  }));
  const state = { resolved: false };
  const resolveAll = (isAccept: boolean) => {
    if (state.resolved) return;
    state.resolved = true;
    for (const n of natives) {
      const fn = isAccept ? n.accept : n.reject;
      if (!fn) continue;
      try {
        fn();
      } catch {
        // A later member's range may be stale once the first resolved; the
        // group's outcome is already consistent, so swallow and move on.
      }
    }
  };
  for (const rev of group) {
    if (changeSetId) (rev as any).robinChangeSetId = changeSetId;
    rev.accept = () => resolveAll(true);
    rev.reject = () => resolveAll(false);
  }
}

// Diff the revisions created by a single op (against a pre-op snapshot) and bind
// them atomically. A no-op when the op added fewer than two revisions.
function groupNewRevisions(
  editor: LiveEditor,
  before: LiveRevision[],
  changeSetId?: string
): number {
  const created = createdRevisions(editor, before);
  if (!created.length) return 0;
  groupRevisionsAtomic(created, changeSetId);
  return created.length;
}

const FORMAT_OPS = new Set([
  'apply_style',
  'clear_formatting',
  'set_char_format',
  'set_para_format',
  'indent_step',
  'apply_bullets',
  'apply_numbering',
  'clear_list'
]);

interface ChangeSetPlan {
  index: number;
  op: EditOp;
  target?: FlatBlock | LiveStoryTarget;
  source?: FlatBlock;
  inherited?: { characterFormat?: FormatBag; paragraphFormat?: FormatBag };
  targetBefore?: { characterFormat?: FormatBag; paragraphFormat?: FormatBag };
  // A `set_cell_text` whose cell does not exist yet because an earlier op in the
  // same change set creates it. It has no preflight target by definition.
  deferredNewCell?: boolean;
  // An `insert_text` whose paragraph does not exist yet because an earlier break
  // in the same change set creates it. Same contract as deferredNewCell.
  deferredNewParagraph?: boolean;
}

// Table ops which bring new, empty cells into existence WITHOUT shifting block
// indices. `insert_table` is deliberately excluded: it adds a block, so every
// later anchor in the batch shifts and a computed cell anchor could name a cell
// of an entirely different table. Filling a brand new table stays a second call
// against a re-read inventory.
const CELL_CREATING_OPS = new Set(['insert_row']);

// The rows every earlier `insert_row` in this batch brings into existence,
// keyed "section;block;row". A mid-table insert creates rows at indices that
// are OCCUPIED at preflight time - the rows below the anchor shift down to
// make room - so the batch's fill anchors for the new row resolve to a real,
// populated block today. Without this carve-out those fills relocate onto the
// shifted OLD row at apply time and overwrite existing data (or die
// `anchor_relocation_ambiguous` on repeated cell text); only end-of-table
// appends worked, because only there the computed anchors were vacant. Cell
// anchors inside a created-row range therefore mean "the row the insert
// creates", exactly as the tool vocabulary teaches, regardless of what
// occupies that index before the insert runs.
function rowsCreatedByEarlierInserts(
  edits: EditOp[],
  index: number
): Set<string> {
  const created = new Set<string>();
  for (const earlier of edits.slice(0, index)) {
    if (earlier?.op !== 'insert_row') continue;
    const parts = String(earlier.anchor ?? '').split(';');
    if (parts.length !== 5) continue;
    const row = Number(parts[2]);
    if (!Number.isInteger(row) || row < 0) continue;
    const count = positiveCount(earlier.count);
    const first = earlier.above === true ? row : row + 1;
    for (let offset = 0; offset < count; offset++)
      created.add(`${parts[0]};${parts[1]};${first + offset}`);
  }
  return created;
}

// Breaks which end the current paragraph and so bring exactly one new, empty
// paragraph into existence at the next block index. Text destined for that new
// paragraph has nowhere else to go, and requiring a second call for it leaves a
// blank page behind whenever the text half then fails - which is exactly what
// the captain saw when asking for a "THANK YOU" page.
const PARAGRAPH_CREATING_OPS = new Set([
  'insert_page_break',
  'insert_column_break'
]);

// The concessions the preflight makes to a not-yet-existing anchor. They stay
// honest because the deferred anchor was absent from the pre-edit block map (so
// it cannot shadow an existing block) and must resolve, at write time, to a
// block of the expected kind which is still empty. Anything else - the
// structural op did not create it, or index arithmetic landed on real content -
// fails the op, which fails the change set, which rejects every revision it
// created. Nothing partially applies.
function assertDeferredAnchorIsNewAndEmpty(
  plan: ChangeSetPlan,
  target: FlatBlock
): void {
  if (!plan.deferredNewCell && !plan.deferredNewParagraph) return;
  if (plan.deferredNewCell && target.kind !== 'table_cell')
    throw new OpError(
      'deferred_anchor_not_a_cell',
      `Anchor "${plan.op.anchor}" did not resolve to a table cell after the structural edit.`
    );
  if (plan.deferredNewParagraph && target.kind === 'table_cell')
    throw new OpError(
      'deferred_anchor_not_a_paragraph',
      `Anchor "${plan.op.anchor}" resolved to a table cell, not the paragraph the break was expected to create.`
    );
  if (target.text.length)
    throw new OpError(
      'deferred_anchor_occupied',
      `Anchor "${
        plan.op.anchor
      }" resolved to a block which already reads ${JSON.stringify(
        target.text
      )}; refusing to overwrite existing content through a deferred anchor.`
    );
}

function mayShiftAnchors(op: EditOp): boolean {
  // A selection replacement can swallow paragraph marks, so treat it as always
  // shifting: the anchors after it must be re-resolved, never reused.
  if (op.op === 'replace_selection') return true;
  if (op.op === 'insert_text') return /[\r\n]/.test(String(op.text ?? ''));
  if (op.op === 'replace_text' || op.op === 'set_cell_text')
    return /[\r\n]/.test(String(op.replace ?? op.text ?? op.newText ?? ''));
  return !FORMAT_OPS.has(op.op) && !ANCHORLESS_OPS.has(op.op);
}

function resolveChangeSetBlock(
  blocks: FlatBlock[],
  anchor: string,
  baseline: FlatBlock | undefined,
  anchorsMayHaveShifted: boolean
): FlatBlock {
  const direct = blocks.find((block) => block.anchor === anchor);
  if (!baseline) {
    if (direct) return direct;
    throw new OpError(
      'anchor_not_found',
      `No block found for anchor "${anchor}".`
    );
  }
  if (!anchorsMayHaveShifted && direct) return direct;
  const matches = blocks.filter(
    (block) => block.kind === baseline.kind && block.text === baseline.text
  );
  if (matches.length === 1) return matches[0];
  if (!matches.length)
    throw new OpError(
      'anchor_relocation_not_found',
      `Anchor "${anchor}" moved after a structural edit and its preflight text no longer identifies one block.`
    );
  throw new OpError(
    'anchor_relocation_ambiguous',
    `Anchor "${anchor}" moved after a structural edit and matches ${matches.length} blocks; refusing a non-deterministic write.`
  );
}

function restoreCapturedFormat(
  editor: LiveEditor,
  target: FlatBlock,
  captured: { characterFormat?: FormatBag; paragraphFormat?: FormatBag }
): void {
  const styleName = captured.paragraphFormat?.styleName;
  if (typeof styleName === 'string' && styleName.trim()) {
    selectParagraph(editor, target);
    callEditor(editor, 'applyStyle', styleName);
  }
  selectBlock(editor, target);
  for (const [prop, value] of Object.entries(captured.characterFormat ?? {})) {
    if (isMeaningfulInheritedFormatValue(prop, value))
      writeFormatPropIfDifferent(
        editor.selection.characterFormat,
        prop,
        normalizeInheritedCharValue(prop, value)
      );
  }
  selectParagraph(editor, target);
  for (const [prop, value] of Object.entries(captured.paragraphFormat ?? {})) {
    if (prop !== 'styleName' && isMeaningfulInheritedFormatValue(prop, value))
      writeFormatPropIfDifferent(editor.selection.paragraphFormat, prop, value);
  }
}

// ---------------------------------------------------------------------------
// Computed format inheritance for inserted paragraphs
// ---------------------------------------------------------------------------
//
// SyncFusion formats an insertion from its insertion POINT, so a section added
// through the common anchoring - an empty separator paragraph - comes out as
// plain Normal/Calibri regardless of what the surrounding document looks like.
// The recipe that fixed this (a second change set carrying `inheritFormatFrom`)
// is a step the model can skip, so the engine now computes the reference
// itself: every paragraph an insert CREATES inherits the visible format of the
// nearest preceding non-empty block in its own container, per paragraph role.
// Mid-text inserts and cell text writes are untouched - SyncFusion's own
// inheritance is correct there.

// One paragraph the insert brings into existence, with the reference that will
// format it. `fallbackStyleName` marks the no-reference case: the paragraph is
// set to the document default style instead of wearing whatever format the
// split donor happened to carry (e.g. a heading's).
interface PlannedInsertInheritance {
  anchor: string;
  expectedText: string;
  source?: FlatBlock;
  inherited?: { characterFormat?: FormatBag; paragraphFormat?: FormatBag };
  fallbackStyleName?: string;
}

const INSERTED_HEADING_MAX_CHARS = 80;
// The block map's isHeading covers only built-in "Heading N"/Title styles;
// real documents carry custom heading styles (the live document's headings are
// "headingNoToc"). Reference selection must recognise those too.
const HEADING_LIKE_STYLE = /heading|title/i;

function isHeadingLikeBlock(block: FlatBlock): boolean {
  return (
    block.isHeading || HEADING_LIKE_STYLE.test(block.format?.styleName ?? '')
  );
}

// Containers for reference resolution: a table cell is its own container; the
// body story is one container across SFDT sections (a section break changes
// page geometry, not what body text looks like).
function inSameContainer(
  targetAnchor: string,
  candidateAnchor: string
): boolean {
  const target = targetAnchor.split(';');
  const candidate = candidateAnchor.split(';');
  if (target.length !== candidate.length) return false;
  if (target.length === 5)
    return target.slice(0, 4).join(';') === candidate.slice(0, 4).join(';');
  return target.length === 2;
}

// Insert-shape role inference. A short line without terminal punctuation that
// is followed by more inserted content reads as a heading; everything else is
// body. A single-paragraph insert is always body - there is nothing following
// it to head.
function segmentLooksLikeHeading(segments: string[], index: number): boolean {
  const trimmed = segments[index].trim();
  if (!trimmed || trimmed.length > INSERTED_HEADING_MAX_CHARS) return false;
  if (/[.!?:;,]$/.test(trimmed)) return false;
  return segments.slice(index + 1).some((segment) => segment.trim().length > 0);
}

// Nearest preceding block in the target's container that can serve as a format
// reference for the given role: non-empty (an empty paragraph carries no
// formatting worth copying), heading-like for heading paragraphs, non-heading
// for body paragraphs. Walking a body target skips embedded table cells and
// keeps climbing; walking a cell target stops at the cell boundary.
function findComputedReference(
  blocks: FlatBlock[],
  targetIndex: number,
  targetAnchor: string,
  includeTarget: boolean,
  role: 'heading' | 'body'
): FlatBlock | undefined {
  const isCellTarget = targetAnchor.split(';').length === 5;
  for (let i = includeTarget ? targetIndex : targetIndex - 1; i >= 0; i--) {
    const candidate = blocks[i];
    if (!inSameContainer(targetAnchor, candidate.anchor)) {
      if (isCellTarget) return undefined;
      continue;
    }
    if (!candidate.text.trim()) continue;
    if (role === 'heading' && !isHeadingLikeBlock(candidate)) continue;
    if (role === 'body' && isHeadingLikeBlock(candidate)) continue;
    return candidate;
  }
  return undefined;
}

// Decide, BEFORE the insert runs, which created paragraphs will need a format
// and from which reference. `explicit` carries a model-chosen source (an
// `inheritFormatFrom` on the insert op itself), which replaces the computed
// reference for every created paragraph. Returns undefined when the insert
// creates no paragraphs - SyncFusion's insertion-point inheritance is correct
// for mid-text inserts (and for cell text), so the default must not interfere.
function planInsertInheritance(
  editor: LiveEditor,
  op: TypedEditOp<'insert_text'>,
  target: FlatBlock,
  blocks: FlatBlock[],
  explicit?: {
    source: FlatBlock;
    inherited?: { characterFormat?: FormatBag; paragraphFormat?: FormatBag };
  }
): PlannedInsertInheritance[] | undefined {
  if (isLiveStoryAnchor(target.anchor)) return undefined;
  const text = insertionText(op);
  if (!text) return undefined;
  const segments = text.split(/\r\n|\r|\n/);
  const offset = insertionPoint(op, target);
  const createsParagraphs = segments.length > 1;
  // Filling a previously-empty paragraph IS creating the paragraph in every
  // sense that matters for formatting: its only insertion-point donor is the
  // meaningless empty separator.
  const fillsEmptyParagraph = target.length === 0;
  if (!createsParagraphs && !fillsEmptyParagraph) {
    if (explicit)
      throw new OpError(
        'inherit_requires_new_paragraph',
        'inheritFormatFrom on insert_text formats the paragraphs the insert creates; this insert lands inside existing text. Format existing content with apply_style, set_char_format or set_para_format.'
      );
    return undefined;
  }

  const lastIndex = segments.length - 1;
  const anchorParts = target.anchor.split(';');
  const blockIndexBase = Number(anchorParts.pop());
  const targetIndex = blocks.findIndex(
    (block) => block.anchor === target.anchor
  );
  if (targetIndex < 0 || !Number.isInteger(blockIndexBase)) return undefined;
  // When the insertion point sits after existing target text (position
  // "after"/"end"), the target block itself precedes the new paragraphs and is
  // a legitimate reference candidate.
  const includeTarget =
    offset > 0 && target.text.slice(0, offset).trim().length > 0;
  const isBodyTarget = anchorParts.length === 1;

  const inheritedBySource = new Map<
    string,
    { characterFormat?: FormatBag; paragraphFormat?: FormatBag }
  >();
  const readInherited = (source: FlatBlock) => {
    let inherited = inheritedBySource.get(source.anchor);
    if (!inherited) {
      inherited = readEffectiveSourceFormat(editor, source);
      inheritedBySource.set(source.anchor, inherited);
    }
    return inherited;
  };

  const planned: PlannedInsertInheritance[] = [];
  segments.forEach((segment, index) => {
    // The current-text projection drops tab inlines, so compare without them.
    const expectedText = segment.replace(/\t/g, '');
    if (!expectedText.trim()) return;
    // Only paragraphs consisting solely of inserted content are formatted; a
    // paragraph that merges with existing text keeps that text's format.
    const hasLeadingExistingText =
      index === 0 && offset > 0 && target.length > 0;
    const hasTrailingExistingText =
      index === lastIndex && offset < target.length;
    if (hasLeadingExistingText || hasTrailingExistingText) return;
    const anchor = [...anchorParts, blockIndexBase + index].join(';');

    if (explicit) {
      planned.push({
        anchor,
        expectedText,
        source: explicit.source,
        inherited: explicit.inherited
      });
      return;
    }

    const role = segmentLooksLikeHeading(segments, index) ? 'heading' : 'body';
    let source =
      role === 'heading'
        ? findComputedReference(
            blocks,
            targetIndex,
            target.anchor,
            includeTarget,
            'heading'
          )
        : undefined;
    if (!source)
      source = findComputedReference(
        blocks,
        targetIndex,
        target.anchor,
        includeTarget,
        'body'
      );
    if (source) {
      planned.push({
        anchor,
        expectedText,
        source,
        inherited: readInherited(source)
      });
    } else if (isBodyTarget) {
      // No reference in the container: fall back to the document default
      // style rather than let the paragraph wear the split donor's format
      // (a body paragraph split off a heading must not stay a heading).
      planned.push({ anchor, expectedText, fallbackStyleName: 'Normal' });
    }
    // A cell with no in-cell reference is left alone: SyncFusion's cell
    // defaults are the honest answer there.
  });
  return planned.length ? planned : undefined;
}

// Format the paragraphs a just-applied insert created, from the plan computed
// before the write. Read-back verification (verifyInheritedFormat / the style
// check on the fallback) is the success criterion; a mismatch fails the op and
// with it the change set.
function applyInsertInheritance(
  editor: LiveEditor,
  planned: PlannedInsertInheritance[],
  byAnchor: Map<string, FlatBlock>
): void {
  for (const paragraph of planned) {
    const target = byAnchor.get(paragraph.anchor);
    if (!target || target.text !== paragraph.expectedText) {
      // Lightweight test doubles do not split paragraphs on newline inserts; a
      // mounted DocumentEditor always does. Skip quietly for doubles, fail
      // loudly when the real editor's split did not land where computed.
      if (!(editor as any).element && !(editor as any).documentHelper) return;
      throw new OpError(
        'inherited_paragraph_not_found',
        `The paragraph the insert created at "${paragraph.anchor}" did not resolve for formatting.`,
        [
          `expected: ${JSON.stringify(paragraph.expectedText)}`,
          `actual: ${JSON.stringify(target?.text)}`
        ]
      );
    }
    if (paragraph.source) {
      applyResolvedInheritedFormat(
        editor,
        paragraph.source,
        target,
        paragraph.inherited ??
          readEffectiveSourceFormat(editor, paragraph.source)
      );
    } else if (paragraph.fallbackStyleName) {
      selectParagraph(editor, target);
      callEditor(editor, 'applyStyle', paragraph.fallbackStyleName);
      selectParagraph(editor, target);
      const resolved = comparableFormatValue(
        editor.selection?.paragraphFormat?.styleName
      );
      if (resolved !== paragraph.fallbackStyleName)
        throw new OpError(
          'inherited_format_mismatch',
          `The document-default fallback style did not resolve at ${paragraph.anchor}.`,
          [
            `paragraphFormat.styleName: expected ${JSON.stringify(
              paragraph.fallbackStyleName
            )}, got ${JSON.stringify(resolved)}`
          ]
        );
    }
  }
}

// ---------------------------------------------------------------------------
// Batch-level integrity: what is only visible when the whole change set is read
// at once, checked before anything is written.
//
// Two things live here, and both exist because they are invisible one op at a
// time:
//
//   1. TWO TOTALS OVER THE SAME TABLE THAT SPAN DIFFERENT ROWS. Live on
//      2026-07-27 the model wrote sum(rows 1..3) into one column's total and
//      sum(rows 1..4) into the column beside it. Each op is individually
//      perfect; together, one of them is wrong by construction. Nothing except
//      a cross-op check can see it.
//   2. THE DEPENDENCY CHAIN, ANNOUNCED. A person asks to re-total BECAUSE they
//      changed an input, so when an input column changes the derived column and
//      the totals are all stale and Robin should follow the chain rather than
//      update the one cell it was told about and stop. Following it silently is
//      worse than not following it: three columns move and the user was told
//      about one. So a batch that touches more than one column of one table
//      must carry `plan` - the announcement - and each derived write must carry
//      its `label`. This is a gate in the engine, not a line in the prompt,
//      because this stack has already proved that a prompt instruction
//      ("always name the rule you are invoking") ships and is ignored.
// ---------------------------------------------------------------------------

const FORMULA_OPS = new Set(['set_cell_formula', 'set_column_formula']);

/**
 * Does this op put a QUANTITY into a table cell? A dependency chain is about
 * amounts moving, so filling a freshly inserted row with "Annual Premium",
 * "Toronto" or a location id `0093` is not part of one - only a computed write
 * or a literal amount is.
 */
function writesCellQuantity(op: EditOp): boolean {
  if (!op?.op) return false;
  if (FORMULA_OPS.has(op.op)) return true;
  return op.op === 'set_cell_text' && isQuantityText(String(op.text ?? ''));
}

interface ColumnTouch {
  tableAnchor: string;
  column: number;
  /** Anchors written one at a time. */
  cells: string[];
  /** True when a set_column_formula covers the column. */
  wholeColumn: boolean;
  /** True when at least one write into this column is engine-computed. */
  computed: boolean;
  /** The model's own labels for the writes into this column, in order. */
  labels: string[];
}

/** Every (table, column) this batch writes a quantity into. */
function collectColumnTouches(edits: EditOp[]): ColumnTouch[] {
  const touches = new Map<string, ColumnTouch>();
  for (const op of edits) {
    if (!writesCellQuantity(op)) continue;
    const parts = String(op.anchor ?? '').split(';');
    if (parts.length !== 5) continue;
    const tableAnchor = `${parts[0]};${parts[1]}`;
    const column = Number(parts[3]);
    if (!Number.isInteger(column)) continue;
    const key = `${tableAnchor};${column}`;
    const touch = touches.get(key) ?? {
      tableAnchor,
      column,
      cells: [],
      wholeColumn: false,
      computed: false,
      labels: []
    };
    if (op.op === 'set_column_formula') touch.wholeColumn = true;
    else touch.cells.push(String(op.anchor));
    if (FORMULA_OPS.has(op.op)) touch.computed = true;
    const label = typeof op.label === 'string' ? op.label.trim() : '';
    if (label) touch.labels.push(label);
    touches.set(key, touch);
  }
  return Array.from(touches.values());
}

/**
 * What this change set is about to do, in resolved terms, built by the ENGINE
 * from the ops themselves. Always computed and always returned on the change
 * set, so "what was touched" is a fact of the result rather than something the
 * model may or may not have mentioned. It is also the text a missing-`plan`
 * refusal hands back, so the model can simply say it.
 */
function describeChangeSetTouches(touches: ColumnTouch[]): string {
  if (!touches.length) return 'This change set writes no table-cell values.';
  const byTable = new Map<string, ColumnTouch[]>();
  for (const touch of touches) {
    const list = byTable.get(touch.tableAnchor) ?? [];
    list.push(touch);
    byTable.set(touch.tableAnchor, list);
  }
  const describeColumn = (touch: ColumnTouch): string => {
    const what = [
      touch.wholeColumn ? 'the whole column recomputed' : '',
      touch.cells.length
        ? `${touch.cells.length} cell${
            touch.cells.length === 1 ? '' : 's'
          } (${touch.cells.join(', ')})`
        : ''
    ]
      .filter(Boolean)
      .join(' plus ');
    const label = touch.labels.length ? ` - ${touch.labels.join('; ')}` : '';
    return `column ${touch.column}${label}: ${what}`;
  };
  return Array.from(byTable.entries())
    .map(
      ([tableAnchor, list]) =>
        `the table at ${tableAnchor}: ${list
          .sort((a, b) => a.column - b.column)
          .map(describeColumn)
          .join('; ')}`
    )
    .join('. Then ');
}

/** A refusal that applies to the whole change set, before any write. */
interface BatchRefusal {
  code: string;
  message: string;
  details?: string[];
  /** Indices of the ops the refusal is about; empty means all of them. */
  indices: number[];
}

/**
 * Two aggregates over one table that span DIFFERENT rows cannot both be right.
 * The comparison is per column: aggregating one column over rows 1-5 and again
 * over rows 1-10 is a legitimate subtotal-plus-grand-total, but two DIFFERENT
 * columns of one table spanning different rows is the live defect - the rows of
 * a table are shared, so the columns cannot honestly disagree about them.
 */
function detectInconsistentAggregateRanges(
  edits: EditOp[]
): BatchRefusal | null {
  // table -> column -> the first op that aggregated it, and over which spans.
  const byTable = new Map<
    string,
    Map<number, { spans: string; index: number; formula: string }>
  >();
  edits.forEach((op, index) => {
    if (op?.op !== 'set_cell_formula') return;
    const formula = String(op.formula ?? '');
    const aggregates = collectFormulaAggregates(formula);
    if (!aggregates?.length) return;
    const spansByColumn = new Map<string, string[]>();
    for (const { ref } of aggregates) {
      const key = `${ref.tableAnchor}|${ref.column}`;
      const list = spansByColumn.get(key) ?? [];
      list.push(`${ref.startRow}..${ref.endRow}`);
      spansByColumn.set(key, list);
    }
    for (const [key, spans] of Array.from(spansByColumn.entries())) {
      const [tableAnchor, columnText] = key.split('|');
      const columns = byTable.get(tableAnchor) ?? new Map();
      const column = Number(columnText);
      if (!columns.has(column))
        columns.set(column, {
          spans: spans.slice().sort().join(' + '),
          index,
          formula
        });
      byTable.set(tableAnchor, columns);
    }
  });
  for (const [tableAnchor, columns] of Array.from(byTable.entries())) {
    const entries = Array.from(columns.entries()).sort(
      (a, b) => a[0] - b[0]
    ) as Array<[number, { spans: string; index: number; formula: string }]>;
    if (entries.length < 2) continue;
    const [firstColumn, first] = entries[0];
    const mismatch = entries.find(([, entry]) => entry.spans !== first.spans);
    if (!mismatch) continue;
    const [otherColumn, other] = mismatch;
    return {
      code: 'inconsistent_aggregate_ranges',
      message:
        `Two aggregates over the table at ${tableAnchor} span different rows: ` +
        `column ${firstColumn} over rows ${first.spans} and column ${otherColumn} over rows ${other.spans}. ` +
        'The rows of a table are shared, so totals of two columns of one table cannot honestly cover different rows - one of these is wrong by construction, and writing both would leave no way to tell which. ' +
        'Nothing was written. Re-read `table_facts`, decide the data rows ONCE, and use that same span for every column of this table.',
      details: [
        `column ${firstColumn}: ${first.formula}`,
        `column ${otherColumn}: ${other.formula}`
      ],
      indices: [first.index, other.index]
    };
  }
  return null;
}

/**
 * The announcement gate. A batch that writes into more than one column of one
 * table is following a dependency chain, and must say so first.
 */
function detectUnannouncedChain(
  edits: EditOp[],
  touches: ColumnTouch[],
  plan: string
): BatchRefusal | null {
  const byTable = new Map<string, ColumnTouch[]>();
  for (const touch of touches) {
    const list = byTable.get(touch.tableAnchor) ?? [];
    list.push(touch);
    byTable.set(touch.tableAnchor, list);
  }
  // A chain needs two things: more than one column of one table moving, and at
  // least one of those values being DERIVED. Two literal amounts in two columns
  // of a row the user dictated are two facts, not a chain.
  const chained = Array.from(byTable.entries()).filter(
    ([, list]) => list.length > 1 && list.some((touch) => touch.computed)
  );
  if (!chained.length) return null;
  const indices = edits.reduce<number[]>((out, op, index) => {
    if (writesCellQuantity(op)) out.push(index);
    return out;
  }, []);
  const announcement = describeChangeSetTouches(touches);
  if (!plan.trim()) {
    const [tableAnchor, list] = chained[0];
    return {
      code: 'unannounced_dependency_chain',
      message:
        `This change set writes into ${
          list.length
        } columns of the table at ${tableAnchor} (${list
          .map((touch) => `column ${touch.column}`)
          .join(
            ', '
          )}), so it is following a dependency chain: an input changed and the values derived from it are being rewritten too. That is the right thing to do, and it is exactly the thing that must be SAID BEFORE it is done - a user who asked about one cell and silently got three columns cannot review what happened. ` +
        'Send the identical edits again with `plan` set to the announcement you are making to the user, e.g. "The tax column and both totals depend on this premium change - recomputing all three." ' +
        `In resolved terms this batch would write: ${announcement}. Nothing was written.`,
      indices
    };
  }
  // The announcement is only as good as the names in it, and the names are the
  // per-op labels the engine echoes back beside what it actually resolved. In a
  // chained batch they stop being optional.
  const unlabelled = edits.reduce<number[]>((out, op, index) => {
    if (
      op?.op &&
      FORMULA_OPS.has(op.op) &&
      !(typeof op.label === 'string' && op.label.trim())
    )
      out.push(index);
    return out;
  }, []);
  if (unlabelled.length) {
    return {
      code: 'unlabelled_chained_write',
      message:
        'Every computed write in a change set that follows a dependency chain must carry a `label`: your own short description of what that cell holds ("the Tax column at 13%", "the annual premium with tax"). The engine echoes each label back beside the rows and column it actually resolved, which is the only way a reader can check the interpretation against what was read - and with three columns moving at once there is no other way to tell them apart. Add a `label` to each computed op and re-send. Nothing was written.',
      details: unlabelled.map(
        (index) => `edit ${index} (${edits[index].op}) has no label`
      ),
      indices: unlabelled
    };
  }
  return null;
}

// Applies a logical change set in deterministic phases. We preflight only the
// relevant anchors, re-resolve them after structural writes, and verify only
// each affected source/target pair; a large document never needs a full result
// inventory to prove inherited formatting succeeded.
export function applyDocumentEdits(
  editor: LiveEditor,
  input: { edits: EditOp[]; changeSetId?: string; plan?: string }
): ApplyEditsResult {
  const edits = Array.isArray(input?.edits) ? input.edits : [];
  const results: Array<EditResult | undefined> = new Array(edits.length);
  const warnings: string[] = [];
  const changeSetId =
    typeof input?.changeSetId === 'string' && input.changeSetId.trim()
      ? input.changeSetId.trim()
      : 'document-edit-change-set';
  const plan = typeof input?.plan === 'string' ? input.plan.trim() : '';
  // What the engine, reading the ops, says this change set does. Always
  // computed - it is a fact of the batch, not a claim by the model.
  const columnTouches = collectColumnTouches(edits);
  const announcement = describeChangeSetTouches(columnTouches);
  const priorTrackChanges = editor.enableTrackChanges;
  editor.enableTrackChanges = true;
  let blocks: FlatBlock[] = [];
  let byAnchor = new Map<string, FlatBlock>();
  // "What the whole document would read if every revision were rejected",
  // kept alongside the live block map so a tracked write can be proven
  // reversible without a second serialize per op.
  let rejectStream = '';
  const revisionSnapshot = snapshotRevisions(editor);
  const plans: ChangeSetPlan[] = [];
  const nonBlockingStoryWriteFailures = new Set<number>();
  const resolvedFormatTargets = new Map<number, FlatBlock>();
  let anchorsMayHaveShifted = false;
  const refresh = () => {
    const sfdt = parseSfdt(editor.serialize());
    blocks = flattenSfdt(sfdt);
    byAnchor = new Map(blocks.map((block) => [block.anchor, block] as const));
    rejectStream = rejectProjectionStream(sfdt);
  };
  refresh();
  const fail = (index: number, op: EditOp, err: unknown) => {
    results[index] = {
      ok: false,
      op: op?.op ?? '',
      anchor: op?.anchor,
      error: isOpError(err) ? err.code : 'op_failed',
      ...(isOpError(err) && err.message && err.message !== err.code
        ? { message: err.message }
        : {}),
      ...(isOpError(err)
        ? err.details
          ? { details: err.details }
          : {}
        : { details: [describeUnexpectedError(err)] }),
      ...(isOpError(err) && err.retry ? { retry: err.retry } : {})
    };
  };

  // Phase 0: what only the whole batch can show. Both of these refuse BEFORE
  // any anchor is resolved, so a refused change set costs nothing at all.
  const batchRefusal =
    detectInconsistentAggregateRanges(edits) ??
    detectUnannouncedChain(edits, columnTouches, plan);
  if (batchRefusal) {
    for (const index of batchRefusal.indices) {
      results[index] = {
        ok: false,
        op: edits[index]?.op ?? '',
        ...(edits[index]?.anchor ? { anchor: edits[index].anchor } : {}),
        error: batchRefusal.code,
        message: batchRefusal.message,
        ...(batchRefusal.details ? { details: batchRefusal.details } : {})
      };
    }
  }

  // Phase 1: capture every pre-existing target/source before any write. Format
  // targets may be created by an earlier structural operation; sources may not.
  const hasStructuralEdits = edits.some(
    (op) => op?.op && !FORMAT_OPS.has(op.op) && !ANCHORLESS_OPS.has(op.op)
  );
  edits.forEach((op, index) => {
    // Already refused by a batch-level check; do not re-diagnose it.
    if (results[index]) return;
    const name = op?.op;
    if (!name) {
      results[index] = { ok: false, op: '', error: 'missing_op' };
      return;
    }
    if (UNSAFE_CHANGE_SET_OPS.has(name)) {
      results[index] = {
        ok: false,
        op: name,
        error: 'unsafe_global_history_op',
        details: [
          `${name} is global editor history and cannot run in an assistant change set. Use a future scoped changeSet-specific inverse instead.`
        ]
      };
      return;
    }
    if (name === 'replace_all' || ANCHORLESS_OPS.has(name)) {
      plans.push({ index, op });
      return;
    }
    if (!op.anchor) {
      results[index] = { ok: false, op: name, error: 'missing_anchor' };
      return;
    }
    // Header/footer matches are discoverable but not writable through a public,
    // tracked SyncFusion range. Report that exact limitation without allowing
    // them to poison independently-verifiable body/table/text-frame edits.
    if (isUnverifiedStoryWriteAnchor(op.anchor)) {
      results[index] = {
        ok: false,
        op: name,
        anchor: op.anchor,
        error: 'story_write_unverified',
        details: [
          'Header/footer text is searchable but not writable as a tracked SyncFusion range.'
        ]
      };
      nonBlockingStoryWriteFailures.add(index);
      return;
    }
    const indexedTarget = byAnchor.get(op.anchor);
    // A formatting op can intentionally point at the future anchor created by
    // an earlier insert. Its expect value identifies that future paragraph and
    // prevents today's occupant of the same hierarchical index being captured
    // as the preflight target. That deferral only means something in a change
    // set whose structural ops can shift anchors: in a formatting-only set no
    // anchor can move, so today's occupant IS the block the model named, and
    // an expect discrepancy must be reported as what it is - stale expect
    // text - never as a missing anchor (observed live: a follow-up formatting
    // set styling freshly inserted paragraphs died anchor_not_found 18 times
    // on anchors that existed).
    const formatExpectMismatch =
      FORMAT_OPS.has(name) &&
      op.expect != null &&
      indexedTarget != null &&
      !expectTextMatches(op.expect, indexedTarget.text);
    if (formatExpectMismatch && !hasStructuralEdits) {
      if (String(op.expect) === '') {
        // Schema-shaped tool calls carry every field on every op, so an EMPTY
        // expect aimed at real content in a shift-free set is an artifact of
        // the op schema, not an expectation; drop it rather than refuse the
        // block the anchor plainly names. `expectGuardRefuses` now applies this
        // same reading to every op, but the deletion stays: in a batch WITH
        // structural edits the empty placeholder still defers this op's anchor
        // resolution below, which is what keeps formatting landing on the
        // paragraphs an insert just created.
        delete (op as { expect?: unknown }).expect;
      } else {
        results[index] = {
          ok: false,
          op: name,
          anchor: op.anchor,
          error: 'expect_mismatch',
          details: staleAnchorDetails(op.expect, indexedTarget.text)
        };
        return;
      }
    }
    let target: FlatBlock | LiveStoryTarget | undefined =
      formatExpectMismatch && hasStructuralEdits ? undefined : indexedTarget;
    // Search returns public, selection-ready story ranges which SFDT cannot
    // flatten (notably text frames and page-specific headers/footers). Text
    // mutations for those anchors preflight against that same live range.
    if (
      !target &&
      isLiveStoryAnchor(op.anchor) &&
      (name === 'replace_text' || name === 'delete_text')
    ) {
      try {
        target = resolveLiveStoryTarget(editor, op);
      } catch (err) {
        fail(index, op, err);
        return;
      }
    }
    // `set_cell_text` may address a cell an earlier op in this same change set
    // is about to create, so a row insert and its cell values are one atomic,
    // single-card edit instead of two calls with a stray empty row between
    // them. Mid-table, the created row's indices are occupied at preflight (the
    // old rows shift down to make room), so an anchor inside a created-row
    // range is deferred even when a block answers to it today - the write-time
    // guard still requires the resolved cell to be brand new and empty.
    const deferredNewCell =
      (name === 'set_cell_text' || name === 'set_cell_formula') &&
      (target
        ? !isLiveStoryTarget(target) &&
          target.kind === 'table_cell' &&
          rowsCreatedByEarlierInserts(edits, index).has(
            String(op.anchor).split(';').slice(0, 3).join(';')
          )
        : edits
            .slice(0, index)
            .some(
              (earlier) => earlier?.op && CELL_CREATING_OPS.has(earlier.op)
            ));
    if (deferredNewCell) target = undefined;
    // `insert_text` may address the empty paragraph an earlier break in this
    // same change set is about to create, so a new page and the text on it are
    // one atomic, single-card edit instead of two calls with a stray blank page
    // between them when the second one fails.
    const deferredNewParagraph =
      !target &&
      name === 'insert_text' &&
      edits
        .slice(0, index)
        .some(
          (earlier) => earlier?.op && PARAGRAPH_CREATING_OPS.has(earlier.op)
        );
    if (
      !target &&
      !deferredNewCell &&
      !deferredNewParagraph &&
      (!FORMAT_OPS.has(name) || !hasStructuralEdits)
    ) {
      results[index] = {
        ok: false,
        op: name,
        anchor: op.anchor,
        error: 'anchor_not_found'
      };
      return;
    }
    if (
      target &&
      !isLiveStoryTarget(target) &&
      // See applyAnchoredOp: replace_selection's `expect` describes the selected
      // range, not the start block, so it is checked by assertSelectionGuard.
      name !== 'replace_selection' &&
      expectGuardRefuses(op.expect, target.text)
    ) {
      results[index] = {
        ok: false,
        op: name,
        anchor: op.anchor,
        error: 'expect_mismatch',
        details: staleAnchorDetails(op.expect, target.text)
      };
      return;
    }
    if (
      target &&
      !isLiveStoryTarget(target) &&
      (name === 'replace_text' || name === 'delete_text') &&
      op.find != null &&
      !target.text.includes(String(op.find))
    ) {
      results[index] = {
        ok: false,
        op: name,
        anchor: op.anchor,
        error: 'text_not_found'
      };
      return;
    }
    const inheritAnchor =
      typeof op.inheritFormatFrom === 'string'
        ? op.inheritFormatFrom.trim()
        : '';
    const source = inheritAnchor ? byAnchor.get(inheritAnchor) : undefined;
    if (inheritAnchor && !source) {
      results[index] = {
        ok: false,
        op: name,
        anchor: op.anchor,
        error: 'inherit_anchor_not_found'
      };
      return;
    }
    // Refuse a meaningless reference before anything writes: an empty
    // paragraph accepted as a source restyles real content down to document
    // defaults (verified live: a heading silently became Normal/Calibri 11).
    if (source && !source.text.trim()) {
      results[index] = {
        ok: false,
        op: name,
        anchor: op.anchor,
        error: 'inherit_source_empty',
        details: [
          `inheritFormatFrom "${inheritAnchor}" is an empty block; it carries no formatting worth copying. Choose a non-empty reference block.`
        ]
      };
      return;
    }
    try {
      plans.push({
        index,
        op,
        target,
        source,
        ...(deferredNewCell ? { deferredNewCell: true } : {}),
        ...(deferredNewParagraph ? { deferredNewParagraph: true } : {}),
        ...(source
          ? { inherited: readEffectiveSourceFormat(editor, source) }
          : {}),
        ...(target && !isLiveStoryTarget(target) && FORMAT_OPS.has(name)
          ? { targetBefore: readEffectiveSourceFormat(editor, target) }
          : {})
      });
    } catch (err) {
      fail(index, op, err);
    }
  });

  const preflightFailed = results.some(
    (result, index) =>
      result && !result.ok && !nonBlockingStoryWriteFailures.has(index)
  );
  try {
    if (preflightFailed) {
      warnings.push(
        `change_set_preflight_failed: ${changeSetId}; no structural or formatting writes were attempted.`
      );
    } else {
      // Phase 2: apply structural writes in request order, refreshing the anchor
      // map after every mutation. This is the only phase allowed to shift blocks.
      for (const plan of plans) {
        const { op, index } = plan;
        if (results[index] || FORMAT_OPS.has(op.op)) continue;
        const revisionsBeforeOp = snapshotRevisions(editor);
        let writtenOp = op;
        let priorRejectStream: string | undefined;
        let insertInheritance: PlannedInsertInheritance[] | undefined;
        let opExtras: OpSuccessExtras | void;
        try {
          if (op.op === 'replace_all') {
            // Untyped->typed boundary, same contract as the dispatch sites.
            const count = applyReplaceAll(
              editor,
              op as TypedEditOp<'replace_all'>,
              blocks,
              byAnchor
            );
            if (!count) warnings.push(`replace_all: "${op.find}" not found.`);
          } else if (ANCHORLESS_OPS.has(op.op)) {
            applyAnchorlessOp(editor, op);
          } else {
            if (!op.anchor)
              throw new OpError(
                'missing_anchor',
                'Structural edit needs an anchor.'
              );
            if (plan.target && isLiveStoryTarget(plan.target)) {
              // A text frame's content IS in the serialized SFDT, so the reject
              // projection covers it and proves the write reversible exactly as
              // it does for a body or table anchor. Before this, story writes
              // were the last users of the revision-type guess, which reports
              // `untracked_write` whenever SyncFusion produces no NEW revision
              // pair - and it produces none when the text being overwritten is
              // itself a still-pending insertion. That is why the captain's
              // second advisor-title edit failed on the cover page while the
              // first succeeded, and why the table edit beside it was fine.
              //
              // Stories the projection genuinely cannot see (footnote/endnote
              // markers) keep the revision assertion; headers/footers never get
              // this far (`story_write_unverified` refuses them at preflight).
              if (isTextFrameAnchor(op.anchor))
                priorRejectStream = rejectStream;
              applyLiveStoryTextOp(editor, op, plan.target);
            } else {
              const target = resolveChangeSetBlock(
                blocks,
                op.anchor,
                plan.target,
                anchorsMayHaveShifted
              );
              assertDeferredAnchorIsNewAndEmpty(plan, target);
              writtenOp = { ...op, anchor: target.anchor };
              // The reversibility baseline: the whole-document reject
              // projection the last refresh built, so a tracked write costs no
              // extra serialize before it lands. Never a per-anchor text - a
              // paragraph-splitting insert moves the pre-existing content off
              // its index by design, so the anchor's occupant after the write
              // is a different logical block.
              if (TRACKED_TEXT_OPS.has(op.op)) priorRejectStream = rejectStream;
              // Decide the inserted paragraphs' formatting BEFORE the write,
              // while the reference blocks and their formats are readable in
              // their pre-insert positions. An explicit inheritFormatFrom on
              // the op replaces the computed reference (its source and format
              // snapshot were captured at preflight).
              if (op.op === 'insert_text') {
                const explicitSource = plan.source
                  ? resolveChangeSetBlock(
                      blocks,
                      String(op.inheritFormatFrom),
                      plan.source,
                      anchorsMayHaveShifted
                    )
                  : undefined;
                insertInheritance = planInsertInheritance(
                  editor,
                  // Untyped->typed boundary, same contract as dispatch sites.
                  writtenOp as TypedEditOp<'insert_text'>,
                  target,
                  blocks,
                  explicitSource
                    ? { source: explicitSource, inherited: plan.inherited }
                    : undefined
                );
              }
              opExtras = applyAnchoredOp(editor, writtenOp, target, byAnchor);
            }
            // A skipped no-op wrote nothing, so it cannot have shifted anything.
            if (mayShiftAnchors(op) && !(opExtras as OpSuccessExtras)?.noOp)
              anchorsMayHaveShifted = true;
          }
          // A no-op left the document untouched: there is no revision to
          // assert, nothing to refresh, and - the whole point - no change card.
          if ((opExtras as OpSuccessExtras)?.noOp) {
            results[index] = {
              ok: true,
              op: op.op,
              anchor: op.anchor,
              ...opExtras
            };
            continue;
          }
          assertTrackedMutation(
            editor,
            revisionsBeforeOp,
            writtenOp,
            priorRejectStream
          );
          refresh();
          if (insertInheritance) {
            applyInsertInheritance(editor, insertInheritance, byAnchor);
            refresh();
          }
          results[index] = {
            ok: true,
            op: op.op,
            anchor: op.anchor,
            ...(opExtras ?? {})
          };
        } catch (err) {
          fail(index, op, err);
        }
      }

      // Phase 3: re-resolve, then apply named style -> direct character -> direct
      // paragraph format -> scoped resolved-format verification per location.
      for (const plan of plans) {
        const { op, index } = plan;
        if (results[index] || !FORMAT_OPS.has(op.op)) continue;
        try {
          if (!op.anchor)
            throw new OpError(
              'missing_anchor',
              'Formatting edit needs an anchor.'
            );
          const target = resolveChangeSetBlock(
            blocks,
            op.anchor,
            plan.target && !isLiveStoryTarget(plan.target)
              ? plan.target
              : undefined,
            anchorsMayHaveShifted
          );
          const source = plan.source
            ? resolveChangeSetBlock(
                blocks,
                String(op.inheritFormatFrom),
                plan.source,
                anchorsMayHaveShifted
              )
            : undefined;
          resolvedFormatTargets.set(index, target);
          applyAnchoredOp(
            editor,
            {
              ...op,
              anchor: target.anchor,
              ...(source ? { inheritFormatFrom: source.anchor } : {}),
              ...(plan.inherited ? { __inheritedFormat: plan.inherited } : {})
            },
            target,
            byAnchor
          );
          refresh();
          results[index] = { ok: true, op: op.op, anchor: op.anchor };
        } catch (err) {
          fail(index, op, err);
        }
      }

      // A failed resolved-format check must not leave pre-existing formatting
      // partially changed. Restore every affected pre-existing target from its
      // preflight snapshot, scoped to those anchors only. New structural content
      // has no safe generic inverse, so it remains a tracked revision for reject.
      if (results.some((result) => result && !result.ok)) {
        for (const plan of plans) {
          const target = resolvedFormatTargets.get(plan.index);
          if (!target || !plan.targetBefore) continue;
          try {
            restoreCapturedFormat(editor, target, plan.targetBefore);
          } catch (err) {
            const existing = results[plan.index];
            results[plan.index] = {
              ok: false,
              op: plan.op.op,
              anchor: plan.op.anchor,
              error: 'compensating_rollback_failed',
              details: [
                ...(existing?.details ?? []),
                err instanceof Error
                  ? err.message
                  : 'Could not restore captured formatting.'
              ]
            };
          }
        }
        refresh();
      }
    }
  } finally {
    editor.enableTrackChanges = priorTrackChanges;
  }

  const hasMaterialFailure = results.some(
    (result, index) =>
      result && !result.ok && !nonBlockingStoryWriteFailures.has(index)
  );
  if (hasMaterialFailure) {
    try {
      // A failed text-frame/post-write verification must not leave earlier
      // sibling edits applied. Scoped native rejects restore only this change
      // set's cards; unrelated user revisions are never touched.
      rejectCreatedRevisions(editor, revisionSnapshot);
    } catch (err) {
      warnings.push(
        `change_set_rollback_failed: ${
          err instanceof Error ? err.message : 'unknown revision rollback error'
        }`
      );
    }
  }

  const revisionCount = groupNewRevisions(
    editor,
    revisionSnapshot,
    changeSetId
  );
  const hasFailure = results.some((result) => result && !result.ok);
  if (hasFailure) {
    // Never use global undo: it can revert unrelated history. Existing writes
    // remain bound to one rejectable revision decision and no op is presented as
    // a successful logical change set when any sibling failed verification.
    results.forEach((result, index) => {
      if (!result?.ok) return;
      results[index] = {
        ...result,
        ok: false,
        error: 'change_set_failed',
        details: [
          `Change set ${changeSetId} failed at another location; this write remains in the single rejectable revision group.`
        ]
      };
    });
  }
  const inventory = readPostEditInventory(editor, warnings);
  const response: ApplyEditsResult = {
    // results starts as a sparse array during preflight; Array#map skips holes,
    // so materialize every requested edit explicitly when a whole change set is
    // rejected before its sibling operations run.
    results: Array.from(
      { length: edits.length },
      (_, index) =>
        results[index] ?? {
          ok: false,
          op: edits[index]?.op ?? '',
          error: preflightFailed ? 'change_set_preflight_failed' : 'op_failed'
        }
    ),
    warnings,
    changeSet: {
      id: changeSetId,
      status: hasFailure ? 'failed' : 'applied',
      revisionGrouping: revisionCount
        ? 'bridge_bound_revision_cards'
        : 'no_revisions',
      uiGrouping: 'requires_cross_layer_group_card',
      // The engine's own account of what this batch touched, beside the
      // model's announcement of what it was about to do. Two independent
      // statements of the same thing: if they disagree, that is visible.
      announcement,
      ...(plan ? { plan } : {})
    }
  };
  if (inventory) response.inventory = inventory;
  return response;
}
