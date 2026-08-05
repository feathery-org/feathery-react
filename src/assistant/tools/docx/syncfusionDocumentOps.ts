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
  OpParams,
  SectionComposerBlock,
  SectionComposerSpec
} from '../../capabilities/registry';
import {
  CellNumberFormat,
  classifyNumericText,
  isZeroPaddedInteger,
  ParsedColumnCell,
  parseNumericCell,
  RenderFormatSource,
  renderNumericCell,
  rescaleExact,
  resolveRenderFormat,
  SkippedCell,
  upgradeNegativeStyle
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
import {
  AppearanceFacts,
  appearanceEquals,
  AppearanceRestore,
  AppearanceWrite,
  AppearanceWriteOutcome,
  AppearanceWriteReport,
  bandedShadingForRow,
  BORDER_SIDES,
  BorderFacts,
  BorderSide,
  BorderWrite,
  cellAppearanceAt,
  collectTableAppearance,
  copiedCellAppearance,
  detectTableBanding,
  inferHeaderRows,
  resolvedCellAppearanceAt,
  rowShadings,
  sourceRowForTarget,
  TableAppearance,
  TableBanding,
  tableIsUnstyled
} from './tableAppearance';

export const FULL_INVENTORY_BLOCK_LIMIT = 800;
export const SELECTION_TEXT_LIMIT = 500;
const ASSISTANT_DOCUMENT_AUTHOR = 'Robin';

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

export interface SectionPatternConfidence {
  matches: number;
  sampled: number;
  level: 'high' | 'medium' | 'low';
}

export interface SectionPatternValue<T> {
  value: T;
  confidence: SectionPatternConfidence;
}

export interface SectionPatternSequenceElement {
  role:
    | 'section_heading'
    | 'intro_paragraph'
    | 'subsection_heading'
    | 'subsection_paragraph'
    | 'table';
  level?: number;
  count: number;
  confidence: SectionPatternConfidence;
}

export interface SectionPatternRoleFormat {
  styleName?: string;
  characterFormat?: FormatBag;
  paragraphFormat?: FormatBag;
  confidence: SectionPatternConfidence;
}

export interface SectionPatternTable {
  ordinal: number;
  columns: SectionPatternValue<number>;
  headerRow: SectionPatternValue<boolean>;
  banding: SectionPatternValue<TableBanding | null>;
  columnHeaders: {
    variants: Array<{ texts: string[]; observed: number }>;
    confidence: SectionPatternConfidence;
  };
  styleName?: SectionPatternValue<string>;
}

export type SectionBoundaryElement = 'empty_paragraph' | 'page_break';

export interface SectionPatternBoundary {
  /** Ordered paragraph-level separator observed between sibling sections. */
  separator: SectionPatternValue<SectionBoundaryElement[]>;
  /** Paragraph spacing is reported separately because it does not add blocks. */
  headingBeforeSpacing?: SectionPatternValue<number>;
  endingParagraphAfterSpacing?: SectionPatternValue<number>;
}

export interface SectionPatternResult {
  ok: true;
  pattern: {
    sectionLevel?: SectionPatternValue<number>;
    sequence: SectionPatternSequenceElement[];
    tables: SectionPatternTable[];
    roles: Record<string, SectionPatternRoleFormat>;
    boundary?: SectionPatternBoundary;
  };
  sample: {
    available: number;
    sampled: number;
    recurring: number;
    near?: string;
    truncated?: true;
  };
  note: string;
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
  /**
   * This table has an appearance worth copying - a fill, a border, a header row
   * or a Word table style somewhere in it. One boolean, deliberately: the
   * skeleton read must stay cheap, and this is exactly enough for "make the new
   * section's table look like its siblings" to know which sibling to read and
   * that there is something to copy. The detail is a `table_facts` read.
   */
  styled?: true;
  /** The Word table style, when it has one. */
  styleName?: string;
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
  /**
   * How the CELL looks - fill, borders, vertical alignment. Present only where
   * this cell differs from the row-level `appearance` beside it, so a banded
   * row costs one appearance object rather than one per cell.
   */
  appearance?: AppearanceFacts;
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
  /**
   * Word's own header-row flag, as stored. A FACT, unlike "row 0 is the
   * header" - a table may carry it on two rows, or on none at all.
   */
  isHeader?: true;
  /**
   * The appearance every present cell of this row SHARES. This is where a
   * banded table's stripe is visible: read the rows' `appearance.shading` down
   * the table and the pattern is the list. Absent when the cells disagree, in
   * which case each cell carries its own `appearance`.
   */
  appearance?: AppearanceFacts;
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
  /** The Word table style this table carries, when it has one. */
  styleName?: string;
  /** Table-level fill/borders, when set. */
  appearance?: AppearanceFacts;
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
  /** Accept/reject unit: same-`group` ops resolve together (default: the
   *  change set id). Persisted in revision `customData`, survives reload. */
  group?: string;
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
   *   separator and a section-label row all land here. Row 0 is excluded as
   *   the explicit header by default rather than inferred from parseability.
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
  /** The row span actually evaluated, after defaulting to data rows 1..end. */
  startRow: number;
  endRow: number;
  /** True when the default whole-data-body span was used. */
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
 * A numeric `set_cell_text` the engine re-rendered in its column's own number
 * format, so the bytes written are not the bytes sent. Recorded beside the
 * provenance: the reviewer sees the figure as the model supplied it and as the
 * document dressed it.
 */
export interface ColumnFormatRender {
  /** The figure exactly as the op supplied it. */
  asSent: string;
  /** The bytes actually written, in the column's own format. */
  written: string;
  /** Whether that format came from this cell or from the column's majority. */
  formatSource: RenderFormatSource;
}

/**
 * A numeric `set_cell_text` that got through the model-authored-number gate by
 * declaring where the figure came from. Recorded on the result so the exception
 * is auditable in the change set instead of being indistinguishable from a
 * computed write.
 */
export interface LiteralNumberWrite {
  text: string;
  /** What the cell held before, when it held a number. */
  previousText: string;
  /**
   * The declared provenance. `user_stated` is `literal: true` - a figure the
   * user dictated in conversation. `attachment` is `quotedFrom`/`quotedText` -
   * a figure quoted verbatim out of a document the user supplied, whose
   * excerpt the engine checked actually contains it.
   */
  source: 'user_stated' | 'attachment';
  /** `attachment` only: the attachment the figure was read out of. */
  quotedFrom?: string;
  /** `attachment` only: the verbatim excerpt the figure was quoted from. */
  quotedText?: string;
  /** Set when the written bytes differ from the bytes sent. */
  rendered?: ColumnFormatRender;
  note: string;
}

export interface EditResult {
  ok: boolean;
  anchor?: string;
  op: string;
  error?: string;
  /** The stable content identity moved from the requested anchor before write. */
  relocated?: { from: string; to: string };
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
  // Present on a successful appearance op (set_cell_format / set_row_format /
  // copy_table_format / restripe_table): what it wrote, what it left alone, and
  // the stripe it detected. The engine's own account, so "did the restripe
  // actually do anything" is answerable from the result.
  appearance?: AppearanceWriteReport;
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
     * The accept/reject units this change set created: one entry per
     * assistant-defined `group` (ops without one share the change set id).
     * Accepting or rejecting ANY revision of a group resolves exactly that
     * group. `revisionCount` is the number of live revisions bound to the
     * group; a group whose ops all no-opped reports 0 - nothing to review.
     * `restoresAppearance` marks a group that also owns table-appearance
     * snapshots, so rejecting its card puts the fills and borders back too.
     */
    groups: Array<{
      id: string;
      opIndices: number[];
      revisionCount: number;
      restoresAppearance?: true;
    }>;
    /**
     * Present only when this change set wrote table APPEARANCE. SyncFusion
     * creates no revision for a fill or a border, so:
     *   'grouped_with_revision_cards' - the appearance snapshots are bound to a
     *     group that has content revisions, and rejecting that card restores the
     *     appearance too;
     *   'untracked_immediate' - no group carrying appearance ended up with a
     *     revision to bind to, so there is no card and the change applies
     *     immediately, exactly like the shipped set_char_format. Stated rather
     *     than implied.
     */
    formatTracking?: 'grouped_with_revision_cards' | 'untracked_immediate';
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
  /** Public SyncFusion bulk-update switch; absent on lightweight test doubles. */
  enableLayout?: boolean;
  enableTrackChanges: boolean;
  currentUser: string;
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
  // SyncFusion stamps `revisionSettings.customData` onto every revision it
  // creates while set — the accept-group tagging channel. Optional: fakes
  // without it skip tagging.
  documentEditorSettings?: {
    revisionSettings?: { customData?: string | null; [k: string]: any };
    [k: string]: any;
  };
  editorHistory?: { undo?(): void; redo?(): void; [k: string]: any };
  search?: any;
  [k: string]: any;
}

// A single SyncFusion tracked-change revision. We only lean on its per-card
// accept/reject; everything else is opaque.
export interface LiveRevision {
  revisionType?: string;
  revisionID?: string;
  /** SyncFusion's durable free-form tag; carries the accept-group binding. */
  customData?: string | null;
  accept?(): void;
  reject?(): void;
  /** Engine-internal single-revision resolve; preferred over accept/reject,
   *  whose public path also resolves adjacent same-author/type NEIGHBOURS. */
  handleAcceptReject?(isAccept: boolean, isGroupAcceptOrReject: boolean): void;
  /** Public SyncFusion navigation: select this revision's range in the document. */
  select?(): void;
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

// Built-in heading styles, anchored: a paragraph is "Heading 3" only when that
// IS the style's name. The unanchored form this replaces matched any name
// CONTAINING "heading<digit>", which ranked the live proposal document's
// "noTOCheading2" - its LARGEST heading style - as a second-level heading.
const HEADING_STYLE = /^heading\s*(\d+)$/i;
const TITLE_STYLE = /^title(\s+char)?$/i;

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
// the tracked revision itself for Accept/Reject. Dropping exactly these ids also
// projects what the document would read if every revision were accepted, which
// is how acceptProjectionStream is built.
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

function allRevisionIdsIn(rids: unknown, ids: Set<string>): boolean {
  return (
    Array.isArray(rids) &&
    rids.length > 0 &&
    rids.every((id) => ids.has(String(id)))
  );
}

function paragraphMarkRevisionIds(block: any): unknown {
  return pick(pick(block, 'characterFormat', 'cf'), 'revisionIds', 'rids');
}

function rowRevisionIds(row: any): unknown {
  return pick(pick(row, 'rowFormat', 'trpr'), 'revisionIds', 'rids');
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

// ---------------------------------------------------------------------------
// Heading detection
//
// Three tiers, most authoritative first, so a well-formed document keeps the
// answer it already gets:
//   1. a declared outline level - the paragraph's own, then its style chain's;
//      the clean OOXML answer, and the only one that is not a guess;
//   2. a built-in style name ("Heading 3", "Title");
//   3. typographic inference across the document's own custom styles.
//
// Tier 3 exists because real documents have neither of the first two. In the
// live proposal document every section heading wears a custom style
// ("headingNoToc", "noTOCheading2") that declares no outline level and is based
// on "Body Text", so neither the outline level nor the inheritance chain says
// anything - and the NAMES rank backwards: "noTOCheading2" is the document's
// largest heading, while "H1" is not a heading at all but a 12pt bold field
// label ("Company Name", "Rating") in a table cell.
//
// So the inference never reads the name. A custom style is a heading when its
// resolved type is a clear step LARGER than the document's body text AND the
// paragraphs wearing it are shaped like headings - short, with no sentence
// terminator. Size alone would promote those bold 12pt labels; shape alone would
// promote every one-line body paragraph. Levels come from the size ordering -
// the largest heading style is level 1, each smaller distinct size one level
// deeper - which makes them relative and consistent within one document: two
// sections set in the same type always compare equal, a smaller one always
// compares deeper, so a same-level comparable can always be resolved.
// ---------------------------------------------------------------------------

// A custom style must be set this much larger than body text to read as a
// heading rather than a styled label. Measured on the live document: its body is
// 11pt, its 12pt bold field labels are 1.09x (excluded) and its smallest real
// heading style is 14pt at 1.27x (included).
const HEADING_SIZE_RATIO = 1.15;
const HEADING_SHAPE_MAX_CHARS = 120;
// Word's own default when neither the document nor the default style says.
const DEFAULT_BODY_FONT_SIZE = 11;
const STYLE_CHAIN_LIMIT = 16;

interface StyleDefinition {
  basedOn?: string;
  fontSize?: number;
  outlineLevel?: number;
}

// Full SFDT writes 'BodyText' | 'Level1'..'Level9'; optimized SFDT writes the
// index, 0 being BodyText. Anything outside Level1..Level9 is read as "not
// declared" rather than "not a heading", for two reasons: BodyText carries no
// ranking, so a document that stamped it on every paragraph would otherwise lose
// its genuine Heading N styles; and OOXML's out-of-range levels (the live
// document's "TOC Heading" carries w:outlineLvl 9, which OOXML defines as body
// text) must not become a level-10 heading.
const MAX_OUTLINE_LEVEL = 9;
function normalizeOutlineLevel(value: any): number | undefined {
  const level =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
      ? Number(value.match(/^level\s*(\d+)$/i)?.[1])
      : NaN;
  return level >= 1 && level <= MAX_OUTLINE_LEVEL ? level : undefined;
}

function readStyleTable(sfdt: any): Map<string, StyleDefinition> {
  const table = new Map<string, StyleDefinition>();
  const styles = pick(sfdt, 'styles', 'sty');
  if (!Array.isArray(styles)) return table;
  for (const style of styles) {
    const name = pick(style, 'name', 'n');
    if (!name) continue;
    // Paragraph styles only ('Paragraph'/0): a linked character style repeats
    // its paragraph style's size under a "... Char" name.
    const type = pick(style, 'type', 't');
    if (type !== undefined && type !== 'Paragraph' && type !== 0) continue;
    const def: StyleDefinition = {};
    // On a style object the optimized key 'b' is basedOn (on a characterFormat
    // it is bold - a different object).
    const basedOn = pick(style, 'basedOn', 'b');
    if (basedOn) def.basedOn = String(basedOn);
    const fontSize = pick(
      pick(style, 'characterFormat', 'cf'),
      'fontSize',
      'fsz'
    );
    if (typeof fontSize === 'number') def.fontSize = fontSize;
    const outlineLevel = normalizeOutlineLevel(
      pick(pick(style, 'paragraphFormat', 'pf'), 'outlineLevel', 'ol')
    );
    if (outlineLevel !== undefined) def.outlineLevel = outlineLevel;
    table.set(String(name).toLowerCase(), def);
  }
  return table;
}

// Resolve one inherited property up the basedOn chain. The chain is only ever
// read for DECLARED values (size, outline level) and never for "is this a
// heading" - the live document's headings are based on "Body Text", so
// inheriting that judgement would classify them as body.
function walkStyleChain<T>(
  table: Map<string, StyleDefinition>,
  styleName: string | undefined,
  read: (def: StyleDefinition) => T | undefined
): T | undefined {
  let name = styleName;
  for (let hops = 0; name && hops < STYLE_CHAIN_LIMIT; hops++) {
    const def = table.get(name.toLowerCase());
    if (!def) return undefined;
    const value = read(def);
    if (value !== undefined) return value;
    name = def.basedOn;
  }
  return undefined;
}

// Tiers 1 (chain) and 2 (name) for one style. A built-in name outranks an
// inherited outline level so "Title", which Word bases on "Heading 1", keeps
// level 0 instead of inheriting level 1.
function declaredStyleLevel(
  table: Map<string, StyleDefinition>,
  styleName: string
): number | undefined {
  const name = styleName.trim();
  if (TITLE_STYLE.test(name)) return 0;
  const m = name.match(HEADING_STYLE);
  if (m) return Number(m[1]);
  return walkStyleChain(table, name, (def) => def.outlineLevel);
}

function looksLikeHeadingText(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= HEADING_SHAPE_MAX_CHARS &&
    !/[.!?]$/.test(trimmed)
  );
}

interface StyleUsage {
  fontSize: number;
  declaredLevel?: number;
  paragraphs: number;
  characters: number;
  headingShaped: number;
}

// Level per paragraph style for one document, keyed by lower-cased style name.
// EVERY paragraph is measured, table cells included: the live document keeps most
// of its prose inside layout tables, and measuring the body story alone left the
// stale table of contents (211 paragraphs of 10pt "TOC 1"/"TOC 2") as the biggest
// body-text vote, which dropped the bar far enough to promote 12pt "Body Text".
// Only which paragraphs can BE headings is restricted - a cell paragraph never
// is, which is where all 71 of the document's "H1" field labels live.
function documentStyleLevels(
  sfdt: any,
  paragraphs: { styleName: string; text: string }[]
): Map<string, number> {
  const table = readStyleTable(sfdt);
  const documentFontSize = pick(
    pick(sfdt, 'characterFormat', 'cf'),
    'fontSize',
    'fsz'
  );
  const defaultFontSize =
    typeof documentFontSize === 'number'
      ? documentFontSize
      : DEFAULT_BODY_FONT_SIZE;
  const resolveFontSize = (styleName: string): number => {
    const size = walkStyleChain(
      table,
      styleName || 'Normal',
      (def) => def.fontSize
    );
    return typeof size === 'number' ? size : defaultFontSize;
  };

  const usage = new Map<string, StyleUsage>();
  for (const paragraph of paragraphs) {
    const styleName = paragraph.styleName.trim();
    const key = styleName.toLowerCase();
    let use = usage.get(key);
    if (!use) {
      use = {
        fontSize: resolveFontSize(styleName),
        paragraphs: 0,
        characters: 0,
        headingShaped: 0
      };
      const declaredLevel = styleName
        ? declaredStyleLevel(table, styleName)
        : undefined;
      if (declaredLevel !== undefined) use.declaredLevel = declaredLevel;
      usage.set(key, use);
    }
    // A style is registered even by an empty paragraph, so an empty "Heading 2"
    // keeps its declared level. Only the statistics the inference reads are
    // restricted to paragraphs that have text.
    if (!paragraph.text.trim()) continue;
    use.paragraphs++;
    use.characters += paragraph.text.trim().length;
    if (looksLikeHeadingText(paragraph.text)) use.headingShaped++;
  }

  // Body text size: the size most of the document's text - measured in
  // characters, not paragraphs, since headings are short by nature - is set in,
  // counting only styles that are not already recognised headings. A tie
  // resolves to the larger size because a higher bar infers FEWER headings,
  // which is the safe direction to be wrong in.
  const charactersBySize = new Map<number, number>();
  for (const use of usage.values()) {
    if (use.declaredLevel !== undefined) continue;
    charactersBySize.set(
      use.fontSize,
      (charactersBySize.get(use.fontSize) ?? 0) + use.characters
    );
  }
  let bodyFontSize = defaultFontSize;
  let bodyCharacters = 0;
  for (const [fontSize, characters] of charactersBySize) {
    if (
      characters > bodyCharacters ||
      (characters === bodyCharacters && fontSize > bodyFontSize)
    ) {
      bodyFontSize = fontSize;
      bodyCharacters = characters;
    }
  }

  const levels = new Map<string, number>();
  const inferred: { key: string; fontSize: number }[] = [];
  const headingFontSizes = new Set<number>();
  for (const [key, use] of usage) {
    if (use.declaredLevel !== undefined) {
      levels.set(key, use.declaredLevel);
      headingFontSizes.add(use.fontSize);
      continue;
    }
    if (use.paragraphs === 0) continue;
    if (use.fontSize < bodyFontSize * HEADING_SIZE_RATIO) continue;
    if (use.headingShaped * 2 < use.paragraphs) continue;
    inferred.push({ key, fontSize: use.fontSize });
    headingFontSizes.add(use.fontSize);
  }

  // Rank by size: the document's largest heading is level 1, each smaller
  // distinct heading size one level deeper. Declared levels are never moved, but
  // the sizes of the styles carrying them still count, so an inferred style
  // lands below a larger Heading N and above a smaller one.
  for (const { key, fontSize } of inferred) {
    let larger = 0;
    for (const other of headingFontSizes) if (other > fontSize) larger++;
    levels.set(key, larger + 1);
  }
  return levels;
}

// Walk the SFDT into a flat, in-order list of addressable blocks. Paragraphs
// (top-level and inside table cells) become blocks; a table contributes its
// cell paragraphs. Anchors follow the SyncFusion hierarchical scheme.
export function flattenSfdt(
  sfdt: any,
  dropRevisionIds?: Set<string>
): FlatBlock[] {
  const out: FlatBlock[] = [];
  // Every paragraph, for the typography measurement; `block` is set only on the
  // ones that can become headings (body paragraphs, never table cells).
  const paragraphs: {
    block?: FlatBlock;
    styleName: string;
    text: string;
    declaredLevel?: number;
  }[] = [];
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
              const format = readFormat(cb);
              out.push({
                anchor: `${si};${bi};${ri};${ci};${cbi}`,
                kind: 'table_cell',
                text,
                format,
                ...readBlockFormats(cb),
                isHeading: false,
                level: -1,
                length: text.length
              });
              paragraphs.push({
                styleName: format?.styleName ?? '',
                text
              });
            });
          });
        });
      } else {
        const text = inlineText(getInlines(block), deletedIds);
        if (
          text.length === 0 &&
          allRevisionIdsIn(paragraphMarkRevisionIds(block), deletedIds)
        )
          return;
        const format = readFormat(block);
        const flat: FlatBlock = {
          anchor: `${si};${bi}`,
          kind: 'paragraph',
          text,
          format,
          ...readBlockFormats(block),
          isHeading: false,
          level: -1,
          length: text.length
        };
        out.push(flat);
        paragraphs.push({
          block: flat,
          styleName: format?.styleName ?? '',
          text,
          declaredLevel: normalizeOutlineLevel(
            pick(pick(block, 'paragraphFormat', 'pf'), 'outlineLevel', 'ol')
          )
        });
      }
    });
  });

  // Heading level needs the whole document: the style table for declared levels
  // and inherited sizes, and every paragraph for the body text size the inference
  // measures custom styles against.
  const levelByStyle = documentStyleLevels(sfdt, paragraphs);
  for (const paragraph of paragraphs) {
    if (!paragraph.block) continue;
    const level =
      paragraph.declaredLevel ??
      levelByStyle.get(paragraph.styleName.trim().toLowerCase()) ??
      -1;
    if (level < 0) continue;
    paragraph.block.kind = 'heading';
    paragraph.block.isHeading = true;
    paragraph.block.level = level;
  }

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

/** The raw SFDT block a table anchor (`"0;7"`) names, or undefined. */
function tableBlockAt(sfdt: any, tableAnchor: string): any {
  const [sectionIndex, blockIndex] = tableAnchor.split(';').map(Number);
  if (!Number.isInteger(sectionIndex) || !Number.isInteger(blockIndex))
    return undefined;
  const sections: any[] = pick(sfdt, 'sections', 'sec') ?? [];
  const block = getBlocks(sections[sectionIndex] ?? {})[blockIndex];
  return getRows(block) ? block : undefined;
}

// `sfdt` is optional because the fixture-driven read path may not have it;
// without it the appearance hint is simply absent rather than wrong.
function collectStructureTables(
  blocks: FlatBlock[],
  sfdt?: any
): StructureTable[] {
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
    const appearance = sfdt
      ? collectTableAppearance(tableBlockAt(sfdt, t.anchor))
      : null;
    if (appearance) {
      if (appearance.styleName) table.styleName = appearance.styleName;
      if (!tableIsUnstyled(appearance)) table.styled = true;
    }
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
  const tableBlock = tableBlockAt(sfdt, tableAnchor);
  const rawRows = tableBlock ? getRows(tableBlock) : undefined;
  if (!rawRows) return null;
  // How the table LOOKS, read from the same raw rows: fills, borders, vertical
  // alignment, header flags, table style. Without this a model asked to make a
  // new section's table match its siblings had nothing to match against.
  const appearance = collectTableAppearance(tableBlock) as TableAppearance;

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
      // The optimized-SFDT cell-format key is `tcpr`, NOT `cf` (`cf` is a
      // paragraph's characterFormat). The live editor always serializes
      // optimized SFDT, so probing `cf` here made every merge span invisible in
      // production while the long-key fixtures kept the spec green - the same
      // class of key mistake `getRows` documents for `r` vs `rw`.
      const cellFormat = pick(rawCell, 'cellFormat', 'tcpr', 'cf') ?? {};
      const columnSpan = Number(
        pick(cellFormat, 'columnSpan', 'colsp', 'colSpan') ?? 1
      );
      const rowSpan = Number(pick(cellFormat, 'rowSpan', 'rwsp') ?? 1);
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
          : {}),
        // Only where the cell differs from its row: collectTableAppearance
        // already hoisted a shared row appearance up to the row.
        ...(appearance?.rows[row]?.cells[column]
          ? { appearance: appearance.rows[row].cells[column] }
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
      ...(appearance?.rows[row]?.isHeader ? { isHeader: true as const } : {}),
      ...(appearance?.rows[row]?.appearance
        ? { appearance: appearance.rows[row].appearance }
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
    ...(appearance?.styleName ? { styleName: appearance.styleName } : {}),
    ...(appearance?.appearance ? { appearance: appearance.appearance } : {}),
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
    const tables = collectStructureTables(blocks, sfdt);
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

// ---------------------------------------------------------------------------
// Section-pattern read
// ---------------------------------------------------------------------------

const SECTION_PATTERN_SAMPLE_LIMIT = 12;
const SECTION_PATTERN_SEQUENCE_LIMIT = 16;
const SECTION_PATTERN_TABLE_LIMIT = 2;
const SECTION_PATTERN_HEADER_VARIANT_LIMIT = 3;
const SECTION_PATTERN_HEADER_COLUMN_LIMIT = 6;
const SECTION_PATTERN_TEXT_LIMIT = 40;
// Similar sections must preserve more than two thirds of their ordered shape.
const SECTION_PATTERN_FAMILY_SIMILARITY = 2 / 3;

type SectionBlockRole =
  | 'section_heading'
  | 'intro_paragraph'
  | 'subsection_heading'
  | 'subsection_paragraph'
  | 'table'
  | 'table_header'
  | 'table_body';

interface SectionUnit {
  blocks: FlatBlock[];
  start: number;
  end: number;
}

interface SectionTableObservation {
  columns: number;
  headerRow: boolean;
  banding: TableBanding | null;
  columnHeaders: string[];
  styleName?: string;
}

function patternConfidence(
  matches: number,
  sampled: number
): SectionPatternConfidence {
  const ratio = sampled > 0 ? matches / sampled : 0;
  const level =
    sampled >= 3 && matches >= 2 && ratio >= 2 / 3
      ? 'high'
      : sampled >= 2 && matches >= 2
      ? 'medium'
      : 'low';
  return { matches, sampled, level };
}

function modal<T>(
  values: T[],
  key: (value: T) => string = (value) => JSON.stringify(value)
): { value: T; count: number } | undefined {
  const counts = new Map<string, { value: T; count: number }>();
  let best: { value: T; count: number } | undefined;
  for (const value of values) {
    const id = key(value);
    const current = counts.get(id) ?? { value, count: 0 };
    current.count++;
    counts.set(id, current);
    if (!best || current.count > best.count) best = current;
  }
  return best;
}

function tableAnchorForBlock(block: FlatBlock): string | undefined {
  if (block.kind !== 'table_cell') return undefined;
  const parts = block.anchor.split(';');
  return parts.length === 5 ? `${parts[0]};${parts[1]}` : undefined;
}

function unitsAtLevel(blocks: FlatBlock[], level: number): SectionUnit[] {
  const units: SectionUnit[] = [];
  for (let start = 0; start < blocks.length; start++) {
    const heading = blocks[start];
    if (!heading.isHeading || heading.level !== level) continue;
    // Empty styled headings and page-break-only title paragraphs are layout
    // scaffolding, not sibling sections. Treating them as units lets a run of
    // placeholders between two real sections become the dominant "family".
    if (!heading.text.replace(/\f/g, '').trim()) continue;
    let end = blocks.length;
    for (let index = start + 1; index < blocks.length; index++) {
      if (blocks[index].isHeading && blocks[index].level <= level) {
        end = index;
        break;
      }
    }
    units.push({ blocks: blocks.slice(start, end), start, end });
  }
  return units;
}

function unitContainsAnchor(unit: SectionUnit, near: string): boolean {
  return unit.blocks.some(
    (block) =>
      block.anchor === near ||
      block.anchor.startsWith(`${near};`) ||
      near.startsWith(`${block.anchor};`)
  );
}

function chooseSectionLevel(
  blocks: FlatBlock[],
  near?: string
): number | undefined {
  const levels = Array.from(
    new Set(
      blocks.filter((block) => block.isHeading).map((block) => block.level)
    )
  ).sort((a, b) => a - b);
  if (!levels.length) return undefined;

  // A heading named as the anchor is stronger evidence than the containing
  // document hierarchy. Without this, every subsection also belongs to its
  // top-level parent's unit and the shallowest repeated level wins below.
  const anchoredHeading = near
    ? blocks.find(
        (block) =>
          block.isHeading &&
          (block.anchor === near || near.startsWith(`${block.anchor};`))
      )
    : undefined;
  if (anchoredHeading) return anchoredHeading.level;

  const repeated = levels.filter(
    (level) => unitsAtLevel(blocks, level).length >= 2
  );
  if (near) {
    const nearbyRepeated = repeated.filter((level) =>
      unitsAtLevel(blocks, level).some((unit) => unitContainsAnchor(unit, near))
    );
    if (nearbyRepeated.length) return nearbyRepeated[0];
  }
  if (repeated.length) return repeated[0];
  if (near) {
    const nearby = levels.filter((level) =>
      unitsAtLevel(blocks, level).some((unit) => unitContainsAnchor(unit, near))
    );
    if (nearby.length) return nearby[0];
  }
  return levels[0];
}

function sampleSectionUnits(
  units: SectionUnit[],
  near?: string
): SectionUnit[] {
  if (units.length <= SECTION_PATTERN_SAMPLE_LIMIT) return units;
  if (!near) return units.slice(0, SECTION_PATTERN_SAMPLE_LIMIT);
  const nearby = units.findIndex((unit) => unitContainsAnchor(unit, near));
  if (nearby < 0) return units.slice(0, SECTION_PATTERN_SAMPLE_LIMIT);
  const start = Math.max(
    0,
    Math.min(
      units.length - SECTION_PATTERN_SAMPLE_LIMIT,
      nearby - Math.floor(SECTION_PATTERN_SAMPLE_LIMIT / 2)
    )
  );
  return units.slice(start, start + SECTION_PATTERN_SAMPLE_LIMIT);
}

function sequenceForUnit(unit: SectionUnit): SectionPatternSequenceElement[] {
  const sequence: SectionPatternSequenceElement[] = [];
  let seenSubsection = false;
  let lastTable = '';
  const push = (
    role: SectionPatternSequenceElement['role'],
    level?: number
  ) => {
    const previous = sequence[sequence.length - 1];
    if (previous && previous.role === role && previous.level === level) {
      previous.count++;
      return;
    }
    sequence.push({
      role,
      ...(level !== undefined ? { level } : {}),
      count: 1,
      // Replaced after the recurring sequence is selected.
      confidence: patternConfidence(0, 0)
    });
  };

  unit.blocks.forEach((block, index) => {
    if (index === 0) {
      push('section_heading', block.level);
      return;
    }
    const tableAnchor = tableAnchorForBlock(block);
    if (tableAnchor) {
      if (tableAnchor !== lastTable) push('table');
      lastTable = tableAnchor;
      return;
    }
    lastTable = '';
    if (block.isHeading) {
      seenSubsection = true;
      push('subsection_heading', block.level);
      return;
    }
    if (!block.text.trim()) return;
    push(seenSubsection ? 'subsection_paragraph' : 'intro_paragraph');
  });
  return sequence;
}

function sequenceTokens(sequence: SectionPatternSequenceElement[]): string[] {
  return sequence.flatMap((element) =>
    Array(Math.min(element.count, SECTION_PATTERN_SEQUENCE_LIMIT)).fill(
      `${element.role}:${element.level ?? ''}`
    )
  );
}

function sequenceSimilarity(
  left: SectionPatternSequenceElement[],
  right: SectionPatternSequenceElement[]
): number {
  const leftTokens = sequenceTokens(left);
  const rightTokens = sequenceTokens(right);
  const longest = Math.max(leftTokens.length, rightTokens.length);
  if (!longest) return 1;

  const previous = Array(rightTokens.length + 1).fill(0);
  for (const leftToken of leftTokens) {
    let diagonal = 0;
    for (let rightIndex = 1; rightIndex <= rightTokens.length; rightIndex++) {
      const above = previous[rightIndex];
      previous[rightIndex] =
        leftToken === rightTokens[rightIndex - 1]
          ? diagonal + 1
          : Math.max(previous[rightIndex], previous[rightIndex - 1]);
      diagonal = above;
    }
  }
  const structuralTokens = (sequence: SectionPatternSequenceElement[]) =>
    new Set(
      sequence
        .filter(
          ({ role }) =>
            role !== 'intro_paragraph' && role !== 'subsection_paragraph'
        )
        .map(({ role, level }) => `${role}:${level ?? ''}`)
    );
  const leftStructure = structuralTokens(left);
  const rightStructure = structuralTokens(right);
  const sharedStructure = Array.from(leftStructure).filter((role) =>
    rightStructure.has(role)
  ).length;
  const totalStructure = new Set([...leftStructure, ...rightStructure]).size;
  const structuralOverlap = totalStructure
    ? sharedStructure / totalStructure
    : 1;
  return Math.min(previous[rightTokens.length] / longest, structuralOverlap);
}

function clusterSectionFamilies(
  sequences: SectionPatternSequenceElement[][]
): number[][] {
  const unassigned = new Set(sequences.map((_sequence, index) => index));
  const families: number[][] = [];
  while (unassigned.size) {
    const first = unassigned.values().next().value as number;
    const family: number[] = [];
    const pending = [first];
    unassigned.delete(first);
    while (pending.length) {
      const current = pending.pop() as number;
      family.push(current);
      for (const candidate of Array.from(unassigned)) {
        if (
          sequenceSimilarity(sequences[current], sequences[candidate]) >
          SECTION_PATTERN_FAMILY_SIMILARITY
        ) {
          unassigned.delete(candidate);
          pending.push(candidate);
        }
      }
    }
    families.push(family.sort((left, right) => left - right));
  }
  return families;
}

function nearestUnitIndex(
  blocks: FlatBlock[],
  units: SectionUnit[],
  near?: string
): number | undefined {
  if (!near) return undefined;
  // `near` is the insertion boundary. When it is exactly the first block of a
  // section, the sibling immediately before that boundary is the relevant
  // authoring example; an anchor inside a section still selects that section.
  const boundary = units.findIndex((unit) => unit.blocks[0]?.anchor === near);
  if (boundary > 0) return boundary - 1;
  const containing = units.findIndex((unit) => unitContainsAnchor(unit, near));
  if (containing >= 0) return containing;
  const blockIndex = blocks.findIndex(
    (block) =>
      block.anchor === near ||
      block.anchor.startsWith(`${near};`) ||
      near.startsWith(`${block.anchor};`)
  );
  if (blockIndex < 0) return undefined;

  let nearest = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  units.forEach((unit, index) => {
    const distance =
      blockIndex < unit.start
        ? unit.start - blockIndex
        : blockIndex >= unit.end
        ? blockIndex - unit.end + 1
        : 0;
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  });
  return units.length ? nearest : undefined;
}

function selectSectionFamily(
  blocks: FlatBlock[],
  units: SectionUnit[],
  sequences: SectionPatternSequenceElement[][],
  near?: string
): { units: SectionUnit[]; sequences: SectionPatternSequenceElement[][] } {
  const families = clusterSectionFamilies(sequences);
  const nearest = nearestUnitIndex(blocks, units, near);
  const candidates =
    nearest !== undefined
      ? families.filter((family) => family.includes(nearest))
      : families;
  const selected = candidates.reduce((best, candidate) => {
    if (!best || candidate.length > best.length) {
      return candidate;
    }
    if (candidate.length < best.length) return best;
    const cohesion = (family: number[]) =>
      family.reduce(
        (total, left, leftIndex) =>
          total +
          family
            .slice(leftIndex + 1)
            .reduce(
              (sum, right) =>
                sum + sequenceSimilarity(sequences[left], sequences[right]),
              0
            ),
        0
      );
    return cohesion(candidate) > cohesion(best) ? candidate : best;
  }, candidates[0]);
  const indices = selected ?? [];
  return {
    units: indices.map((index) => units[index]),
    sequences: indices.map((index) => sequences[index])
  };
}

function roleBlocksForUnit(
  unit: SectionUnit
): Map<SectionBlockRole, FlatBlock[]> {
  const roles = new Map<SectionBlockRole, FlatBlock[]>();
  const add = (role: SectionBlockRole, block: FlatBlock) => {
    const current = roles.get(role) ?? [];
    current.push(block);
    roles.set(role, current);
  };
  let seenSubsection = false;
  unit.blocks.forEach((block, index) => {
    if (index === 0) {
      add('section_heading', block);
      return;
    }
    const tableAnchor = tableAnchorForBlock(block);
    if (tableAnchor) {
      const row = Number(block.anchor.split(';')[2]);
      add(row === 0 ? 'table_header' : 'table_body', block);
      return;
    }
    if (block.isHeading) {
      seenSubsection = true;
      add('subsection_heading', block);
      return;
    }
    if (!block.text.trim()) return;
    add(seenSubsection ? 'subsection_paragraph' : 'intro_paragraph', block);
  });
  return roles;
}

const SECTION_CHARACTER_FORMAT_KEYS = new Set([
  'bold',
  'italic',
  'fontSize',
  'fontFamily',
  'fontColor',
  'highlightColor',
  'underline',
  'allCaps'
]);
const SECTION_PARAGRAPH_FORMAT_KEYS = new Set([
  'leftIndent',
  'rightIndent',
  'firstLineIndent',
  'textAlignment',
  'beforeSpacing',
  'afterSpacing',
  'lineSpacing',
  'lineSpacingType',
  'keepWithNext',
  'outlineLevel'
]);

function clipPatternValue(value: unknown): unknown {
  return typeof value === 'string'
    ? value.slice(0, SECTION_PATTERN_TEXT_LIMIT * 2)
    : value;
}

function compactFormatBag(
  source: FormatBag | undefined,
  allowed: Set<string>
): FormatBag | undefined {
  if (!source) return undefined;
  const compact: FormatBag = {};
  for (const key of Object.keys(source)) {
    if (allowed.has(key)) compact[key] = clipPatternValue(source[key]);
  }
  return Object.keys(compact).length ? compact : undefined;
}

function roleFormat(
  block: FlatBlock
): Omit<SectionPatternRoleFormat, 'confidence'> {
  const styleName = block.format?.styleName;
  const characterFormat = compactFormatBag(
    block.characterFormat,
    SECTION_CHARACTER_FORMAT_KEYS
  );
  const paragraphFormat = compactFormatBag(
    block.paragraphFormat,
    SECTION_PARAGRAPH_FORMAT_KEYS
  );
  return {
    ...(styleName
      ? { styleName: styleName.slice(0, SECTION_PATTERN_TEXT_LIMIT * 2) }
      : {}),
    ...(characterFormat ? { characterFormat } : {}),
    ...(paragraphFormat ? { paragraphFormat } : {})
  };
}

function tableAnchorsForUnit(unit: SectionUnit): string[] {
  const anchors: string[] = [];
  for (const block of unit.blocks) {
    const anchor = tableAnchorForBlock(block);
    if (anchor && anchors[anchors.length - 1] !== anchor) anchors.push(anchor);
  }
  return anchors;
}

function tableObservation(
  sfdt: any,
  tableAnchor: string
): SectionTableObservation | undefined {
  const table = tableBlockAt(sfdt, tableAnchor);
  const rows = getRows(table);
  if (!table || !rows) return undefined;
  const appearance = collectTableAppearance(table);
  const columns = rows.reduce((widest, row) => {
    const cells: any[] = pick(row, 'cells', 'c') ?? [];
    return Math.max(widest, cells.length);
  }, 0);
  const headerRow = appearance ? inferHeaderRows(appearance) > 0 : false;
  const deletedIds = deletedRevisionIds(sfdt);
  const firstRowCells: any[] = pick(rows[0], 'cells', 'c') ?? [];
  const columnHeaders = headerRow
    ? firstRowCells.slice(0, SECTION_PATTERN_HEADER_COLUMN_LIMIT).map((cell) =>
        getBlocks(cell)
          .map((block) => inlineText(getInlines(block), deletedIds))
          .join('\n')
          .slice(0, SECTION_PATTERN_TEXT_LIMIT)
      )
    : [];
  return {
    columns,
    headerRow,
    banding: appearance ? detectTableBanding(appearance) : null,
    columnHeaders,
    ...(appearance?.styleName ? { styleName: appearance.styleName } : {})
  };
}

function observedValue<T>(
  values: Array<T | undefined>,
  sampled: number
): SectionPatternValue<T> | undefined {
  const present = values.filter((value): value is T => value !== undefined);
  const chosen = modal(present);
  return chosen
    ? {
        value: chosen.value,
        confidence: patternConfidence(chosen.count, sampled)
      }
    : undefined;
}

function boundaryElement(block: FlatBlock): SectionBoundaryElement | undefined {
  if (block.kind !== 'paragraph') return undefined;
  if (block.text === '\f') return 'page_break';
  return block.text.trim() ? undefined : 'empty_paragraph';
}

function separatorBeforeUnit(
  blocks: FlatBlock[],
  unit: SectionUnit
): SectionBoundaryElement[] | undefined {
  let priorSibling = false;
  for (let index = unit.start - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.isHeading && block.level <= unit.blocks[0].level) {
      priorSibling = true;
      break;
    }
  }
  if (!priorSibling) return undefined;

  const separator: SectionBoundaryElement[] = [];
  for (let index = unit.start - 1; index >= 0; index--) {
    const element = boundaryElement(blocks[index]);
    if (!element) break;
    separator.unshift(element);
  }
  return separator;
}

function endingParagraphForUnit(unit: SectionUnit): FlatBlock | undefined {
  for (let index = unit.blocks.length - 1; index >= 1; index--) {
    const block = unit.blocks[index];
    if (boundaryElement(block)) continue;
    return block.kind === 'paragraph' ? block : undefined;
  }
  return undefined;
}

function sectionBoundaryPattern(
  blocks: FlatBlock[],
  units: SectionUnit[]
): SectionPatternBoundary {
  const separators = units
    .map((unit) => separatorBeforeUnit(blocks, unit))
    .filter(
      (separator): separator is SectionBoundaryElement[] =>
        separator !== undefined
    );
  const selectedSeparator = modal(separators);
  const separator = selectedSeparator
    ? {
        value: selectedSeparator.value,
        confidence: patternConfidence(
          selectedSeparator.count,
          separators.length
        )
      }
    : {
        value: [] as SectionBoundaryElement[],
        confidence: patternConfidence(0, 0)
      };
  const headingBeforeSpacing = observedValue(
    units.map((unit) => unit.blocks[0]?.paragraphFormat?.beforeSpacing),
    units.length
  );
  const endingParagraphAfterSpacing = observedValue(
    units.map(
      (unit) => endingParagraphForUnit(unit)?.paragraphFormat?.afterSpacing
    ),
    units.length
  );
  return {
    separator,
    ...(headingBeforeSpacing ? { headingBeforeSpacing } : {}),
    ...(endingParagraphAfterSpacing ? { endingParagraphAfterSpacing } : {})
  };
}

function subsectionBoundaryPattern(
  units: SectionUnit[]
): SectionPatternValue<SectionBoundaryElement[]> {
  const separators = units.flatMap((unit) => {
    let seenSubsection = false;
    const observed: SectionBoundaryElement[][] = [];
    unit.blocks.forEach((block, index) => {
      if (
        index === 0 ||
        !block.isHeading ||
        block.level <= unit.blocks[0].level ||
        !block.text.replace(/\f/g, '').trim()
      )
        return;
      if (seenSubsection) {
        const separator: SectionBoundaryElement[] = [];
        for (let prior = index - 1; prior >= 0; prior--) {
          const element = boundaryElement(unit.blocks[prior]);
          if (!element) break;
          separator.unshift(element);
        }
        observed.push(separator);
      }
      seenSubsection = true;
    });
    return observed;
  });
  const selected = modal(separators);
  return selected
    ? {
        value: selected.value,
        confidence: patternConfidence(selected.count, separators.length)
      }
    : {
        value: [],
        confidence: patternConfidence(0, 0)
      };
}

function tablePatterns(sfdt: any, units: SectionUnit[]): SectionPatternTable[] {
  const observations = units.map((unit) =>
    tableAnchorsForUnit(unit).map((anchor) => tableObservation(sfdt, anchor))
  );
  const tableCount = Math.min(
    SECTION_PATTERN_TABLE_LIMIT,
    observations.reduce(
      (largest, tables) => Math.max(largest, tables.length),
      0
    )
  );
  const patterns: SectionPatternTable[] = [];
  for (let ordinal = 0; ordinal < tableCount; ordinal++) {
    const tableAtOrdinal = observations.map((tables) => tables[ordinal]);
    const columns = observedValue(
      tableAtOrdinal.map((table) => table?.columns),
      units.length
    );
    const headerRow = observedValue(
      tableAtOrdinal.map((table) => table?.headerRow),
      units.length
    );
    const banding = observedValue(
      tableAtOrdinal.map((table) => table?.banding),
      units.length
    );
    if (!columns || !headerRow || !banding) continue;
    const headerVariants = new Map<
      string,
      { texts: string[]; observed: number }
    >();
    for (const table of tableAtOrdinal) {
      if (!table?.headerRow) continue;
      const id = JSON.stringify(table.columnHeaders);
      const variant = headerVariants.get(id) ?? {
        texts: table.columnHeaders,
        observed: 0
      };
      variant.observed++;
      headerVariants.set(id, variant);
    }
    const variants = Array.from(headerVariants.values())
      .sort((a, b) => b.observed - a.observed)
      .slice(0, SECTION_PATTERN_HEADER_VARIANT_LIMIT);
    const styleName = observedValue(
      tableAtOrdinal.map((table) => table?.styleName),
      units.length
    );
    patterns.push({
      ordinal: ordinal + 1,
      columns,
      headerRow,
      banding,
      columnHeaders: {
        variants,
        confidence: patternConfidence(
          tableAtOrdinal.filter((table) => table?.headerRow).length,
          units.length
        )
      },
      ...(styleName ? { styleName } : {})
    });
  }
  return patterns;
}

interface SectionFamilyEvidence {
  level: number;
  availableUnits: SectionUnit[];
  sampledUnits: SectionUnit[];
  units: SectionUnit[];
  sequences: SectionPatternSequenceElement[][];
}

/**
 * The single family-selection seam shared by the read tool and the composer.
 * Planning from a different sample than the one advertised by
 * deriveSectionPattern is the section equivalent of copying table perimeter
 * evidence from one grid and verifying another.
 */
function deriveSectionFamilyEvidence(
  blocks: FlatBlock[],
  near?: string
): SectionFamilyEvidence | undefined {
  const level = chooseSectionLevel(blocks, near);
  if (level === undefined) return undefined;
  const availableUnits = unitsAtLevel(blocks, level);
  const sampledUnits = sampleSectionUnits(availableUnits, near);
  const sampledSequences = sampledUnits.map(sequenceForUnit);
  const sampledTruncatedSequences = sampledSequences.map((sequence) =>
    sequence.slice(0, SECTION_PATTERN_SEQUENCE_LIMIT)
  );
  const family = selectSectionFamily(
    blocks,
    sampledUnits,
    sampledTruncatedSequences,
    near
  );
  return {
    level,
    availableUnits,
    sampledUnits,
    units: family.units,
    sequences: family.sequences
  };
}

/**
 * Derive the document's own recurring section schema from sibling sections.
 * `near` only selects the relevant sibling family/sample; inference still works
 * from the document alone, and a document with no repetition returns an honest
 * low-confidence observable shape instead of failing.
 */
export function deriveSectionPattern(
  editor: LiveEditor,
  options: { near?: string } = {}
): SectionPatternResult {
  const sfdt = serializeSfdt(editor);
  const blocks = flattenSfdt(sfdt);
  const near =
    typeof options?.near === 'string' && options.near.trim()
      ? options.near.trim().slice(0, 100)
      : undefined;
  const evidence = deriveSectionFamilyEvidence(blocks, near);
  if (!evidence) {
    return {
      ok: true,
      pattern: { sequence: [], tables: [], roles: {} },
      sample: {
        available: 0,
        sampled: 0,
        recurring: 0,
        ...(near ? { near } : {})
      },
      note: 'Low confidence: no heading-delimited sibling sections were found; returning an empty observable pattern.'
    };
  }

  const { level, availableUnits, sampledUnits, units, sequences } = evidence;
  const sequenceTruncated = units.some(
    (unit) => sequenceForUnit(unit).length > SECTION_PATTERN_SEQUENCE_LIMIT
  );
  const selectedSequence = modal(sequences);
  const recurring = units.length;
  const sequence = (selectedSequence?.value ?? []).map((element, index) => ({
    ...element,
    confidence: patternConfidence(
      sequences.filter((candidate) => {
        const atIndex = candidate[index];
        return (
          atIndex?.role === element.role &&
          atIndex?.level === element.level &&
          atIndex?.count === element.count
        );
      }).length,
      units.length
    )
  }));

  const unitRoles = units.map(roleBlocksForUnit);
  const selectedRoles = new Set<SectionBlockRole>();
  sequence.forEach((element) => selectedRoles.add(element.role));
  if (sequence.some((element) => element.role === 'table')) {
    selectedRoles.add('table_header');
    selectedRoles.add('table_body');
  }
  const roles: Record<string, SectionPatternRoleFormat> = {};
  for (const role of selectedRoles) {
    if (role === 'table') continue;
    const candidates = unitRoles.reduce(
      (all, byRole) =>
        all.concat((byRole.get(role) ?? []).map((block) => roleFormat(block))),
      [] as Array<Omit<SectionPatternRoleFormat, 'confidence'>>
    );
    const selected = modal(candidates);
    if (!selected) continue;
    const selectedKey = JSON.stringify(selected.value);
    const matches = unitRoles.filter((byRole) =>
      (byRole.get(role) ?? []).some(
        (block) => JSON.stringify(roleFormat(block)) === selectedKey
      )
    ).length;
    roles[role] = {
      ...selected.value,
      confidence: patternConfidence(matches, units.length)
    };
  }

  const confidence = patternConfidence(recurring, units.length);
  const baseNote =
    confidence.level === 'low'
      ? units.length < 2
        ? `Low confidence: only ${units.length} sibling section was available at heading level ${level}; returning its observable minimal shape.`
        : `Low confidence: no section shape clearly repeats across the selected family of ${units.length} sampled siblings at heading level ${level}; returning the most common observable shape.`
      : `Recurring section family observed in ${units.length} of ${sampledUnits.length} sampled siblings at heading level ${level}.`;
  const tableTruncated = units.some(
    (unit) => tableAnchorsForUnit(unit).length > SECTION_PATTERN_TABLE_LIMIT
  );
  const truncated = sequenceTruncated || tableTruncated;
  const note = truncated
    ? `${baseNote} Output is capped to the first ${SECTION_PATTERN_SEQUENCE_LIMIT} sequence elements and ${SECTION_PATTERN_TABLE_LIMIT} table shapes.`
    : baseNote;

  return {
    ok: true,
    pattern: {
      sectionLevel: {
        value: level,
        confidence: patternConfidence(units.length, units.length)
      },
      sequence,
      tables: tablePatterns(sfdt, units),
      roles,
      boundary: sectionBoundaryPattern(blocks, units)
    },
    sample: {
      available: availableUnits.length,
      sampled: units.length,
      recurring,
      ...(near ? { near } : {}),
      ...(truncated ? { truncated: true as const } : {})
    },
    note
  };
}

function parseSfdt(raw: string): any {
  if (!raw) return { sections: [] };
  try {
    return JSON.parse(raw);
  } catch {
    return { sections: [] };
  }
}

interface SerializationTiming {
  count: number;
  totalMs: number;
}

const serializationTimingByEditor = new WeakMap<
  LiveEditor,
  SerializationTiming
>();

function serializationClockMs(): number {
  return typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now();
}

/** Parse one editor snapshot and account for the expensive serialize call. */
function serializeSfdt(editor: LiveEditor): any {
  const timing = serializationTimingByEditor.get(editor);
  const startedAt = serializationClockMs();
  let raw = '';
  try {
    raw = editor.serialize();
  } finally {
    if (timing) {
      timing.count++;
      timing.totalMs += serializationClockMs() - startedAt;
    }
  }
  return parseSfdt(raw);
}

function withSerializationTiming<T>(
  editor: LiveEditor,
  timing: SerializationTiming,
  run: () => T
): T {
  const previous = serializationTimingByEditor.get(editor);
  serializationTimingByEditor.set(editor, timing);
  try {
    return run();
  } finally {
    if (previous) serializationTimingByEditor.set(editor, previous);
    else serializationTimingByEditor.delete(editor);
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
  const sfdt = serializeSfdt(editor);
  return buildInventoryFromBlocks(flattenSfdt(sfdt), input, sfdt);
}

export function buildIndexBlocks(editor: LiveEditor): IndexBlock[] {
  return buildIndexBlocksFromBlocks(flattenSfdt(serializeSfdt(editor)));
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

// One engine-owned boundary for operations which may ask SyncFusion to inspect
// or rebuild derived document state without user navigation. The review rail
// remains the owner of deliberate selection/scroll changes; background reads
// and post-resolution layout are visually silent.
function withPreservedDocumentView<T>(
  editor: LiveEditor,
  operation: () => T,
  suppressOperationScroll = true
): T {
  const selection = editor.selection;
  const startOffset = selection?.startOffset;
  const endOffset = selection?.endOffset;
  const documentHelper = (editor as any).documentHelper;
  const viewer = documentHelper?.viewerContainer as HTMLElement | undefined;
  const scrollTop = viewer?.scrollTop;
  const scrollLeft = viewer?.scrollLeft;
  const previousSkipScroll = documentHelper?.skipScrollToPosition;
  if (documentHelper && suppressOperationScroll)
    documentHelper.skipScrollToPosition = true;
  try {
    return operation();
  } finally {
    if (
      typeof startOffset === 'string' &&
      typeof endOffset === 'string' &&
      (selection?.startOffset !== startOffset ||
        selection?.endOffset !== endOffset)
    ) {
      // Search/layout can consume the one-shot suppression flag. Re-arm it
      // immediately before restoring the exact public range.
      if (documentHelper) documentHelper.skipScrollToPosition = true;
      selection.select(startOffset, endOffset);
    }
    if (viewer) {
      if (typeof scrollTop === 'number') viewer.scrollTop = scrollTop;
      if (typeof scrollLeft === 'number') viewer.scrollLeft = scrollLeft;
    }
    if (documentHelper)
      documentHelper.skipScrollToPosition = previousSkipScroll;
  }
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

  const documentHelper = (editor as any).documentHelper;
  return withPreservedDocumentView(editor, () => {
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
      const searchResults = (search as any).textSearchResults?.innerList ?? [];
      const sfdt = serializeSfdt(editor);
      const byAnchor = new Map(
        flattenSfdt(sfdt).map((block) => [block.anchor, block] as const)
      );
      const occurrences: DocumentOccurrence[] = [];
      const rawCandidateOrdinals = new Map<string, number>();
      let count = 0;
      for (const [resultIndex, result] of offsets.entries()) {
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
        let matchText = text;
        if (currentText !== undefined) {
          const currentOffsets = currentQueryOffsets(
            currentText,
            text,
            matchCase
          );
          const currentOffset = currentOffsets[rawOrdinal];
          if (
            currentOffset === undefined ||
            (wholeWord &&
              !isWholeWordAt(currentText, currentOffset, text.length))
          )
            continue;
          matchText = currentText.slice(
            currentOffset,
            currentOffset + text.length
          );
        } else {
          // Story/page text is absent from flattened SFDT. Read the search
          // result's already-resolved positions directly; its public `.text`
          // getter resolves logical indexes through Selection and moves the UI.
          const searchResult = searchResults[resultIndex];
          const getTextInternal = documentHelper?.selection?.getTextInternal;
          if (
            searchResult?.start &&
            searchResult?.end &&
            typeof getTextInternal === 'function'
          )
            matchText = String(
              getTextInternal.call(
                documentHelper.selection,
                searchResult.start,
                searchResult.end,
                false
              ) ?? text
            );
        }
        count++;
        if (occurrences.length >= maxResults) continue;
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
    }
  });
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
// A refusal must name the real text mismatch, never anchor drift this module
// does not measure, wrong advice sends the model re-reading unchanged content

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
 * `undefined`/`null` means no expectation was supplied. Every other value,
 * including the empty string, is a real expected value. In particular,
 * `set_cell_text` has no separate `find` predicate: weakening `expect: ''`
 * there would let a stale empty-cell read overwrite content inserted since
 * that read.
 */
function expectGuardRefuses(expected: unknown, live: string): boolean {
  if (expected == null) return false;
  return !expectTextMatches(expected, live);
}

// An expect_mismatch refusal must name what actually mismatched, or the model
// re-reads the inventory, gets the same anchor back, and re-sends the same
// request forever. The live text is the one fact that lets the next attempt
// differ.
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
// Text-frame content must be walked too. It lives in the serialized SFDT
// exactly like any other content - as `inline.textFrame.blocks`, which is
// where currentTextFrameText already reads it - and a walk that skips it
// leaves a text-frame write with no projection to be proven by, falling back
// to the revision-type guess this projection exists to replace.
// Exported for its own test: this projection IS the tracked-write proof, so
// "does it actually see the content it claims to cover" has to be assertable
// directly. A projection blind to a story would pass every write in it
// vacuously.
export function rejectProjectionStream(sfdt: any): string {
  return revisionProjectionStream(sfdt, insertedRevisionIds(sfdt));
}

// The mirror projection: what the document would read if every revision were
// ACCEPTED - pending deletions dropped, pending insertions kept. The reject
// projection proves a write is REVERSIBLE; this one proves it actually REPLACED
// the text it targeted, which reversibility cannot show and no revision-type
// inspection can establish either: a write that inserts the replacement beside
// an untouched target creates a perfectly rejectable Insertion and leaves the
// document reading "Innovation LearningInnovation Learning LLC".
function acceptProjectionStream(sfdt: any): string {
  return revisionProjectionStream(sfdt, deletedRevisionIds(sfdt));
}

function revisionProjectionStream(sfdt: any, dropIds: Set<string>): string {
  const out: string[] = [];
  const pushParagraph = (block: any) => {
    const inlines = getInlines(block);
    out.push(inlineText(inlines, dropIds));
    const markRevisionIds = paragraphMarkRevisionIds(block);
    // Rejecting an inserted paragraph mark joins this paragraph with the next
    // one, so an inserted mark contributes no separator to the projection.
    if (!allRevisionIdsIn(markRevisionIds, dropIds)) out.push('\n');
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
          if (allRevisionIdsIn(rowRevisionIds(row), dropIds)) continue;
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
// reversible by the whole-document reject projection and proven to have replaced
// the text it targeted by the accept projection.
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
  replacement: string,
  writtenEndOffset: string
): void {
  // A deletion writes no text, so there is no written range to re-search - and
  // `findAll('')` is not a search: against the real SDK it never terminates and
  // exhausts the heap. What a tracked deletion must prove is that the target is
  // struck and the write is reversible, which the accept projection
  // (`assertStoryTextFrameReplacement`) and the tracked-revision assertion
  // establish for every story shape.
  if (!replacement) return;
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
  // A first tracked replace inserts at the deleted range's old end; replacing a
  // still-pending insertion reuses its start. Both are also where a broken write
  // can insert beside an untouched target, which reads as the right range and is
  // not discriminable here - the accept projection is what refuses that write
  // (`assertStoryTextFrameReplacement`).
  const match = matches.find(
    (result: any) =>
      (String(result?.startOffset) === target.startOffset ||
        String(result?.startOffset) === target.endOffset) &&
      String(result?.endOffset) === writtenEndOffset
  );
  if (!match)
    throw new OpError(
      'text_verification_failed',
      `Text verification failed at "${target.anchor}".`,
      [
        `expected: ${JSON.stringify(replacement)}`,
        `expected range: ${target.startOffset} or ${target.endOffset} to ${writtenEndOffset}`,
        `ranges returned for the replacement: ${
          matches
            .map(
              (result: any) =>
                `${String(result?.startOffset)} to ${String(result?.endOffset)}`
            )
            .join(', ') || 'none'
        }`
      ]
    );
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
): { target: LiveStoryTarget; replacement: string } {
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
  // A pure deletion is not an empty replacement: `insertText('')` leaves the
  // selection untouched, so the op silently wrote nothing. `delete()` is the
  // public tracked-deletion primitive the body `delete_text` path already uses,
  // and it is safe here for the same reason it is safe there - the selection is
  // exactly the searched text range, with no paragraph mark in it.
  if (replacement) replaceSelectedText(editor, replacement);
  else editor.editor.delete();
  verifyLiveStoryWrite(
    editor,
    target,
    replacement,
    String(editor.selection.endOffset ?? '')
  );
  return { target, replacement };
}

// The property a story text write must actually have, stated as a document
// projection instead of inferred from the revisions it happened to author:
// accepting every revision must read as the target text REPLACED by the
// replacement. Nothing else separates a real tracked replacement from a write
// that inserted the replacement beside an undeleted target - that write lands on
// the same search range, authors a rejectable Insertion, and leaves the reject
// projection unchanged, so it passes every other assertion while the accepted
// document reads "Innovation LearningInnovation Learning LLC".
//
// Only text frames get this: their content is serialized into the SFDT, so the
// projection can see it. Stories the projection cannot see (footnote/endnote
// markers) keep the revision-pair assertion in `assertTrackedMutation`, which
// demands the Deletion a real replacement authors.
function assertStoryTextFrameReplacement(
  write: { target: LiveStoryTarget; replacement: string },
  priorAcceptStream: string,
  postWriteSfdt: any
): void {
  const { target, replacement } = write;
  const accepted = acceptProjectionStream(postWriteSfdt);
  // The projection is a whole-document stream, so the target is one occurrence of
  // its own spelling in it and every occurrence is a candidate; the search-range
  // check in `verifyLiveStoryWrite` is what pins down which one was written.
  //
  // Only an occurrence spanning every character that actually changed can be the
  // one this write replaced, and a whole-document candidate is built for those
  // alone: a one-letter `find` in a large document has thousands of occurrences
  // and none of them is worth a copy of the document. Both ends of the changed
  // span are maximal and may overlap (shortening "X LLC" to "X" lets the space
  // fall on either side), which only widens the set of occurrences worth testing
  // - safe, because the filter must exclude no occurrence that could be the
  // replaced one and full-stream equality is what decides.
  const changedFrom = commonPrefixLength(priorAcceptStream, accepted);
  const changedTo =
    priorAcceptStream.length - commonSuffixLength(priorAcceptStream, accepted);
  // An accepted document that did not change at all has no changed span to pin
  // an occurrence with, and exactly one write leaves it unchanged: replacing the
  // target with its own text.
  const spansTheChange = (at: number) =>
    accepted === priorAcceptStream
      ? replacement === target.text
      : at <= changedFrom && at + target.text.length >= changedTo;
  const replacedAt = (at: number) =>
    priorAcceptStream.slice(0, at) +
    replacement +
    priorAcceptStream.slice(at + target.text.length);
  const occurrences: number[] = [];
  // `find` is required to be non-empty, and an empty needle would make indexOf
  // stand still.
  if (target.text)
    for (
      let at = priorAcceptStream.indexOf(target.text);
      at >= 0;
      at = priorAcceptStream.indexOf(target.text, at + 1)
    )
      occurrences.push(at);
  if (
    occurrences.some((at) => spansTheChange(at) && replacedAt(at) === accepted)
  )
    return;
  const explain = occurrences.find(spansTheChange) ?? occurrences[0];
  throw new OpError(
    'text_verification_failed',
    `Text verification failed at "${target.anchor}".`,
    explain === undefined
      ? [
          `expected: ${JSON.stringify(
            target.text
          )} replaced by ${JSON.stringify(replacement)}`,
          'the target text was not part of the accepted document before this write, so this write cannot have replaced it'
        ]
      : describeAcceptDivergence(replacedAt(explain), accepted)
  );
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
// Treating them as an equality filter discards ranges search already resolved
// correctly: the tool schema fills every field so an unset `end` arrives as 0,
// and a model-counted offset is routinely off by a few characters, either one
// would report a text right under the user's selection as not found.
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

interface SelectionTextRunBlock {
  block: FlatBlock;
  start: number;
  textEnd: number;
  markEnd: number;
}

interface SelectionTextRun {
  container: string;
  text: string;
  blocks: SelectionTextRunBlock[];
}

interface LocatedSelectionRange {
  target: FlatBlock;
  startOffset: string;
  endOffset: string;
}

type SelectionRelocationAttempt =
  | { range: LocatedSelectionRange; relocated?: { from: string; to: string } }
  | { details: string[] };

// Body paragraphs form one searchable story, while every table cell is its own
// selection container. Starting a fresh run whenever the flattened walk enters
// a different container also prevents a body match from jumping across a table.
function selectionSearchContainer(anchor: string): string {
  const parts = String(anchor).split(';');
  return parts.length >= 5 ? `cell:${parts.slice(0, 4).join(';')}` : 'body';
}

function selectionTextRuns(blocks: FlatBlock[]): SelectionTextRun[] {
  const runs: SelectionTextRun[] = [];
  for (const block of blocks) {
    const container = selectionSearchContainer(block.anchor);
    let run = runs[runs.length - 1];
    if (!run || run.container !== container) {
      run = { container, text: '', blocks: [] };
      runs.push(run);
    }
    const start = run.text.length;
    run.blocks.push({
      block,
      start,
      textEnd: start + block.length,
      markEnd: start + block.length + 1
    });
    // SyncFusion Selection exposes paragraph boundaries as carriage returns.
    run.text += `${block.text}\r`;
  }
  return runs;
}

function selectionIdentityMatches(op: EditOp, text: string): boolean {
  if (op.expect == null) return false;
  const expect = String(op.expect);
  const expectLength =
    typeof op.expectLength === 'number' && op.expectLength > 0
      ? op.expectLength
      : null;
  return expectLength == null
    ? text === expect
    : text.length === expectLength && text.startsWith(expect);
}

function declaredSelectionText(
  op: EditOp,
  byAnchor: Map<string, FlatBlock>,
  runs: SelectionTextRun[]
): string | undefined {
  const anchor = String(op.anchor ?? '');
  const block = byAnchor.get(anchor);
  if (!block) return undefined;
  const startOffset = offsetString(op.startOffset) || `${anchor};0`;
  const endOffset = offsetString(op.endOffset) || `${anchor};${block.length}`;
  const start = offsetParts(startOffset);
  const end = offsetParts(endOffset);
  if (start.anchor !== anchor) return undefined;
  const run = runs.find((candidate) =>
    candidate.blocks.some((entry) => entry.block.anchor === start.anchor)
  );
  if (!run) return undefined;
  const startEntry = run.blocks.find(
    (entry) => entry.block.anchor === start.anchor
  );
  const endEntry = run.blocks.find(
    (entry) => entry.block.anchor === end.anchor
  );
  if (!startEntry || !endEntry) return undefined;
  if (
    start.offset < 0 ||
    start.offset > startEntry.block.length ||
    end.offset < 0 ||
    end.offset > endEntry.block.length + 1
  )
    return undefined;
  const from = startEntry.start + start.offset;
  const to = endEntry.start + end.offset;
  return from < to ? run.text.slice(from, to) : undefined;
}

function declaredSelectionCrossesContainer(
  op: EditOp,
  byAnchor: Map<string, FlatBlock>
): boolean {
  const start = byAnchor.get(String(op.anchor ?? ''));
  const end = offsetParts(offsetString(op.endOffset));
  const endBlock = byAnchor.get(end.anchor);
  return !!(
    start &&
    endBlock &&
    rangeContainer(start.anchor) !== rangeContainer(endBlock.anchor)
  );
}

function rangeAtRunPosition(
  run: SelectionTextRun,
  start: number,
  end: number
): LocatedSelectionRange | undefined {
  const startEntry = run.blocks.find(
    (entry) => start >= entry.start && start <= entry.textEnd
  );
  const endEntry = run.blocks.find(
    (entry) => end > entry.start && end <= entry.markEnd
  );
  if (!startEntry || !endEntry) return undefined;
  if (
    rangeContainer(startEntry.block.anchor) !==
    rangeContainer(endEntry.block.anchor)
  )
    return undefined;
  return {
    target: startEntry.block,
    startOffset: `${startEntry.block.anchor};${start - startEntry.start}`,
    endOffset: `${endEntry.block.anchor};${end - endEntry.start}`
  };
}

// Selection relocation is the range-shaped extension of the existing anchor
// doctrine below: content is authoritative, matches must be unique, and a
// table/cell boundary is never crossed. It consumes the request-time identity;
// it does not consult the mutable UI selection.
function attemptSelectionRelocation(
  blocks: FlatBlock[],
  op: EditOp
): SelectionRelocationAttempt {
  const from = String(op.anchor ?? '');
  const expect = op.expect == null ? '' : String(op.expect);
  const expectLength =
    typeof op.expectLength === 'number' && op.expectLength > 0
      ? op.expectLength
      : expect.length;
  const attempted = `selection relocation attempted from "${from}" using \`expect\` ${JSON.stringify(
    expect
  )}${op.expectLength ? ` and length ${expectLength}` : ''}`;
  if (!expect || expectLength < expect.length)
    return {
      details: [
        attempted,
        'selection content identity is empty or internally inconsistent'
      ]
    };

  const matches: LocatedSelectionRange[] = [];
  for (const run of selectionTextRuns(blocks)) {
    let cursor = 0;
    while (cursor <= run.text.length - expect.length) {
      const start = run.text.indexOf(expect, cursor);
      if (start < 0) break;
      const end = start + expectLength;
      if (
        end <= run.text.length &&
        run.text.slice(start, end).startsWith(expect)
      ) {
        const range = rangeAtRunPosition(run, start, end);
        if (range && sameRelocationContainer(from, range.target.anchor))
          matches.push(range);
      }
      cursor = start + Math.max(expect.length, 1);
    }
  }

  if (!matches.length)
    return { details: [attempted, 'matching selection ranges: none'] };
  if (matches.length > 1)
    return {
      details: [
        attempted,
        `matching selection ranges (${matches.length}): ${matches
          .map((match) => `${match.startOffset}..${match.endOffset}`)
          .join(', ')}`
      ]
    };
  const range = matches[0];
  return {
    range,
    ...(range.target.anchor !== from
      ? { relocated: { from, to: range.target.anchor } }
      : {})
  };
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
  const expect = op.expect != null ? String(op.expect) : null;
  // A schema-filled 0 is indistinguishable from an unset length, and a
  // zero-length range is already refused as selection_empty.
  const expectLength =
    typeof op.expectLength === 'number' && op.expectLength > 0
      ? op.expectLength
      : null;
  if (expect == null)
    throw new OpError(
      'missing_selection_guard',
      'replace_selection must pin the content it believes it is replacing.',
      [
        `live text at this range: ${JSON.stringify(
          range.text.length > STALE_TEXT_EXCERPT_LIMIT
            ? `${range.text.slice(0, STALE_TEXT_EXCERPT_LIMIT - 1)}…`
            : range.text
        )}`,
        "Resend with `expect` set to the selected text copied from the selection context. When that text was truncated, also set `expectLength` to the selection's `textLength`; length alone does not pin content."
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
): any | undefined {
  if (!replacement) return undefined;
  const sfdt = serializeSfdt(editor);
  const blocks = flattenSfdt(sfdt);
  let startIndex = blocks.findIndex(
    (block) => block.anchor === range.startAnchor
  );
  let endIndex = blocks.findIndex((block) => block.anchor === range.endAnchor);
  if (startIndex < 0) {
    startIndex = blocks.findIndex(
      (block) =>
        compareOffsets(block.anchor, range.startAnchor) >= 0 &&
        compareOffsets(block.anchor, range.endAnchor) <= 0
    );
  }
  if (endIndex < 0) {
    for (let index = blocks.length - 1; index >= 0; index--) {
      const block = blocks[index];
      if (
        compareOffsets(block.anchor, range.startAnchor) >= 0 &&
        compareOffsets(block.anchor, range.endAnchor) <= 0
      ) {
        endIndex = index;
        break;
      }
    }
  }
  if (startIndex < 0)
    throw new OpError(
      'post_write_anchor_not_found',
      `The edited anchor "${range.startAnchor}" disappeared after the write.`
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
  return sfdt;
}

function verifyWrittenText(
  editor: LiveEditor,
  anchor: string,
  expected: string
): any {
  const sfdt = serializeSfdt(editor);
  const current = flattenSfdt(sfdt).find((block) => block.anchor === anchor);
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
  return sfdt;
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
  /** Engine-internal identity linking a composed paragraph to its creator. */
  __sectionCreatorId?: string;
  /** Engine-internal non-empty segment ordinal within that creator. */
  __sectionSegmentIndex?: number;
  /** Exact final body anchor planned from the complete composed topology. */
  __sectionFinalAnchor?: string;
  /**
   * Exact live boundary before one composer-owned structural write. Unlike a
   * content match, this remains deterministic when the section itself repeats
   * the boundary heading or the boundary is an ordinary blank paragraph.
   */
  __sectionBoundaryAnchor?: string;
  /** Composer-owned perimeter handling suppresses the generic insert heuristic. */
  __suppressSectionBoundary?: boolean;
  /** A malformed composer request is routed through the ordinary group refusal. */
  __sectionRefusal?: {
    code: string;
    message: string;
    details?: string[];
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
  /**
   * Set by the table-appearance ops. Its `report` half becomes the result's
   * `appearance`; its `restores` half is engine-internal and is collected by the
   * executor, never returned to the model.
   */
  appearanceWrite?: AppearanceWriteOutcome;
  /** Fresh post-write snapshot reused by the executor's integrity checks. */
  postWriteSfdt?: any;
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
): { blocks: FlatBlock[]; postWriteSfdt: any } {
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

  const postWriteSfdt = serializeSfdt(editor);
  const freshBlocks = flattenSfdt(postWriteSfdt);
  const freshResolver = makeFormulaResolver(freshBlocks);
  const freshByAnchor = new Map(
    freshBlocks.map((block) => [block.anchor, block])
  );
  const writtenText = freshByAnchor.get(targetAnchor)?.text;
  if (writtenText !== rendered.renderedValue) {
    throw new OpError(
      writtenText == null
        ? 'post_write_anchor_not_found'
        : 'text_verification_failed',
      writtenText == null
        ? `The edited anchor "${targetAnchor}" disappeared after the write.`
        : `Text verification failed at "${targetAnchor}".`,
      [
        `expected: ${JSON.stringify(rendered.renderedValue)}`,
        `actual: ${JSON.stringify(writtenText ?? null)}`
      ]
    );
  }
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
  return { blocks: freshBlocks, postWriteSfdt };
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

  const written = writeAndVerifyFormulaResult(editor, {
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
    formula: {
      ...withoutReceipt,
      receipt: buildFormulaReceipt(withoutReceipt)
    },
    postWriteSfdt: written.postWriteSfdt
  };
}

// ---------------------------------------------------------------------------
// Column-wide recompute (set_column_formula)
//
// The failure this exists to remove: the model picks the row range and gets it
// wrong, writing totals in the same row over DIFFERENT spans, one wrong by
// construction with nothing in the output saying which.
//
// So let a formula apply down a WHOLE DATA column. The engine evaluates it for
// every row in the span and - because of the no-op rule - writes only the cells
// whose value actually moves. That is what makes bulk safe: without no-op
// skipping a column recompute would produce a change card per row and drown the
// review pane; with it you get exactly the cells that moved. It also removes
// the range-guessing failure outright: row 0 is the explicit header by default,
// while blank separators and section labels in the data body are skipped and
// named.
//
// `{row}` in the formula is substituted with each row index before parsing, so
// the grammar itself is untouched: one notation, evaluated N times.
// ---------------------------------------------------------------------------

const ROW_PLACEHOLDER = '{row}';

/**
 * Formula refusals that describe ONE ROW rather than the request. A header cell
 * holding "Coverage", a blank separator and a short row all land here; skipping
 * and naming them lets the span safely cover the whole data body. Every other
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
      report.wholeTable ? ' (every data row; row 0 is the header)' : ''
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
      )}. Omit both \`startRow\` and \`endRow\` to recompute every data row while reserving row 0 as the header - rows that cannot produce a value are skipped and named.`
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
  // Row roles are explicit, never inferred from whether row 0 happens to parse
  // as a number. With no bounds, row 0 is the header and rows 1..end are data;
  // callers with a headerless table can opt in to row 0 via startRow: 0.
  const startRow = requestedStart ?? 1;
  const endRow = requestedEnd ?? collected.rowCount - 1;
  if (wholeTable && collected.rowCount <= 1)
    throw new OpError(
      'no_data_rows',
      `The table at ${tableAnchor} contains only row 0, which the default column span reserves as the header. Send \`startRow: 0\` and \`endRow: 0\` only if that row is actually data.`
    );
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
      }); the requested span ends at row ${endRow}. Re-read table_facts, or omit \`startRow\`/\`endRow\` to cover every data row while reserving row 0 as the header.`
    );

  const rows: ColumnRowOutcome[] = [];
  let postWriteSfdt: any;
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
    const written = writeAndVerifyFormulaResult(editor, {
      formulaText: source,
      evaluation,
      rendered,
      target,
      selfReferencing,
      round: roundingMode,
      ...decimals
    });
    blocks = written.blocks;
    postWriteSfdt = written.postWriteSfdt;
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
  return { column: report, postWriteSfdt };
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

// Currency symbols and number-format punctuation without a digit are an empty
// amount placeholder, not prose. This deliberately excludes letters so
// "Included" and "N/A" keep the prose carve-out below.
function isDigitFreeQuantityPlaceholder(text: string): boolean {
  return (
    text !== '' &&
    !/\d/.test(text) &&
    /^[\s$¢£¤¥\u058F\u060B\u09F2\u09F3\u09FB\u0AF1\u0BF9\u0E3F\u17DB\u20A0-\u20CF.,'’()\-−+%]*$/.test(
      text
    )
  );
}

/**
 * THE ONE JUDGEMENT: does this cell belong to a column of formatted amounts,
 * and - if it does - what number format does the DOCUMENT say a value written
 * here should wear? Both halves of the money-cell contract read it: the
 * provenance gate below (which numeric writes need a declared source) and the
 * `set_cell_text` render (what bytes such a write actually lays down). There is
 * deliberately one implementation, so the two can never disagree about which
 * cells are money cells.
 *
 * The rule, and where each part of it comes from:
 * - "a formatted amount" is `classifyNumericText(...).quantity` - the same
 *   three-tier test `table_facts` publishes and the gate has always used, so an
 *   id column (`0093`) and prose that happens to contain digits are excluded by
 *   construction rather than by a second opinion.
 * - the cell BELONGS to such a column when it already holds a quantity itself,
 *   or when it is empty and at least two OTHER cells of its own column hold
 *   one. Two is the gate's existing threshold: one lone formatted cell could be
 *   the header or a stray.
 * - the FORMAT is `resolveRenderFormat`, the formula path's own discovery,
 *   unchanged: the target cell's own format when it has one, otherwise the
 *   column's dominant format (`renders in this cell's own number format`).
 * - a column whose amounts do not agree on one unit has no single format to
 *   write in, so it resolves to null and nothing is re-rendered - the same
 *   mixed-unit refusal `collectNumericCells` applies to arithmetic.
 */
function resolveQuantityCellFormat(
  blocks: FlatBlock[],
  block: FlatBlock
): {
  format: CellNumberFormat;
  formatSource: RenderFormatSource;
  /** The column's own formatted amounts, as the formula path names them. */
  inputs: ParsedColumnCell[];
} | null {
  const parts = block.anchor.split(';');
  if (block.kind !== 'table_cell' || parts.length !== 5) return null;
  const existing = block.text.trim();
  const existingIsQuantity = existing !== '' && isQuantityText(existing);
  // A cell holding "Included" or "N/A" is not a money cell, whatever its
  // neighbours look like.
  if (
    existing !== '' &&
    !existingIsQuantity &&
    !isDigitFreeQuantityPlaceholder(existing)
  )
    return null;

  const collected = collectTableColumnCells(
    blocks,
    `${parts[0]};${parts[1]}`,
    Number(parts[3])
  );
  const siblings: ParsedColumnCell[] = [];
  for (const cellEntry of collected?.cells ?? []) {
    if (cellEntry.anchor === block.anchor) continue;
    if (cellEntry.text == null || !isQuantityText(cellEntry.text)) continue;
    const parsed = parseNumericCell(cellEntry.text);
    if (!parsed) continue;
    siblings.push({
      row: cellEntry.row,
      anchor: cellEntry.anchor,
      text: cellEntry.text,
      parsed: parsed
    });
  }
  if (!existingIsQuantity && siblings.length < 2) return null;

  const units = new Set(
    siblings.map((sibling) => sibling.parsed.unit).filter(Boolean)
  );
  const existingUnit = existingIsQuantity
    ? parseNumericCell(existing)?.unit ?? ''
    : '';
  if (existingUnit) units.add(existingUnit);
  if (units.size > 1) return null;

  return {
    ...resolveRenderFormat(existingIsQuantity ? block.text : null, siblings),
    inputs: siblings
  };
}

const LITERAL_NUMBER_NOTE =
  'Written verbatim as a literal figure (literal: true), NOT computed by the engine. Only valid for a figure the user stated; anything derived from other cells must go through set_cell_formula.';

const QUOTED_NUMBER_NOTE =
  'Quoted verbatim from an attachment the user supplied (quotedFrom / quotedText), NOT computed by the engine. The engine verified the figure appears in the quoted excerpt; it cannot verify the excerpt came from that attachment, so the citation is recorded for review. Anything derived from other cells must go through set_cell_formula.';

/**
 * What the engine can and cannot check about "this figure came out of the
 * user's document".
 *
 * It CANNOT check the claim itself: the attachment is read server-side, this
 * engine runs against the editor and has no copy of the PDF, so "quotedFrom
 * names a real attachment" is an assertion and stays one. Saying otherwise
 * would be the same unverifiable-number problem one level up.
 *
 * It CAN check the claim is INTERNALLY CONSISTENT, and that is worth having:
 * the figure being written must actually occur in the excerpt the model says it
 * read it out of. A number the model derived cannot be dressed as a quotation
 * without also fabricating an excerpt containing it, and the excerpt travels
 * with the change set, so a reviewer can search the attachment for that exact
 * sentence. Value equality, not string equality, is the test - a PDF reading
 * `$9,660.00` justifies writing `9660` into a column that renders it that way.
 */
function quotedExcerptContains(excerpt: string, figure: string): boolean {
  const target = parseNumericCell(figure);
  if (!target) return false;
  const candidates = excerpt.match(/[^\s]*\d[^\s]*/g) ?? [];
  return candidates.some((candidate) => {
    const parsed = parseNumericCell(candidate.replace(/[.,;:)]+$/, ''));
    if (!parsed) return false;
    const scale = Math.max(parsed.value.scale, target.value.scale);
    const a = rescaleExact(parsed.value, scale);
    const b = rescaleExact(target.value, scale);
    return !!a && !!b && a.units === b.units;
  });
}

/**
 * The gate. Returns the audit record when a numeric write is allowed through on
 * a declared provenance, `undefined` when the write is not numeric at all, and
 * throws the refusal otherwise.
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
  byAnchor: Map<string, FlatBlock>,
  rendered?: ColumnFormatRender
): LiteralNumberWrite | undefined {
  const text = modelAuthoredCellText(op);
  if (text === undefined) return undefined;
  if (block.kind !== 'table_cell') return undefined;
  const { record, citationFailure } =
    op.op === 'set_cell_text'
      ? resolveNumberProvenance(
          op as TypedEditOp<'set_cell_text'>,
          text.trim(),
          block.text.trim()
        )
      : { record: undefined, citationFailure: '' };
  // `literal: true` is an auditable claim even outside a quantity-formatted
  // column. The change-set boundary uses these records to enforce the
  // single-use licence for a user-stated figure.
  const userStatedRecord =
    record?.source === 'user_stated' && classifyNumericText(text).numeric
      ? { ...record, ...(rendered ? { rendered } : {}) }
      : undefined;
  if (!isQuantityText(text)) return userStatedRecord;
  // A QUANTITY SLOT IN A QUANTITY COLUMN: either the cell already holds a
  // quantity, or it is empty and sits in a column that plainly holds them - the
  // freshly-inserted Total cell, which is exactly where a fabricated total
  // lands, so leaving the empty case open would leave the gate open.
  const existing = block.text.trim();
  const existingIsQuantity = existing !== '' && isQuantityText(existing);
  if (!resolveQuantityCellFormat(Array.from(byAnchor.values()), block))
    return userStatedRecord;
  if (record) return { ...record, ...(rendered ? { rendered } : {}) };
  throw new OpError(
    'model_authored_number',
    `Refusing to write the number ${JSON.stringify(text.trim())}${
      rendered ? ` (sent as ${JSON.stringify(rendered.asSent)})` : ''
    } into ${
      existingIsQuantity
        ? 'a cell that already holds a formatted amount'
        : 'an empty cell in a column of formatted amounts'
    } through ${
      op.op
    }: a value in a quantity column is almost always derived from other cells, and a number in the response body is unverifiable - the engine cannot tell a correct total from a plausible one. Use set_cell_formula with a \`formula\` that REFERENCES the cells the value comes from (e.g. "[${
      block.anchor
    }] * 1.13", or "sum([0;7;1..93;3])"): the engine reads those cells, computes exactly, renders in this cell's own number format and verifies by re-reading. If this figure is not derived, declare where it came from instead: the user dictated this exact number - set_cell_text with \`literal: true\`; or it is quoted verbatim from a document the user attached - set_cell_text with \`quotedFrom\` (the attachment) and \`quotedText\` (the verbatim excerpt containing the figure), which the engine checks the figure against and records as a citation.${citationFailure}`,
    [
      `target cell: ${block.anchor}`,
      `current content: ${JSON.stringify(block.text)}`
    ]
  );
}

/**
 * The sanctioned provenances for a figure the engine did not compute, and the
 * audit record each one leaves. Anything else is refused by the gate above.
 *
 * `citationFailure` is the sentence the refusal appends when a citation WAS
 * offered and did not hold up. Falling silently back to the generic refusal
 * would read as "attachments are not supported" and send the model round the
 * same loop it was already stuck in.
 */
function resolveNumberProvenance(
  op: TypedEditOp<'set_cell_text'>,
  text: string,
  previousText: string
): { record?: LiteralNumberWrite; citationFailure: string } {
  if (op.literal === true) {
    return {
      record: {
        text,
        previousText,
        source: 'user_stated',
        note: LITERAL_NUMBER_NOTE
      },
      citationFailure: ''
    };
  }
  const quotedFrom =
    typeof op.quotedFrom === 'string' ? op.quotedFrom.trim() : '';
  const quotedText =
    typeof op.quotedText === 'string' ? op.quotedText.trim() : '';
  if (!quotedFrom && !quotedText) return { citationFailure: '' };
  if (!quotedFrom || !quotedText) {
    return {
      citationFailure:
        ' `quotedFrom` and `quotedText` must BOTH be sent: the attachment the figure was read out of, and the verbatim excerpt containing it.'
    };
  }
  if (!quotedExcerptContains(quotedText, text)) {
    return {
      citationFailure: ` The excerpt sent as \`quotedText\` (${JSON.stringify(
        quotedText
      )}) does not contain this figure, so the citation does not support it.`
    };
  }
  return {
    record: {
      text,
      previousText,
      source: 'attachment',
      quotedFrom,
      quotedText,
      note: QUOTED_NUMBER_NOTE
    },
    citationFailure: ''
  };
}

/** True when this op declares a provenance for a figure it is writing. */
function declaresNumberProvenance(op: EditOp): boolean {
  if (op.op !== 'set_cell_text') return false;
  return (
    op.literal === true ||
    (typeof op.quotedFrom === 'string' && op.quotedFrom.trim() !== '') ||
    (typeof op.quotedText === 'string' && op.quotedText.trim() !== '')
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
        return {
          postWriteSfdt: verifyWrittenText(
            editor,
            block.anchor,
            String(replacement)
          )
        };
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
      return { postWriteSfdt: verifyWrittenText(editor, block.anchor, next) };
    }
    replaceSelectedText(editor, String(replacement ?? ''));
    return { postWriteSfdt: verifyWrittenText(editor, block.anchor, next) };
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
    return {
      postWriteSfdt: verifySelectionWrite(editor, range, String(replacement))
    };
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
  delete_paragraph: ({ editor, op, block, byAnchor }) => {
    if (block.kind === 'table_cell')
      throw new OpError(
        'paragraph_delete_table_cell',
        'delete_paragraph removes document paragraphs, not table-cell content. Use set_cell_text/delete_text for a cell.'
      );
    if (!op.force && block.text.trim().length) {
      throw new OpError(
        'paragraph_not_empty',
        'delete_paragraph only removes whitespace-only paragraphs unless `force: true` is supplied.',
        [
          `anchor: ${block.anchor}`,
          `paragraph text: ${JSON.stringify(block.text)}`,
          'Visible characters are never treated as empty. A paragraph containing "_" must be explicitly forced or handled with a more specific edit.'
        ]
      );
    }
    const blocks = Array.from(byAnchor.values());
    const index = blocks.findIndex(
      (candidate) => candidate.anchor === block.anchor
    );
    const next = index >= 0 ? blocks[index + 1] : undefined;
    if (next && next.kind !== 'table_cell')
      editor.selection.select(`${block.anchor};0`, `${next.anchor};0`);
    else selectParagraph(editor, block);
    editor.editor.delete();
  },
  insert_text: ({ editor, op, block }) => {
    const offset = insertionPoint(op, block);
    selectRange(editor, block.anchor, offset, offset);
    editor.editor.insertText(insertionText(op));
  },
  insert_section: ({ op }) => {
    // Valid section requests are expanded at applyDocumentEdits' common
    // boundary. Keeping this refusal backstop in the typed handler registry
    // makes malformed requests use the same group failure/rollback path and
    // prevents an accidental bypass from becoming a partial write.
    const refusal = op.__sectionRefusal;
    if (refusal)
      throw new OpError(refusal.code, refusal.message, refusal.details);
    throw new OpError(
      'section_composer_not_expanded',
      'insert_section did not reach the engine section composer; nothing was written.',
      [
        'Re-send this operation through applyDocumentEdits. The low-level document operations remain available for non-section edits.'
      ]
    );
  },
  set_cell_text: ({ editor, op, block }) => {
    // Overwrite the (cell) block's content.
    selectBlock(editor, block);
    const replacement = String(op.text ?? '');
    replaceSelectedText(editor, replacement);
    return {
      postWriteSfdt: verifyWrittenText(editor, block.anchor, replacement)
    };
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
  insert_table: ({ editor, op, block, byAnchor }) => {
    if (block.kind === 'table_cell')
      throw new OpError(
        'insert_table_requires_body_anchor',
        'A top-level table cannot be inserted from inside an existing table cell. Use an addressable body paragraph or heading before/after the intended location; nothing was written.',
        [`cell anchor: ${block.anchor}`]
      );
    const position =
      typeof op.position === 'string' ? op.position.toLowerCase() : 'before';
    let insertionAnchor = block.anchor;
    if (position === 'after') {
      const parts = block.anchor.split(';');
      const blockIndex = Number(parts[1]);
      const nextAnchor =
        parts.length >= 2 && Number.isInteger(blockIndex)
          ? `${parts[0]};${blockIndex + 1}`
          : '';
      const next = nextAnchor ? byAnchor.get(nextAnchor) : undefined;
      if (!next)
        throw new OpError(
          'insert_table_after_requires_following_block',
          'A table can be placed after this block only when the next body block is addressable. Anchor the next block with position "before" instead; nothing was written.',
          [`anchor after ${block.anchor}: ${nextAnchor || 'unavailable'}`]
        );
      insertionAnchor = next.anchor;
    }
    selectRange(editor, insertionAnchor, 0, 0);
    callEditor(
      editor,
      'insertTable',
      positiveCount(op.rows),
      positiveCount(op.columns)
    );
    if (Array.isArray(op.initialCells)) {
      op.initialCells.forEach((row: unknown, rowIndex: number) => {
        if (!Array.isArray(row)) return;
        row.forEach((cell: unknown, columnIndex: number) => {
          const text = String(cell ?? '');
          if (!text) return;
          selectRange(
            editor,
            `${insertionAnchor};${rowIndex};${columnIndex};0`,
            0,
            0
          );
          callEditor(editor, 'insertText', text);
        });
      });
    }
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
  // --- Table appearance ------------------------------------------------------
  // Each returns the restore snapshots the executor binds to the change set's
  // revision group; see the appearance-write section for why that is how a
  // formatting write is made rejectable at all.
  set_cell_format: ({ editor, op, block }) => {
    const { tableAnchor, row, column } = cellAnchorParts(
      block.anchor,
      'set_cell_format'
    );
    const write = appearanceWriteFromOp(op);
    const current = liveTableAppearance(editor, tableAnchor);
    const before = cellAppearanceAt(current, row, column);
    const transaction = runAppearanceTransaction(editor, (record) => {
      record({
        cellAnchor: block.anchor,
        write: restoreWriteFor(before, write)
      });
      writeAppearance(editor, block.anchor, write, 'cell');
      return { ...emptyAppearanceReport(), cellsWritten: 1 };
    });
    return {
      appearanceWrite: {
        report: transaction.result,
        restores: transaction.restores
      }
    };
  },
  set_row_format: ({ editor, op, block }) => {
    const { tableAnchor, row } = cellAnchorParts(
      block.anchor,
      'set_row_format'
    );
    const isHeaderField = fmtField(op, 'isHeader');
    // isHeader alone is a complete request, so the appearance fields are only
    // required when it is absent.
    const write =
      isHeaderField != null
        ? tryAppearanceWriteFromOp(op)
        : appearanceWriteFromOp(op);
    const current = liveTableAppearance(editor, tableAnchor);
    const cells = current.rows[row]?.cells ?? [];
    if (!cells.length)
      throw new OpError(
        'row_not_found',
        `Row ${row} of table "${tableAnchor}" has no cells.`
      );
    const transaction = runAppearanceTransaction(editor, (record) => {
      if (isHeaderField != null) {
        const wanted = !!isHeaderField;
        if (wanted !== !!current.rows[row].isHeader) {
          record({
            cellAnchor: block.anchor,
            rowIsHeader: !!current.rows[row].isHeader
          });
          writeRowIsHeader(editor, block.anchor, wanted);
        }
      }
      let cellsWritten = 0;
      if (write) {
        // One selectRow write would set every cell at once, but the RESTORE has
        // to be per cell (the cells may have differed before), so the write is
        // per cell too - one path, and the inverse is exact by construction.
        for (let column = 0; column < cells.length; column++) {
          const cellAnchor = cellAnchorOf(tableAnchor, row, column);
          const before = cellAppearanceAt(current, row, column);
          record({ cellAnchor, write: restoreWriteFor(before, write) });
          writeAppearance(editor, cellAnchor, write, 'cell');
          cellsWritten++;
        }
      }
      return { ...emptyAppearanceReport(), cellsWritten, rowsWritten: 1 };
    });
    return {
      appearanceWrite: {
        report: transaction.result,
        restores: transaction.restores
      }
    };
  },
  copy_table_format: ({ editor, op, block }) => {
    const { tableAnchor } = cellAnchorParts(block.anchor, 'copy_table_format');
    const appearanceWrite = runCopyTableFormat(editor, op, tableAnchor);
    return {
      appearanceWrite,
      postWriteSfdt: appearanceWrite.postWriteSfdt
    };
  },
  restripe_table: ({ editor, op, block }) => {
    const { tableAnchor } = cellAnchorParts(block.anchor, 'restripe_table');
    const current = liveTableAppearance(editor, tableAnchor);
    const banding = detectTableBanding(current);
    if (!banding)
      return {
        appearanceWrite: {
          report: { ...emptyAppearanceReport(), noBandingDetected: true },
          restores: []
        }
      };
    const fromRow = integerParam(op.fromRow, 'fromRow') ?? 0;
    return {
      appearanceWrite: applyBandingRows(
        editor,
        tableAnchor,
        current,
        banding,
        fromRow
      )
    };
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
    if (editor.revisions?.acceptAll) {
      editor.revisions.acceptAll();
      invalidateDocumentLayout(editor);
    } else throw new OpError('unsupported_op', 'No revisions to accept.');
  },
  reject_all_revisions: ({ editor }) => {
    if (editor.revisions?.rejectAll) {
      editor.revisions.rejectAll();
      invalidateDocumentLayout(editor);
    } else throw new OpError('unsupported_op', 'No revisions to reject.');
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

/**
 * A figure written into a column of formatted amounts wears that column's
 * format. `9660` into a column of `$36,803.00` lands as `$9,660.00`, because
 * the neighbours say so - the captain's complaint was exactly that the engine
 * wrote the digits it was handed and ignored the column around them:
 * *"I gave it just the value."*
 *
 * WHEN. Only when the figure carries no format of its own, which is
 * `classifyNumericText`'s own middle tier: numeric, but with no unit, no
 * decimal places and no observed grouping. That is what "just the value" means,
 * and reading it off the existing classifier is what keeps this from becoming a
 * second opinion about what a number is. A figure that ARRIVES formatted -
 * `0.00`, `$0`, `($0.00)`, `12.5%` - is an explicit instruction about how the
 * cell should read and is written exactly as sent; that is how "drop the
 * currency symbol from this column" is expressed, and re-dressing it would
 * silently refuse the request.
 *
 * WHAT FORMAT. The document's, discovered by `resolveQuantityCellFormat` -
 * which is `resolveRenderFormat`, the same mechanism `set_cell_formula` uses to
 * keep `$36,803` from coming back as `36803`. There is no second formatting
 * implementation.
 *
 * WHERE IN THE ORDER. Deliberately ahead of the provenance gate, not behind it,
 * so the gate judges the bytes that will LAND. Dropping the `$` therefore stops
 * being a way to slip a money value past it: a bare `9660` aimed at a money
 * column is now refused exactly as `$9,660.00` already was. That closes a hole
 * rather than opening one - a figure the engine is about to dress as money is a
 * money write, whatever decoration it arrived with.
 *
 * Untouched, in every case: text that is not a number, an identifier whose
 * leading zeros are part of what it says, a figure that already carries a
 * format, a value that does not fit the column's decimals, and any cell whose
 * column is not a column of formatted amounts.
 */
function renderCellTextInColumnFormat(
  op: EditOp,
  block: FlatBlock,
  byAnchor: Map<string, FlatBlock>
): { op: EditOp; rendered?: ColumnFormatRender } {
  if (op.op !== 'set_cell_text') return { op };
  const asSent = String(op.text ?? '');
  const classified = classifyNumericText(asSent);
  if (!classified.numeric || classified.quantity) return { op };
  if (isZeroPaddedInteger(asSent)) return { op };
  const parsed = parseNumericCell(asSent);
  if (!parsed) return { op };
  const resolved = resolveQuantityCellFormat(
    Array.from(byAnchor.values()),
    block
  );
  if (!resolved) return { op };
  let format = resolved.format;
  if (parsed.value.units < 0)
    format = upgradeNegativeStyle(format, resolved.inputs);
  const value = rescaleExact(parsed.value, format.decimals);
  if (!value) return { op };
  const written = renderNumericCell(value, format);
  if (written === asSent) return { op };
  return {
    op: { ...op, text: written },
    rendered: { asSent, written, formatSource: resolved.formatSource }
  };
}

// Applies one anchored op. `block` is the freshly-resolved block. Throws OpError
// on a recoverable failure (surfaced as {ok:false, error}).
function applyAnchoredOp(
  editor: LiveEditor,
  rawOp: EditOp,
  block: FlatBlock,
  byAnchor: Map<string, FlatBlock>
): OpSuccessExtras | void {
  // One re-render, before the no-op rule, the provenance gate and the handler,
  // so all three see the bytes that will actually land in the cell.
  const { op, rendered } = renderCellTextInColumnFormat(rawOp, block, byAnchor);
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
  const literalNumber = guardModelAuthoredNumber(op, block, byAnchor, rendered);

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

// ---------------------------------------------------------------------------
// Table appearance writes (set_cell_format / set_row_format /
// copy_table_format / restripe_table, and the insert_row banding preserve)
//
// SyncFusion authors NO revision for a cell fill, border or vertical alignment
// - its RevisionType is Insertion|Deletion|MoveTo|MoveFrom and nothing else, and
// a probe of a real DocumentEditor confirms the revision count does not move.
// So these writes are made reversible the only honest way available: every write
// first snapshots the appearance it is about to overwrite, and the executor binds
// those snapshots into the change set's revision group, so rejecting the card
// restores the appearance before it rejects the content. A change set that wrote
// only appearance has no card to bind to and reports that fact rather than
// implying a reviewable change exists.
// ---------------------------------------------------------------------------

const HEX_COLOR = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const CLEARED_COLORS = new Set(['none', 'empty', 'transparent', 'auto']);

/**
 * A model-supplied colour to the canonical form the READ reports, or null for
 * "no fill". Upper-cased so that copying a `#d9e2f3` source produces a target
 * whose read equals the source's read - without that, a copy is not idempotent.
 */
function normalizeShading(raw: unknown, field: string): string | null {
  const value = String(raw ?? '').trim();
  if (!value || CLEARED_COLORS.has(value.toLowerCase())) return null;
  const match = HEX_COLOR.exec(value);
  if (!match)
    throw new OpError(
      'invalid_color',
      `\`${field}\` must be a hex colour like "#D9E2F3", or "none" to clear the fill; received ${JSON.stringify(
        value
      )}.`
    );
  return `#${match[1].toUpperCase()}`;
}

/** The `applyBorders` calls that reproduce `borders`, or clear them when absent. */
function borderWritesFor(borders: AppearanceFacts['borders']): BorderWrite[] {
  const clear: BorderWrite = { type: 'NoBorder', style: 'None' };
  if (!borders) return [clear];
  const spec = (type: string, facts: BorderFacts): BorderWrite => ({
    type,
    style: facts.style,
    ...(facts.width != null ? { width: facts.width } : {}),
    ...(facts.color ? { color: facts.color } : {})
  });
  if (borders.all) return [spec('AllBorders', borders.all)];
  // Clear first: a side the source does not have must not survive on the target.
  const writes: BorderWrite[] = [clear];
  for (const side of BORDER_SIDES) {
    const facts = borders[side as BorderSide];
    if (facts)
      writes.push(
        spec(`${side[0].toUpperCase()}${side.slice(1)}Border`, facts)
      );
  }
  return writes;
}

/** The write that reproduces `facts` in full (used by copy and restore). */
function appearanceWriteFor(
  facts: AppearanceFacts | undefined,
  parts: { shading?: boolean; verticalAlignment?: boolean; borders?: boolean }
): AppearanceWrite {
  return {
    ...(parts.shading ? { shading: facts?.shading ?? null } : {}),
    ...(parts.verticalAlignment
      ? { verticalAlignment: facts?.verticalAlignment ?? 'Top' }
      : {}),
    ...(parts.borders ? { borders: borderWritesFor(facts?.borders) } : {})
  };
}

/** The inverse of `applied`, read from the appearance that was there before. */
function restoreWriteFor(
  before: AppearanceFacts | undefined,
  applied: AppearanceWrite
): AppearanceWrite {
  return appearanceWriteFor(before, {
    shading: applied.shading !== undefined,
    verticalAlignment: applied.verticalAlignment !== undefined,
    borders: applied.borders !== undefined
  });
}

const BORDER_TYPES = new Set([
  'AllBorders',
  'OutsideBorders',
  'LeftBorder',
  'RightBorder',
  'TopBorder',
  'BottomBorder',
  'NoBorder'
]);

type AppearanceOp =
  | TypedEditOp<'set_cell_format'>
  | TypedEditOp<'set_row_format'>;

/**
 * The write a `set_cell_format`/`set_row_format` op asks for. Refuses an op that
 * carries no appearance at all, for the same reason `set_char_format` does: a
 * styling op that silently succeeds having done nothing makes the assistant
 * report "Done." over an unchanged document.
 */
function appearanceWriteFromOp(op: AppearanceOp): AppearanceWrite {
  const shadingField = fmtField(op, 'shading');
  const verticalAlignment = fmtMeaningfulField(op, 'verticalAlignment');
  const borderType = fmtMeaningfulField(op, 'borders');
  const borderStyle = fmtMeaningfulField(op, 'borderStyle');
  const borderColor = fmtMeaningfulField(op, 'borderColor');
  const borderWidth = fmtMeaningfulField(op, 'borderWidth');
  const write: AppearanceWrite = {};
  if (shadingField != null && String(shadingField).trim())
    write.shading = normalizeShading(shadingField, 'shading');
  if (verticalAlignment) {
    const match = (['Top', 'Center', 'Bottom'] as const).find(
      (value) => value.toLowerCase() === String(verticalAlignment).toLowerCase()
    );
    if (!match)
      throw new OpError(
        'invalid_vertical_alignment',
        `\`verticalAlignment\` must be Top, Center or Bottom; received ${JSON.stringify(
          String(verticalAlignment)
        )}.`
      );
    write.verticalAlignment = match;
  }
  // A border colour/width/style with no `borders` type has nowhere to apply, so
  // default the type rather than dropping the request silently.
  if (borderType || borderStyle || borderColor || borderWidth != null) {
    const type = String(borderType ?? 'AllBorders');
    if (!BORDER_TYPES.has(type))
      throw new OpError(
        'invalid_border_type',
        `\`borders\` must be one of ${[...BORDER_TYPES].join(
          ', '
        )}; received ${JSON.stringify(type)}.`
      );
    const style =
      type === 'NoBorder' ? 'None' : String(borderStyle ?? 'Single');
    const width = Number(borderWidth);
    write.borders = [
      {
        type,
        style,
        ...(Number.isFinite(width) && width > 0 ? { width } : {}),
        ...(borderColor
          ? {
              color: normalizeShading(borderColor, 'borderColor') ?? '#000000'
            }
          : {})
      }
    ];
  }
  if (
    write.shading === undefined &&
    write.verticalAlignment === undefined &&
    write.borders === undefined
  )
    throw new OpError(
      'missing_format',
      `${op.op} needs at least one appearance field (shading / verticalAlignment / borders).`
    );
  return write;
}

/**
 * The same parse, but returning undefined instead of refusing when the op
 * carries no appearance - for `set_row_format`, where `isHeader` on its own is
 * already a complete request. Field-value errors still refuse.
 */
function tryAppearanceWriteFromOp(
  op: AppearanceOp
): AppearanceWrite | undefined {
  try {
    return appearanceWriteFromOp(op);
  } catch (err) {
    if (isOpError(err) && err.code === 'missing_format') return undefined;
    throw err;
  }
}

/** `"0;7;3;2;0"` -> `{ tableAnchor: "0;7", row: 3, column: 2 }`. */
function cellAnchorParts(
  anchor: string,
  opName: string
): { tableAnchor: string; row: number; column: number } {
  const parts = anchor.split(';');
  if (parts.length !== 5 || parts.some((part) => !/^\d+$/.test(part)))
    throw new OpError(
      'not_a_cell_anchor',
      `${opName} needs a table-cell anchor ("section;block;row;cell;paragraph", e.g. "0;7;2;1;0"); "${anchor}" is not one. Copy one from a table_facts read.`
    );
  return {
    tableAnchor: `${parts[0]};${parts[1]}`,
    row: Number(parts[2]),
    column: Number(parts[3])
  };
}

/** The table's appearance as it stands in the live editor right now. */
function liveTableAppearance(
  editor: LiveEditor,
  tableAnchor: string
): TableAppearance {
  const appearance = collectTableAppearance(
    tableBlockAt(serializeSfdt(editor), tableAnchor)
  );
  if (!appearance)
    throw new OpError(
      'table_not_found',
      `No table answers to the anchor "${tableAnchor}". Re-read the structure and use a current anchor.`
    );
  return appearance;
}

const cellAnchorOf = (tableAnchor: string, row: number, column: number) =>
  `${tableAnchor};${row};${column};0`;

// `extent`, not `scope`: the registry parity spec scans this file for
// `scope === '...'` to enumerate the inventory scopes, and a local named `scope`
// here would forge one.
function selectForAppearance(
  editor: LiveEditor,
  cellAnchor: string,
  extent: 'cell' | 'row'
): void {
  editor.selection.select(`${cellAnchor};0`, `${cellAnchor};0`);
  callSelection(editor, extent === 'row' ? 'selectRow' : 'selectCell');
}

/**
 * Apply one appearance write to the cell (or row) the anchor names. The
 * selection is re-established before each border call because `applyBorders`
 * operates on whatever is selected.
 */
function writeAppearance(
  editor: LiveEditor,
  cellAnchor: string,
  write: AppearanceWrite,
  extent: 'cell' | 'row'
): void {
  selectForAppearance(editor, cellAnchor, extent);
  const cellFormat = editor.selection?.cellFormat;
  if (!cellFormat)
    throw new OpError(
      'unsupported_op',
      'Cell formatting is unavailable on this editor.'
    );
  // SyncFusion's own spelling of "no fill" on the way in and out; see
  // tableAppearance.ts on why the read treats it as absent.
  if (write.shading !== undefined)
    cellFormat.background = write.shading ?? 'empty';
  if (write.verticalAlignment)
    cellFormat.verticalAlignment = write.verticalAlignment;
  for (const border of write.borders ?? []) {
    callEditor(editor, 'applyBorders', {
      type: border.type,
      borderStyle: border.style,
      ...(border.width != null ? { lineWidth: border.width } : {}),
      ...(border.color ? { borderColor: border.color } : {})
    });
    selectForAppearance(editor, cellAnchor, extent);
  }
}

const TABLE_BORDER_MEMBERS = [
  ['top', 'TopBorder'],
  ['bottom', 'BottomBorder'],
  ['left', 'LeftBorder'],
  ['right', 'RightBorder'],
  ['horizontal', 'InsideHorizontalBorder'],
  ['vertical', 'InsideVerticalBorder']
] as const;

function writeTableBorders(
  editor: LiveEditor,
  tableAnchor: string,
  borders: BorderWrite[]
): void {
  const cellAnchor = cellAnchorOf(tableAnchor, 0, 0);
  const selectTable = () => {
    selectForAppearance(editor, cellAnchor, 'cell');
    callSelection(editor, 'selectTable');
  };
  selectTable();
  for (const border of borders) {
    callEditor(editor, 'applyBorders', {
      type: border.type,
      borderStyle: border.style,
      ...(border.width != null ? { lineWidth: border.width } : {}),
      ...(border.color ? { borderColor: border.color } : {})
    });
    selectTable();
  }
}

/** Capture all six table border members before a table-level normalization. */
function liveTableBorderRestore(
  editor: LiveEditor,
  tableAnchor: string
): BorderWrite[] {
  selectForAppearance(editor, cellAnchorOf(tableAnchor, 0, 0), 'cell');
  const cell = (editor as any).selection?.start?.paragraph?.associatedCell;
  const table = cell?.ownerTable?.combineWidget?.((editor as any).viewer);
  const borders = table?.tableFormat?.borders;
  const writes: BorderWrite[] = [{ type: 'NoBorder', style: 'None' }];
  for (const [member, type] of TABLE_BORDER_MEMBERS) {
    const border = borders?.[member];
    const style = String(border?.lineStyle ?? 'None');
    if (!border?.isBorderDefined || style === 'None' || style === 'Cleared')
      continue;
    const width = Number(border.lineWidth);
    const color = String(border.color ?? '');
    writes.push({
      type,
      style,
      ...(Number.isFinite(width) && width > 0 ? { width } : {}),
      ...(color && color !== 'empty' ? { color } : {})
    });
  }
  return writes;
}

function tableBordersMatchAll(
  writes: BorderWrite[],
  expected: BorderFacts
): boolean {
  return TABLE_BORDER_MEMBERS.every(([, type]) => {
    const write = writes.find((entry) => entry.type === type);
    return (
      write?.style === expected.style &&
      (write.width ?? 0) === (expected.width ?? 0) &&
      (write.color ?? '#000000').toUpperCase() ===
        (expected.color ?? '#000000').toUpperCase()
    );
  });
}

function writeRowIsHeader(
  editor: LiveEditor,
  cellAnchor: string,
  isHeader: boolean
): void {
  selectForAppearance(editor, cellAnchor, 'row');
  const rowFormat = editor.selection?.rowFormat;
  if (!rowFormat)
    throw new OpError(
      'unsupported_op',
      'Row formatting is unavailable on this editor.'
    );
  rowFormat.isHeader = isHeader;
}

/** Put every recorded appearance back, newest first. */
function replayAppearanceRestores(
  editor: LiveEditor,
  restores: AppearanceRestore[]
): void {
  for (let index = restores.length - 1; index >= 0; index--) {
    const restore = restores[index];
    if (restore.tableBorders)
      writeTableBorders(
        editor,
        restore.cellAnchor.split(';').slice(0, 2).join(';'),
        restore.tableBorders
      );
    if (restore.rowIsHeader !== undefined)
      writeRowIsHeader(editor, restore.cellAnchor, restore.rowIsHeader);
    if (restore.write)
      writeAppearance(editor, restore.cellAnchor, restore.write, 'cell');
  }
}

/**
 * Appearance is not tracked by SyncFusion. Keep every helper that writes it
 * atomic by owning its inverse before the corresponding live write and
 * replaying the complete local journal when either a write or its verification
 * throws. Successful callers receive that same journal for later group reject.
 */
function runAppearanceTransaction<T>(
  editor: LiveEditor,
  work: (record: (restore: AppearanceRestore) => void) => T
): { result: T; restores: AppearanceRestore[] } {
  const restores: AppearanceRestore[] = [];
  try {
    return {
      result: work((restore) => restores.push(restore)),
      restores
    };
  } catch (error) {
    try {
      replayAppearanceRestores(editor, restores);
    } catch (rollbackError) {
      throw new OpError(
        'appearance_rollback_failed',
        'A table appearance write failed and its exact restore did not complete.',
        [
          `write failure: ${describeUnexpectedError(error)}`,
          `restore failure: ${describeUnexpectedError(rollbackError)}`
        ]
      );
    }
    throw error;
  }
}

const emptyAppearanceReport = (): AppearanceWriteReport => ({
  cellsWritten: 0,
  rowsWritten: 0,
  cellsUnchanged: 0
});

/**
 * Re-lay `banding` over the rows of one table, from `fromRow` down. Only writes
 * a row whose fill actually differs, and leaves a row whose own cells carry
 * DIFFERENT fills alone - a deliberate per-cell highlight is not a stripe error,
 * and the count of such rows is reported rather than quietly absorbed.
 */
function applyBandingRows(
  editor: LiveEditor,
  tableAnchor: string,
  current: TableAppearance,
  banding: TableBanding,
  fromRow: number
): AppearanceWriteOutcome {
  const report = emptyAppearanceReport();
  const shadings = rowShadings(current);
  const start = Math.max(fromRow, banding.headerRows);
  let skipped = 0;
  const transaction = runAppearanceTransaction(editor, (record) => {
    for (let row = start; row < current.rows.length; row++) {
      const wanted = bandedShadingForRow(banding, row);
      if (wanted === undefined) continue;
      if (shadings[row] === undefined) {
        skipped++;
        continue;
      }
      if (shadings[row] === wanted) continue;
      const cells = current.rows[row].cells;
      for (let column = 0; column < cells.length; column++) {
        const cellAnchor = cellAnchorOf(tableAnchor, row, column);
        const before = cellAppearanceAt(current, row, column);
        const write: AppearanceWrite = { shading: wanted };
        record({ cellAnchor, write: restoreWriteFor(before, write) });
        writeAppearance(editor, cellAnchor, write, 'cell');
        report.cellsWritten++;
      }
      report.rowsWritten++;
    }
  });
  report.banding = banding;
  if (skipped) report.rowsSkippedMixed = skipped;
  return { report, restores: transaction.restores };
}

/** Enforce only the inserted rows' resolved fallback fills. */
function applyPlannedRowShadings(
  editor: LiveEditor,
  tableAnchor: string,
  current: TableAppearance,
  planned: Array<{ row: number; shading: string | null }>
): AppearanceWriteOutcome {
  const report = emptyAppearanceReport();
  const transaction = runAppearanceTransaction(editor, (record) => {
    for (const { row, shading } of planned) {
      const cells = current.rows[row]?.cells ?? [];
      let rowTouched = false;
      for (let column = 0; column < cells.length; column++) {
        const before = cellAppearanceAt(current, row, column);
        if ((before?.shading ?? null) === shading) {
          report.cellsUnchanged++;
          continue;
        }
        const cellAnchor = cellAnchorOf(tableAnchor, row, column);
        const write: AppearanceWrite = { shading };
        record({ cellAnchor, write: restoreWriteFor(before, write) });
        writeAppearance(editor, cellAnchor, write, 'cell');
        report.cellsWritten++;
        rowTouched = true;
      }
      if (rowTouched) report.rowsWritten++;
    }
  });
  return { report, restores: transaction.restores };
}

function runCopyTableFormat(
  editor: LiveEditor,
  op: TypedEditOp<'copy_table_format'>,
  targetAnchor: string
): AppearanceWriteOutcome & { postWriteSfdt?: any } {
  const sourceAnchor = normalizeTableAnchor(op.sourceTable);
  if (!sourceAnchor)
    throw new OpError(
      'missing_source_table',
      'copy_table_format needs `sourceTable`: the table to copy the look FROM, as a table anchor ("0;7") or any of its cell anchors.'
    );
  if (sourceAnchor === targetAnchor)
    throw new OpError(
      'copy_source_is_target',
      `copy_table_format was given the same table ("${targetAnchor}") as both source and target.`
    );
  const sfdt = serializeSfdt(editor);
  const source = collectTableAppearance(tableBlockAt(sfdt, sourceAnchor));
  if (!source)
    throw new OpError(
      'source_table_not_found',
      `No table answers to the \`sourceTable\` anchor "${sourceAnchor}". Re-read the structure and name a table that exists.`
    );
  const target = collectTableAppearance(tableBlockAt(sfdt, targetAnchor));
  if (!target)
    throw new OpError(
      'table_not_found',
      `No table answers to the anchor "${targetAnchor}".`
    );
  // Source and target came from the same just-produced snapshot and nothing
  // has written yet, so carry the target forward instead of reserializing it.
  return applyCopiedTableAppearance(
    editor,
    sourceAnchor,
    source,
    targetAnchor,
    target
  );
}

/**
 * Copy a pre-resolved table look onto a live target. Automatic insert
 * inheritance and explicit `copy_table_format` meet here, so both use the same
 * cyclic row/column mapping and the same exact restore snapshots.
 */
function applyCopiedTableAppearance(
  editor: LiveEditor,
  sourceAnchor: string,
  source: TableAppearance,
  targetAnchor: string,
  resolvedTarget?: TableAppearance,
  options: { banding?: TableBanding } = {}
): AppearanceWriteOutcome & { postWriteSfdt?: any } {
  const target = resolvedTarget ?? liveTableAppearance(editor, targetAnchor);
  const banding = options.banding ?? detectTableBanding(source);
  const headerRows = banding?.headerRows ?? inferHeaderRows(source);
  const report = emptyAppearanceReport();
  if (source.styleName) report.sourceStyleName = source.styleName;
  if (banding) report.banding = banding;
  const desiredRows = target.rows.map((targetRow, row) =>
    targetRow.cells.map((_, column) =>
      copiedCellAppearance(source, banding, headerRows, row, column, {
        rows: target.rows.length,
        columns: targetRow.cells.length
      })
    )
  );
  const desiredBorders = desiredRows.flat().map((entry) => entry?.borders);
  const firstAllBorder = desiredBorders[0]?.all;
  const uniformAllBorder =
    !!firstAllBorder &&
    desiredBorders.length > 0 &&
    desiredBorders.every(
      (borders) =>
        !!borders?.all &&
        Object.keys(borders).length === 1 &&
        appearanceEquals(
          { borders: { all: firstAllBorder } },
          { borders: { all: borders.all } }
        )
    )
      ? firstAllBorder
      : undefined;
  const targetHasCellBorders = target.rows.some((row, rowIndex) =>
    row.cells.some(
      (_, column) => !!cellAppearanceAt(target, rowIndex, column)?.borders
    )
  );
  const tableBordersBefore = uniformAllBorder
    ? liveTableBorderRestore(editor, targetAnchor)
    : undefined;
  const tableAlreadyNormalized =
    !!uniformAllBorder &&
    !targetHasCellBorders &&
    !!tableBordersBefore &&
    tableBordersMatchAll(tableBordersBefore, uniformAllBorder);
  const normalizeTableBorders = !!uniformAllBorder && !tableAlreadyNormalized;
  const withoutBorders = (
    appearance: AppearanceFacts | undefined
  ): AppearanceFacts | undefined => {
    if (!appearance) return undefined;
    const rest = { ...appearance };
    delete rest.borders;
    return Object.keys(rest).length ? rest : undefined;
  };
  const transaction = runAppearanceTransaction(editor, (record) => {
    target.rows.forEach((targetRow, row) => {
      // The same mapping copiedCellAppearance uses, so the header flag and the
      // cell appearance can never be taken from two different source rows.
      const mapped = source.rows[sourceRowForTarget(source, headerRows, row)];
      let rowTouched = false;
      const wantsHeader = !!mapped?.isHeader;
      if (wantsHeader !== !!targetRow.isHeader && targetRow.cells.length) {
        const cellAnchor = cellAnchorOf(targetAnchor, row, 0);
        record({ cellAnchor, rowIsHeader: !!targetRow.isHeader });
        writeRowIsHeader(editor, cellAnchor, wantsHeader);
        rowTouched = true;
      }
      for (let column = 0; column < targetRow.cells.length; column++) {
        const desired = desiredRows[row][column];
        const before = cellAppearanceAt(target, row, column);
        const resolvedBefore = uniformAllBorder
          ? resolvedCellAppearanceAt(target, row, column)
          : before;
        const desiredCell = uniformAllBorder
          ? withoutBorders(desired)
          : desired;
        const beforeCell = uniformAllBorder
          ? withoutBorders(resolvedBefore)
          : resolvedBefore;
        const borderChanged =
          !!uniformAllBorder &&
          !appearanceEquals(
            { borders: resolvedBefore?.borders },
            { borders: { all: uniformAllBorder } }
          );
        const cellAnchor = cellAnchorOf(targetAnchor, row, column);
        if (normalizeTableBorders && before?.borders)
          record({
            cellAnchor,
            write: { borders: borderWritesFor(before.borders) }
          });
        if (appearanceEquals(desiredCell, beforeCell)) {
          if (borderChanged) {
            report.cellsWritten++;
            rowTouched = true;
          } else {
            report.cellsUnchanged++;
          }
          continue;
        }
        const write = appearanceWriteFor(desiredCell, {
          shading: true,
          verticalAlignment: true,
          borders: !uniformAllBorder
        });
        record({ cellAnchor, write: restoreWriteFor(before, write) });
        writeAppearance(editor, cellAnchor, write, 'cell');
        report.cellsWritten++;
        rowTouched = true;
      }
      if (rowTouched) report.rowsWritten++;
    });
    if (normalizeTableBorders && uniformAllBorder) {
      writeTableBorders(editor, targetAnchor, [
        {
          type: 'AllBorders',
          style: uniformAllBorder.style,
          ...(uniformAllBorder.width != null
            ? { width: uniformAllBorder.width }
            : {}),
          ...(uniformAllBorder.color ? { color: uniformAllBorder.color } : {})
        }
      ]);
      // Replay runs newest-first: restore the table border layer before putting
      // back any cell-level overrides that the normalized write cleared.
      record({
        cellAnchor: cellAnchorOf(targetAnchor, 0, 0),
        tableBorders: tableBordersBefore
      });
    }
    const postWriteSfdt = serializeSfdt(editor);
    const after = collectTableAppearance(
      tableBlockAt(postWriteSfdt, targetAnchor)
    );
    if (!after)
      throw new OpError(
        'table_not_found',
        `No table answers to the anchor "${targetAnchor}". Re-read the structure and use a current anchor.`
      );
    const mismatches: string[] = [];
    after.rows.forEach((row, rowIndex) => {
      const mapped =
        source.rows[sourceRowForTarget(source, headerRows, rowIndex)];
      if (!!row.isHeader !== !!mapped?.isHeader)
        mismatches.push(
          `row ${rowIndex} header: expected ${!!mapped?.isHeader}, got ${!!row.isHeader}`
        );
      for (let column = 0; column < row.cells.length; column++) {
        const expected = copiedCellAppearance(
          source,
          banding,
          headerRows,
          rowIndex,
          column,
          { rows: after.rows.length, columns: row.cells.length }
        );
        const actual = uniformAllBorder
          ? resolvedCellAppearanceAt(after, rowIndex, column)
          : cellAppearanceAt(after, rowIndex, column);
        if (!appearanceEquals(expected, actual))
          mismatches.push(
            `row ${rowIndex}, column ${column}: expected ${JSON.stringify(
              expected
            )}, got ${JSON.stringify(actual)}`
          );
      }
    });
    if (mismatches.length)
      throw new OpError(
        'inherited_appearance_mismatch',
        `Table appearance from ${sourceAnchor} did not resolve at ${targetAnchor}.`,
        mismatches
      );
    return postWriteSfdt;
  });
  return {
    report,
    restores: transaction.restores,
    postWriteSfdt: transaction.result
  };
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
// content is lost.
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

function commonPrefixLength(a: string, b: string): number {
  let at = 0;
  const comparable = Math.min(a.length, b.length);
  while (at < comparable && a[at] === b[at]) at++;
  return at;
}

function commonSuffixLength(a: string, b: string): number {
  let at = 0;
  const comparable = Math.min(a.length, b.length);
  while (at < comparable && a[a.length - 1 - at] === b[b.length - 1 - at]) at++;
  return at;
}

// A full-document projection would drown the model; report only the first
// divergence with enough surrounding context to identify the location.
function describeDivergence(
  lead: string,
  tail: string,
  expected: string,
  actual: string
): string[] {
  const start = commonPrefixLength(expected, actual);
  const from = Math.max(0, start - 60);
  const excerpt = (stream: string) =>
    JSON.stringify(stream.slice(from, start + 80));
  return [`${lead} ${excerpt(actual)} ${tail} ${excerpt(expected)}`];
}

function describeStreamDivergence(expected: string, actual: string): string[] {
  return describeDivergence(
    'after rejecting every revision the document would read',
    'where it previously read',
    expected,
    actual
  );
}

function describeAcceptDivergence(expected: string, actual: string): string[] {
  return describeDivergence(
    'after accepting every revision the document would read',
    'where this write should have made it read',
    expected,
    actual
  );
}

export const TRACKED_TEXT_OPS = new Set([
  'replace_text',
  'replace_selection',
  'delete_text',
  'delete_paragraph',
  'insert_text',
  // The composer expands to tracked insert_text/insert_table writes before
  // dispatch; membership keeps the registry-exhaustive content-op invariant
  // honest at the public operation boundary.
  'insert_section',
  'insert_table',
  'set_cell_text',
  'set_cell_formula',
  'set_column_formula',
  'change_case'
]);

// A structural table edit is content just as much as text is, so it carries the
// same requirement: SyncFusion must author a rejectable card of the right kind.
export const TRACKED_STRUCTURAL_OPS = new Map([
  ['insert_row', 'insertion'],
  ['delete_row', 'deletion']
]);

function deletionRevisionDetails(
  revisions: LiveRevision[],
  targetText?: string
): string[] {
  const destroyed = targetText
    ? [`text that would be destroyed: ${JSON.stringify(targetText)}`]
    : [];
  return [
    ...destroyed,
    ...revisions.map(
      (revision, index) =>
        `unexpected deletion revision ${index + 1}: ${
          revision.revisionID
            ? `revisionID ${JSON.stringify(revision.revisionID)}`
            : 'no revisionID'
        }`
    )
  ];
}

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
  priorRejectStream: string | undefined,
  postWriteSfdt: any,
  targetText?: string
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
  const unexpectedDeletions =
    op.op === 'insert_text'
      ? revisions.filter(
          (revision) =>
            String(revision.revisionType ?? '').toLowerCase() === 'deletion'
        )
      : [];
  if (unexpectedDeletions.length)
    throw new OpError(
      'insert_text_created_deletion',
      `insert_text at "${op.anchor}" created a Deletion revision, but no deletion was requested.`,
      deletionRevisionDetails(unexpectedDeletions, targetText)
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
    const nowRejectsTo = rejectProjectionStream(postWriteSfdt);
    if (nowRejectsTo !== priorRejectStream)
      throw new OpError(
        'untracked_write',
        `${op.op} changed text which rejecting the tracked revisions would not restore.`,
        describeStreamDivergence(priorRejectStream, nowRejectsTo)
      );
    return;
  }

  // The only writes left are the story ranges the projection genuinely cannot
  // see (footnote/endnote markers): they are absent from serialized SFDT, so the
  // projection above cannot be evaluated for them and they keep the
  // revision-type assertion, whose Deletion requirement is what proves such a
  // write struck its target. Text frames never reach here - their content IS
  // serialized, so they arrive with a prior reject stream - and page-specific
  // headers/footers never reach the write at all (`story_write_unverified`
  // refuses them at preflight).
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

// Revert only the exact cards recorded for one failed group; never touch
// unrelated human revisions (or a successful sibling group) and never use
// global history or rejectAll.
function rejectRevisions(revisions: LiveRevision[]): void {
  if (!revisions.length) return;
  if (revisions.some((revision) => typeof revision.reject !== 'function'))
    throw new OpError(
      'compensating_rollback_failed',
      'A failed edit group created a revision that could not be rejected.'
    );
  for (const revision of revisions) {
    // Never the public reject(): its adjacency cascade could reject
    // neighbouring revisions this change set never created.
    resolveSingleRevision(captureNativeResolvers(revision), false);
  }
}

// Durable accept-group tag, carried in revision customData: unlike the
// in-memory bindings, it round-trips through SFDT/DOCX.
const REVISION_GROUP_TAG_VERSION = 1;

export interface RevisionGroupTag {
  changeSetId: string;
  group: string;
  /** Exact inverse for untracked appearance coupled to this review group. */
  appearanceRestores?: AppearanceRestore[];
}

/** The accept group an op belongs to; ungrouped ops share the change set id. */
function opGroupId(op: EditOp, changeSetId: string): string {
  return typeof op.group === 'string' && op.group.trim()
    ? op.group.trim()
    : changeSetId;
}

function revisionGroupTag(
  changeSetId: string,
  group: string,
  appearanceRestores?: AppearanceRestore[]
): string {
  return JSON.stringify({
    v: REVISION_GROUP_TAG_VERSION,
    source: 'robin',
    changeSetId,
    group,
    ...(appearanceRestores?.length ? { appearanceRestores } : {})
  });
}

function parsePersistedBorderWrites(value: unknown): BorderWrite[] | null {
  if (!Array.isArray(value)) return null;
  const borders: BorderWrite[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const border = item as Record<string, unknown>;
    if (
      typeof border.type !== 'string' ||
      !BORDER_TYPES.has(border.type) ||
      typeof border.style !== 'string' ||
      !border.style
    )
      return null;
    if (
      border.width !== undefined &&
      (typeof border.width !== 'number' || !Number.isFinite(border.width))
    )
      return null;
    if (border.color !== undefined && typeof border.color !== 'string')
      return null;
    borders.push({
      type: border.type,
      style: border.style,
      ...(typeof border.width === 'number' ? { width: border.width } : {}),
      ...(typeof border.color === 'string' ? { color: border.color } : {})
    });
  }
  return borders;
}

function parsePersistedAppearanceWrite(value: unknown): AppearanceWrite | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const write: AppearanceWrite = {};
  if ('shading' in raw) {
    if (raw.shading !== null && typeof raw.shading !== 'string') return null;
    write.shading = raw.shading as string | null;
  }
  if ('verticalAlignment' in raw) {
    if (!['Top', 'Center', 'Bottom'].includes(String(raw.verticalAlignment)))
      return null;
    write.verticalAlignment = raw.verticalAlignment as
      | 'Top'
      | 'Center'
      | 'Bottom';
  }
  if ('borders' in raw) {
    const borders = parsePersistedBorderWrites(raw.borders);
    if (!borders) return null;
    write.borders = borders;
  }
  return write.shading !== undefined ||
    write.verticalAlignment !== undefined ||
    write.borders !== undefined
    ? write
    : null;
}

function parsePersistedAppearanceRestores(
  value: unknown
): AppearanceRestore[] | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  const restores: AppearanceRestore[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      return undefined;
    const raw = item as Record<string, unknown>;
    if (
      typeof raw.cellAnchor !== 'string' ||
      !/^\d+;\d+;\d+;\d+;\d+$/.test(raw.cellAnchor)
    )
      return undefined;
    if (raw.rowIsHeader !== undefined && typeof raw.rowIsHeader !== 'boolean')
      return undefined;
    const write =
      raw.write === undefined
        ? undefined
        : parsePersistedAppearanceWrite(raw.write);
    if (raw.write !== undefined && !write) return undefined;
    const tableBorders =
      raw.tableBorders === undefined
        ? undefined
        : parsePersistedBorderWrites(raw.tableBorders);
    if (raw.tableBorders !== undefined && !tableBorders?.length)
      return undefined;
    if (raw.rowIsHeader === undefined && !write && !tableBorders)
      return undefined;
    restores.push({
      cellAnchor: raw.cellAnchor,
      ...(typeof raw.rowIsHeader === 'boolean'
        ? { rowIsHeader: raw.rowIsHeader }
        : {}),
      ...(write ? { write } : {}),
      ...(tableBorders ? { tableBorders } : {})
    });
  }
  return restores;
}

export function parseRevisionGroupTag(
  customData: unknown
): RevisionGroupTag | undefined {
  if (typeof customData !== 'string' || !customData.trim()) return undefined;
  try {
    const parsed = JSON.parse(customData);
    if (
      parsed &&
      parsed.source === 'robin' &&
      typeof parsed.changeSetId === 'string' &&
      typeof parsed.group === 'string'
    ) {
      const appearanceRestores = parsePersistedAppearanceRestores(
        parsed.appearanceRestores
      );
      return {
        changeSetId: parsed.changeSetId,
        group: parsed.group,
        ...(appearanceRestores ? { appearanceRestores } : {})
      };
    }
  } catch {
    // Foreign customData (another producer's tag, or plain text) is not ours
    // to interpret; the revision simply stays outside assistant grouping.
  }
  return undefined;
}

// Resolve ONE revision without the adjacency cascade: public accept/reject
// resolve the pane's whole same-author/type neighbour card. The internal
// `handleAcceptReject` is feature-detected (fallback: public call); note it
// skips `beforeAcceptRejectChanges`.
function resolveSingleRevision(
  natives: {
    accept?: () => void;
    reject?: () => void;
    single?: (isAccept: boolean, isGroup: boolean) => void;
  },
  isAccept: boolean
): void {
  if (natives.single) {
    natives.single(isAccept, false);
    return;
  }
  const fn = isAccept ? natives.accept : natives.reject;
  if (fn) fn();
}

// Every revision created until the next stamp carries this op's group tag.
// Editors without `revisionSettings` (test fakes) skip tagging and fall back
// to change-set-wide grouping.
function stampRevisionGroup(
  editor: LiveEditor,
  changeSetId: string,
  op: EditOp
): void {
  const settings = editor.documentEditorSettings?.revisionSettings;
  if (!settings) return;
  settings.customData = revisionGroupTag(
    changeSetId,
    opGroupId(op, changeSetId)
  );
}

// SyncFusion coalesces adjacent same-author/same-type revisions into one
// object, silently folding a second group's content (and losing its tag)
// into the first — so gate the engine's merge predicates on the group tag.
// Untagged content normalizes to one empty key: native merge behavior.
const REVISION_ISOLATION_INSTALLED = '__robinRevisionGroupIsolation';

function revisionTagKey(customData: unknown): string {
  const tag = parseRevisionGroupTag(customData);
  return tag ? `${tag.changeSetId} ${tag.group}` : '';
}

export function installRevisionGroupIsolation(editor: LiveEditor): void {
  const mod: any = (editor as any).editorModule ?? editor.editor;
  if (!mod || typeof mod.isRevisionMatched !== 'function') return;
  if (mod[REVISION_ISOLATION_INSTALLED]) return;
  mod[REVISION_ISOLATION_INSTALLED] = true;

  // The tag new content would carry.
  const activeKey = () =>
    revisionTagKey(editor.documentEditorSettings?.revisionSettings?.customData);

  // "May this new tracked content extend `item`?" Unwrap element revisions so
  // the author/type check and the tag check apply to the same revision.
  const originalMatched = mod.isRevisionMatched.bind(mod);
  mod.isRevisionMatched = (item: any, type: any): boolean => {
    // Type-less calls are OWNERSHIP checks ("is this pending insertion my
    // own?" → remove outright, no Deletion layered) and must stay native:
    // tag-gating them leaves content rejecting cannot restore. Only the
    // typed combine/extend calls are group-scoped.
    if (type === undefined || type === null) return originalMatched(item, type);
    const revisions: any[] =
      item && typeof item.revisionLength === 'number'
        ? Array.from(
            { length: item.revisionLength },
            (_, i) => item.revisions?.[i]
          )
        : [item];
    const key = activeKey();
    return revisions.some(
      (rev) =>
        rev &&
        originalMatched(rev, type) &&
        revisionTagKey(rev.customData) === key
    );
  };

  // "May these two existing revisions merge?" (e.g. the content separating
  // them was removed). Only within one group.
  if (typeof mod.compareTwoRevisions === 'function') {
    const originalCompare = mod.compareTwoRevisions.bind(mod);
    mod.compareTwoRevisions = (a: any, b: any): boolean =>
      originalCompare(a, b) &&
      revisionTagKey(a?.customData) === revisionTagKey(b?.customData);
  }
}

function captureNativeResolvers(rev: LiveRevision) {
  return {
    accept: typeof rev.accept === 'function' ? rev.accept.bind(rev) : undefined,
    reject: typeof rev.reject === 'function' ? rev.reject.bind(rev) : undefined,
    single:
      typeof rev.handleAcceptReject === 'function'
        ? rev.handleAcceptReject.bind(rev)
        : undefined
  };
}

// Bulk revision resolution can leave SyncFusion's rendered widgets pointing at
// pre-resolution geometry even though its document model is already correct.
// Rebuild that derived layout once, after the batch/history boundary closes.
function invalidateDocumentLayout(editor: LiveEditor): void {
  withPreservedDocumentView(
    editor,
    () => {
      try {
        (editor as any).documentHelper?.layout?.layoutWholeDocument?.();
      } catch {
        // A renderer teardown must not turn a completed resolution into a failure.
      }
    },
    // The full layout pass needs Syncfusion's own scroll bookkeeping enabled;
    // the outer boundary restores the captured viewport after it completes.
    false
  );
}

// Bind a set of revisions authored by ONE logical edit group so per-card
// accept/reject is all-or-nothing within the group and NEVER wider. The first
// accept/reject on any member resolves the whole group with that single
// decision; later clicks on already-resolved members are no-ops. Each native
// handler is wrapped in try/catch so a stale-range throw on a later member
// cannot undo the first member's (safe) result. Single-revision groups are
// bound too: the wrapper is what routes around the pane's adjacency cascade.
//
// `onReject` is how a FORMATTING write joins the same decision. SyncFusion
// authors no revision for a cell fill or border (its RevisionType is
// Insertion|Deletion|MoveTo|MoveFrom, verified against the real SDK), so the
// appearance a change set overwrote cannot be a card of its own. Instead the
// executor hands the restore snapshots for THIS group in here: rejecting the
// group puts the appearance back FIRST - while the row indices it recorded are
// still valid, since rejecting a row insertion shifts every row below it - and
// then rejects the content. That is what makes "reject the card and the table
// looks exactly as it did" true for a batch that also restripes.
//
function groupRevisionsAtomic(
  editor: LiveEditor,
  group: LiveRevision[],
  changeSetId?: string,
  groupId?: string,
  onReject?: () => void
): void {
  if (!group.length) return;
  const members = group.map(captureNativeResolvers);
  const state = { resolved: false };
  // Members a reviewer resolved one-by-one (robinResolveSelf); a later group
  // decision must not resolve them a second time.
  const resolvedAlone = new Set<number>();
  const resolveAll = (isAccept: boolean) => {
    if (state.resolved) return;
    state.resolved = true;
    if (!isAccept && onReject) {
      // The single outermost boundary for the appearance restore: this runs
      // inside SyncFusion's own Changes-pane callback, and a throw here would
      // escape into the host UI and leave the group half-resolved. The content
      // rejects below either way.
      try {
        onReject();
      } catch {
        // Nothing to add: the cards still resolve consistently.
      }
    }
    for (let index = 0; index < members.length; index++) {
      if (resolvedAlone.has(index)) continue;
      try {
        resolveSingleRevision(members[index], isAccept);
      } catch {
        // A later member's range may be stale once the first resolved; the
        // group's outcome is already consistent, so swallow and move on.
      }
    }
    if (members.length > 1) invalidateDocumentLayout(editor);
  };
  group.forEach((rev, index) => {
    if (changeSetId) (rev as any).robinChangeSetId = changeSetId;
    if (groupId) (rev as any).robinGroupId = groupId;
    // Rebind guard: marks this revision's accept/reject as already wrapped so
    // a later rebind pass cannot stack wrappers.
    (rev as any).robinGroupBound = true;
    // The per-edit escape hatch: resolve THIS member alone through the native
    // single-revision path, leaving the rest of the group pending.
    (rev as any).robinResolveSelf = (isAccept: boolean) => {
      if (state.resolved || resolvedAlone.has(index)) return;
      resolvedAlone.add(index);
      resolveSingleRevision(members[index], isAccept);
    };
    // Only a fresh lookup from the editor's live collection may re-arm a
    // member. Undo can restore the same object while its closure still says
    // "resolved"; detached repeat calls must remain no-ops.
    (rev as any).robinReviveSelf = () => {
      state.resolved = false;
      resolvedAlone.delete(index);
    };
    rev.accept = () => resolveAll(true);
    rev.reject = () => resolveAll(false);
  });
}

/** Resolve ONE revision — not its accept group, no adjacency cascade.
 *  Group-bound revisions use the natives captured at bind time (their public
 *  accept/reject were rewired to whole-group resolution). */
export function resolveRevisionIndividually(
  revision: LiveRevision,
  isAccept: boolean
): void {
  const self = (revision as any).robinResolveSelf;
  if (typeof self === 'function') {
    self(isAccept);
    return;
  }
  resolveSingleRevision(captureNativeResolvers(revision), isAccept);
}

interface RevisionMemberIdentity {
  revisionID?: string;
  groupKey: string;
  author: string;
  original: LiveRevision;
}

function revisionMemberIdentity(
  revision: LiveRevision
): RevisionMemberIdentity {
  const revisionID = String(revision.revisionID ?? '').trim();
  return {
    ...(revisionID ? { revisionID } : {}),
    groupKey: revisionTagKey(revision.customData),
    author: String(revision.author ?? ''),
    original: revision
  };
}

function liveRevisionMember(
  editor: LiveEditor,
  identity: RevisionMemberIdentity
): LiveRevision | undefined {
  return snapshotRevisions(editor).find((revision) => {
    if (identity.revisionID)
      return (
        String(revision.revisionID ?? '') === identity.revisionID &&
        revisionTagKey(revision.customData) === identity.groupKey &&
        String(revision.author ?? '') === identity.author
      );
    return revision === identity.original;
  });
}

/**
 * Resolve several revisions as ONE undoable operation. Resolving them
 * one-by-one records one history entry each, so undo peels the unit apart —
 * e.g. undoing an accepted replace restores only its inserted half, which
 * then reads as a plain insertion. Wrap the batch in the engine's complex
 * history (the same mechanism its native Accept All uses) so a single undo
 * restores the whole unit.
 */
export function resolveRevisionsAsOneUndo(
  editor: LiveEditor,
  revisions: LiveRevision[],
  isAccept: boolean
): void {
  const identities = revisions.map(revisionMemberIdentity);
  const editorModule: any = (editor as any).editorModule ?? editor.editor;
  const history: any =
    (editor as any).editorHistoryModule ?? (editor as any).editorHistory;
  let complex = false;
  if (
    revisions.length > 1 &&
    typeof editorModule?.initComplexHistory === 'function'
  ) {
    try {
      editorModule.initComplexHistory(isAccept ? 'Accept All' : 'Reject All');
      complex = true;
    } catch {
      complex = false;
    }
  }
  try {
    // SyncFusion's own grouped accept/reject loop always resolves the last
    // live revision first. Structural insertions share mutable ranges; walking
    // them forwards can relocate later table rows across earlier headings when
    // the review group is accepted. Preserve the SDK's reverse-order contract.
    for (const identity of [...identities].reverse()) {
      const revision = liveRevisionMember(editor, identity);
      if (!revision) continue;
      // Undo may revive the same bridge-bound object. Its per-member closure
      // still remembers the earlier decision until the current live member is
      // explicitly re-armed.
      (revision as any).robinReviveSelf?.();
      try {
        resolveRevisionIndividually(revision, isAccept);
      } catch {
        // A stale member range must not stop the rest of the unit.
      }
    }
  } finally {
    if (complex) {
      try {
        history?.updateComplexHistory?.();
      } catch {
        // History bookkeeping must never break the resolution itself.
      }
    }
  }
  if (revisions.length > 1) invalidateDocumentLayout(editor);
}

export interface RevisionGroupIdentity {
  changeSetId: string;
  group: string;
  untagged?: boolean;
}

/**
 * Resolve review groups from the editor's CURRENT revision collection. Undo
 * can revive a revision as either a new JS object or the same bridge-bound
 * object whose in-memory "resolved" closure is already spent. The persisted
 * customData tag (or author for a human group) is the durable identity, so a
 * click must re-read that collection and re-arm each live revision's
 * single-revision binding rather than trusting a render-time object.
 */
export function resolveLiveRevisionGroupsAsOneUndo(
  editor: LiveEditor,
  groups: RevisionGroupIdentity[],
  isAccept: boolean
): LiveRevision[] {
  const tagged = new Set(
    groups
      .filter((group) => !group.untagged)
      .map((group) => `${group.changeSetId}\u0000${group.group}`)
  );
  const authors = new Set(
    groups.filter((group) => group.untagged).map((group) => group.group)
  );
  const matchesGroup = (revision: LiveRevision) => {
    const tag = parseRevisionGroupTag(revision.customData);
    return tag
      ? tagged.has(`${tag.changeSetId}\u0000${tag.group}`)
      : authors.has(String(revision.author ?? '').trim() || 'Unknown author');
  };
  const initial = snapshotRevisions(editor).filter(matchesGroup);
  const resolved: LiveRevision[] = [];
  const editorModule: any = (editor as any).editorModule ?? editor.editor;
  const history: any =
    (editor as any).editorHistoryModule ?? (editor as any).editorHistory;
  let complex = false;
  if (
    initial.length > 1 &&
    typeof editorModule?.initComplexHistory === 'function'
  ) {
    try {
      editorModule.initComplexHistory(isAccept ? 'Accept All' : 'Reject All');
      complex = true;
    } catch {
      complex = false;
    }
  }
  try {
    // Use the CURRENT collection every time, exactly like SyncFusion's native
    // grouped resolver (`revision[revision.length - 1]`). Accepting a table
    // revision can replace or merge neighbouring revision objects, so a fixed
    // snapshot leaves stale members behind and can reflow their rows over
    // earlier section content.
    let budget = Math.max(20, initial.length * 4);
    while (budget-- > 0) {
      const current = snapshotRevisions(editor).filter(matchesGroup);
      if (!current.length) break;
      const revision = current[current.length - 1];
      (revision as any).robinReviveSelf?.();
      resolved.push(revision);
      try {
        resolveRevisionIndividually(revision, isAccept);
      } catch {
        // Try the next live tail; the bounded budget prevents a stale range
        // from trapping the review rail in a resolution loop.
      }
    }
  } finally {
    if (complex) {
      try {
        history?.updateComplexHistory?.();
      } catch {
        // History bookkeeping must never break the resolution itself.
      }
    }
  }
  if (initial.length) invalidateDocumentLayout(editor);
  return resolved;
}

/** Result of binding one change set's created revisions into accept groups. */
interface RevisionGroupingReport {
  revisionCount: number;
  /** group id -> number of live revisions bound to it. */
  revisionsByGroup: Map<string, number>;
  /**
   * Groups whose appearance snapshots found a revision to bind to, so rejecting
   * their card restores the appearance as well as the content. A group that took
   * snapshots but produced no revision is absent here: its appearance is
   * untracked and already applied, which is what `formatTracking` reports.
   */
  appearanceGroups: Set<string>;
}

// Diff the revisions created by this change set (against a pre-batch snapshot),
// partition them by the group tag each revision carries in `customData`, and
// bind each partition atomically. Revisions with no readable tag (test fakes,
// editors without `revisionSettings`) fall back into the change-set-wide group.
//
// `restoresByGroup` carries the appearance snapshots each group's ops took.
// SyncFusion authors no revision for a fill or a border, so a group's snapshots
// ride along on that group's own card and nowhere else: rejecting one group must
// never put back appearance a different group wrote.
function groupNewRevisions(
  editor: LiveEditor,
  before: LiveRevision[],
  changeSetId: string,
  restoresByGroup?: Map<string, AppearanceRestore[]>
): RevisionGroupingReport {
  const created = createdRevisions(editor, before);
  const revisionsByGroup = new Map<string, number>();
  const appearanceGroups = new Set<string>();
  if (!created.length)
    return { revisionCount: 0, revisionsByGroup, appearanceGroups };
  const partitions = new Map<string, LiveRevision[]>();
  for (const rev of created) {
    const tag = parseRevisionGroupTag(rev.customData);
    const group =
      tag && tag.changeSetId === changeSetId ? tag.group : changeSetId;
    const partition = partitions.get(group);
    if (partition) partition.push(rev);
    else partitions.set(group, [rev]);
  }
  partitions.forEach((partition, group) => {
    const restores = restoresByGroup?.get(group);
    if (restores?.length) {
      // The live closures below disappear on reload; the same customData that
      // carries group identity therefore carries the exact appearance inverse.
      // SyncFusion removes the revision metadata when the group resolves and
      // revives it with the revision on undo.
      for (const revision of partition) {
        const tag = parseRevisionGroupTag(revision.customData);
        if (tag?.changeSetId === changeSetId && tag.group === group)
          revision.customData = revisionGroupTag(changeSetId, group, restores);
      }
    }
    const onReject =
      restores && restores.length
        ? () => replayAppearanceRestores(editor, restores)
        : undefined;
    if (onReject) appearanceGroups.add(group);
    groupRevisionsAtomic(editor, partition, changeSetId, group, onReject);
    revisionsByGroup.set(group, partition.length);
  });
  return { revisionCount: created.length, revisionsByGroup, appearanceGroups };
}

// changeSet.groups: ops declare the units, the post-write partition supplies
// the facts — a group whose writes all no-opped reports visibly empty.
function reportRevisionGroups(
  edits: EditOp[],
  changeSetId: string,
  revisionsByGroup: Map<string, number>,
  appearanceGroups: Set<string>
): Array<{
  id: string;
  opIndices: number[];
  revisionCount: number;
  restoresAppearance?: true;
}> {
  const opIndicesById = new Map<string, number[]>();
  edits.forEach((op, index) => {
    if (!op?.op) return;
    const id = opGroupId(op, changeSetId);
    const indices = opIndicesById.get(id);
    if (indices) indices.push(index);
    else opIndicesById.set(id, [index]);
  });
  // Untagged revisions land in the change-set-wide group; make sure it is
  // reported even when every op declared its own group.
  revisionsByGroup.forEach((_, id) => {
    if (!opIndicesById.has(id)) opIndicesById.set(id, []);
  });
  return [...opIndicesById.entries()].map(([id, opIndices]) => ({
    id,
    opIndices,
    revisionCount: revisionsByGroup.get(id) ?? 0,
    ...(appearanceGroups.has(id) ? { restoresAppearance: true as const } : {})
  }));
}

/** One tracked revision inside an accept group, shaped for review UI. */
export interface RevisionGroupItem {
  revision: LiveRevision;
  /** 'Insertion' | 'Deletion' | 'MoveTo' | 'MoveFrom' | 'Replace' | ''. */
  revisionType: string;
  /** Excerpt of the tracked content (Replace: the NEW text); empty for
   *  pure structure. */
  text: string;
  /** Replace only: the deleted (old) text for a `− old / + new` diff. */
  beforeText?: string;
  /** Replace only: the insertion half (`revision` holds the deletion) —
   *  one approval must resolve both. */
  partner?: LiveRevision;
  /** Who made the edit (the revision's author string). */
  author?: string;
}

/** One accept group with its live member revisions: an assistant-defined
 *  group (tagged), or one author's manual tracked edits (untagged). */
export interface RevisionGroupView {
  changeSetId: string;
  /** The assistant's group id, or the author name for untagged views. */
  group: string;
  /** True when this view aggregates one author's manual (untagged) edits. */
  untagged?: boolean;
  items: RevisionGroupItem[];
}

// The range's visible text: structural markers (paragraph marks, row
// formats) have no `.text` and contribute nothing.
function revisionRangeText(revision: LiveRevision): string {
  let range: any[];
  try {
    range = typeof revision.getRange === 'function' ? revision.getRange() : [];
  } catch {
    return '';
  }
  if (!Array.isArray(range)) return '';
  let out = '';
  for (const item of range) {
    if (typeof item?.text === 'string') out += item.text;
  }
  return out.trim();
}

/**
 * The tracked-change groups currently pending in the editor, in revision-
 * collection order, each with its live member revisions. Assistant edits use
 * their persisted accept-group tag; untagged human edits group by author.
 * This is the read model for the grouped review UI; resolving an assistant
 * group is just calling accept()/reject() on any member (the atomic binding
 * does the rest).
 */
// A tracked replace is a Deletion (old text) immediately followed in the
// document by an Insertion (new text): the deletion range's last element is
// linked directly to the insertion range's first. To a reviewer that is ONE
// edit, so the pair folds into one 'Replace' item.
function isReplacePair(
  deletion: LiveRevision,
  insertion: LiveRevision
): boolean {
  try {
    const delRange =
      typeof deletion.getRange === 'function' ? deletion.getRange() : [];
    const insRange =
      typeof insertion.getRange === 'function' ? insertion.getRange() : [];
    const last: any = delRange[delRange.length - 1];
    return !!last && !!insRange[0] && last.nextNode === insRange[0];
  } catch {
    return false;
  }
}

// Memo key for findReplaceCounterpart: null = computed, no counterpart.
const REPLACE_COUNTERPART_MEMO = '__robinReplaceCounterpart';

/** The other half of a tracked replace, from either side. Memoized on the
 *  revision objects — the halves are created together, so the linkage is
 *  stable for the revision's lifetime. */
export function findReplaceCounterpart(
  revision: LiveRevision
): LiveRevision | undefined {
  const memo = (revision as any)[REPLACE_COUNTERPART_MEMO];
  if (memo !== undefined) return memo ?? undefined;
  const counterpart = computeReplaceCounterpart(revision);
  (revision as any)[REPLACE_COUNTERPART_MEMO] = counterpart ?? null;
  if (counterpart) (counterpart as any)[REPLACE_COUNTERPART_MEMO] = revision;
  return counterpart;
}

// Two revisions form one replace when their group identity matches: the same
// assistant tag, or — for human (untagged) edits — the same author.
function sameEditUnit(a: LiveRevision, b: LiveRevision): boolean {
  const tagA = parseRevisionGroupTag(a.customData);
  const tagB = parseRevisionGroupTag(b.customData);
  if (tagA && tagB)
    return tagA.changeSetId === tagB.changeSetId && tagA.group === tagB.group;
  if (!tagA && !tagB) return String(a.author ?? '') === String(b.author ?? '');
  return false;
}

function computeReplaceCounterpart(
  revision: LiveRevision
): LiveRevision | undefined {
  const type = String(revision.revisionType ?? '');
  if (type !== 'Deletion' && type !== 'Insertion') return undefined;
  let range: any[];
  try {
    range = typeof revision.getRange === 'function' ? revision.getRange() : [];
  } catch {
    return undefined;
  }
  if (!Array.isArray(range) || !range.length) return undefined;
  // A deletion's replacement text follows it; an insertion's replaced text
  // precedes it.
  const neighbour: any =
    type === 'Deletion'
      ? range[range.length - 1]?.nextNode
      : range[0]?.previousNode;
  const count = neighbour?.revisionLength ?? 0;
  for (let i = 0; i < count; i++) {
    const other = neighbour.getRevision?.(i);
    if (!other) continue;
    const otherType = String(other.revisionType ?? '');
    if (otherType !== (type === 'Deletion' ? 'Insertion' : 'Deletion'))
      continue;
    if (!sameEditUnit(revision, other)) continue;
    const deletion = type === 'Deletion' ? revision : other;
    const insertion = type === 'Deletion' ? other : revision;
    if (isReplacePair(deletion, insertion)) return other;
  }
  return undefined;
}

/** Review-rail read model: pending revisions grouped by accept-group tag
 *  (human/untagged edits group by author), replace pairs folded to one item. */
export function listRevisionGroups(editor: LiveEditor): RevisionGroupView[] {
  const views = new Map<string, RevisionGroupView>();
  for (const revision of snapshotRevisions(editor)) {
    const tag = parseRevisionGroupTag(revision.customData);
    const author = String(revision.author ?? '').trim() || 'Unknown author';
    // Assistant edits group by their accept-group tag; human edits group by
    // who made them.
    const key = tag ? `${tag.changeSetId} ${tag.group}` : `author ${author}`;
    let view = views.get(key);
    if (!view) {
      view = tag
        ? { changeSetId: tag.changeSetId, group: tag.group, items: [] }
        : { changeSetId: '', group: author, untagged: true, items: [] };
      views.set(key, view);
    }
    const item: RevisionGroupItem = {
      revision,
      revisionType: String(revision.revisionType ?? ''),
      text: revisionRangeText(revision),
      author
    };
    const prev = view.items[view.items.length - 1];
    if (
      prev &&
      !prev.partner &&
      prev.revisionType === 'Deletion' &&
      item.revisionType === 'Insertion' &&
      isReplacePair(prev.revision, item.revision)
    ) {
      prev.partner = item.revision;
      prev.revisionType = 'Replace';
      prev.beforeText = prev.text;
      prev.text = item.text;
      continue;
    }
    view.items.push(item);
  }
  return [...views.values()];
}

/** Rebuild accept-group bindings from persisted customData tags — the
 *  in-memory wrappers die on save/reload, the tags don't. Idempotent
 *  (bound revisions are skipped). Returns how many revisions were bound. */
export function rebindRevisionGroups(editor: LiveEditor): number {
  const partitions = new Map<
    string,
    {
      changeSetId: string;
      group: string;
      revisions: LiveRevision[];
      restoreCandidates: AppearanceRestore[][];
    }
  >();
  for (const rev of snapshotRevisions(editor)) {
    if ((rev as any).robinGroupBound) continue;
    const tag = parseRevisionGroupTag(rev.customData);
    if (!tag) continue;
    const key = `${tag.changeSetId}\u0000${tag.group}`;
    const partition = partitions.get(key);
    if (partition) {
      partition.revisions.push(rev);
      if (tag.appearanceRestores)
        partition.restoreCandidates.push(tag.appearanceRestores);
    } else
      partitions.set(key, {
        changeSetId: tag.changeSetId,
        group: tag.group,
        revisions: [rev],
        restoreCandidates: tag.appearanceRestores
          ? [tag.appearanceRestores]
          : []
      });
  }
  let bound = 0;
  partitions.forEach((partition) => {
    const payloads = new Map(
      partition.restoreCandidates.map((restores) => [
        JSON.stringify(restores),
        restores
      ])
    );
    // Every revision written by us carries the same inverse. Refuse to guess
    // if foreign/corrupt metadata supplies conflicting payloads.
    const restores =
      payloads.size === 1 ? [...payloads.values()][0] : undefined;
    groupRevisionsAtomic(
      editor,
      partition.revisions,
      partition.changeSetId,
      partition.group,
      restores?.length
        ? () => replayAppearanceRestores(editor, restores)
        : undefined
    );
    bound += partition.revisions.length;
  });
  return bound;
}

// Ops that change how something LOOKS and never where anything IS. Membership
// buys three things: they cannot shift anchors, they run in phase 3 after every
// structural edit (so a restripe sees the table's final row indices), and a
// pre-existing target's formatting is snapshotted for the failure rollback.
const FORMAT_OPS = new Set([
  'apply_style',
  'clear_formatting',
  'set_char_format',
  'set_para_format',
  'indent_step',
  'apply_bullets',
  'apply_numbering',
  'clear_list',
  'set_cell_format',
  'set_row_format',
  'copy_table_format',
  'restripe_table'
]);

// The appearance ops whose anchor names a TABLE rather than one paragraph. A
// structure read reports a table as `"0;7"`, which is nothing's block anchor, so
// the preflight retargets it to the table's first cell before resolving it -
// naming the table the way the read names it must not be an error (see
// retargetTableScopedAnchor).
const TABLE_SCOPED_FORMAT_OPS = new Set([
  'copy_table_format',
  'restripe_table'
]);

// The appearance ops manage their own exact restores (see AppearanceRestore), so
// the generic character/paragraph-format snapshot the other FORMAT_OPS take is
// both useless to them and harmful: capturing and re-writing resolved character
// formats changes serialized bytes on a target the op never touched, which would
// leave a diff behind even after a REFUSED appearance op.
const TABLE_APPEARANCE_OPS = new Set([
  'set_cell_format',
  'set_row_format',
  'copy_table_format',
  'restripe_table'
]);

interface PlannedTableAppearanceInheritance {
  sourceTableAnchor: string;
  targetTableAnchor: string;
  source: TableAppearance;
  /** Absent means every row of a newly inserted table. */
  targetRows?: number[];
  /** A document-sampled data-row cycle for a newly inserted table. */
  banding?: TableBanding;
  /** The pre-insert stripe an inserted row must restore below itself. */
  preserveBanding?: { fromRow: number; banding: TableBanding };
  /** When no stripe resolves, the locally observed fill for each new row. */
  fallbackShadings?: Array<{ row: number; shading: string | null }>;
}

interface PlannedInsertInheritance {
  anchor: string;
  expectedText?: string;
  source?: FlatBlock;
  inherited?: { characterFormat?: FormatBag; paragraphFormat?: FormatBag };
  fallbackStyleName?: string;
  tableAppearance?: PlannedTableAppearanceInheritance;
  sectionBoundary?: {
    text: string;
    separator: SectionBoundaryElement[];
    beforeSeparator: SectionBoundaryElement[];
    afterSeparator: SectionBoundaryElement[];
    firstAnchor: string;
    lastAnchor: string;
    lastLength: number;
    afterAnchor?: string;
  };
}

interface ChangeSetPlan {
  index: number;
  op: EditOp;
  target?: FlatBlock | LiveStoryTarget;
  /** Preflight relocation, extended at write time if another structural op moves it again. */
  relocated?: { from: string; to: string };
  source?: FlatBlock;
  inherited?: { characterFormat?: FormatBag; paragraphFormat?: FormatBag };
  targetBefore?: { characterFormat?: FormatBag; paragraphFormat?: FormatBag };
  // A `set_cell_text` whose cell does not exist yet because an earlier op in the
  // same change set creates it. It has no preflight target by definition.
  deferredNewCell?: boolean;
  // An `insert_text` whose paragraph does not exist yet because an earlier break
  // in the same change set creates it. Same contract as deferredNewCell.
  deferredNewParagraph?: boolean;
  /** The one table address populated after this insert in request order. */
  expectedInsertedTableAnchor?: string;
  /**
   * The appearance and resolved text formats a structural insert inherits,
   * captured before any write can move the source blocks. The same plan type is
   * used by paragraph, table and row insertion so computed inheritance has one
   * guarded apply boundary.
   */
  insertInheritance?: PlannedInsertInheritance[];
}

// Table ops which bring new, empty cells into existence. `insert_row` does it
// without shifting table block indices; `insert_table` does shift body block
// indices, so only cell anchors under the exact inserted table anchor are
// allowed to defer to it.
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

function tableAnchorFromCellAnchor(anchor: unknown): string {
  const parts = String(anchor ?? '').split(';');
  if (parts.length < 5) return '';
  return parts.slice(0, -3).join(';');
}

/**
 * The top-level anchor at which an inserted table will be addressable.
 * Inserting at a body paragraph puts the table at that block index and pushes
 * the paragraph down. Inserting from a cell targets the first body block after
 * the containing table.
 */
function resultingInsertedTableAnchor(op: {
  anchor?: unknown;
  position?: unknown;
}): string {
  const parts = String(op.anchor ?? '').split(';');
  const after = String(op.position ?? '').toLowerCase() === 'after';
  if (parts.length === 2) {
    const block = Number(parts[1]);
    if (!Number.isInteger(block) || block < 0) return '';
    return `${parts[0]};${block + (after ? 1 : 0)}`;
  }
  if (parts.length < 5) return '';
  const block = Number(parts[1]);
  if (!Number.isInteger(block) || block < 0) return '';
  return `${parts[0]};${block + 1}`;
}

/**
 * Cell writes for a newly inserted table immediately follow that insert and
 * precede the next table insert. Their common table anchor is the caller's
 * planned address for the new grid after earlier structural siblings have
 * shifted the shared insertion boundary. The live executor still verifies
 * that the table actually appears at this address before any cell can write.
 */
function cellWriteTableAnchorsFollowingInsert(
  edits: EditOp[],
  insertIndex: number
): string[] {
  const group = edits[insertIndex]?.group;
  const anchors = new Set<string>();
  for (let index = insertIndex + 1; index < edits.length; index++) {
    const candidate = edits[index];
    if (candidate?.op === 'insert_table') break;
    if (candidate?.group !== group) continue;
    if (
      candidate?.op !== 'set_cell_text' &&
      candidate?.op !== 'set_cell_formula'
    )
      continue;
    const tableAnchor = tableAnchorFromCellAnchor(candidate.anchor);
    if (tableAnchor) anchors.add(tableAnchor);
  }
  return [...anchors];
}

function expectedInsertedTableAnchor(
  edits: EditOp[],
  insertIndex: number
): string | undefined {
  const anchors = cellWriteTableAnchorsFollowingInsert(edits, insertIndex);
  return anchors.length === 1 ? anchors[0] : undefined;
}

function assertInsertedTableIsAddressable(
  op: EditOp,
  byAnchor: Map<string, FlatBlock>,
  expectedAnchor?: string
): void {
  if (op.op !== 'insert_table') return;
  const resultingAnchor = resultingInsertedTableAnchor(op);
  if (expectedAnchor && resultingAnchor !== expectedAnchor)
    throw new OpError(
      'inserted_table_anchor_mismatch',
      `insert_table created a table at "${resultingAnchor}", but its following cell writes target "${expectedAnchor}". Nothing was written.`,
      [
        `actual resulting table anchor: ${resultingAnchor}`,
        `planned cell-write table anchor: ${expectedAnchor}`
      ]
    );
  if (resultingAnchor && byAnchor.has(`${resultingAnchor};0;0;0`)) return;
  throw new OpError(
    'inserted_table_not_addressable',
    `insert_table at "${op.anchor}" did not create a distinct table at "${resultingAnchor}". Adjacent tables can coalesce instead of creating a new addressable block. Choose an anchor separated from the existing table by a paragraph, then target the new cells under "${resultingAnchor};row;column;0". Nothing was written.`,
    [
      `requested insert anchor: ${op.anchor}`,
      `expected resulting table anchor: ${resultingAnchor}`
    ]
  );
}

function tableCreatedByEarlierInsert(edits: EditOp[], index: number): boolean {
  const tableAnchor = tableAnchorFromCellAnchor(edits[index]?.anchor);
  return (
    !!tableAnchor &&
    edits.some(
      (earlier, earlierIndex) =>
        earlierIndex < index &&
        earlier?.op === 'insert_table' &&
        expectedInsertedTableAnchor(edits, earlierIndex) === tableAnchor
    )
  );
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

/**
 * A table-scoped appearance op whose anchor names the TABLE (`"0;7"`, the way a
 * structure read reports it) is retargeted to that table's first cell
 * paragraph, which is a real block. These ops act on the whole table, so any of
 * its cell anchors identifies the same work - which also makes a stale row index
 * harmless rather than a refusal.
 */
function retargetTableScopedAnchor(
  op: EditOp,
  byAnchor: Map<string, FlatBlock>
): EditOp {
  if (!op?.op || !TABLE_SCOPED_FORMAT_OPS.has(op.op)) return op;
  const anchor = String(op.anchor ?? '');
  if (!anchor || byAnchor.has(anchor)) return op;
  const tableAnchor = normalizeTableAnchor(anchor);
  if (!tableAnchor) return op;
  const firstCell = `${tableAnchor};0;0;0`;
  return byAnchor.has(firstCell) ? { ...op, anchor: firstCell } : op;
}

/**
 * Split a handler's success extras into the model-facing half and the
 * engine-internal appearance restores, which are collected rather than returned.
 */
function collectOpExtras(
  extras: OpSuccessExtras | void,
  record: (restores: AppearanceRestore[]) => void
): Partial<EditResult> {
  if (!extras) return {};
  const appearanceWrite = extras.appearanceWrite;
  const rest = { ...extras };
  delete rest.appearanceWrite;
  delete rest.postWriteSfdt;
  if (appearanceWrite) record(appearanceWrite.restores);
  return {
    ...rest,
    ...(appearanceWrite ? { appearance: appearanceWrite.report } : {})
  };
}

function userStatedFigureKey(write: LiteralNumberWrite): string | null {
  const parsed = parseNumericCell(write.rendered?.asSent ?? write.text);
  if (!parsed) return null;
  let { units, scale } = parsed.value;
  while (scale > 0 && units % 10 === 0) {
    units /= 10;
    scale--;
  }
  return `${units}:${scale}`;
}

/**
 * A user-stated figure is a one-cell licence within a change set. Successful
 * writes already carry the common-boundary audit record, so enforce the batch
 * invariant over those records instead of re-interpreting model-authored ops.
 */
function refuseReusedUserStatedFigures(
  results: Array<EditResult | undefined>
): void {
  const firstUse = new Map<string, { anchor: string; text: string }>();
  results.forEach((result, index) => {
    if (!result?.ok) return;
    const write = result.literalNumber;
    if (!write || write.source !== 'user_stated') return;
    const key = userStatedFigureKey(write);
    if (!key) return;
    const anchor = result.anchor ?? '(unknown cell)';
    const first = firstUse.get(key);
    if (!first) {
      firstUse.set(key, { anchor, text: write.rendered?.asSent ?? write.text });
      return;
    }
    if (first.anchor === anchor) return;
    results[index] = {
      ...result,
      ok: false,
      error: 'user_stated_figure_reused',
      message:
        `The user-stated figure ${JSON.stringify(
          first.text
        )} already licenses cell "${
          first.anchor
        }" and cannot also license cell "${anchor}" in the same change set. ` +
        `If "${anchor}" depends on the first cell, derive it with set_cell_formula. Otherwise ask the user which cell the figure belongs in. Nothing was written.`,
      details: [
        `first literal cell: ${first.anchor}`,
        `reused literal cell: ${anchor}`
      ]
    };
  });
}

function mayShiftAnchors(op: EditOp): boolean {
  // A selection replacement can swallow paragraph marks, so treat it as always
  // shifting: the anchors after it must be re-resolved, never reused.
  if (op.op === 'replace_selection') return true;
  if (op.op === 'insert_text')
    return /[\r\n]/.test(insertionText(op as TypedEditOp<'insert_text'>));
  if (op.op === 'replace_text' || op.op === 'set_cell_text')
    return /[\r\n]/.test(String(op.replace ?? op.text ?? op.newText ?? ''));
  return !FORMAT_OPS.has(op.op) && !ANCHORLESS_OPS.has(op.op);
}

type RelocationAttempt =
  | { target: FlatBlock; relocated: { from: string; to: string } }
  | { details: string[] };

function sameRelocationContainer(from: string, to: string): boolean {
  const source = String(from).split(';');
  const target = String(to).split(';');
  const sourceIsCell = source.length >= 5;
  const targetIsCell = target.length >= 5;
  if (sourceIsCell || targetIsCell)
    return (
      sourceIsCell &&
      targetIsCell &&
      source.slice(0, 4).join(';') === target.slice(0, 4).join(';')
    );
  // Body sections are one story/container. A section break changes page
  // geometry, not the tracked text range's editing container.
  return source.length === 2 && target.length === 2;
}

function relocationIdentity(
  op: EditOp,
  captured?: FlatBlock
):
  | { label: '`expect`'; text: string; matches: (block: FlatBlock) => boolean }
  | { label: '`find`'; text: string; matches: (block: FlatBlock) => boolean }
  | {
      label: 'captured pre-write block text';
      text: string;
      matches: (block: FlatBlock) => boolean;
    }
  | undefined {
  if (op.expect != null) {
    const text = String(op.expect);
    return {
      label: '`expect`',
      text,
      matches: (block) => expectTextMatches(text, block.text)
    };
  }
  if (op.find != null && String(op.find).length) {
    const text = String(op.find);
    return {
      label: '`find`',
      text,
      matches: (block) => block.text.includes(text)
    };
  }
  if (captured) {
    return {
      label: 'captured pre-write block text',
      text: captured.text,
      matches: (block) =>
        block.kind === captured.kind && block.text === captured.text
    };
  }
  return undefined;
}

function attemptAnchorRelocation(
  blocks: FlatBlock[],
  op: EditOp,
  captured?: FlatBlock
): RelocationAttempt {
  const from = String(op.anchor ?? '');
  const identity = relocationIdentity(op, captured);
  if (!identity)
    return {
      details: [
        `relocation attempted from: ${from}`,
        'content identity unavailable: supply `expect` or `find` so the moved target can be identified'
      ]
    };
  const matches = blocks.filter(identity.matches);
  const attempted = `relocation attempted from "${from}" using ${
    identity.label
  } ${JSON.stringify(identity.text)}`;
  if (!matches.length) return { details: [attempted, 'matching blocks: none'] };
  if (matches.length > 1)
    return {
      details: [
        attempted,
        `matching blocks (${matches.length}): ${matches
          .map((match) => match.anchor)
          .join(', ')}`
      ]
    };
  const target = matches[0];
  // Never relocate across containers silently. In particular, an exact text
  // match in a different table/cell is a refusal, not a guess; tracked changes
  // make a same-container relocation reversible, but cannot make a wrong-cell
  // target semantically safe.
  if (!sameRelocationContainer(from, target.anchor))
    return {
      details: [
        attempted,
        `the only match is at "${target.anchor}", in a different table/cell container; relocation refused`
      ]
    };
  return { target, relocated: { from, to: target.anchor } };
}

function retargetOpToBlock(op: EditOp, target: FlatBlock): EditOp {
  const from = String(op.anchor ?? '');
  const next: EditOp = { ...op, anchor: target.anchor };
  for (const field of ['startOffset', 'endOffset'] as const) {
    const value = offsetString(op[field]);
    if (!value || anchorFromOffset(value) !== from) continue;
    const suffix = value.slice(from.length);
    next[field] = `${target.anchor}${suffix}`;
  }
  return next;
}

function resolveChangeSetBlock(
  blocks: FlatBlock[],
  anchor: string,
  baseline: FlatBlock | undefined,
  anchorsMayHaveShifted: boolean,
  preferEquivalentDirect = false
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
  // Inheritance sources are read-only appearance donors. If the exact anchor
  // still exposes the same block snapshot, copying from it is deterministic
  // even when an unrelated structural edit elsewhere made other anchors move.
  // Mutation targets do not use this carve-out: their logical occurrence must
  // still be relocated conservatively.
  if (
    preferEquivalentDirect &&
    direct &&
    direct.kind === baseline.kind &&
    direct.text === baseline.text &&
    JSON.stringify(direct.format ?? {}) ===
      JSON.stringify(baseline.format ?? {}) &&
    JSON.stringify(direct.characterFormat ?? {}) ===
      JSON.stringify(baseline.characterFormat ?? {}) &&
    JSON.stringify(direct.paragraphFormat ?? {}) ===
      JSON.stringify(baseline.paragraphFormat ?? {})
  )
    return direct;
  const matches = blocks.filter(
    (block) => block.kind === baseline.kind && block.text === baseline.text
  );
  if (matches.length === 1) {
    const match = matches[0];
    // Content identity is strong enough to recover a moved paragraph, but it
    // is never permission to jump into a different table cell. A cell is a
    // hard editing container in SyncFusion; crossing one silently could put a
    // perfectly spelled value in the wrong row/table, so that guess is refused.
    if (!sameRelocationContainer(anchor, match.anchor))
      throw new OpError(
        'anchor_relocation_container_mismatch',
        `Anchor "${anchor}" now matches content at "${match.anchor}", but that location is in a different table/cell container. Refusing to guess.`,
        [
          `relocation attempted from: ${anchor}`,
          `matching content found at: ${match.anchor}`
        ]
      );
    return match;
  }
  if (!matches.length)
    throw new OpError(
      'anchor_relocation_not_found',
      `Anchor "${anchor}" moved after a structural edit and its preflight text no longer identifies one block.`,
      [`relocation attempted from: ${anchor}`, 'matching blocks: none']
    );
  throw new OpError(
    'anchor_relocation_ambiguous',
    `Anchor "${anchor}" moved after a structural edit and matches ${matches.length} blocks; refusing a non-deterministic write.`,
    [
      `relocation attempted from: ${anchor}`,
      `matching blocks: ${matches.map((match) => match.anchor).join(', ')}`
    ]
  );
}

function resolveSectionBoundary(
  blocks: FlatBlock[],
  anchor: string,
  baseline: FlatBlock | LiveStoryTarget | undefined
): FlatBlock {
  const target = blocks.find((block) => block.anchor === anchor);
  if (!target)
    throw new OpError(
      'section_boundary_topology_mismatch',
      `The section insertion boundary planned at "${anchor}" no longer exists.`,
      [`planned boundary: ${anchor}`]
    );
  if (
    baseline &&
    !isLiveStoryTarget(baseline) &&
    (target.kind !== baseline.kind || target.text !== baseline.text)
  )
    throw new OpError(
      'section_boundary_topology_mismatch',
      `The section insertion boundary planned at "${anchor}" no longer names the captured block.`,
      [
        `captured kind/text: ${baseline.kind} ${JSON.stringify(baseline.text)}`,
        `live kind/text: ${target.kind} ${JSON.stringify(target.text)}`
      ]
    );
  return target;
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
// Computed format inheritance for inserted paragraphs, rows and tables
// ---------------------------------------------------------------------------
//
// SyncFusion formats an insertion from its insertion POINT, so a section added
// through the common anchoring - an empty separator paragraph - comes out as
// plain Normal/Calibri regardless of what the surrounding document looks like.
// The recipe that fixed this (a second change set carrying `inheritFormatFrom`)
// is a step the model can skip, so the engine now computes the reference
// itself: every paragraph an insert CREATES inherits the visible format of the
// nearest preceding non-empty block in its own container, per paragraph role.
// Mid-text inserts and writes into pre-existing cells are untouched -
// SyncFusion's own inheritance is correct there. Writes into cells a structural
// op just created use that op's preflight column-format plan.

// One target the insert brings into existence. Paragraph targets carry the
// resolved source snapshot that will format them. A table target carries the
// appearance snapshot copied through the existing table-appearance machinery.
// `fallbackStyleName` marks the no-reference paragraph case: the paragraph is
// set to the document default style instead of wearing whatever format the
// split donor happened to carry (e.g. a heading's).
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

function tableAnchorsInSection(sfdt: any, sectionIndex: number): string[] {
  const sections: any[] = pick(sfdt, 'sections', 'sec') ?? [];
  const section = sections[sectionIndex];
  if (!section) return [];
  return getBlocks(section).flatMap((block, blockIndex) =>
    getRows(block) ? [`${sectionIndex};${blockIndex}`] : []
  );
}

/**
 * The table a new table structurally follows. A cell anchor names its
 * containing table directly. For a body insertion, an adjacent table is the
 * true sibling; when a spacer/heading sits between them, the nearest table in
 * the same SFDT section is the deterministic fallback requested by the
 * inheritance contract. Ties prefer the preceding table.
 */
function sourceTableForInsert(
  sfdt: any,
  op: EditOp,
  explicitSource?: FlatBlock
): { anchor: string; appearance: TableAppearance } | undefined {
  if (explicitSource?.kind === 'table_cell') {
    const anchor = tableAnchorFromCellAnchor(explicitSource.anchor);
    const appearance = collectTableAppearance(tableBlockAt(sfdt, anchor));
    if (appearance) return { anchor, appearance };
  }
  const requested = String(op.anchor ?? '').split(';');
  const section = Number(requested[0]);
  const block = Number(requested[1]);
  if (!Number.isInteger(section) || !Number.isInteger(block)) return undefined;
  if (requested.length >= 5) {
    const anchor = `${section};${block}`;
    const appearance = collectTableAppearance(tableBlockAt(sfdt, anchor));
    if (appearance) return { anchor, appearance };
  }
  const anchors = tableAnchorsInSection(sfdt, section);
  const adjacent = anchors.filter((anchor) => {
    const candidate = Number(anchor.split(';')[1]);
    return Math.abs(candidate - block) === 1;
  });
  const candidates = adjacent.length ? adjacent : anchors;
  candidates.sort((left, right) => {
    const leftBlock = Number(left.split(';')[1]);
    const rightBlock = Number(right.split(';')[1]);
    const distance = Math.abs(leftBlock - block) - Math.abs(rightBlock - block);
    return distance || leftBlock - rightBlock;
  });
  const anchor = candidates[0];
  if (!anchor) return undefined;
  const appearance = collectTableAppearance(tableBlockAt(sfdt, anchor));
  return appearance ? { anchor, appearance } : undefined;
}

function planTableCellFormats(
  editor: LiveEditor,
  blocks: FlatBlock[],
  sourceTableAnchor: string,
  sourceAppearance: TableAppearance,
  targetTableAnchor: string,
  targetRows: number[],
  targetColumns: number,
  options: { sourceRows?: number[]; headerRows?: number } = {}
): PlannedInsertInheritance[] {
  const headerRows = options.headerRows ?? inferHeaderRows(sourceAppearance);
  const byAnchor = new Map(
    blocks.map((block) => [block.anchor, block] as const)
  );
  const inheritedBySource = new Map<
    string,
    { characterFormat?: FormatBag; paragraphFormat?: FormatBag }
  >();
  const planned: PlannedInsertInheritance[] = [];
  for (const [rowIndex, targetRow] of targetRows.entries()) {
    const sourceRow =
      options.sourceRows?.[rowIndex] ??
      sourceRowForTarget(sourceAppearance, headerRows, targetRow);
    const sourceColumns = sourceAppearance.rows[sourceRow]?.cells.length ?? 0;
    if (!sourceColumns) continue;
    for (let targetColumn = 0; targetColumn < targetColumns; targetColumn++) {
      const sourceColumn = Math.min(targetColumn, sourceColumns - 1);
      const sourceAnchor = `${sourceTableAnchor};${sourceRow};${sourceColumn};0`;
      const source = byAnchor.get(sourceAnchor);
      if (!source) continue;
      let inherited = inheritedBySource.get(sourceAnchor);
      if (!inherited) {
        inherited = readEffectiveSourceFormat(editor, source);
        inheritedBySource.set(sourceAnchor, inherited);
      }
      planned.push({
        anchor: `${targetTableAnchor};${targetRow};${targetColumn};0`,
        expectedText: '',
        source,
        inherited
      });
    }
  }
  return planned;
}

/**
 * A row insert's typography comes from the row at its new position (the row it
 * displaces), or the last existing row when appended. Unlike whole-table copy,
 * it must not cycle: on a two-row table whose visual header lacks `isHeader`,
 * cycling an appended target wraps to row zero and turns body text white.
 */
function sourceRowsForInsertedRows(
  source: TableAppearance,
  targetRows: number[]
): number[] {
  const lastRow = source.rows.length - 1;
  return targetRows.map((targetRow) => Math.min(targetRow, lastRow));
}

/**
 * Strict detection deliberately needs corroboration before automatic
 * restriping. A visual header plus exactly two differently filled data rows is
 * the small-table exception: those two neighbours state the next alternating
 * fill unambiguously, even though neither band can occur twice yet.
 */
function shortInsertBanding(source: TableAppearance): TableBanding | null {
  const headerRows = inferHeaderRows(source);
  const body = rowShadings(source).slice(headerRows);
  if (headerRows === 0 || body.length !== 2) return null;
  const [first, second] = body;
  if (first === undefined || second === undefined || first === second)
    return null;
  return { headerRows, period: 2, cycle: [first, second] };
}

interface DocumentBandingCandidate {
  banding: TableBanding;
  dataRows: number;
}

/** Proven data-row cycles from the document's existing tables. */
function documentBandingCandidates(
  sfdt: any,
  targetTableAnchor: string
): DocumentBandingCandidate[] {
  const sections: any[] = pick(sfdt, 'sections', 'sec') ?? [];
  const candidates: DocumentBandingCandidate[] = [];
  sections.forEach((section, sectionIndex) => {
    getBlocks(section).forEach((block, blockIndex) => {
      const anchor = `${sectionIndex};${blockIndex}`;
      if (anchor === targetTableAnchor || !getRows(block)) return;
      const appearance = collectTableAppearance(block);
      const banding = appearance ? detectTableBanding(appearance) : null;
      if (appearance && banding)
        candidates.push({
          banding,
          dataRows: appearance.rows.length - banding.headerRows
        });
    });
  });
  return candidates;
}

/**
 * A new table has no body rows of its own to establish a cycle. Use the
 * longest existing table that proves one: its larger body is the strongest
 * document-local sample, and detectTableBanding has already excluded its
 * leading header rows from the returned cycle.
 */
function documentTableBanding(
  sfdt: any,
  targetTableAnchor: string
): TableBanding | null {
  return (
    documentBandingCandidates(sfdt, targetTableAnchor).sort(
      (left, right) => right.dataRows - left.dataRows
    )[0]?.banding ?? null
  );
}

/**
 * Resolve a two-colour document convention for a table with only one data row.
 * The recurring-section read already establishes document table banding with
 * `detectTableBanding`; row insertion reuses the same evidence across sibling
 * tables when its target is too short to prove a stripe by itself.
 *
 * The target's observed data fill fixes the cycle phase, and the inserted row
 * takes the OTHER member. If no sibling proves an alternating pair containing
 * that fill, this declines and the caller keeps the same local fill instead.
 */
function documentInsertBanding(
  sfdt: any,
  targetTableAnchor: string,
  source: TableAppearance
): TableBanding | null {
  const candidates = documentBandingCandidates(sfdt, targetTableAnchor)
    .map((candidate) => candidate.banding)
    .filter(
      (banding) =>
        banding.period === 2 &&
        banding.cycle[0] !== banding.cycle[1] &&
        source.rows.length === banding.headerRows + 1
    );
  if (!candidates.length) return null;

  const shadings = rowShadings(source);
  const matching = candidates.filter((banding) =>
    banding.cycle.includes(shadings[banding.headerRows] ?? null)
  );
  const selected = modal(matching, (banding) =>
    JSON.stringify(
      [...banding.cycle].sort((left, right) =>
        String(left).localeCompare(String(right))
      )
    )
  )?.value;
  if (!selected) return null;

  const first = shadings[selected.headerRows];
  if (first === undefined) return null;
  const other = selected.cycle.find((shading) => shading !== first);
  if (other === undefined) return null;
  return { headerRows: selected.headerRows, period: 2, cycle: [first, other] };
}

function planTableInsertInheritance(
  editor: LiveEditor,
  op: EditOp,
  blocks: FlatBlock[],
  sfdt: any,
  explicitSource?: FlatBlock
): PlannedInsertInheritance[] | undefined {
  const targetTableAnchor = resultingInsertedTableAnchor(op);
  if (!targetTableAnchor) return undefined;
  const sourceTable = sourceTableForInsert(sfdt, op, explicitSource);
  if (!sourceTable) return undefined;
  const rows = positiveCount(op.rows);
  const columns = positiveCount(op.columns);
  const targetRows = Array.from({ length: rows }, (_, index) => index);
  // An explicit source is the composer's same-family/same-ordinal table. Its
  // own proven stripe outranks an unrelated document-wide table; fall back to
  // the existing document sample only when that sibling is too short to prove
  // a cycle by itself.
  const banding =
    (explicitSource ? detectTableBanding(sourceTable.appearance) : null) ??
    documentTableBanding(sfdt, targetTableAnchor);
  return [
    {
      anchor: targetTableAnchor,
      tableAppearance: {
        sourceTableAnchor: sourceTable.anchor,
        targetTableAnchor,
        source: sourceTable.appearance,
        ...(banding ? { banding } : {})
      }
    },
    ...planTableCellFormats(
      editor,
      blocks,
      sourceTable.anchor,
      sourceTable.appearance,
      targetTableAnchor,
      targetRows,
      columns,
      { headerRows: banding?.headerRows }
    )
  ];
}

function planRowInsertInheritance(
  editor: LiveEditor,
  op: EditOp,
  blocks: FlatBlock[],
  sfdt: any
): PlannedInsertInheritance[] | undefined {
  const parts = String(op.anchor ?? '').split(';');
  if (parts.length !== 5) return undefined;
  const row = Number(parts[2]);
  if (!Number.isInteger(row) || row < 0) return undefined;
  const tableAnchor = `${parts[0]};${parts[1]}`;
  const source = collectTableAppearance(tableBlockAt(sfdt, tableAnchor));
  if (!source || !source.rows.length) return undefined;
  const count = positiveCount(op.count);
  const firstRow = op.above === true ? row : row + 1;
  const targetRows = Array.from(
    { length: count },
    (_, index) => firstRow + index
  );
  const sourceRows = sourceRowsForInsertedRows(source, targetRows);
  const columns = Math.max(...source.rows.map((entry) => entry.cells.length));
  const formats = planTableCellFormats(
    editor,
    blocks,
    tableAnchor,
    source,
    tableAnchor,
    targetRows,
    columns,
    { sourceRows }
  );
  // `preserveBanding: false` is the explicit request for SyncFusion's raw row
  // appearance. Typography still inherits, but no fill/border/header write is
  // added by the engine.
  if (op.preserveBanding === false) return formats.length ? formats : undefined;
  // Strict: this fires without being asked, so a table with one highlighted row
  // must not be mistaken for a stripe.
  const banding =
    detectTableBanding(source, { strict: true }) ??
    shortInsertBanding(source) ??
    documentInsertBanding(sfdt, tableAnchor, source);
  const shadings = rowShadings(source);
  const fallbackShadings = banding
    ? undefined
    : targetRows.flatMap((targetRow, index) => {
        const shading = shadings[sourceRows[index]];
        return shading === undefined ? [] : [{ row: targetRow, shading }];
      });
  return [
    {
      anchor: tableAnchor,
      tableAppearance: {
        sourceTableAnchor: tableAnchor,
        targetTableAnchor: tableAnchor,
        source,
        targetRows,
        ...(banding
          ? { preserveBanding: { fromRow: firstRow, banding } }
          : fallbackShadings?.length
          ? { fallbackShadings }
          : {})
      }
    },
    ...formats
  ];
}

function rebasePlannedInsertInheritance(
  planned: PlannedInsertInheritance[] | undefined,
  requestedOp: EditOp,
  writtenOp: EditOp
): PlannedInsertInheritance[] | undefined {
  if (!planned || requestedOp.anchor === writtenOp.anchor) return planned;
  const oldTableAnchor =
    requestedOp.op === 'insert_table'
      ? resultingInsertedTableAnchor(requestedOp)
      : tableAnchorFromCellAnchor(requestedOp.anchor);
  const newTableAnchor =
    writtenOp.op === 'insert_table'
      ? resultingInsertedTableAnchor(writtenOp)
      : tableAnchorFromCellAnchor(writtenOp.anchor);
  if (!oldTableAnchor || !newTableAnchor || oldTableAnchor === newTableAnchor)
    return planned;
  const rebaseAnchor = (anchor: string) =>
    anchor === oldTableAnchor || anchor.startsWith(`${oldTableAnchor};`)
      ? `${newTableAnchor}${anchor.slice(oldTableAnchor.length)}`
      : anchor;
  return planned.map((entry) => ({
    ...entry,
    anchor: rebaseAnchor(entry.anchor),
    ...(entry.tableAppearance
      ? {
          tableAppearance: {
            ...entry.tableAppearance,
            targetTableAnchor: rebaseAnchor(
              entry.tableAppearance.targetTableAnchor
            )
          }
        }
      : {})
  }));
}

function sectionTextCore(text: string): string | undefined {
  const lines = text.split(/\r\n|\r|\n/);
  const content = (line: string) => line.replace(/\f/g, '').trim().length > 0;
  const first = lines.findIndex(content);
  let last = lines.length - 1;
  while (last >= first && !content(lines[last])) last--;
  if (first < 0 || last <= first) return undefined;
  const core = lines.slice(first, last + 1).join('\n');
  return segmentLooksLikeHeading(core.split('\n'), 0) ? core : undefined;
}

function planSectionBoundaryInheritance(
  target: FlatBlock,
  blocks: FlatBlock[],
  text: string,
  offset: number
): PlannedInsertInheritance['sectionBoundary'] | undefined {
  if (target.kind === 'table_cell') return undefined;
  const core = sectionTextCore(text);
  if (!core) return undefined;
  const level = chooseSectionLevel(blocks, target.anchor);
  if (level === undefined) return undefined;
  const sampledUnits = sampleSectionUnits(
    unitsAtLevel(blocks, level),
    target.anchor
  );
  const sampledSequences = sampledUnits.map((unit) =>
    sequenceForUnit(unit).slice(0, SECTION_PATTERN_SEQUENCE_LIMIT)
  );
  const family = selectSectionFamily(
    blocks,
    sampledUnits,
    sampledSequences,
    target.anchor
  );
  if (family.units.length < 2) return undefined;
  const observed = sectionBoundaryPattern(blocks, family.units).separator;
  if (observed.confidence.level === 'low') return undefined;

  const hasLeadingText = target.text.slice(0, offset).length > 0;
  const hasTrailingText = target.text.slice(offset).length > 0;
  const normalized = `${hasLeadingText ? '\n' : ''}${core}${
    hasTrailingText ? '\n' : ''
  }`;
  const segments = normalized.split('\n');
  const firstContent = segments.findIndex((segment) => segment.trim());
  let lastContent = segments.length - 1;
  while (lastContent >= 0 && !segments[lastContent].trim()) lastContent--;
  const anchorParts = target.anchor.split(';');
  const blockIndexBase = Number(anchorParts.pop());
  const targetIndex = blocks.findIndex(
    (block) => block.anchor === target.anchor
  );
  if (
    firstContent < 0 ||
    lastContent < firstContent ||
    targetIndex < 0 ||
    !Number.isInteger(blockIndexBase)
  )
    return undefined;
  const anchorAt = (index: number) =>
    [...anchorParts, blockIndexBase + index].join(';');
  const previousSeparator: SectionBoundaryElement[] = [];
  for (let index = targetIndex - 1; index >= 0; index--) {
    const element = boundaryElement(blocks[index]);
    if (!element) break;
    previousSeparator.unshift(element);
  }
  const followingSeparator: SectionBoundaryElement[] = [];
  for (let index = targetIndex + 1; index < blocks.length; index++) {
    const element = boundaryElement(blocks[index]);
    if (!element) break;
    followingSeparator.push(element);
  }
  const prefixMissing = (
    desired: SectionBoundaryElement[],
    existing: SectionBoundaryElement[]
  ) =>
    JSON.stringify(desired.slice(0, existing.length)) ===
    JSON.stringify(existing)
      ? desired.slice(existing.length)
      : desired;
  const suffixMissing = (
    desired: SectionBoundaryElement[],
    existing: SectionBoundaryElement[]
  ) =>
    JSON.stringify(desired.slice(desired.length - existing.length)) ===
    JSON.stringify(existing)
      ? desired.slice(0, desired.length - existing.length)
      : desired;
  const beforeSeparator = hasLeadingText
    ? observed.value
    : prefixMissing(observed.value, previousSeparator);
  const afterSeparator = hasTrailingText
    ? observed.value
    : suffixMissing(observed.value, followingSeparator);
  const nextBlock = blocks[targetIndex + 1];
  const afterAnchor = hasTrailingText
    ? anchorAt(segments.length - 1)
    : nextBlock?.anchor.split(';').length === 2
    ? anchorAt(segments.length)
    : undefined;
  if (!observed.value.length && normalized === text) return undefined;
  return {
    text: normalized,
    separator: observed.value,
    beforeSeparator,
    afterSeparator,
    firstAnchor: anchorAt(firstContent),
    lastAnchor: anchorAt(lastContent),
    lastLength: segments[lastContent].replace(/\t/g, '').length,
    ...(afterAnchor ? { afterAnchor } : {})
  };
}

// Decide, BEFORE the insert runs, which created paragraphs will need a format
// and from which reference. `explicit` carries a model-chosen source (an
// `inheritFormatFrom` on the insert op itself), which replaces the computed
// reference for every created paragraph. Returns undefined when the insert
// creates no paragraphs - SyncFusion's insertion-point inheritance is correct
// for mid-text inserts (and for cell text), so the default must not interfere.
function planInsertInheritance(
  editor: LiveEditor,
  op: EditOp,
  target: FlatBlock,
  blocks: FlatBlock[],
  sfdt: any,
  explicit?: {
    source: FlatBlock;
    inherited?: { characterFormat?: FormatBag; paragraphFormat?: FormatBag };
  }
): PlannedInsertInheritance[] | undefined {
  if (op.op === 'insert_table')
    return planTableInsertInheritance(
      editor,
      op,
      blocks,
      sfdt,
      explicit?.source
    );
  if (op.op === 'insert_row')
    return planRowInsertInheritance(editor, op, blocks, sfdt);
  if (op.op !== 'insert_text') return undefined;
  if (isLiveStoryAnchor(target.anchor)) return undefined;
  let text = insertionText(op as TypedEditOp<'insert_text'>);
  if (!text) return undefined;
  const offset = insertionPoint(op as TypedEditOp<'insert_text'>, target);
  const boundary = op.__suppressSectionBoundary
    ? undefined
    : planSectionBoundaryInheritance(target, blocks, text, offset);
  if (boundary) text = boundary.text;
  const segments = text.split(/\r\n|\r|\n/);
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

  const planned: PlannedInsertInheritance[] = boundary
    ? [{ anchor: target.anchor, sectionBoundary: boundary }]
    : [];
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
): AppearanceWriteOutcome | undefined {
  const appearanceOutcomes: AppearanceWriteOutcome[] = [];
  const transaction = runAppearanceTransaction(editor, (record) => {
    for (const paragraph of planned) {
      if (paragraph.sectionBoundary) continue;
      if (paragraph.tableAppearance) {
        const appearance = paragraph.tableAppearance;
        // A new table has no appearance of its own, so reproduce the whole
        // sibling look. SyncFusion already clones an inserted row's non-banding
        // cell appearance; rewriting its borders while the row is a pending
        // insertion loses shared-edge borders in the real SDK, so the row path
        // only restores the preflight stripe below.
        if (!appearance.targetRows) {
          const outcome = applyCopiedTableAppearance(
            editor,
            appearance.sourceTableAnchor,
            appearance.source,
            appearance.targetTableAnchor,
            undefined,
            { banding: appearance.banding }
          );
          appearanceOutcomes.push(outcome);
          outcome.restores.forEach(record);
        }
        if (appearance.preserveBanding) {
          const outcome = applyBandingRows(
            editor,
            appearance.targetTableAnchor,
            liveTableAppearance(editor, appearance.targetTableAnchor),
            appearance.preserveBanding.banding,
            appearance.preserveBanding.fromRow
          );
          appearanceOutcomes.push(outcome);
          outcome.restores.forEach(record);
        }
        if (appearance.fallbackShadings) {
          const fallback = applyPlannedRowShadings(
            editor,
            appearance.targetTableAnchor,
            liveTableAppearance(editor, appearance.targetTableAnchor),
            appearance.fallbackShadings
          );
          if (fallback.report.cellsWritten) {
            appearanceOutcomes.push(fallback);
            fallback.restores.forEach(record);
          }
        }
        continue;
      }
      const target = byAnchor.get(paragraph.anchor);
      if (
        !target ||
        (paragraph.expectedText !== undefined &&
          target.text !== paragraph.expectedText)
      ) {
        // Lightweight test doubles do not split paragraphs on newline inserts;
        // a mounted DocumentEditor always does. Skip quietly for doubles, fail
        // loudly when the real editor's split did not land where computed.
        if (!(editor as any).element && !(editor as any).documentHelper)
          continue;
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
    return appearanceOutcomes.reduce<AppearanceWriteReport>(
      (combined, outcome) => ({
        cellsWritten: combined.cellsWritten + outcome.report.cellsWritten,
        rowsWritten: combined.rowsWritten + outcome.report.rowsWritten,
        cellsUnchanged: combined.cellsUnchanged + outcome.report.cellsUnchanged,
        ...((combined.rowsSkippedMixed ?? 0) +
          (outcome.report.rowsSkippedMixed ?? 0) >
        0
          ? {
              rowsSkippedMixed:
                (combined.rowsSkippedMixed ?? 0) +
                (outcome.report.rowsSkippedMixed ?? 0)
            }
          : {}),
        ...(outcome.report.banding
          ? { banding: outcome.report.banding }
          : combined.banding
          ? { banding: combined.banding }
          : {}),
        ...(outcome.report.sourceStyleName
          ? { sourceStyleName: outcome.report.sourceStyleName }
          : combined.sourceStyleName
          ? { sourceStyleName: combined.sourceStyleName }
          : {})
      }),
      emptyAppearanceReport()
    );
  });
  if (!transaction.restores.length) return undefined;
  return {
    report: transaction.result,
    restores: transaction.restores
  };
}

function shiftBodyBlockAnchor(anchor: string, amount: number): string {
  const parts = anchor.split(';');
  const index = Number(parts[1]);
  return parts.length === 2 && Number.isInteger(index)
    ? `${parts[0]};${index + amount}`
    : anchor;
}

function insertSectionSeparatorBeforeAnchor(
  editor: LiveEditor,
  anchor: string,
  separator: SectionBoundaryElement[]
): string {
  let targetAnchor = anchor;
  for (const [index, element] of separator.entries()) {
    selectRange(editor, targetAnchor, 0, 0);
    editor.editor.insertText('\n');
    if (element === 'page_break') {
      selectRange(editor, targetAnchor, 0, 0);
      editor.editor.insertText('\f');
    }
    targetAnchor = shiftBodyBlockAnchor(anchor, index + 1);
  }
  return targetAnchor;
}

function shiftPlannedBodyAnchor(
  anchor: string,
  firstAnchor: string,
  lastAnchor: string,
  amount: number
): string {
  const parts = anchor.split(';');
  const first = firstAnchor.split(';');
  const last = lastAnchor.split(';');
  if (
    parts.length !== 2 ||
    first.length !== 2 ||
    last.length !== 2 ||
    parts[0] !== first[0] ||
    parts[0] !== last[0]
  )
    return anchor;
  const index = Number(parts[1]);
  const firstIndex = Number(first[1]);
  const lastIndex = Number(last[1]);
  return Number.isInteger(index) && index >= firstIndex && index <= lastIndex
    ? `${parts[0]};${index + amount}`
    : anchor;
}

function applySectionBoundaryInheritance(
  editor: LiveEditor,
  planned: PlannedInsertInheritance[]
): PlannedInsertInheritance[] {
  const boundary = planned.find(
    (entry) => entry.sectionBoundary
  )?.sectionBoundary;
  if (!boundary || !boundary.separator.length) return planned;

  if (boundary.afterAnchor && boundary.afterSeparator.length) {
    insertSectionSeparatorBeforeAnchor(
      editor,
      boundary.afterAnchor,
      boundary.afterSeparator
    );
  } else if (boundary.afterSeparator.length) {
    let anchor = boundary.lastAnchor;
    let offset = boundary.lastLength;
    for (const element of boundary.afterSeparator) {
      selectRange(editor, anchor, offset, offset);
      editor.editor.insertText('\n');
      anchor = shiftBodyBlockAnchor(anchor, 1);
      offset = 0;
      if (element === 'page_break') {
        selectRange(editor, anchor, 0, 0);
        editor.editor.insertText('\f');
        offset = 1;
      }
    }
  }

  if (!boundary.beforeSeparator.length) return planned;
  insertSectionSeparatorBeforeAnchor(
    editor,
    boundary.firstAnchor,
    boundary.beforeSeparator
  );
  const shift = boundary.beforeSeparator.length;
  return planned.map((entry) =>
    entry.sectionBoundary
      ? entry
      : {
          ...entry,
          anchor: shiftPlannedBodyAnchor(
            entry.anchor,
            boundary.firstAnchor,
            boundary.lastAnchor,
            shift
          )
        }
  );
}

// ---------------------------------------------------------------------------
// Batch-level integrity: what is only visible when the whole change set is read
// at once, checked before anything is written.
//
// Two things live here, and both exist because they are invisible one op at a
// time:
//
//   1. TWO TOTALS OVER THE SAME TABLE THAT SPAN DIFFERENT ROWS. Each op is
//      individually perfect, together one of them is wrong by construction,
//      and nothing except a cross-op check can see it.
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
  if (op.op !== 'set_cell_text') return false;
  const text = String(op.text ?? '');
  // A figure sent as "just the value" is still an amount when the op declares
  // it as one - the column, not this batch-level read, supplies the currency
  // symbol it will land with, so the decoration cannot be the whole test.
  return (
    isQuantityText(text) ||
    (declaresNumberProvenance(op) && classifyNumericText(text).numeric)
  );
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

function detectEmptyInsertedTables(edits: EditOp[]): BatchRefusal | null {
  const emptyTables: Array<{
    index: number;
    anchor: string;
    size: string;
    resultingAnchor?: string;
    mismatchedCellWriteAnchors?: string[];
  }> = [];
  edits.forEach((op, index) => {
    if (op?.op !== 'insert_table') return;
    const anchor = String(op.anchor ?? '');
    if (Array.isArray(op.initialCells)) {
      const rows = positiveCount(op.rows);
      const columns = positiveCount(op.columns);
      const validShape =
        op.initialCells.length === rows &&
        op.initialCells.every(
          (row: unknown) =>
            Array.isArray(row) &&
            row.length === columns &&
            row.every((cell) => typeof cell === 'string')
        );
      if (!validShape) {
        emptyTables.push({
          index,
          anchor,
          size: `${rows}x${columns}`,
          mismatchedCellWriteAnchors: ['invalid initialCells dimensions']
        });
        return;
      }
      if (
        op.initialCells.some((row: string[]) =>
          row.some((cell: string) => cell.trim().length > 0)
        )
      )
        return;
    }
    const resultingAnchor = resultingInsertedTableAnchor(op);
    const followingCellWriteAnchors = cellWriteTableAnchorsFollowingInsert(
      edits,
      index
    );
    if (followingCellWriteAnchors.length === 1) return;
    const mismatchedCellWriteAnchors =
      followingCellWriteAnchors.length > 1
        ? followingCellWriteAnchors
        : undefined;
    emptyTables.push({
      index,
      anchor,
      size: `${positiveCount(op.rows)}x${positiveCount(op.columns)}`,
      ...(mismatchedCellWriteAnchors?.length
        ? { resultingAnchor, mismatchedCellWriteAnchors }
        : {})
    });
  });
  if (!emptyTables.length) return null;
  const first = emptyTables[0];
  if (
    first.mismatchedCellWriteAnchors?.[0] === 'invalid initialCells dimensions'
  ) {
    return {
      code: 'insert_table_initial_cells_invalid',
      message: `insert_table at "${first.anchor}" declares a ${first.size} table, but initialCells does not have exactly that many string rows and columns. Nothing was written.`,
      details: [`expected initialCells shape: ${first.size}`],
      indices: [first.index]
    };
  }
  if (first.mismatchedCellWriteAnchors?.length) {
    return {
      code: 'insert_table_cell_anchor_mismatch',
      message:
        `insert_table at "${first.anchor}" would create the table at "${
          first.resultingAnchor
        }", but this change set writes cells under ${first.mismatchedCellWriteAnchors
          .map((anchor) => `"${anchor}"`)
          .join(', ')}. ` +
        `Retarget those writes to "${first.resultingAnchor};row;column;0", or choose an insert anchor whose resulting table address matches them. Nothing was written.`,
      details: [
        `resulting table anchor: ${first.resultingAnchor}`,
        ...first.mismatchedCellWriteAnchors.map(
          (anchor) => `cell writes target table: ${anchor}`
        )
      ],
      indices: [first.index]
    };
  }
  return {
    code: 'empty_insert_table',
    message:
      `insert_table at "${first.anchor}" would create an empty ${first.size} table with no cell writes in this change set. ` +
      'Empty grids in client proposals are refused; include set_cell_text writes for the new table or do not insert it.',
    details: emptyTables.map(
      (table) => `empty table: ${table.size} at ${table.anchor}`
    ),
    indices: emptyTables.map((table) => table.index)
  };
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

// ---------------------------------------------------------------------------
// Deterministic section composer
// ---------------------------------------------------------------------------
//
// Robin supplies semantic content and structure; this compiler supplies the
// mechanics the model cannot make reliable by emitting a longer primitive-op
// recipe. Every compiled write still crosses the existing CAS, tracked-write,
// inheritance, appearance, verification and group-rollback boundaries below.

interface ComposerTextItem {
  text: string;
  label: string;
  source?: FlatBlock;
  finalAnchor?: string;
}

type ComposerUnit =
  | { kind: 'text'; items: ComposerTextItem[]; label: string }
  | {
      kind: 'separator';
      elements: SectionBoundaryElement[];
      label: string;
    }
  | {
      kind: 'table';
      table: SectionComposerBlock & { role: 'table' };
      blockIndex: number;
      ordinal: number;
      source?: FlatBlock;
      label: string;
    };

interface CompiledSectionEdit {
  edit: EditOp;
  label: string;
}

interface SectionExpansionEntry {
  originalIndex: number;
  original: EditOp;
  start: number;
  count: number;
  labels: string[];
  section: boolean;
  contentBlocks: number;
  tables: number;
}

interface SectionExpansion {
  edits: EditOp[];
  entries: SectionExpansionEntry[];
  expandedToOriginal: number[];
  changed: boolean;
}

function sectionSpecError(
  code: string,
  label: string,
  message: string,
  details?: string[]
): never {
  throw new OpError(
    code,
    `insert_section ${label}: ${message} Nothing was written.`,
    details
  );
}

function sectionText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim())
    sectionSpecError('invalid_section_text', label, 'needs non-empty text.');
  if (/\r|\n/.test(value))
    sectionSpecError(
      'invalid_section_text',
      label,
      'must describe one paragraph. Split multi-paragraph content into separate semantic blocks.'
    );
  return value;
}

function validatedSectionSpec(value: unknown): SectionComposerSpec {
  if (!value || typeof value !== 'object')
    sectionSpecError(
      'invalid_section_spec',
      'sectionSpec',
      'must be an object with `title` and `blocks`.'
    );
  const candidate = value as SectionComposerSpec;
  const title = sectionText(candidate.title, 'title');
  if (!Array.isArray(candidate.blocks))
    sectionSpecError(
      'invalid_section_spec',
      'sectionSpec.blocks',
      'must be an ordered array of heading, paragraph, or table blocks.'
    );
  const blocks = candidate.blocks.map((block, index) => {
    const label = `block ${index + 1}`;
    if (!block || typeof block !== 'object')
      sectionSpecError(
        'invalid_section_block',
        label,
        'must be a heading, paragraph, or table block.'
      );
    if (block.role === 'heading')
      return {
        role: 'heading' as const,
        text: sectionText(block.text, `${label} (heading)`),
        ...(Number.isInteger(block.level) && Number(block.level) > 0
          ? { level: Number(block.level) }
          : {})
      };
    if (block.role === 'paragraph')
      return {
        role: 'paragraph' as const,
        text: sectionText(block.text, `${label} (paragraph)`)
      };
    if (block.role !== 'table')
      sectionSpecError(
        'invalid_section_role',
        label,
        `has unknown role ${JSON.stringify(
          (block as any).role
        )}; use heading, paragraph, or table.`
      );
    const table = block.table;
    const tableLabel = `${label} (table)`;
    if (!table || typeof table !== 'object')
      sectionSpecError(
        'invalid_section_table',
        tableLabel,
        'needs a `table` object.'
      );
    if (
      !Array.isArray(table.columnHeaders) ||
      !table.columnHeaders.length ||
      table.columnHeaders.some((cell) => typeof cell !== 'string')
    )
      sectionSpecError(
        'invalid_section_table_headers',
        tableLabel,
        'needs at least one string in `columnHeaders`.'
      );
    if (
      !Array.isArray(table.rows) ||
      table.rows.some(
        (row) =>
          !Array.isArray(row) ||
          row.length !== table.columnHeaders.length ||
          row.some((cell) => typeof cell !== 'string')
      )
    )
      sectionSpecError(
        'invalid_section_table_rows',
        tableLabel,
        `needs every data row to contain exactly ${table.columnHeaders.length} string cells.`,
        [
          `columnHeaders: ${table.columnHeaders.length}`,
          `row widths: ${
            Array.isArray(table.rows)
              ? table.rows
                  .map((row) =>
                    Array.isArray(row) ? row.length : 'not an array'
                  )
                  .join(', ')
              : 'rows is not an array'
          }`
        ]
      );
    if (
      table.columnRoles !== undefined &&
      (!Array.isArray(table.columnRoles) ||
        table.columnRoles.length !== table.columnHeaders.length ||
        table.columnRoles.some((role) => typeof role !== 'string'))
    )
      sectionSpecError(
        'invalid_section_column_roles',
        tableLabel,
        '`columnRoles`, when supplied, must contain one string per column.'
      );
    return {
      role: 'table' as const,
      table: {
        columnHeaders: [...table.columnHeaders],
        rows: table.rows.map((row) => [...row]),
        ...(table.columnRoles ? { columnRoles: [...table.columnRoles] } : {})
      }
    };
  });
  return { title, blocks };
}

function composerRoleCandidates(
  units: SectionUnit[],
  role: Exclude<SectionBlockRole, 'table' | 'table_header' | 'table_body'>,
  level?: number
): FlatBlock[] {
  if (role === 'section_heading')
    return units
      .flatMap((unit) => (unit.blocks[0] ? [unit.blocks[0]] : []))
      .filter((block) => block.text.trim());
  if (role === 'subsection_heading' && level !== undefined) {
    const exact = units.flatMap((unit) =>
      unit.blocks
        .slice(1)
        .filter(
          (block) =>
            block.isHeading && block.level === level && !!block.text.trim()
        )
    );
    if (exact.length) return exact;
  }
  return units
    .flatMap((unit) => roleBlocksForUnit(unit).get(role) ?? [])
    .filter((block) => block.text.trim());
}

/** Pick a real donor carrying the modal format advertised for this role. */
function composerRoleSource(
  evidence: SectionFamilyEvidence | undefined,
  role: Exclude<SectionBlockRole, 'table' | 'table_header' | 'table_body'>,
  level?: number
): FlatBlock | undefined {
  const candidates = evidence
    ? composerRoleCandidates(evidence.units, role, level)
    : [];
  const selected = modal(candidates.map(roleFormat));
  if (!selected) return undefined;
  const key = JSON.stringify(selected.value);
  return candidates.find((block) => JSON.stringify(roleFormat(block)) === key);
}

function composerTableSource(
  blocks: FlatBlock[],
  evidence: SectionFamilyEvidence | undefined,
  near: string,
  ordinal: number,
  byAnchor: Map<string, FlatBlock>
): FlatBlock | undefined {
  if (!evidence?.units.length) return undefined;
  const nearest = nearestUnitIndex(blocks, evidence.units, near) ?? 0;
  const ranked = evidence.units
    .map((unit, index) => ({ unit, index }))
    .sort(
      (left, right) =>
        Math.abs(left.index - nearest) - Math.abs(right.index - nearest) ||
        left.index - right.index
    );
  for (const { unit } of ranked) {
    const tableAnchor = tableAnchorsForUnit(unit)[ordinal];
    const firstCell = tableAnchor
      ? byAnchor.get(`${tableAnchor};0;0;0`)
      : undefined;
    if (firstCell) return firstCell;
  }
  return undefined;
}

function missingSectionPrefix(
  desired: SectionBoundaryElement[],
  existing: SectionBoundaryElement[]
): SectionBoundaryElement[] {
  return JSON.stringify(desired.slice(0, existing.length)) ===
    JSON.stringify(existing)
    ? desired.slice(existing.length)
    : desired;
}

function missingSectionSuffix(
  desired: SectionBoundaryElement[],
  existing: SectionBoundaryElement[]
): SectionBoundaryElement[] {
  return JSON.stringify(desired.slice(desired.length - existing.length)) ===
    JSON.stringify(existing)
    ? desired.slice(0, desired.length - existing.length)
    : desired;
}

function adjacentSectionSeparators(
  blocks: FlatBlock[],
  target: FlatBlock,
  direction: -1 | 1
): SectionBoundaryElement[] {
  const start = blocks.findIndex((block) => block.anchor === target.anchor);
  const separators: SectionBoundaryElement[] = [];
  if (start < 0) return separators;
  for (
    let index = start + direction;
    index >= 0 && index < blocks.length;
    index += direction
  ) {
    const element = boundaryElement(blocks[index]);
    if (!element) break;
    if (direction < 0) separators.unshift(element);
    else separators.push(element);
  }
  return separators;
}

/** Text which inserts exactly these paragraph-level separators at a boundary. */
function composerSeparatorText(
  elements: SectionBoundaryElement[],
  position: 'before' | 'after'
): string {
  const payload = elements
    .map((element) => (element === 'page_break' ? '\f' : ''))
    .join('\n');
  return position === 'before' ? `${payload}\n` : `\n${payload}`;
}

function composerUnitBlockCount(unit: ComposerUnit): number {
  if (unit.kind === 'text') return unit.items.length;
  if (unit.kind === 'separator') return unit.elements.length;
  return 1;
}

interface ComposerInsertionBoundary {
  target: FlatBlock;
  position: 'before' | 'after';
  /** Heading whose sibling family owns appearance, independent of placement. */
  familyAnchor?: string;
}

interface ComposerSectionMapEntry {
  heading: FlatBlock;
  start: number;
  end: number;
}

interface NamedComposerSectionTarget {
  name: string;
  position: 'before' | 'after';
}

function composerSectionName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/^the\s+/, '')
    .replace(/\s+section$/, '')
    .trim();
}

function namedComposerSectionTarget(
  anchor: string
): NamedComposerSectionTarget | undefined {
  const match = anchor.match(/^\s*(before|after)\s*:\s*(.+?)\s*$/i);
  if (!match?.[2]) return undefined;
  return {
    position: match[1].toLowerCase() as 'before' | 'after',
    name: match[2]
  };
}

/**
 * Section-authoring map, derived exclusively from real heading blocks. Empty
 * styled headings are layout placeholders and never become sections or split
 * one section from its content.
 */
function composerSectionMap(blocks: FlatBlock[]): ComposerSectionMapEntry[] {
  const headings = blocks
    .map((heading, start) => ({ heading, start }))
    .filter(
      ({ heading }) =>
        heading.isHeading && !!heading.text.replace(/\f/g, '').trim()
    );
  return headings.map(({ heading, start }, headingIndex) => {
    const next = headings
      .slice(headingIndex + 1)
      .find((candidate) => candidate.heading.level <= heading.level);
    return {
      heading,
      start,
      end: next?.start ?? blocks.length
    };
  });
}

function composerSectionCandidate(
  entry: ComposerSectionMapEntry,
  entries: ComposerSectionMapEntry[]
): string {
  const parent = [...entries]
    .reverse()
    .find(
      (candidate) =>
        candidate.start < entry.start &&
        candidate.end > entry.start &&
        candidate.heading.level < entry.heading.level
    );
  return `${JSON.stringify(entry.heading.text)} at ${entry.heading.anchor}${
    parent ? ` under ${JSON.stringify(parent.heading.text)}` : ''
  }`;
}

function matchingComposerSections(
  entries: ComposerSectionMapEntry[],
  requestedName: string
): ComposerSectionMapEntry[] {
  const requested = composerSectionName(requestedName);
  if (!requested) return [];
  const exact = entries.filter(
    (entry) => composerSectionName(entry.heading.text) === requested
  );
  if (exact.length) return exact;
  return entries.filter((entry) => {
    const candidate = composerSectionName(entry.heading.text);
    if (!candidate) return false;
    return candidate.includes(requested) || requested.includes(candidate);
  });
}

function bodyBlockNumber(block: FlatBlock): number | undefined {
  const parts = block.anchor.split(';');
  const number = Number(parts[1]);
  return Number.isInteger(number) ? number : undefined;
}

function boundaryAfterComposerSection(
  blocks: FlatBlock[],
  entry: ComposerSectionMapEntry
): ComposerInsertionBoundary | undefined {
  const nextHeading = blocks[entry.end];
  if (nextHeading?.isHeading && nextHeading.text.replace(/\f/g, '').trim())
    return { target: nextHeading, position: 'before' };

  const section = Number(entry.heading.anchor.split(';')[0]);
  const represented = blocks
    .slice(entry.start, entry.end)
    .filter((block) => Number(block.anchor.split(';')[0]) === section);
  const finalBlock = represented.reduce<
    { number: number; block: FlatBlock } | undefined
  >((latest, block) => {
    const number = bodyBlockNumber(block);
    if (number === undefined || (latest && latest.number > number))
      return latest;
    return { number, block };
  }, undefined);
  if (!finalBlock) return undefined;

  const bodyTarget = represented.find(
    (block) =>
      block.anchor.split(';').length === 2 &&
      bodyBlockNumber(block) === finalBlock.number
  );
  if (bodyTarget) return { target: bodyTarget, position: 'after' };

  // A section ending in a table needs a following body paragraph as its public
  // insertion surface. Word commonly keeps an empty one there; use it by
  // topology, never by trying to match its empty content.
  const followingBody = blocks.find((block) => {
    const parts = block.anchor.split(';');
    return (
      parts.length === 2 &&
      Number(parts[0]) === section &&
      Number(parts[1]) > finalBlock.number
    );
  });
  return followingBody
    ? { target: followingBody, position: 'before' }
    : undefined;
}

function boundaryForComposerSection(
  blocks: FlatBlock[],
  entry: ComposerSectionMapEntry,
  position: 'before' | 'after'
): ComposerInsertionBoundary | undefined {
  const boundary: ComposerInsertionBoundary | undefined =
    position === 'before'
      ? { target: entry.heading, position: 'before' }
      : boundaryAfterComposerSection(blocks, entry);
  return boundary
    ? { ...boundary, familyAnchor: entry.heading.anchor }
    : undefined;
}

function composerBodyBlocksInSection(
  blocks: FlatBlock[],
  section: number
): FlatBlock[] {
  return blocks.filter((block) => {
    const parts = block.anchor.split(';');
    return parts.length === 2 && Number(parts[0]) === section;
  });
}

function composerBoundaryBesideBlock(
  bodyBlocks: FlatBlock[],
  block: number,
  position: 'before' | 'after'
): ComposerInsertionBoundary | undefined {
  const indexed = bodyBlocks
    .map((target) => ({
      target,
      block: Number(target.anchor.split(';')[1])
    }))
    .filter((candidate) => Number.isInteger(candidate.block));
  const following = indexed
    .filter((candidate) => candidate.block > block)
    .sort((left, right) => left.block - right.block)[0]?.target;
  const preceding = indexed
    .filter((candidate) => candidate.block < block)
    .sort((left, right) => right.block - left.block)[0]?.target;
  if (position === 'after') {
    if (following)
      return {
        target: following,
        position: 'before'
      };
    if (preceding)
      return {
        target: preceding,
        position: 'after'
      };
  } else {
    if (preceding)
      return {
        target: preceding,
        position: 'after'
      };
    if (following)
      return {
        target: following,
        position: 'before'
      };
  }
  return undefined;
}

function resolveComposerInsertionBoundary(
  blocks: FlatBlock[],
  byAnchor: Map<string, FlatBlock>,
  anchor: string,
  requestedPosition: 'before' | 'after',
  positionWasExplicit: boolean
): ComposerInsertionBoundary | undefined {
  const sectionMap = composerSectionMap(blocks);
  const named = namedComposerSectionTarget(anchor);
  if (named) {
    if (positionWasExplicit && requestedPosition !== named.position)
      sectionSpecError(
        'section_target_position_conflict',
        'entry point',
        `${JSON.stringify(anchor)} says ${
          named.position
        }, while position says ${requestedPosition}.`,
        [
          `section-map target: ${named.position}:${named.name}`,
          `explicit position: ${requestedPosition}`
        ]
      );
    const matches = matchingComposerSections(sectionMap, named.name);
    if (matches.length > 1)
      sectionSpecError(
        'section_target_ambiguous',
        'entry point',
        `${JSON.stringify(named.name)} matched ${
          matches.length
        } section headings. Ask one question choosing between the concrete candidates below; no manual placement is needed.`,
        matches.map((entry) => composerSectionCandidate(entry, sectionMap))
      );
    if (!matches.length)
      sectionSpecError(
        'section_target_not_found',
        'entry point',
        `the section map did not contain a heading matching ${JSON.stringify(
          named.name
        )}.`,
        [
          `tried: ${named.position} the named section heading and its structural boundary`,
          `available section headings: ${
            sectionMap
              .map((entry) => composerSectionCandidate(entry, sectionMap))
              .join('; ') || '(none)'
          }`
        ]
      );
    const resolved = boundaryForComposerSection(
      blocks,
      matches[0],
      named.position
    );
    if (!resolved)
      sectionSpecError(
        'section_boundary_unavailable',
        'entry point',
        `resolved ${named.position}:${named.name} in the section map, but its structural edge had no body insertion surface.`,
        [
          `matched section: ${composerSectionCandidate(
            matches[0],
            sectionMap
          )}`,
          'tried: the section heading, the block after its last content, and a following empty body paragraph'
        ]
      );
    return resolved;
  }

  const exact = byAnchor.get(anchor);
  const exactSection = exact?.isHeading
    ? sectionMap.find((entry) => entry.heading.anchor === exact.anchor)
    : undefined;
  if (exactSection) {
    const resolved = boundaryForComposerSection(
      blocks,
      exactSection,
      requestedPosition
    );
    if (resolved) return resolved;
  }
  if (exact && exact.kind !== 'table_cell') {
    if (!exact.text.replace(/\f/g, '').trim()) {
      const exactIndex = blocks.findIndex(
        (candidate) => candidate.anchor === exact.anchor
      );
      const followingSection = sectionMap.find(
        (entry) => entry.start > exactIndex
      );
      if (followingSection)
        return { target: followingSection.heading, position: 'before' };
      const preceding = [...blocks.slice(0, exactIndex)]
        .reverse()
        .find(
          (candidate) =>
            candidate.kind !== 'table_cell' &&
            !!candidate.text.replace(/\f/g, '').trim()
        );
      if (preceding) return { target: preceding, position: 'after' };
    }
    return {
      target: exact,
      position: requestedPosition
    };
  }

  const parts = anchor.split(';');
  const section = Number(parts[0]);
  const block = Number(parts[1]);
  if (!Number.isInteger(section) || !Number.isInteger(block)) return undefined;
  const bodyBlocks = composerBodyBlocksInSection(blocks, section);
  if (!bodyBlocks.length) return undefined;

  // A table has no public body-block anchor, while every cell names its
  // containing top-level block. Treat either a cell or that otherwise-missing
  // top-level address as the same structural boundary and manufacture a body
  // insertion point immediately beside it.
  const containsTable = blocks.some((candidate) => {
    const candidateParts = candidate.anchor.split(';');
    return (
      candidate.kind === 'table_cell' &&
      Number(candidateParts[0]) === section &&
      Number(candidateParts[1]) === block
    );
  });
  if (exact?.kind === 'table_cell' || containsTable)
    return composerBoundaryBesideBlock(bodyBlocks, block, requestedPosition);

  const indexed = bodyBlocks
    .map((target) => ({
      target,
      block: Number(target.anchor.split(';')[1])
    }))
    .filter((candidate) => Number.isInteger(candidate.block));
  if (requestedPosition === 'before') {
    const following = indexed
      .filter((candidate) => candidate.block >= block)
      .sort((left, right) => left.block - right.block)[0]?.target;
    if (following)
      return {
        target: following,
        position: 'before'
      };
  } else {
    const preceding = indexed
      .filter((candidate) => candidate.block <= block)
      .sort((left, right) => right.block - left.block)[0]?.target;
    if (preceding)
      return {
        target: preceding,
        position: 'after'
      };
  }
  return composerBoundaryBesideBlock(bodyBlocks, block, requestedPosition);
}

function compileSectionComposer(
  op: EditOp,
  originalIndex: number,
  blocks: FlatBlock[],
  byAnchor: Map<string, FlatBlock>
): { children: CompiledSectionEdit[]; contentBlocks: number; tables: number } {
  const anchor = typeof op.anchor === 'string' ? op.anchor.trim() : '';
  const positionValue = String(op.position ?? 'before').toLowerCase();
  if (positionValue !== 'before' && positionValue !== 'after')
    sectionSpecError(
      'invalid_section_position',
      'position',
      `must be "before" or "after", not ${JSON.stringify(op.position)}.`
    );
  const requestedPosition = positionValue as 'before' | 'after';
  const boundary = anchor
    ? resolveComposerInsertionBoundary(
        blocks,
        byAnchor,
        anchor,
        requestedPosition,
        op.position !== undefined
      )
    : undefined;
  if (!boundary)
    sectionSpecError(
      'section_anchor_not_found',
      'anchor',
      `could not resolve a structural body boundary near ${JSON.stringify(
        anchor || op.anchor
      )}.`,
      [
        `tried: an exact body anchor, a table boundary, and the document section map (${
          composerSectionMap(blocks).length
        } named headings)`
      ]
    );
  const resolvedTarget = boundary.target;
  let position = boundary.position;
  const resolvedParts = resolvedTarget.anchor.split(';');
  const resolvedBlockIndex = Number(resolvedParts[1]);
  const needsSeedAnchor =
    position === 'after' &&
    resolvedParts.length === 2 &&
    Number.isInteger(resolvedBlockIndex) &&
    !blocks.some((block) => {
      const parts = block.anchor.split(';');
      return (
        parts[0] === resolvedParts[0] &&
        Number(parts[1]) === resolvedBlockIndex + 1
      );
    });
  // At the end of a story there is no public body block on the far side of
  // the structural boundary. Split the final paragraph once to create that
  // body insertion surface, then compose before it in the same revision group.
  // The paragraph starts empty; no placeholder/content identity participates.
  const target: FlatBlock = needsSeedAnchor
    ? {
        ...resolvedTarget,
        anchor: `${resolvedParts[0]};${resolvedBlockIndex + 1}`,
        kind: 'paragraph',
        text: '',
        length: 0,
        isHeading: false,
        level: -1
      }
    : resolvedTarget;
  if (needsSeedAnchor) position = 'before';
  const spec = validatedSectionSpec(op.sectionSpec);
  const group =
    typeof op.group === 'string'
      ? op.group
      : `__insert_section_${originalIndex + 1}`;
  const familyAnchor = boundary.familyAnchor ?? resolvedTarget.anchor;
  const evidence = deriveSectionFamilyEvidence(blocks, familyAnchor);
  const familyBoundary = evidence
    ? sectionBoundaryPattern(blocks, evidence.units).separator
    : undefined;
  const desiredBoundary =
    evidence &&
    evidence.units.length >= 2 &&
    familyBoundary &&
    familyBoundary.confidence.level !== 'low'
      ? familyBoundary.value
      : [];
  const beforeExisting = adjacentSectionSeparators(blocks, resolvedTarget, -1);
  const afterExisting = adjacentSectionSeparators(blocks, resolvedTarget, 1);
  const leadingBoundary =
    position === 'before'
      ? missingSectionPrefix(desiredBoundary, beforeExisting)
      : desiredBoundary;
  let trailingBoundary =
    boundary.position === 'after'
      ? missingSectionSuffix(desiredBoundary, afterExisting)
      : desiredBoundary;
  if (
    needsSeedAnchor &&
    trailingBoundary[trailingBoundary.length - 1] === 'empty_paragraph'
  )
    trailingBoundary = trailingBoundary.slice(0, -1);
  const observedSubsectionBoundary = evidence
    ? subsectionBoundaryPattern(evidence.units)
    : undefined;
  const desiredSubsectionBoundary =
    evidence &&
    evidence.units.length >= 2 &&
    observedSubsectionBoundary &&
    observedSubsectionBoundary.confidence.level !== 'low'
      ? observedSubsectionBoundary.value
      : [];

  const contentUnits: ComposerUnit[] = [];
  let textItems: ComposerTextItem[] = [];
  let seenSubsection = false;
  let tableOrdinal = 0;
  const flushText = () => {
    if (!textItems.length) return;
    contentUnits.push({
      kind: 'text',
      items: textItems,
      label: textItems.map((item) => item.label).join(' + ')
    });
    textItems = [];
  };
  textItems.push({
    text: spec.title,
    label: 'title',
    source: composerRoleSource(evidence, 'section_heading')
  });
  spec.blocks.forEach((block, blockIndex) => {
    const label = `block ${blockIndex + 1} (${block.role})`;
    if (block.role === 'heading') {
      if (seenSubsection && desiredSubsectionBoundary.length) {
        flushText();
        contentUnits.push({
          kind: 'separator',
          elements: desiredSubsectionBoundary,
          label: 'inherited sibling-family subsection boundary'
        });
      }
      seenSubsection = true;
      textItems.push({
        text: block.text,
        label,
        source: composerRoleSource(evidence, 'subsection_heading', block.level)
      });
      return;
    }
    if (block.role === 'paragraph') {
      textItems.push({
        text: block.text,
        label,
        source: composerRoleSource(
          evidence,
          seenSubsection ? 'subsection_paragraph' : 'intro_paragraph'
        )
      });
      return;
    }
    flushText();
    contentUnits.push({
      kind: 'table',
      table: block,
      blockIndex,
      ordinal: tableOrdinal,
      source: composerTableSource(
        blocks,
        evidence,
        familyAnchor,
        tableOrdinal,
        byAnchor
      ),
      label
    });
    tableOrdinal++;
  });
  flushText();

  // Word coalesces adjacent top-level tables into one grid. A paragraph is a
  // storage-topology separator, not a visual style or document-specific shape.
  const separatedContent: ComposerUnit[] = [];
  for (const unit of contentUnits) {
    if (
      unit.kind === 'table' &&
      separatedContent[separatedContent.length - 1]?.kind === 'table'
    )
      separatedContent.push({
        kind: 'separator',
        elements: ['empty_paragraph'],
        label: 'required separator between adjacent tables'
      });
    separatedContent.push(unit);
  }

  const finalUnits: ComposerUnit[] = [
    ...(leadingBoundary.length
      ? [
          {
            kind: 'separator' as const,
            elements: leadingBoundary,
            label: 'leading sibling-family boundary'
          }
        ]
      : []),
    ...separatedContent,
    ...(trailingBoundary.length
      ? [
          {
            kind: 'separator' as const,
            elements: trailingBoundary,
            label: 'trailing sibling-family boundary'
          }
        ]
      : [])
  ];
  // Plan paragraph destinations from the COMPLETE final topology. Inserting
  // several units `after` one stable anchor necessarily pushes earlier units
  // forward, so a creator-time anchor is stale by the end. These final anchors
  // are the same perimeter/topology evidence phase 3 verifies after every
  // structural write has landed.
  const anchorParts = target.anchor.split(';');
  const targetBlockIndex = Number(anchorParts[1]);
  let finalBlockOffset = position === 'after' ? 1 : 0;
  if (anchorParts.length === 2 && Number.isInteger(targetBlockIndex))
    finalUnits.forEach((unit) => {
      if (unit.kind === 'text') {
        unit.items.forEach((item, index) => {
          item.finalAnchor = `${anchorParts[0]};${
            targetBlockIndex + finalBlockOffset + index
          }`;
        });
        finalBlockOffset += unit.items.length;
      } else if (unit.kind === 'separator') {
        finalBlockOffset += unit.elements.length;
      } else {
        finalBlockOffset++;
      }
    });
  const structuralOrder =
    position === 'before' ? finalUnits : [...finalUnits].reverse();
  const structural: CompiledSectionEdit[] = needsSeedAnchor
    ? [
        {
          label: 'created structural seed anchor',
          edit: {
            op: 'insert_text',
            group,
            anchor: resolvedTarget.anchor,
            position: 'after',
            text: '\n',
            __suppressSectionBoundary: true
          }
        }
      ]
    : [];
  const formatting: CompiledSectionEdit[] = [];
  let insertedBeforeBoundary = 0;
  structuralOrder.forEach((unit, unitIndex) => {
    const sectionBoundaryAnchor =
      position === 'before' &&
      anchorParts.length === 2 &&
      Number.isInteger(targetBlockIndex)
        ? `${anchorParts[0]};${targetBlockIndex + insertedBeforeBoundary}`
        : target.anchor;
    if (unit.kind === 'table') {
      const cells = [
        [...unit.table.table.columnHeaders],
        ...unit.table.table.rows.map((row) => [...row])
      ];
      structural.push({
        label: unit.label,
        edit: {
          op: 'insert_table',
          group,
          anchor: resolvedTarget.anchor,
          position,
          __sectionBoundaryAnchor: sectionBoundaryAnchor,
          rows: cells.length,
          columns: unit.table.table.columnHeaders.length,
          initialCells: cells,
          ...(unit.source ? { inheritFormatFrom: unit.source.anchor } : {})
        }
      });
      if (position === 'before')
        insertedBeforeBoundary += composerUnitBlockCount(unit);
      return;
    }
    const creatorId = `section-${originalIndex + 1}-unit-${unitIndex + 1}`;
    const isSeparator = unit.kind === 'separator';
    structural.push({
      label: unit.label,
      edit: {
        op: 'insert_text',
        group,
        anchor: resolvedTarget.anchor,
        position,
        __sectionBoundaryAnchor: sectionBoundaryAnchor,
        text: isSeparator
          ? composerSeparatorText(unit.elements, position)
          : unit.items.map((item) => item.text).join('\n'),
        __sectionCreatorId: creatorId,
        __suppressSectionBoundary: true
      }
    });
    if (position === 'before')
      insertedBeforeBoundary += composerUnitBlockCount(unit);
    if (isSeparator) return;
    unit.items.forEach((item, segmentIndex) => {
      if (!item.source) return;
      formatting.push({
        label: item.label,
        edit: {
          op: 'apply_style',
          group,
          anchor: resolvedTarget.anchor,
          expect: item.text,
          inheritFormatFrom: item.source.anchor,
          __sectionCreatorId: creatorId,
          __sectionSegmentIndex: segmentIndex,
          ...(item.finalAnchor
            ? { __sectionFinalAnchor: item.finalAnchor }
            : {})
        }
      });
    });
  });
  return {
    children: [...structural, ...formatting],
    contentBlocks: spec.blocks.length + 1,
    tables: tableOrdinal
  };
}

function expandSectionComposerEdits(
  editor: LiveEditor,
  input: { edits: EditOp[]; changeSetId?: string; plan?: string }
): SectionExpansion {
  const requested = Array.isArray(input?.edits) ? input.edits : [];
  const changed = requested.some((op) => op?.op === 'insert_section');
  if (!changed)
    return {
      edits: requested,
      entries: requested.map((original, originalIndex) => ({
        originalIndex,
        original,
        start: originalIndex,
        count: 1,
        labels: [original.op],
        section: false,
        contentBlocks: 0,
        tables: 0
      })),
      expandedToOriginal: requested.map((_op, index) => index),
      changed: false
    };

  const sfdt = serializeSfdt(editor);
  const blocks = flattenSfdt(sfdt);
  const byAnchor = new Map(blocks.map((block) => [block.anchor, block]));
  const edits: EditOp[] = [];
  const entries: SectionExpansionEntry[] = [];
  const expandedToOriginal: number[] = [];
  requested.forEach((original, originalIndex) => {
    const start = edits.length;
    if (original?.op !== 'insert_section') {
      edits.push(original);
      expandedToOriginal.push(originalIndex);
      entries.push({
        originalIndex,
        original,
        start,
        count: 1,
        labels: [original?.op ?? 'edit'],
        section: false,
        contentBlocks: 0,
        tables: 0
      });
      return;
    }
    // The high-level op crosses the registry-exhaustive common guard even
    // though its compiled children perform the actual mutations below.
    observeMutationGuardBoundary(original, 'block_expect');
    let compiled:
      | {
          children: CompiledSectionEdit[];
          contentBlocks: number;
          tables: number;
        }
      | undefined;
    try {
      compiled = compileSectionComposer(
        original,
        originalIndex,
        blocks,
        byAnchor
      );
    } catch (error) {
      const refusal = isOpError(error)
        ? {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {})
          }
        : {
            code: 'section_compile_failed',
            message:
              'insert_section could not compile the supplied semantic section; nothing was written.',
            details: [describeUnexpectedError(error)]
          };
      compiled = {
        children: [
          {
            edit: {
              ...original,
              // A semantic target such as `before:Premium Summary` is not a
              // live block anchor. Route compile-time refusals through one
              // harmless real body anchor so the typed handler can surface
              // the precise section-map diagnosis before generic anchor
              // preflight has a chance to replace it with anchor_not_found.
              anchor:
                blocks.find((block) => block.kind !== 'table_cell')?.anchor ??
                original.anchor,
              __sectionRefusal: refusal
            },
            label: 'sectionSpec'
          }
        ],
        contentBlocks: 0,
        tables: 0
      };
    }
    for (const child of compiled.children) {
      edits.push(child.edit);
      expandedToOriginal.push(originalIndex);
    }
    entries.push({
      originalIndex,
      original,
      start,
      count: compiled.children.length,
      labels: compiled.children.map((child) => child.label),
      section: true,
      contentBlocks: compiled.contentBlocks,
      tables: compiled.tables
    });
  });
  return { edits, entries, expandedToOriginal, changed: true };
}

function combinedComposerAppearance(
  results: EditResult[]
): AppearanceWriteReport | undefined {
  const reports = results
    .map((result) => result.appearance)
    .filter((report): report is AppearanceWriteReport => !!report);
  if (!reports.length) return undefined;
  return reports.reduce<AppearanceWriteReport>(
    (combined, report) => ({
      cellsWritten: combined.cellsWritten + report.cellsWritten,
      rowsWritten: combined.rowsWritten + report.rowsWritten,
      cellsUnchanged: combined.cellsUnchanged + report.cellsUnchanged,
      ...((combined.rowsSkippedMixed ?? 0) + (report.rowsSkippedMixed ?? 0) > 0
        ? {
            rowsSkippedMixed:
              (combined.rowsSkippedMixed ?? 0) + (report.rowsSkippedMixed ?? 0)
          }
        : {}),
      ...(report.banding
        ? { banding: report.banding }
        : combined.banding
        ? { banding: combined.banding }
        : {}),
      ...(report.sourceStyleName
        ? { sourceStyleName: report.sourceStyleName }
        : combined.sourceStyleName
        ? { sourceStyleName: combined.sourceStyleName }
        : {})
    }),
    { cellsWritten: 0, rowsWritten: 0, cellsUnchanged: 0 }
  );
}

function collapseSectionComposerResult(
  result: ApplyEditsResult,
  expansion: SectionExpansion
): ApplyEditsResult {
  if (!expansion.changed) return result;
  const results = expansion.entries.map((entry) => {
    const children = result.results.slice(
      entry.start,
      entry.start + entry.count
    );
    if (!entry.section) return children[0];
    const failedIndex = children.findIndex(
      (child) => !child.ok && child.error !== 'change_set_failed'
    );
    const fallbackFailure = children.findIndex((child) => !child.ok);
    const failureAt = failedIndex >= 0 ? failedIndex : fallbackFailure;
    if (failureAt >= 0) {
      const child = children[failureAt];
      const label = entry.labels[failureAt] ?? 'sectionSpec';
      return {
        ok: false,
        op: 'insert_section',
        ...(entry.original.anchor ? { anchor: entry.original.anchor } : {}),
        error: child.error ?? 'section_assembly_failed',
        message: `insert_section failed at ${label}: ${
          child.message ?? 'the engine refused this block'
        }`,
        details: [
          `failing section component: ${label}`,
          ...(child.details ?? [])
        ],
        ...(child.retry ? { retry: child.retry } : {})
      } as EditResult;
    }
    const appearance = combinedComposerAppearance(children);
    return {
      ok: true,
      op: 'insert_section',
      ...(entry.original.anchor ? { anchor: entry.original.anchor } : {}),
      ...(appearance ? { appearance } : {})
    } as EditResult;
  });
  const changeSet = result.changeSet
    ? {
        ...result.changeSet,
        groups: result.changeSet.groups.map((group) => ({
          ...group,
          opIndices: Array.from(
            new Set(
              group.opIndices.map(
                (index) => expansion.expandedToOriginal[index] ?? index
              )
            )
          )
        })),
        announcement: `${
          result.changeSet.announcement
        } The engine also assembled ${expansion.entries
          .filter((entry) => entry.section)
          .map(
            (entry) =>
              `${entry.contentBlocks} semantic blocks and ${
                entry.tables
              } tables at ${entry.original.anchor ?? '(missing anchor)'}`
          )
          .join('; ')}.`
      }
    : undefined;
  return {
    ...result,
    results,
    ...(changeSet ? { changeSet } : {})
  };
}

// Applies a logical change set in deterministic phases. We preflight only the
// relevant anchors, re-resolve them after structural writes, and verify only
// each affected source/target pair; a large document never needs a full result
// inventory to prove inherited formatting succeeded.
export function applyDocumentEdits(
  editor: LiveEditor,
  input: { edits: EditOp[]; changeSetId?: string; plan?: string }
): ApplyEditsResult {
  const serializationTiming: SerializationTiming = { count: 0, totalMs: 0 };
  return withSerializationTiming(editor, serializationTiming, () => {
    const expansion = expandSectionComposerEdits(editor, input);
    const result = applyDocumentEditsMeasured(
      editor,
      { ...input, edits: expansion.edits },
      serializationTiming
    );
    return collapseSectionComposerResult(result, expansion);
  });
}

function applyDocumentEditsMeasured(
  editor: LiveEditor,
  input: { edits: EditOp[]; changeSetId?: string; plan?: string },
  serializationTiming: SerializationTiming
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
  const priorCurrentUser = editor.currentUser;
  // enableTrackChanges flips to true only inside the protected try below
  // (which restores it in `finally`) - preflight here is read-only, and a
  // serialization failure before that point must leave it exactly as found.
  // The group tag rides on SyncFusion's revision customData for the duration
  // of this change set; whatever the host set there before is restored after.
  const revisionSettings = editor.documentEditorSettings?.revisionSettings;
  const priorRevisionCustomData = revisionSettings?.customData;
  let blocks: FlatBlock[] = [];
  let byAnchor = new Map<string, FlatBlock>();
  // "What the whole document would read if every revision were rejected",
  // kept alongside the live block map so a tracked write can be proven
  // reversible without a second serialize per op. Its mirror - what the document
  // would read if every revision were accepted - is what proves a story write
  // replaced the text it targeted rather than landing beside it.
  let rejectStream = '';
  let acceptStream = '';
  // Catch-all: rebuild bindings lost to reload/earlier sessions before any
  // new writes land.
  rebindRevisionGroups(editor);
  // Adjacent writes from different accept groups must not coalesce into one
  // revision; see installRevisionGroupIsolation. Idempotent.
  installRevisionGroupIsolation(editor);
  // The parsed SFDT behind the current block map. Table APPEARANCE lives on
  // cellFormat/rowFormat, which flattening drops, so the banding preserve reads
  // it from here instead of paying a second serialize.
  let liveSfdt: any;
  const revisionSnapshot = snapshotRevisions(editor);
  const plans: ChangeSetPlan[] = [];
  const failedGroups = new Set<string>();
  // Exact revision object membership makes per-group rollback work even in
  // editors/test doubles which do not expose revisionSettings.customData.
  const revisionsByAppliedGroup = new Map<string, Set<LiveRevision>>();
  const nonBlockingStoryWriteFailures = new Set<number>();
  const resolvedFormatTargets = new Map<number, FlatBlock>();
  // Every still-applied appearance snapshot, in write order. A failed group's
  // entries are replayed and removed without touching successful siblings.
  const appearanceRestores: AppearanceRestore[] = [];
  // The same snapshots split by the accept group whose op took them, so a reject
  // of ONE grouped card puts back exactly that group's appearance and never a
  // sibling group's. Every appearance write in this change set goes through
  // `recordAppearanceRestores`, so neither collection can miss one.
  const appearanceRestoresByGroup = new Map<string, AppearanceRestore[]>();
  const recordAppearanceRestores = (
    op: EditOp,
    restores: AppearanceRestore[]
  ) => {
    if (!restores.length) return;
    appearanceRestores.push(...restores);
    const id = opGroupId(op, changeSetId);
    const bucket = appearanceRestoresByGroup.get(id);
    if (bucket) bucket.push(...restores);
    else appearanceRestoresByGroup.set(id, [...restores]);
  };
  let anchorsMayHaveShifted = false;
  const refresh = (serializedSfdt?: any) => {
    const sfdt = serializedSfdt ?? serializeSfdt(editor);
    liveSfdt = sfdt;
    blocks = flattenSfdt(sfdt);
    byAnchor = new Map(blocks.map((block) => [block.anchor, block] as const));
    rejectStream = rejectProjectionStream(sfdt);
    acceptStream = acceptProjectionStream(sfdt);
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
  const rememberGroupRevisions = (op: EditOp, before: LiveRevision[]) => {
    const created = createdRevisions(editor, before);
    if (!created.length) return;
    const id = opGroupId(op, changeSetId);
    const bucket = revisionsByAppliedGroup.get(id) ?? new Set<LiveRevision>();
    for (const revision of created) bucket.add(revision);
    revisionsByAppliedGroup.set(id, bucket);
  };
  const markGroupFailed = (
    groupId: string,
    failingIndex: number,
    disposition: 'refused' | 'rolled back'
  ) => {
    failedGroups.add(groupId);
    const failure = results[failingIndex];
    const failedOp = edits[failingIndex];
    edits.forEach((op, index) => {
      if (opGroupId(op, changeSetId) !== groupId || index === failingIndex)
        return;
      if (results[index] && !results[index]?.ok) return;
      results[index] = {
        ...(results[index] ?? {}),
        ok: false,
        op: op?.op ?? '',
        ...(op?.anchor ? { anchor: op.anchor } : {}),
        error: 'change_set_failed',
        details: [
          `Group ${JSON.stringify(groupId)} failed because edit ${
            failingIndex + 1
          } (${failedOp?.op ?? 'unknown op'} at ${JSON.stringify(
            failedOp?.anchor ?? '(no anchor)'
          )}) did not land (${
            failure?.error ?? 'op_failed'
          }); this sibling was ${disposition} with its group.`
        ]
      };
    });
  };
  const rollbackGroup = (groupId: string) => {
    const rollbackErrors: string[] = [];
    const attempt = (work: () => void) => {
      try {
        work();
      } catch (err) {
        rollbackErrors.push(describeUnexpectedError(err));
      }
    };
    const restores = appearanceRestoresByGroup.get(groupId) ?? [];
    if (restores.length)
      attempt(() => replayAppearanceRestores(editor, restores));
    appearanceRestoresByGroup.delete(groupId);
    if (restores.length) {
      const owned = new Set(restores);
      for (let index = appearanceRestores.length - 1; index >= 0; index--)
        if (owned.has(appearanceRestores[index]))
          appearanceRestores.splice(index, 1);
    }
    for (const plan of plans) {
      if (opGroupId(plan.op, changeSetId) !== groupId) continue;
      const target = resolvedFormatTargets.get(plan.index);
      if (!target || !plan.targetBefore) continue;
      const targetBefore = plan.targetBefore;
      attempt(() => restoreCapturedFormat(editor, target, targetBefore));
    }
    const live = new Set(snapshotRevisions(editor));
    const revisions = [...(revisionsByAppliedGroup.get(groupId) ?? [])].filter(
      (revision) => live.has(revision)
    );
    if (revisions.length) attempt(() => rejectRevisions(revisions));
    revisionsByAppliedGroup.delete(groupId);
    attempt(() => refresh());
    if (rollbackErrors.length)
      warnings.push(
        `group_rollback_failed: ${groupId}; ${rollbackErrors.join('; ')}`
      );
  };

  // Phase 0: what only the whole batch can show. Both of these refuse BEFORE
  // any anchor is resolved, so a refused change set costs nothing at all.
  const batchRefusal =
    detectInconsistentAggregateRanges(edits) ??
    detectEmptyInsertedTables(edits) ??
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
  edits.forEach((rawOp, index) => {
    // Already refused by a batch-level check; do not re-diagnose it.
    if (results[index]) return;
    let op = retargetTableScopedAnchor(rawOp, byAnchor);
    let relocated: { from: string; to: string } | undefined;
    const name = op?.op;
    if (!name) {
      results[index] = { ok: false, op: '', error: 'missing_op' };
      return;
    }
    if (
      op.group !== undefined &&
      (typeof op.group !== 'string' ||
        !op.group.trim() ||
        op.group.trim().length > 120)
    ) {
      results[index] = {
        ok: false,
        op: name,
        ...(op.anchor ? { anchor: op.anchor } : {}),
        error: 'invalid_group',
        message:
          "`group` names this edit's accept/reject unit: a non-empty string of at most 120 characters, shared by every edit that must resolve together. Omit it to group the whole change set."
      };
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
    // an expect discrepancy must be reported as what it is, stale expect
    // text, never as a missing anchor on an anchor that exists.
    const formatExpectMismatch =
      FORMAT_OPS.has(name) &&
      op.expect != null &&
      indexedTarget != null &&
      !expectTextMatches(op.expect, indexedTarget.text);
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
    if (name === 'replace_selection') {
      const suppliedStart = offsetString(op.startOffset);
      // A start offset that names a different anchor is malformed, not drift.
      // Preserve resolveSelectionRange's specific refusal instead of guessing.
      const startDisagrees =
        suppliedStart && anchorFromOffset(suppliedStart) !== String(op.anchor);
      const runs = selectionTextRuns(blocks);
      const declaredText = declaredSelectionText(op, byAnchor, runs);
      const hasPinnedLength =
        typeof op.expectLength === 'number' && op.expectLength > 0;
      const declaredStartsWithExpect =
        declaredText != null &&
        op.expect != null &&
        declaredText.startsWith(String(op.expect));
      if (
        !startDisagrees &&
        !declaredSelectionCrossesContainer(op, byAnchor) &&
        op.expect != null &&
        !selectionIdentityMatches(op, declaredText ?? '') &&
        // A pinned prefix at the declared start plus a conflicting total
        // length is a bad CAS claim, not evidence that the range moved. Keep
        // assertSelectionGuard's measured refusal instead of expanding it.
        !(hasPinnedLength && declaredStartsWithExpect)
      ) {
        const attempt = attemptSelectionRelocation(blocks, op);
        if ('range' in attempt) {
          target = attempt.range.target;
          relocated = attempt.relocated;
          op = {
            ...op,
            anchor: attempt.range.target.anchor,
            startOffset: attempt.range.startOffset,
            endOffset: attempt.range.endOffset
          };
        } else {
          results[index] = {
            ok: false,
            op: name,
            anchor: op.anchor,
            error: 'stale_anchor',
            details: [
              ...staleAnchorDetails(op.expect, declaredText ?? ''),
              ...attempt.details
            ]
          };
          return;
        }
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
            ) || tableCreatedByEarlierInsert(edits, index));
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
    // A formatting target created by this batch has no pre-write identity yet,
    // so a zero-match attempt remains deferred to phase 3. If the expected
    // content already exists exactly once, though, this is ordinary anchor
    // drift and we can bind the plan to that current block now.
    if (!target && formatExpectMismatch && hasStructuralEdits) {
      const attempt = attemptAnchorRelocation(blocks, op);
      if ('target' in attempt) {
        target = attempt.target;
        relocated = attempt.relocated;
        op = retargetOpToBlock(op, target);
      }
    }
    if (
      !target &&
      !deferredNewCell &&
      !deferredNewParagraph &&
      (!FORMAT_OPS.has(name) || !hasStructuralEdits)
    ) {
      const attempt = attemptAnchorRelocation(blocks, op);
      if ('target' in attempt) {
        target = attempt.target;
        relocated = attempt.relocated;
        op = retargetOpToBlock(op, target);
      } else {
        results[index] = {
          ok: false,
          op: name,
          anchor: op.anchor,
          error: indexedTarget ? 'expect_mismatch' : 'anchor_not_found',
          details: [
            ...(indexedTarget
              ? staleAnchorDetails(op.expect, indexedTarget.text)
              : []),
            ...attempt.details
          ]
        };
        return;
      }
    }
    if (
      target &&
      !isLiveStoryTarget(target) &&
      // See applyAnchoredOp: replace_selection's `expect` describes the selected
      // range, not the start block, so it is checked by assertSelectionGuard.
      name !== 'replace_selection' &&
      expectGuardRefuses(op.expect, target.text)
    ) {
      const staleTarget = target;
      const attempt = attemptAnchorRelocation(blocks, op, staleTarget);
      if ('target' in attempt) {
        target = attempt.target;
        relocated = attempt.relocated;
        op = retargetOpToBlock(op, target);
      } else {
        results[index] = {
          ok: false,
          op: name,
          anchor: op.anchor,
          error: 'expect_mismatch',
          details: [
            ...staleAnchorDetails(op.expect, staleTarget.text),
            ...attempt.details
          ]
        };
        return;
      }
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
      const inherited = source
        ? readEffectiveSourceFormat(editor, source)
        : undefined;
      const insertInheritance =
        target &&
        !isLiveStoryTarget(target) &&
        (op.op === 'insert_table' || op.op === 'insert_row')
          ? planInsertInheritance(
              editor,
              op,
              target,
              blocks,
              liveSfdt,
              source ? { source, inherited } : undefined
            )
          : undefined;
      const plannedTableAnchor =
        op.op === 'insert_table'
          ? expectedInsertedTableAnchor(edits, index)
          : undefined;
      plans.push({
        index,
        op,
        target,
        source,
        ...(relocated ? { relocated } : {}),
        ...(deferredNewCell ? { deferredNewCell: true } : {}),
        ...(deferredNewParagraph ? { deferredNewParagraph: true } : {}),
        ...(plannedTableAnchor
          ? { expectedInsertedTableAnchor: plannedTableAnchor }
          : {}),
        ...(insertInheritance ? { insertInheritance } : {}),
        ...(inherited ? { inherited } : {}),
        ...(target &&
        !isLiveStoryTarget(target) &&
        FORMAT_OPS.has(name) &&
        !TABLE_APPEARANCE_OPS.has(name)
          ? { targetBefore: readEffectiveSourceFormat(editor, target) }
          : {})
      });
    } catch (err) {
      fail(index, op, err);
    }
  });

  const preflightFailures = results.reduce<number[]>(
    (indices, result, index) => {
      if (result && !result.ok && !nonBlockingStoryWriteFailures.has(index))
        indices.push(index);
      return indices;
    },
    []
  );
  if (!batchRefusal) {
    for (const index of preflightFailures) {
      const groupId = opGroupId(edits[index], changeSetId);
      if (!failedGroups.has(groupId))
        markGroupFailed(groupId, index, 'refused');
    }
  }
  const preflightFailed = !!batchRefusal || preflightFailures.length > 0;
  // SyncFusion's public bulk-update switch suppresses pagination/layout paint
  // until the phase loops finish. Preserve an outer caller's already-disabled
  // state; only this function's own true -> false transition is restored.
  const suspendLayout = !batchRefusal && editor.enableLayout === true;
  try {
    if (suspendLayout) editor.enableLayout = false;
    editor.enableTrackChanges = true;
    editor.currentUser = ASSISTANT_DOCUMENT_AUTHOR;
    if (batchRefusal) {
      warnings.push(
        `change_set_preflight_failed: ${changeSetId}; no structural or formatting writes were attempted.`
      );
    } else {
      if (preflightFailures.length)
        warnings.push(
          `group_preflight_failed: ${[...failedGroups].join(
            ', '
          )}; unaffected groups remain eligible to apply.`
        );
      // Phase 2: apply structural writes in request order, refreshing the anchor
      // map after every mutation. This is the only phase allowed to shift blocks.
      for (const plan of plans) {
        const { op, index } = plan;
        const groupId = opGroupId(op, changeSetId);
        if (
          results[index] ||
          FORMAT_OPS.has(op.op) ||
          failedGroups.has(groupId)
        )
          continue;
        stampRevisionGroup(editor, changeSetId, op);
        const revisionsBeforeOp = snapshotRevisions(editor);
        let writtenOp = op;
        let appliedRelocation = plan.relocated;
        let priorRejectStream: string | undefined;
        let priorAcceptStream: string | undefined;
        let storyWrite:
          | { target: LiveStoryTarget; replacement: string }
          | undefined;
        let trackedMutationTargetText: string | undefined;
        let insertInheritance = plan.insertInheritance;
        let inheritanceAppearance: AppearanceWriteOutcome | undefined;
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
              trackedMutationTargetText = plan.target.text;
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
              // That same serialization is what lets the mirror projection prove
              // the write REPLACED the target instead of inserting beside it
              // (`assertStoryTextFrameReplacement`), so both baselines - reject
              // and accept - are captured here.
              //
              // Stories the projection genuinely cannot see (footnote/endnote
              // markers) keep the revision assertion; headers/footers never get
              // this far (`story_write_unverified` refuses them at preflight).
              if (isTextFrameAnchor(op.anchor)) {
                priorRejectStream = rejectStream;
                priorAcceptStream = acceptStream;
              }
              storyWrite = applyLiveStoryTextOp(editor, op, plan.target);
            } else {
              const sectionBoundaryAnchor =
                typeof op.__sectionBoundaryAnchor === 'string'
                  ? op.__sectionBoundaryAnchor.trim()
                  : '';
              const target = sectionBoundaryAnchor
                ? resolveSectionBoundary(
                    blocks,
                    sectionBoundaryAnchor,
                    // Composer boundaries are captured topology, including a
                    // freshly seeded empty paragraph. Their address, not the
                    // content on either side, is the identity contract.
                    undefined
                  )
                : resolveChangeSetBlock(
                    blocks,
                    op.anchor,
                    plan.target,
                    anchorsMayHaveShifted
                  );
              assertDeferredAnchorIsNewAndEmpty(plan, target);
              writtenOp = { ...op, anchor: target.anchor };
              if (target.anchor !== op.anchor)
                appliedRelocation = {
                  from: plan.relocated?.from ?? op.anchor,
                  to: target.anchor
                };
              insertInheritance = rebasePlannedInsertInheritance(
                insertInheritance,
                op,
                writtenOp
              );
              if (insertInheritance) plan.insertInheritance = insertInheritance;
              trackedMutationTargetText = target.text;
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
              if (op.op === 'insert_text' && !insertInheritance) {
                const explicitSource = plan.source
                  ? resolveChangeSetBlock(
                      blocks,
                      String(op.inheritFormatFrom),
                      plan.source,
                      anchorsMayHaveShifted,
                      true
                    )
                  : undefined;
                insertInheritance = planInsertInheritance(
                  editor,
                  // Untyped->typed boundary, same contract as dispatch sites.
                  writtenOp as TypedEditOp<'insert_text'>,
                  target,
                  blocks,
                  liveSfdt,
                  explicitSource
                    ? { source: explicitSource, inherited: plan.inherited }
                    : undefined
                );
                if (insertInheritance)
                  plan.insertInheritance = insertInheritance;
                const boundary = insertInheritance?.find(
                  (candidate) => candidate.sectionBoundary
                )?.sectionBoundary;
                if (boundary) writtenOp = { ...writtenOp, text: boundary.text };
              }
              opExtras = applyAnchoredOp(editor, writtenOp, target, byAnchor);
              if (
                op.op === 'insert_text' &&
                insertInheritance?.some(
                  (candidate) => candidate.sectionBoundary
                )
              ) {
                insertInheritance = applySectionBoundaryInheritance(
                  editor,
                  insertInheritance
                );
                plan.insertInheritance = insertInheritance;
              }
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
              anchor: writtenOp.anchor,
              ...(appliedRelocation ? { relocated: appliedRelocation } : {}),
              ...opExtras
            };
            continue;
          }
          // One committed snapshot feeds the reject- and accept-projection
          // assertions and the refreshed anchor map. Serializing those
          // independently made every exhaustive batch pay two whole-document
          // passes per op.
          const postWriteSfdt =
            (opExtras as OpSuccessExtras | undefined)?.postWriteSfdt ??
            serializeSfdt(editor);
          if (storyWrite && priorAcceptStream !== undefined)
            assertStoryTextFrameReplacement(
              storyWrite,
              priorAcceptStream,
              postWriteSfdt
            );
          assertTrackedMutation(
            editor,
            revisionsBeforeOp,
            writtenOp,
            priorRejectStream,
            postWriteSfdt,
            trackedMutationTargetText
          );
          refresh(postWriteSfdt);
          assertInsertedTableIsAddressable(
            writtenOp,
            byAnchor,
            plan.expectedInsertedTableAnchor
          );
          // Cell text aimed at a row/table created earlier in this batch gets
          // the source-column format captured by that structural op's preflight
          // plan. Apply after the text lands so verification observes the real
          // run, not merely an empty insertion point.
          if (op.op === 'set_cell_text' && writtenOp.anchor) {
            const inheritedCell = plans
              .filter((candidate) => candidate.index < index)
              .flatMap((candidate) => candidate.insertInheritance ?? [])
              .find(
                (candidate) =>
                  !candidate.tableAppearance &&
                  candidate.anchor === writtenOp.anchor
              );
            if (inheritedCell)
              insertInheritance = [
                {
                  ...inheritedCell,
                  expectedText: byAnchor.get(writtenOp.anchor)?.text
                }
              ];
          }
          if (
            op.op === 'insert_table' &&
            Array.isArray(op.initialCells) &&
            insertInheritance
          ) {
            insertInheritance = insertInheritance.map((candidate) =>
              candidate.tableAppearance
                ? candidate
                : {
                    ...candidate,
                    expectedText: byAnchor.get(candidate.anchor)?.text
                  }
            );
            plan.insertInheritance = insertInheritance;
          }
          if (insertInheritance) {
            // Text writes below format their populated cells themselves. The
            // structural op still formats every other new cell now, including
            // row-only/two-phase inserts, and always applies table appearance.
            const cellsWrittenLater = new Set(
              edits
                .slice(index + 1)
                .filter((candidate) => candidate?.op === 'set_cell_text')
                .map((candidate) => String(candidate.anchor ?? ''))
            );
            const applicable =
              op.op === 'insert_table' || op.op === 'insert_row'
                ? insertInheritance.filter(
                    (candidate) =>
                      !!candidate.tableAppearance ||
                      !cellsWrittenLater.has(candidate.anchor)
                  )
                : insertInheritance;
            inheritanceAppearance = applyInsertInheritance(
              editor,
              applicable,
              byAnchor
            );
            if (inheritanceAppearance)
              recordAppearanceRestores(op, inheritanceAppearance.restores);
            // Inheritance changes appearance only. Anchors, text, and both
            // revision projections remain identical to postWriteSfdt, while
            // every inherited property is verified through the public live
            // selection API (table-copy verification carries its own fresh
            // snapshot). Keep the content snapshot instead of serializing the
            // whole document again.
          }
          results[index] = {
            ok: true,
            op: op.op,
            anchor: writtenOp.anchor,
            ...(appliedRelocation ? { relocated: appliedRelocation } : {}),
            ...collectOpExtras(opExtras, (restores) =>
              recordAppearanceRestores(op, restores)
            ),
            ...(inheritanceAppearance
              ? { appearance: inheritanceAppearance.report }
              : {})
          };
        } catch (err) {
          fail(index, op, err);
          if (appliedRelocation)
            results[index] = {
              ...(results[index] ?? { ok: false, op: op.op }),
              anchor: writtenOp.anchor,
              relocated: appliedRelocation
            };
        } finally {
          rememberGroupRevisions(op, revisionsBeforeOp);
        }
        if (results[index] && !results[index]?.ok) {
          rollbackGroup(groupId);
          markGroupFailed(groupId, index, 'rolled back');
        }
      }

      // Phase 3: re-resolve, then apply named style -> direct character -> direct
      // paragraph format -> scoped resolved-format verification per location.
      for (const plan of plans) {
        const { op, index } = plan;
        const groupId = opGroupId(op, changeSetId);
        if (
          results[index] ||
          !FORMAT_OPS.has(op.op) ||
          failedGroups.has(groupId)
        )
          continue;
        stampRevisionGroup(editor, changeSetId, op);
        const revisionsBeforeOp = snapshotRevisions(editor);
        let appliedRelocation = plan.relocated;
        try {
          if (!op.anchor)
            throw new OpError(
              'missing_anchor',
              'Formatting edit needs an anchor.'
            );
          // A table-scoped op names a TABLE, and its anchor is just one of that
          // table's cells - so it must NOT be relocated by cell text. Two tables
          // sharing a header cell is ordinary (it is exactly the captain's
          // document: two Location Schedules with "Loc #" in row 0), and the
          // text match then reports `anchor_relocation_ambiguous` for an op that
          // had no ambiguity at all. A row insert never moves a table's block
          // anchor, so the direct anchor is the right answer here.
          const baselineTarget =
            plan.target && !isLiveStoryTarget(plan.target)
              ? plan.target
              : undefined;
          let target: FlatBlock;
          let createdTarget: FlatBlock | undefined;
          if (!baselineTarget && op.expect != null) {
            if (op.__sectionFinalAnchor) {
              const planned = byAnchor.get(op.__sectionFinalAnchor);
              if (!planned || !expectTextMatches(op.expect, planned.text))
                throw new OpError(
                  'section_paragraph_topology_mismatch',
                  `The composed paragraph planned at "${op.__sectionFinalAnchor}" did not resolve after assembly.`,
                  [
                    `expected: ${JSON.stringify(op.expect)}`,
                    `actual: ${JSON.stringify(planned?.text)}`
                  ]
                );
              createdTarget = planned;
            }
            for (let prior = plans.length - 1; prior >= 0; prior--) {
              if (createdTarget) break;
              const creator = plans[prior];
              if (
                creator.index >= index ||
                creator.op.op !== 'insert_text' ||
                creator.op.anchor !== op.anchor ||
                opGroupId(creator.op, changeSetId) !== groupId ||
                (op.__sectionCreatorId !== undefined &&
                  creator.op.__sectionCreatorId !== op.__sectionCreatorId)
              )
                continue;
              const createdParagraphs = (
                creator.insertInheritance ?? []
              ).filter(
                (candidate) =>
                  !candidate.sectionBoundary &&
                  !candidate.tableAppearance &&
                  candidate.expectedText !== undefined
              );
              const inheritedTarget =
                op.__sectionSegmentIndex !== undefined
                  ? createdParagraphs[op.__sectionSegmentIndex]
                  : createdParagraphs.find(
                      (candidate) =>
                        candidate.expectedText === String(op.expect)
                    );
              if (
                inheritedTarget?.expectedText !== undefined &&
                !expectTextMatches(op.expect, inheritedTarget.expectedText)
              )
                continue;
              if (!inheritedTarget) continue;
              const live = byAnchor.get(inheritedTarget.anchor);
              if (live && expectTextMatches(op.expect, live.text)) {
                createdTarget = live;
                break;
              }
            }
          }
          if (createdTarget) {
            target = createdTarget;
          } else if (
            !baselineTarget &&
            anchorsMayHaveShifted &&
            !TABLE_SCOPED_FORMAT_OPS.has(op.op) &&
            op.expect != null
          ) {
            // This format target did not exist at preflight: an earlier insert
            // created it. Resolve the model's expected text against the live
            // post-structure map instead of blindly taking the old boundary's
            // now-occupied numeric anchor.
            const attempt = attemptAnchorRelocation(blocks, op);
            if ('target' in attempt) target = attempt.target;
            else {
              const noMatch = attempt.details.some((detail) =>
                detail.includes('matching blocks: none')
              );
              throw new OpError(
                noMatch
                  ? 'anchor_relocation_not_found'
                  : 'anchor_relocation_ambiguous',
                `The formatting target created earlier in this change set could not be identified deterministically.`,
                attempt.details
              );
            }
          } else {
            target = resolveChangeSetBlock(
              blocks,
              op.anchor,
              baselineTarget,
              anchorsMayHaveShifted && !TABLE_SCOPED_FORMAT_OPS.has(op.op)
            );
          }
          appliedRelocation =
            target.anchor !== op.anchor
              ? {
                  from: plan.relocated?.from ?? op.anchor,
                  to: target.anchor
                }
              : plan.relocated;
          const source = plan.source
            ? resolveChangeSetBlock(
                blocks,
                String(op.inheritFormatFrom),
                plan.source,
                anchorsMayHaveShifted,
                true
              )
            : undefined;
          resolvedFormatTargets.set(index, target);
          const extras = applyAnchoredOp(
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
          // Formatting cannot shift blocks. Its CAS guard and resolved-format
          // verification read the live public selection, and table appearance
          // handlers take their own fresh snapshots where exact before/after
          // state is required. Consecutive formatting ops therefore share the
          // structural phase's anchor/text snapshot.
          results[index] = {
            ok: true,
            op: op.op,
            anchor: target.anchor,
            ...(appliedRelocation ? { relocated: appliedRelocation } : {}),
            ...collectOpExtras(extras, (restores) =>
              recordAppearanceRestores(op, restores)
            )
          };
        } catch (err) {
          fail(index, op, err);
          if (appliedRelocation)
            results[index] = {
              ...(results[index] ?? { ok: false, op: op.op }),
              relocated: appliedRelocation
            };
        } finally {
          rememberGroupRevisions(op, revisionsBeforeOp);
        }
        if (results[index] && !results[index]?.ok) {
          rollbackGroup(groupId);
          markGroupFailed(groupId, index, 'rolled back');
        }
      }
    }
  } finally {
    editor.enableTrackChanges = priorTrackChanges;
    editor.currentUser = priorCurrentUser;
    if (revisionSettings) revisionSettings.customData = priorRevisionCustomData;
    if (suspendLayout) editor.enableLayout = true;
  }

  refuseReusedUserStatedFigures(results);
  if (!batchRefusal) {
    results.forEach((result, index) => {
      if (
        !result ||
        result.ok ||
        nonBlockingStoryWriteFailures.has(index) ||
        failedGroups.has(opGroupId(edits[index], changeSetId))
      )
        return;
      const groupId = opGroupId(edits[index], changeSetId);
      rollbackGroup(groupId);
      markGroupFailed(groupId, index, 'rolled back');
    });
    // Coverage-only story refusals still make their own review group fail, but
    // preserve the established contract that a verified body write can remain
    // tracked. A differently named group is unaffected and remains `ok`.
    results.forEach((result, index) => {
      if (
        !result ||
        result.ok ||
        failedGroups.has(opGroupId(edits[index], changeSetId))
      )
        return;
      markGroupFailed(opGroupId(edits[index], changeSetId), index, 'refused');
    });
  }

  const wroteAppearance = appearanceRestores.length > 0;
  const grouping = groupNewRevisions(
    editor,
    revisionSnapshot,
    changeSetId,
    appearanceRestoresByGroup
  );
  const revisionCount = grouping.revisionCount;
  const hasFailure = results.some((result) => result && !result.ok);
  const inventory = readPostEditInventory(editor, warnings);
  warnings.push(
    `document_serialization: count=${
      serializationTiming.count
    }; total_ms=${serializationTiming.totalMs.toFixed(1)}`
  );
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
      groups: reportRevisionGroups(
        edits,
        changeSetId,
        grouping.revisionsByGroup,
        grouping.appearanceGroups
      ),
      ...(wroteAppearance
        ? {
            // Only every appearance group having found a card to ride on makes
            // "reject and the appearance comes back" true of the whole batch.
            // If any group wrote appearance without producing a revision, that
            // appearance is already applied with nothing to reject, so the batch
            // says so; `groups[].restoresAppearance` still names the exact
            // groups a reject would restore.
            formatTracking:
              grouping.appearanceGroups.size === appearanceRestoresByGroup.size
                ? ('grouped_with_revision_cards' as const)
                : ('untracked_immediate' as const)
          }
        : {}),
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
