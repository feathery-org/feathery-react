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
//      around the batch (then forced off so user typing stays untracked) and
//      an `expect` compare-and-swap guard.
//
// Anchor scheme: an anchor IS the SyncFusion hierarchical index prefix of a
// block, with the trailing character offset omitted. A top-level paragraph is
// `"{sectionIndex};{blockIndex}"`; a table-cell paragraph is
// `"{sectionIndex};{blockIndex};{rowIndex};{cellIndex};{cellBlockIndex}"`. To
// address a character range inside the block we append `;{offset}` -> the exact
// string `documentEditor.selection.select(start, end)` consumes.
//
// Bound documents take a second route through that apply engine. A document
// whose content controls carry tags in the binding grammar (see
// `../../../elements/components/DocxEditor/bindings`) is edited through the
// binding engine instead of by selecting text and typing over it, because a
// selection write deletes the content control it lands in - tag and all - and
// with it the binding. Every result says which route it took:
//
//   - `route: 'engine'` - the binding engine performed the write inside one
//     transaction, then recomputed every formula that depended on it. The SFDT
//     diff is opened with first-class revisions, so the input and its dependent
//     formulas are one reviewable group. A batch mixing both routes remains
//     all-or-nothing, and editor-routed edits are undone if the engine fails.
//   - `route: 'editor'` - the ordinary tracked write above, unchanged.
//
// Bindings do not lock a document down wholesale: an op that touches nothing
// bound still takes the editor route in a bound document, and only tags in the
// binding grammar count, so a .docx carrying ordinary Word content controls
// keeps exactly the behaviour it had before bindings existed. Reads advertise
// the same facts: `binding` on an inventory entry, a table, a row or a cell is
// how the model learns what is computed and what it may write.

// This module is the only document-editing engine that ships in the SDK. Keep
// fixes here rather than forking a copy into a host application, so the in-form
// editor container and every assistant tool stay on one implementation.
import {
  AdvertisedDocumentOp,
  AnchoredDocumentOp,
  AnchorlessDocumentOp,
  DOCUMENT_EDITOR_CAPABILITIES,
  FigureSourceCitation,
  OpParams,
  SectionComposerBlock,
  SectionComposerSpec
} from '../../capabilities/registry';
import {
  CellNumberFormat,
  classifyNumericText,
  isZeroPaddedInteger,
  NumericValue,
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
import type {
  BindingInstanceChoice,
  BindingWireIdentity,
  BindingWriteAmbiguity,
  BindingWriteResolution
} from './bindingWriteContract';
// Binding engine primitives. Imported rather than re-implemented so a content
// control this engine did not author is never mistaken for a binding, and bound
// values use the same parse/render/transaction path as direct editor input.
import {
  formatTag,
  parseTag
} from '../../../elements/components/DocxEditor/bindings/core/tagDsl';
import type { Definition } from '../../../elements/components/DocxEditor/bindings/core/tagDsl';
import {
  defaultValue,
  isValueError,
  parseDisplay,
  renderDisplay
} from '../../../elements/components/DocxEditor/bindings/core/valueTypes';
import {
  collectRefs,
  parseExpression
} from '../../../elements/components/DocxEditor/bindings/core/formula';
import {
  addLineItem,
  getAt,
  removeLineItem,
  scanBindings,
  setAt,
  setOccurrenceText,
  setTaggedValue
} from '../../../elements/components/DocxEditor/bindings/core/sfdtAdapter';
import type {
  BindingIndex,
  Occurrence,
  TableEntry
} from '../../../elements/components/DocxEditor/bindings/core/sfdtAdapter';
import {
  bindingCommandSurfaceFor,
  diffBindingCommands,
  type BindingCommandSurface
} from '../../../elements/components/DocxEditor/bindings/reconcileRegistry';
import {
  AppearanceFacts,
  appearanceEquals,
  AppearanceWriteOutcome,
  AppearanceWriteReport,
  bandedShadingForRow,
  BORDER_SIDES,
  BorderFacts,
  BorderSide,
  cellAppearanceAt,
  collectTableAppearance,
  copiedCellAppearance,
  copiedRowIsHeader,
  headerBandContains,
  detectTableBanding,
  effectiveCellAppearance,
  inferHeaderRows,
  resolvedCellAppearanceAt,
  rowShadings,
  sourceRowForTarget,
  TableAppearance,
  TableBanding,
  tableLayoutEquals,
  tableLayoutForTarget,
  tableIsUnstyled,
  uniformDataRowShading,
  UNSTATED_TABLE_LAYOUT
} from './tableAppearance';
import {
  createdRevisions,
  disableUserTrackChanges,
  groupRevisionsAtomic,
  invalidateDocumentLayout,
  installRevisionGroupIsolation,
  liveTableWidgetAt,
  paragraphIdentityText,
  parseRevisionGroupTag,
  preserveDocumentViewDuring,
  rebindRevisionGroups,
  resolveRevisionIndividually,
  revisionGroupTag,
  snapshotRevisions,
  wrappingDocumentEditorContainer,
  writeTableLayout,
  writeTableProperties
} from '../../../utils/documentEditorPrimitives';
import type {
  AppearanceRestore,
  AppearanceWrite,
  ParagraphStyleRestore,
  BorderWrite,
  CellPropertyFacts,
  LiveEditor,
  LiveRevision,
  RowPropertyFacts,
  TableLayoutFacts,
  TablePropertyFacts,
  TablePropertyRestore
} from '../../../utils/documentEditorPrimitives';

// The engine's public editor handle type; every spec drives ops through it.
export type { LiveEditor } from '../../../utils/documentEditorPrimitives';

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

/**
 * What a read tells the model about one binding: enough to see that a figure is
 * computed rather than typed, and which field to change instead.
 */
export interface BindingFact {
  /** The binding's name, i.e. what a formula refers to it by. */
  field: string;
  /** Explicit wire identity; equal field labels do not imply global scope. */
  identity: BindingWireIdentity;
  /** `formula` is engine-owned and refuses every write; `input` is editable. */
  kind: 'input' | 'formula';
  /** The expression a formula binding computes, in the engine's vocabulary. */
  expr?: string;
  /** The bound table this binding belongs to, for a cell inside one. */
  table?: string;
  /** The bound row id, which survives the row moving or being renumbered. */
  row?: string;
}

/** The bound identity of a table, on both structure and facts reads. */
export interface BoundTableFact {
  kind: 'bound';
  tableId: string;
  /**
   * The table's bound rows in document order - unbound rows (a header, a totals
   * row) are not listed. `null` marks a bound row carrying no row id.
   */
  rowIds: Array<string | null>;
  /** The names of the table's bound columns. */
  columns: string[];
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
  /**
   * Every document binding this block carries, in document order.
   *
   * A list rather than a single fact because Word lets any number of inline
   * content controls share one paragraph - "Effective [date], quoted at
   * [tax_rate] tax." is two. Reporting only the first left every later bound
   * value invisible to the model, and a bound value the model cannot see is a
   * bound value it cannot change.
   */
  bindings?: BindingFact[];
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
  /**
   * Present when the table is bound: structural ops on it route to the engine.
   */
  binding?: BoundTableFact;
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
  /**
   * The binding this cell holds, when it holds one. A `formula` cell is written
   * by changing the inputs it is computed from, never directly.
   */
  binding?: BindingFact;
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
  /**
   * The row's binding identity, when it has one. `rowId` is what the engine
   * addresses the row by, so it survives rows above it being added or removed.
   */
  binding?: { rowId: string | null };
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
  /** Present when the table is bound, with its row ids and bound columns. */
  binding?: BoundTableFact;
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
    | 'authored_matrix_checked'
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
// Writes a whole cell matrix in one op, so its figures are checked over that
// matrix at the batch boundary (detectUnsourcedAuthoredFigures) rather than one
// op text against one cell. Same rule, same quantity-column definition.
const MATRIX_AUTHORED_CELL_TEXT_OPS = new Set(['insert_table']);

function observeMutationGuardBoundary(
  op: EditOp,
  cas: MutationGuardCoverage['cas']
): void {
  mutationGuardObserver?.({
    op: op.op,
    cas,
    numberProvenance: MODEL_AUTHORED_CELL_TEXT_OPS.has(op.op)
      ? 'model_authored_text_checked'
      : MATRIX_AUTHORED_CELL_TEXT_OPS.has(op.op)
      ? 'authored_matrix_checked'
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
/**
 * A style the engine resolved from the document where the model had asked for
 * a different one, on a paragraph this change set created. Reported in BOTH
 * directions - it is how a wrong resolver stays visible instead of silently
 * imposed.
 */
export interface ComposedStyleDisagreement {
  requested: string;
  resolved: string;
  from: string;
}

/** The record a creation path leaves when the document could not answer. */
export interface CreationGap {
  /** The component that could not inherit. */
  what: string;
  reason: string;
  /** Everywhere the resolver looked, in order. */
  searched: string[];
}

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

/**
 * What the composer actually inherited, and from where. The engine has exactly
 * one honest answer for "did this composed unit take the sibling family's look,
 * or did it fall back to the editor's defaults?", and it belongs in the result
 * rather than in the appearance of the output - a fallback that reads exactly
 * like a success is how a wrong family survived a day of testing.
 */
export interface ComposedSectionInheritance {
  /** The block whose sibling family every inherited format came from. */
  familyAnchor: string;
  /** That family's outline level, and how many siblings it was derived from. */
  level?: number;
  siblings: number;
  /** The donor each composed unit copied, in spec order. */
  donors: Array<{ unit: string; from: string }>;
  /**
   * Composed units the DOCUMENT could not supply a donor for, with everywhere
   * the resolver looked. These are written with the editor's defaults, NOT
   * with the document's look, and that is the single fact this report exists
   * to make visible.
   */
  withoutDonor?: CreationGap[];
  // Present when the engine resolved a style from the document that differs
  // from the one the op asked for, on a paragraph this change set created.
  styleResolved?: ComposedStyleDisagreement;
}

export interface EditResult {
  ok: boolean;
  anchor?: string;
  op: string;
  /**
   * Which path the edit took: `engine` for a binding-engine transaction (which
   * recomputes dependent formulas and authors one grouped SFDT change set),
   * `editor` for the ordinary native tracked write. Every applied result carries
   * it; `editor` is the default, so a document with no bindings reports nothing
   * but `editor`.
   */
  route?: 'engine' | 'editor';
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
  /** Present when a non-global write needs an explicit user choice. */
  ambiguity?: BindingWriteAmbiguity;
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
  // Present on a successful `delete_row` that removed at least one row which was
  // ITSELF an unaccepted insertion: how many. Those rows are gone outright, with
  // no card to review and no reject that can restore them (see
  // assertTrackedMutation); the rest of the set are ordinary tracked deletions.
  // Absent means every row removed became a tracked deletion.
  withdrewPendingInsertion?: number;
  // Present on a successful appearance op (set_cell_format / set_row_format /
  // copy_table_format / restripe_table): what it wrote, what it left alone, and
  // the stripe it detected. The engine's own account, so "did the restripe
  // actually do anything" is answerable from the result.
  appearance?: AppearanceWriteReport;
  // Present on a successful `insert_section`: which sibling family the composed
  // unit inherited from, the donor behind each composed block, and - the point
  // of the field - any block the family could not dress, which therefore wears
  // the editor's defaults rather than the document's look.
  inherited?: ComposedSectionInheritance;
  // Present on a successful creation the DOCUMENT could not dress: the
  // component, why, and everywhere the resolver looked. Its absence is the
  // engine's statement that everything it created inherited from the document.
  withoutDonor?: CreationGap[];
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
  /**
   * The binding tag of a document field or formula living in this block, when it
   * has one. Present only in documents that use bindings, and only on the blocks
   * that are bound; ops consult it to refuse writes that would destroy a binding.
   */
  boundTag?: string;
  /** Visible-text ranges occupied by bindings in this paragraph/cell. */
  bindingRanges?: Array<{ tag: string; start: number; end: number }>;
  /**
   * Set when this block shares a paragraph with a BINDING content control, or
   * sits inside one. SyncFusion's live offsets count a control's boundary markers
   * as positions while this walker counts only characters, so an anchored write
   * here lands off by however many markers precede it. Ops refuse rather than
   * write into a range they cannot address exactly.
   *
   * Only tags in the binding grammar count. A document carrying ordinary Word
   * structured document tags is not a bound document and keeps the write
   * behaviour it had before bindings existed.
   */
  offsetsUntrusted?: true;
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

/**
 * Revision ids carried by the inlines of one anchored block.
 *
 * Anchors are `section;block` for body paragraphs and
 * `section;block;row;cell;para` inside a table.
 */
function resolveAnchoredNode(sfdt: any, anchor: string): any {
  const parts = String(anchor).split(';');
  const sections: any[] = pick(sfdt, 'sections', 'sec') ?? [];
  const section = sections[Number(parts[0])];
  if (!section) return undefined;
  // Anchors count EXPANDED blocks: a block-level content control holding N
  // blocks contributes N entries. Raw indices diverge from anchors the moment
  // such a control holds anything but exactly one block - which is precisely
  // what a bound document has - so resolve the same way `tableContainerAt` does.
  //
  // UNWRAP. expandBlockContentControls yields `{ block, insideControl }` pairs,
  // not raw blocks. The previous caller never unwrapped and got away with it
  // only because it walked every value looking for revision ids, so it reached
  // `.block` by accident. A TABLE anchor did not get away with it: getRows on
  // the wrapper finds nothing, cell resolution collapses to undefined, and the
  // foreign-revision guard silently found NOTHING for every table-cell anchor -
  // set_cell_text was unguarded. Unwrapping here fixes that hole too.
  const entry = expandBlockContentControls(getBlocks(section))[
    Number(parts[1])
  ];
  if (!entry) return undefined;
  let block: any = entry.block;
  if (!block) return undefined;
  if (parts.length >= 5) {
    const rows =
      getRows(block) ?? getRows(getBlocks(block).find((b: any) => getRows(b)));
    const row = rows?.[Number(parts[2])];
    const cells = pick(row, 'cells', 'c');
    const cell = Array.isArray(cells) ? cells[Number(parts[3])] : undefined;
    block = getBlocks(cell)[Number(parts[4])] ?? cell;
  }
  return block;
}

/** Every revision id anywhere in an anchored block, at any depth. */
function revisionIdsAtAnchor(sfdt: any, anchor: string): Set<string> {
  const found = new Set<string>();
  const block = resolveAnchoredNode(sfdt, anchor);
  if (!block) return found;
  const collect = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(collect);
    const ids = pick(node, 'revisionIds', 'rids');
    if (Array.isArray(ids)) for (const id of ids) found.add(String(id));
    for (const value of Object.values(node)) collect(value);
  };
  collect(block);
  return found;
}

/**
 * Where each revision sits, in the SAME offset space `find` resolves against.
 *
 * Deliberately the structural twin of `bindingRangesOf` below: same walk, same
 * skip rule, same offset counter. The two must agree, because both map a
 * character range onto the live text that `inlineText` projects - and an offset
 * walk that drifts from the one the caller used is a guard that fires on the
 * wrong text.
 *
 * ONE DELIBERATE DIFFERENCE. `bindingRangesOf` drops an inline whose revisions
 * are all deletions, because deleted text is not part of the live projection.
 * This must NOT drop it: a pending deletion is the single most dangerous thing
 * in the paragraph, since SyncFusion re-authors it under the current user
 * rather than leaving it alone. It occupies no live width, so it is recorded as
 * a ZERO-WIDTH marker sitting at the current offset.
 */
function revisionRangesOf(
  inlines: any[],
  deletedIds: Set<string>
): Array<{ id: string; start: number; end: number }> {
  const ranges: Array<{ id: string; start: number; end: number }> = [];
  let offset = 0;
  const walk = (items: any[]): void => {
    for (const inline of items) {
      if (inline == null) continue;
      // Two places, not one. A run carries its content revisions directly, and
      // a TRACKED FORMATTING change is recorded on the run's own
      // characterFormat. Reading only the first missed the second entirely, so
      // a foreign tracked formatting change on a run was narrowed straight past
      // - the same lost-protection shape as the paragraph mark.
      const raw = pick(inline, 'revisionIds', 'rids');
      const formatRaw = pick(
        pick(inline, 'characterFormat', 'cf'),
        'revisionIds',
        'rids'
      );
      const ids = [
        ...(Array.isArray(raw) ? raw.map(String) : []),
        ...(Array.isArray(formatRaw) ? formatRaw.map(String) : [])
      ];
      const start = offset;
      if (ids.length > 0 && ids.every((id) => deletedIds.has(id))) {
        // CURRENTLY UNREACHABLE for a FOREIGN pending deletion: the guard
        // detects that case earlier and abandons the narrowing altogether, so
        // this branch never decides anything for one. It is kept, and kept
        // correct, because it still runs for the assistant's OWN pending
        // deletions (which are not in `preExisting` and so are filtered out
        // downstream), and because it is what the branch must do the day the
        // liveText projection is fixed and narrowing over deletions becomes
        // safe again. Deleting it would quietly remove the offset arithmetic
        // that restoration depends on.
        for (const id of ids) ranges.push({ id, start, end: start });
        continue;
      }
      const nested = getInlines(inline);
      if (nested.length) {
        walk(nested);
        for (const id of ids) ranges.push({ id, start, end: offset });
        continue;
      }
      const text = pick(inline, 'text', 'tlp');
      if (typeof text === 'string') offset += text.length;
      for (const id of ids) ranges.push({ id, start, end: offset });
    }
  };
  walk(inlines);
  return ranges;
}

/**
 * Does a revision's span touch the half-open range [start, end) being written?
 *
 * A zero-width marker (a pending deletion) counts when it sits anywhere from
 * the start boundary to the end boundary INCLUSIVE. That is deliberately
 * generous: a deletion sitting exactly where the write begins or ends is inside
 * the text SyncFusion's selected-range delete will walk over, and a guard whose
 * job is to prevent an unrecoverable re-authoring should err toward refusing.
 */
function revisionTouchesRange(
  revision: { start: number; end: number },
  start: number,
  end: number
): boolean {
  return revision.start === revision.end
    ? revision.start >= start && revision.start <= end
    : revision.start < end && revision.end > start;
}

/**
 * Revision ids the character-range walk CANNOT address, at an anchor.
 *
 * Two of them, and both were invisible to the narrowing until review caught it:
 *
 *   PARAGRAPH MARK  `characterFormat.revisionIds` on the block itself. Deleting
 *                   a paragraph mark is how a paragraph gets merged into the
 *                   next one. It is not in any run, so walking inlines never
 *                   sees it.
 *   ROW FORMAT      `rowFormat.revisionIds` on a table row - a whole inserted or
 *                   deleted row. Worse than the paragraph mark: it hangs off the
 *                   ROW, above the cell's paragraph, so even the block-wide
 *                   recursion from a cell anchor cannot reach it.
 *
 * Neither has a character range, so there is nothing to intersect a write
 * against - which is exactly why the answer is to stop narrowing rather than to
 * invent an offset for them.
 */
function structuralRevisionIdsAtAnchor(sfdt: any, anchor: string): Set<string> {
  const found = new Set<string>();
  const add = (ids: unknown): void => {
    if (Array.isArray(ids)) for (const id of ids) found.add(String(id));
  };
  const node = resolveAnchoredNode(sfdt, anchor);
  add(paragraphMarkRevisionIds(node));
  // A run's own characterFormat revision ids - a tracked FORMATTING change.
  // Included here as well as in the range walk: a formatting revision covers a
  // run whose boundaries need not line up with the text being written, so the
  // safe reading is to treat it as structural and stop narrowing.
  for (const inline of getInlines(node))
    add(pick(pick(inline, 'characterFormat', 'cf'), 'revisionIds', 'rids'));
  const parts = String(anchor).split(';');
  if (parts.length >= 5) {
    const sections: any[] = pick(sfdt, 'sections', 'sec') ?? [];
    const section = sections[Number(parts[0])];
    const entry = section
      ? expandBlockContentControls(getBlocks(section))[Number(parts[1])]
      : undefined;
    const table = entry?.block;
    const rows = table
      ? getRows(table) ?? getRows(getBlocks(table).find((b: any) => getRows(b)))
      : undefined;
    add(rowRevisionIds(rows?.[Number(parts[2])]));
  }
  return found;
}

/** The revisions that already existed when this change set began. */
const PRE_EXISTING_REVISIONS_KEY = '__fmPreExistingRevisionIds';

/**
 * Refuse to overwrite text that carries somebody else's pending tracked change.
 *
 * SyncFusion's tracked delete does not leave such a revision alone: for an
 * element already carrying a pending Deletion it UNLINKS that revision, authors
 * a replacement under the current user, and drops the original from the
 * collection. The user's deletion silently becomes the assistant's - so a later
 * reject of the assistant's work resurrects text the USER deleted, and a failed
 * op's rollback does the same immediately. Neither is recoverable afterwards,
 * because by then the user's revision no longer exists in any form.
 *
 * So this refuses before the write, the same stance every other op takes toward
 * a range it cannot address safely.
 */
function assertNoForeignPendingRevisions(
  editor: LiveEditor,
  block: FlatBlock,
  op: EditOp,
  // The character range this op will actually overwrite, in the same offset
  // space `find` was resolved in. Omit it when the op rewrites the WHOLE block
  // (set_cell_text, change_case, a replace_text with no `find`) - then every
  // revision in the block genuinely is in range and block granularity is not a
  // widening, it is the truth.
  range?: { start: number; end: number }
): void {
  const preExisting: Set<string> | undefined = (editor as any)[
    PRE_EXISTING_REVISIONS_KEY
  ];
  if (!preExisting || !preExisting.size) return;
  let touched: string[] = [];
  try {
    const sfdt = serializeSfdt(editor);
    const deletedIds = deletedRevisionIds(sfdt);
    const node = range ? resolveAnchoredNode(sfdt, block.anchor) : undefined;
    const ranges = node ? revisionRangesOf(getInlines(node), deletedIds) : [];
    // A foreign revision on the paragraph mark or on a table row has no
    // character range, so the range filter below cannot see it and would let
    // the write through - a protection the block-wide path used to give. When
    // one is present the narrowing is abandoned, same as for a pending deletion.
    const structuralIds = structuralRevisionIdsAtAnchor(sfdt, block.anchor);
    const foreignStructural = [...structuralIds].filter((id) =>
      preExisting.has(id)
    );
    // A foreign pending DELETION in this block makes the caller's offsets
    // untrustworthy, so the range is discarded and the block-wide check runs.
    //
    // MEASURED, and it is an engine defect independent of this guard: with a
    // pending deletion present, `liveText` comes back as the deletion-INCLUDED
    // text truncated to the length of the deletion-EXCLUDED text. On
    // "Alpha beta gamma delta." with "beta " pending-deleted, liveText reads
    // "Alpha beta gamma d" - a hybrid of two projections that is neither. Any
    // index resolved in it points at the wrong characters.
    // Until that is fixed, narrowing here would mean trusting offsets that are
    // known wrong, so this deliberately gives up the narrowing for these blocks
    // and keeps the safe answer. The trade is pinned by the deletion cases in
    // tests/foreignRevisionRange.spec.ts, including a control that fails if the
    // narrowing is ever lost entirely.
    const blockCarriesForeignDeletion = ranges.some(
      (revision) => preExisting.has(revision.id) && deletedIds.has(revision.id)
    );
    if (range && !blockCarriesForeignDeletion && !foreignStructural.length) {
      // Narrow to the range actually being written. Before this, a foreign
      // revision ANYWHERE in the paragraph refused the op - so a paragraph
      // carrying one pending change made every other word in it unwritable,
      // which is a refusal the user cannot act on and cannot understand.
      touched = [
        ...new Set(
          ranges
            .filter(
              (revision) =>
                preExisting.has(revision.id) &&
                revisionTouchesRange(revision, range.start, range.end)
            )
            .map((revision) => revision.id)
        )
      ];
    } else {
      // `revisionIdsAtAnchor` recurses the block, so it reaches the paragraph
      // mark - but a row lives ABOVE the cell's paragraph, so rowFormat ids are
      // unioned in explicitly. Without them a foreign row revision is invisible
      // on every path.
      const ids = revisionIdsAtAnchor(sfdt, block.anchor);
      touched = [
        ...new Set(
          [...ids, ...structuralIds].filter((id) => preExisting.has(id))
        )
      ];
    }
  } catch (error) {
    // FAIL CLOSED. This used to swallow the error and return, which let a write
    // proceed unguarded precisely when the document could not be read - the one
    // moment there is least reason to trust it. Refusing is the same stance the
    // rest of this file takes toward a range it cannot address safely.
    throw new OpError(
      'pending_revision_check_failed',
      `${op.op} could not verify whether "${block.anchor}" carries somebody else's pending tracked change, so nothing was written.`,
      [
        `anchor: ${block.anchor}`,
        `reason: ${(error as Error)?.message ?? String(error)}`,
        'Retry the operation; if it keeps failing, re-read the document with getDocumentInventory.'
      ]
    );
  }
  if (!touched.length) return;
  throw new OpError(
    'pending_revision_in_range',
    `${op.op} would overwrite text at "${block.anchor}" that carries ${
      touched.length
    } pending tracked change${
      touched.length === 1 ? '' : 's'
    } made before this edit. Rewriting it re-authors that change as the assistant's, so accepting or rejecting it later would no longer do what its author intended. Nothing was written.`,
    [
      `anchor: ${block.anchor}`,
      `pending revisions in range: ${touched.join(', ')}`,
      'Accept or reject the existing tracked changes first, or target a range that does not overlap them.'
    ]
  );
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
    // A content control wraps its runs in a nested inline list, so its text is
    // one level down. Without descending, every value held by a bound field or
    // formula is invisible here - the document reads as though those cells were
    // empty, and so does everything built on this: the inventory, table facts,
    // and the search index.
    else if (getInlines(inline).length)
      out += inlineText(getInlines(inline), deletedIds);
    // Tabs render as whitespace in the offset stream.
    else if (inline.name === 'Tab' || inline.tlp === undefined) continue;
  }
  return out;
}

function bindingRangesOf(
  inlines: any[],
  deletedIds: Set<string>
): Array<{ tag: string; start: number; end: number }> {
  const ranges: Array<{ tag: string; start: number; end: number }> = [];
  let offset = 0;
  const walk = (items: any[]) => {
    for (const inline of items) {
      if (inline == null) continue;
      const revisionIds = pick(inline, 'revisionIds', 'rids');
      if (
        Array.isArray(revisionIds) &&
        revisionIds.length > 0 &&
        revisionIds.every((id) => deletedIds.has(String(id)))
      )
        continue;
      const nested = getInlines(inline);
      if (nested.length) {
        const start = offset;
        walk(nested);
        const def = bindingDefinitionOf(inline);
        if (def && (def.kind === 'field' || def.kind === 'formula')) {
          const properties = pick(inline, 'contentControlProperties', 'ccp');
          ranges.push({
            tag: String(pick(properties, 'tag', 'tg')),
            start,
            end: offset
          });
        }
        continue;
      }
      const text = pick(inline, 'text', 'tlp');
      if (typeof text === 'string') offset += text.length;
    }
  };
  walk(inlines);
  return ranges.sort((left, right) => left.start - right.start);
}

/**
 * The binding tag of the first document field or formula in a block's runs.
 *
 * A bound value is not editable text: it is owned by the binding engine, which
 * rewrites it on every reconcile. Worse, the write primitive these ops use -
 * select a range, then insertText - DELETES a content control outright rather
 * than replacing its contents, so a write aimed at a bound cell destroys the
 * author's binding instead of changing its value. Ops refuse instead.
 *
 * Foreign content controls return undefined: parseTag only claims tags in the
 * binding grammar, so a control this engine did not author is ordinary text.
 */
function boundTagOf(inlines: any[]): string | undefined {
  if (!Array.isArray(inlines)) return undefined;
  for (const inline of inlines) {
    const def = bindingDefinitionOf(inline);
    if (def && (def.kind === 'field' || def.kind === 'formula')) {
      const properties = pick(inline, 'contentControlProperties', 'ccp');
      return String(pick(properties, 'tag', 'tg'));
    }
    const nested = getInlines(inline);
    if (nested.length) {
      const found = boundTagOf(nested);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * The binding definition a node's content control declares, or null.
 *
 * The single place that decides whether a content control belongs to this
 * engine. Anything the binding grammar does not claim - a Word form field, a
 * template's plain-text SDT, a malformed tag - is ordinary content, and the
 * whole bound-document write regime must stay off it.
 */
function bindingDefinitionOf(node: any): Definition | null {
  const properties = node && pick(node, 'contentControlProperties', 'ccp');
  const tag = properties && pick(properties, 'tag', 'tg');
  if (typeof tag !== 'string') return null;
  try {
    return parseTag(tag) ?? null;
  } catch {
    // A malformed binding tag is the engine's diagnostic to raise, not ours.
    return null;
  }
}

// A content control that wraps BLOCKS rather than runs - how a table marker is
// expressed - is transparent to the walker: the blocks inside it are the ones the
// document addresses. SyncFusion agrees; with the costs table wrapped in a
// marker, its own selection offsets still report the table as block 2, not the
// wrapper. Leaving the wrapper opaque made every configured table flatten to an
// empty paragraph, i.e. invisible.
function expandBlockContentControls(
  blocks: any[],
  insideControl = false
): Array<{ block: any; insideControl: boolean }> {
  const out: Array<{ block: any; insideControl: boolean }> = [];
  for (const block of blocks) {
    const isWrapper =
      block &&
      pick(block, 'contentControlProperties', 'ccp') !== undefined &&
      Array.isArray(pick(block, 'blocks', 'b')) &&
      !getRows(block) &&
      !pick(block, 'inlines', 'i');
    if (isWrapper)
      out.push(
        ...expandBlockContentControls(
          getBlocks(block),
          // A foreign wrapper is transparent for ADDRESSING but says nothing
          // about offsets: only a binding marker makes the content inside it
          // unaddressable.
          insideControl || bindingDefinitionOf(block) !== null
        )
      );
    else out.push({ block, insideControl });
  }
  return out;
}

/** Whether a paragraph's runs contain a content control this engine authored. */
function hasBindingContentControl(inlines: any[]): boolean {
  if (!Array.isArray(inlines)) return false;
  for (const inline of inlines) {
    if (bindingDefinitionOf(inline)) return true;
    if (hasBindingContentControl(getInlines(inline))) return true;
  }
  return false;
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
  styleFontSize: number;
  declaredLevel?: number;
  paragraphs: number;
  characters: number;
  headingShaped: number;
  effectiveFontSizes: Map<number, { paragraphs: number; characters: number }>;
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
  paragraphs: { styleName: string; text: string; fontSize?: number }[]
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
        styleFontSize: resolveFontSize(styleName),
        paragraphs: 0,
        characters: 0,
        headingShaped: 0,
        effectiveFontSizes: new Map()
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
    const characters = paragraph.text.trim().length;
    use.characters += characters;
    if (looksLikeHeadingText(paragraph.text)) use.headingShaped++;
    const effectiveFontSize = paragraph.fontSize ?? use.styleFontSize;
    const observed = use.effectiveFontSizes.get(effectiveFontSize) ?? {
      paragraphs: 0,
      characters: 0
    };
    observed.paragraphs++;
    observed.characters += characters;
    use.effectiveFontSizes.set(effectiveFontSize, observed);
  }

  // A direct run/paragraph size overrides the style table in Word. Rank a
  // style by the size most of its real paragraphs render at, falling back to
  // the declared style size. One exceptional override must not split siblings;
  // ties choose the larger size, the conservative (shallower) interpretation.
  const effectiveFontSize = (use: StyleUsage): number => {
    let selected = use.styleFontSize;
    let selectedParagraphs = 0;
    let selectedCharacters = 0;
    for (const [fontSize, observed] of use.effectiveFontSizes) {
      if (
        observed.paragraphs > selectedParagraphs ||
        (observed.paragraphs === selectedParagraphs &&
          (observed.characters > selectedCharacters ||
            (observed.characters === selectedCharacters &&
              fontSize > selected)))
      ) {
        selected = fontSize;
        selectedParagraphs = observed.paragraphs;
        selectedCharacters = observed.characters;
      }
    }
    return selected;
  };

  // Body text size: the size most of the document's text - measured in
  // characters, not paragraphs, since headings are short by nature - is set in,
  // counting only styles that are not already recognised headings. A tie
  // resolves to the larger size because a higher bar infers FEWER headings,
  // which is the safe direction to be wrong in.
  const charactersBySize = new Map<number, number>();
  for (const use of usage.values()) {
    if (use.declaredLevel !== undefined) continue;
    const fontSize = effectiveFontSize(use);
    charactersBySize.set(
      fontSize,
      (charactersBySize.get(fontSize) ?? 0) + use.characters
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
    const renderedFontSize = effectiveFontSize(use);
    if (use.declaredLevel !== undefined) {
      levels.set(key, use.declaredLevel);
      headingFontSizes.add(renderedFontSize);
      continue;
    }
    if (use.paragraphs === 0) continue;
    // Classification and relative depth use different evidence. A custom
    // heading style remains a heading when its own typography is distinctive,
    // but direct overrides decide where that heading renders in the ladder.
    if (use.styleFontSize < bodyFontSize * HEADING_SIZE_RATIO) continue;
    if (use.headingShaped * 2 < use.paragraphs) continue;
    inferred.push({ key, fontSize: renderedFontSize });
    headingFontSizes.add(renderedFontSize);
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
    fontSize?: number;
    declaredLevel?: number;
  }[] = [];
  const sections: any[] = pick(sfdt, 'sections', 'sec') ?? [];
  const deletedIds = dropRevisionIds ?? deletedRevisionIds(sfdt);

  sections.forEach((section, si) => {
    expandBlockContentControls(getBlocks(section)).forEach((entry, bi) => {
      const { block, insideControl } = entry;
      const rows = getRows(block);
      if (rows) {
        // Table: descend into each cell's blocks.
        rows.forEach((row: any, ri: number) => {
          const cells: any[] = pick(row, 'cells', 'c') ?? [];
          cells.forEach((cell, ci) => {
            expandBlockContentControls(getBlocks(cell)).forEach(
              (cellEntry, cbi) => {
                const cb = cellEntry.block;
                const text = inlineText(getInlines(cb), deletedIds);
                const format = readFormat(cb);
                const cellBoundTag = boundTagOf(getInlines(cb));
                const cellBindingRanges = bindingRangesOf(
                  getInlines(cb),
                  deletedIds
                );
                const cellOffsetsUntrusted =
                  insideControl ||
                  cellEntry.insideControl ||
                  hasBindingContentControl(getInlines(cb));
                out.push({
                  anchor: `${si};${bi};${ri};${ci};${cbi}`,
                  kind: 'table_cell',
                  text,
                  format,
                  ...readBlockFormats(cb),
                  isHeading: false,
                  level: -1,
                  length: text.length,
                  ...(cellBoundTag ? { boundTag: cellBoundTag } : {}),
                  ...(cellBindingRanges.length
                    ? { bindingRanges: cellBindingRanges }
                    : {}),
                  ...(cellOffsetsUntrusted ? { offsetsUntrusted: true } : {})
                });
                paragraphs.push({
                  styleName: format?.styleName ?? '',
                  text,
                  ...(format?.fontSize !== undefined
                    ? { fontSize: format.fontSize }
                    : {})
                });
              }
            );
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
        const blockBoundTag = boundTagOf(getInlines(block));
        const blockBindingRanges = bindingRangesOf(
          getInlines(block),
          deletedIds
        );
        const blockOffsetsUntrusted =
          insideControl || hasBindingContentControl(getInlines(block));
        const flat: FlatBlock = {
          anchor: `${si};${bi}`,
          kind: 'paragraph',
          text,
          format,
          ...readBlockFormats(block),
          isHeading: false,
          level: -1,
          length: text.length,
          ...(blockBoundTag ? { boundTag: blockBoundTag } : {}),
          ...(blockBindingRanges.length
            ? { bindingRanges: blockBindingRanges }
            : {}),
          ...(blockOffsetsUntrusted ? { offsetsUntrusted: true } : {})
        };
        out.push(flat);
        paragraphs.push({
          block: flat,
          styleName: format?.styleName ?? '',
          text,
          ...(format?.fontSize !== undefined
            ? { fontSize: format.fontSize }
            : {}),
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

function toInventoryEntry(
  b: FlatBlock,
  tables: Map<string, BoundTableFact> = new Map()
): InventoryEntry {
  const entry: InventoryEntry = {
    anchor: b.anchor,
    kind: b.kind,
    text: b.text
  };
  if (b.format) entry.format = b.format;
  const tableAnchor = tableAnchorForBlock(b);
  const bindings = bindingFactsOf(
    b,
    tableAnchor ? tables.get(tableAnchor)?.tableId : undefined
  );
  if (bindings.length) entry.bindings = bindings;
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

interface TableContainerRef {
  sectionIndex: number;
  blockIndex: number;
  blocks: any[];
  block: any;
}

/**
 * The top-level SFDT block a table anchor (`"0;7"`) names, or undefined.
 *
 * Anchors are numbered over the EXPANDED block list - block content controls are
 * transparent to the walker (see `expandBlockContentControls`) - so the raw
 * `sections[s].blocks` index is not the same number whenever a wrapper holds
 * anything other than exactly one block, or a wrapper sits earlier in the
 * section. The anchor is therefore translated back through the same expansion
 * rather than used as a raw index; `blockIndex` remains a raw index into
 * `blocks`, which is what the mutating callers splice with.
 */
function tableContainerAt(
  sfdt: any,
  tableAnchor: string
): TableContainerRef | null {
  const [sectionIndex, blockIndex] = tableAnchor.split(';').map(Number);
  if (!Number.isInteger(sectionIndex) || !Number.isInteger(blockIndex))
    return null;
  const sections: any[] = pick(sfdt, 'sections', 'sec') ?? [];
  const blocks = getBlocks(sections[sectionIndex] ?? {});
  const addressed = expandBlockContentControls(blocks)[blockIndex]?.block;
  if (!addressed) return null;
  const rawIndex = blocks.findIndex((candidate: any) =>
    topLevelBlockHolds(candidate, addressed)
  );
  if (rawIndex < 0) return null;
  return {
    sectionIndex,
    blockIndex: rawIndex,
    blocks,
    block: blocks[rawIndex]
  };
}

/** Whether a section block IS, or wraps, an addressable block. */
function topLevelBlockHolds(candidate: any, addressed: any): boolean {
  if (candidate === addressed) return true;
  return expandBlockContentControls([candidate]).some(
    (entry) => entry.block === addressed
  );
}

/** The raw SFDT table block a table anchor (`"0;7"`) names, or undefined. */
function tableBlockAt(sfdt: any, tableAnchor: string): any {
  const container = tableContainerAt(sfdt, tableAnchor);
  if (!container) return undefined;
  if (getRows(container.block)) return container.block;
  return getBlocks(container.block).find((candidate) => getRows(candidate));
}

function scanReadableBindings(sfdt: any): BindingIndex | null {
  if (!Array.isArray(sfdt?.sections)) return null;
  const index = scanBindings(sfdt);
  return index.occurrences.length || index.tables.size ? index : null;
}

/**
 * The block anchor (`"0;7"`) of a bound table, in the SAME coordinate system the
 * flattened blocks use.
 *
 * The scanner's `markerPath` is a RAW path (`sections/0/blocks/3`), and raw block
 * indices diverge from anchors as soon as a block content control holds anything
 * other than exactly one block, or one sits earlier in the section. So the
 * marker's own table is located in the expanded walk by identity instead of its
 * raw index being reused as an anchor - which is what let a genuinely bound table
 * fall through to the native editor route and be edited behind its marker's back.
 */
function boundTableAnchor(sfdt: any, table: TableEntry): string | null {
  const path = table.markerPath;
  if (path.length < 2 || path[0] !== 'sections') return null;
  const sectionIndex = Number(path[1]);
  if (!Number.isInteger(sectionIndex)) return null;
  const sections: any[] = pick(sfdt, 'sections', 'sec') ?? [];
  const section = sections[sectionIndex];
  if (!section) return null;
  const marker = getAt(sfdt, path);
  const tableBlock = marker ? firstTableBlockIn(marker) : undefined;
  if (!tableBlock) return null;
  const blockIndex = expandBlockContentControls(getBlocks(section)).findIndex(
    (entry) => entry.block === tableBlock
  );
  return blockIndex < 0 ? null : `${sectionIndex};${blockIndex}`;
}

function bindingTablesByAnchor(
  sfdt: any,
  scanned?: BindingIndex | null
): Map<string, BoundTableFact> {
  const index = scanned === undefined ? scanReadableBindings(sfdt) : scanned;
  const out = new Map<string, BoundTableFact>();
  if (!index) return out;
  for (const table of index.tables.values()) {
    const anchor = boundTableAnchor(sfdt, table);
    if (!anchor) continue;
    out.set(anchor, {
      kind: 'bound',
      tableId: table.tableId,
      rowIds: table.rows.map((row) => row.rowId),
      columns: [...table.columnDefs.keys()]
    });
  }
  return out;
}

function bindingFactFromTag(
  tag: string | undefined,
  table?: string
): BindingFact | undefined {
  if (!tag) return undefined;
  try {
    const def = parseTag(tag);
    if (!def || def.kind === 'table') return undefined;
    return {
      field: def.name,
      identity: { id: def.name, global: def.isGlobal },
      kind: def.kind === 'formula' ? 'formula' : 'input',
      ...(def.kind === 'formula' ? { expr: def.expression } : {}),
      ...(table ? { table } : {}),
      ...(def.options.row ? { row: def.options.row } : {})
    };
  } catch {
    return undefined;
  }
}

/** The binding name a tag declares, or `''` when the tag is not a field. */
function bindingNameOfTag(tag: string | undefined): string {
  if (!tag) return '';
  try {
    const def = parseTag(tag);
    return def && def.kind !== 'table' ? def.name : '';
  } catch {
    return '';
  }
}

/**
 * Every binding a block carries, in document order and deduplicated by
 * identity, so one global value appearing twice in a sentence reads as the one
 * identity it is.
 *
 * `bindingRanges` is the complete truth the flatten already computes; the
 * single `boundTag` is only its first entry, kept as the fallback for a block
 * whose binding wraps it rather than sitting inside its runs.
 */
function bindingFactsOf(block: FlatBlock, table?: string): BindingFact[] {
  const tags = block.bindingRanges?.length
    ? block.bindingRanges.map((range) => range.tag)
    : [block.boundTag];
  const facts: BindingFact[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const fact = bindingFactFromTag(tag, table);
    if (!fact || seen.has(fact.identity.id)) continue;
    seen.add(fact.identity.id);
    facts.push(fact);
  }
  return facts;
}

// `sfdt` is optional because the fixture-driven read path may not have it;
// without it the appearance hint is simply absent rather than wrong.
function collectStructureTables(
  blocks: FlatBlock[],
  sfdt?: any
): StructureTable[] {
  const order: TableAccumulator[] = [];
  const byAnchor = new Map<string, TableAccumulator>();
  const boundTables = sfdt ? bindingTablesByAnchor(sfdt) : new Map();
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
    const binding = boundTables.get(t.anchor);
    if (binding) table.binding = binding;
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
  const bindingIndex = scanReadableBindings(sfdt);
  const tableBinding = bindingTablesByAnchor(sfdt, bindingIndex).get(
    tableAnchor
  );
  const boundTableEntry = tableBinding
    ? bindingIndex?.tables.get(tableBinding.tableId)
    : undefined;

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
          : {}),
        ...(first?.boundTag
          ? {
              binding: bindingFactFromTag(first.boundTag, tableBinding?.tableId)
            }
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
    const boundRow = boundTableEntry?.rows.find(
      (entry) => entry.path && Number(entry.path[entry.path.length - 1]) === row
    );
    rows.push({
      row,
      cellCount: cells.length,
      filledCells: filled.length,
      ...(boundRow ? { binding: { rowId: boundRow.rowId } } : {}),
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
    ...(tableBinding ? { binding: tableBinding } : {}),
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

/**
 * Where the unit starting at `blocks[start]` ends: the index of the next heading
 * at the SAME level or shallower, or the end of the document.
 *
 * A DEEPER heading is a subsection OF this unit, so it must not end it. The
 * `scope: 'section'` read stopped at the plain next heading of any level, which
 * truncated every parent section at its own first subsection - a live read
 * defect on most of the HILB proposal. The depth-aware rule already existed in
 * `unitsAtLevel`; this is that one comparison, owned in one place, so the
 * inventory read and the relocation range can never disagree about where a
 * section ends.
 *
 * A start block that is not a heading has no level of its own to compare
 * against, so any heading ends it - the behaviour a body anchor always had.
 */
function sectionUnitEnd(blocks: FlatBlock[], start: number): number {
  const from = blocks[start];
  const level = from?.isHeading ? from.level : Number.POSITIVE_INFINITY;
  for (let index = start + 1; index < blocks.length; index++)
    if (blocks[index].isHeading && blocks[index].level <= level) return index;
  return blocks.length;
}

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
  const boundTables = sfdt ? bindingTablesByAnchor(sfdt) : new Map();

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
    const section = blocks.slice(start, sectionUnitEnd(blocks, start));
    const slice = cap(section);
    if (slice.length < section.length) {
      // The live bug this guards: a 94-row table read at maxEntries 60 looked
      // complete, so the model summed 60 rows and GUESSED the last anchor.
      return {
        inventory: slice.map((block) => toInventoryEntry(block, boundTables)),
        truncation: {
          returned: slice.length,
          total: section.length,
          message: partialReadMessage(slice.length, section.length)
        }
      };
    }
    return {
      inventory: slice.map((block) => toInventoryEntry(block, boundTables))
    };
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
      inventory: all.map((block) => toInventoryEntry(block, boundTables)),
      truncation: {
        returned: all.length,
        total: blocks.length,
        message: partialReadMessage(all.length, blocks.length)
      }
    };
  }
  return {
    inventory: all.map((block) => toInventoryEntry(block, boundTables))
  };
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
    const end = sectionUnitEnd(blocks, start);
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

/**
 * Which unit of `units` an anchor selects as the authoring example.
 *
 * `anchorNamesMember` is what the anchor MEANS, and the two meanings pick
 * different units when the anchor is a section's first block:
 *   - a BOUNDARY (the default): the composed unit is going in front of that
 *     section, so the sibling immediately BEFORE the boundary is the example;
 *   - a MEMBER: the anchor names the very section being joined, so that
 *     section is the example. Reading a member as a boundary silently skips to
 *     its predecessor - which is how a second "Your Client Services Team" was
 *     built from the section above it, one that has no table at all, and so
 *     found no table donor to copy.
 * An anchor inside a section selects that section under either meaning.
 */
function nearestUnitIndex(
  blocks: FlatBlock[],
  units: SectionUnit[],
  near?: string,
  anchorNamesMember = false
): number | undefined {
  if (!near) return undefined;
  const boundary = units.findIndex((unit) => unit.blocks[0]?.anchor === near);
  if (!anchorNamesMember && boundary > 0) return boundary - 1;
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
  near?: string,
  anchorNamesMember = false
): { units: SectionUnit[]; sequences: SectionPatternSequenceElement[][] } {
  const families = clusterSectionFamilies(sequences);
  const nearest = nearestUnitIndex(blocks, units, near, anchorNamesMember);
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
  near?: string,
  anchorNamesMember = false
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
    near,
    anchorNamesMember
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

// SyncFusion treats every public selection as navigation. That is correct for
// a person clicking in the editor, but not for the engine's transient CAS,
// formatting, and post-write verification ranges. Worse, when layout is
// resumed after a batch, SyncFusion's refresh path calls Control-Home and
// scrolls the document to page one. Keep those two internal behaviours scoped
// to this synchronous transaction: user selection methods are restored before
// control returns to the host, and the exact viewport is retained as a final
// safety boundary.
function withSilentEditSelections<T>(
  editor: LiveEditor,
  operation: () => T
): T {
  const selection = editor.selection as any;
  const documentHelper = (editor as any).documentHelper;
  const viewer = documentHelper?.viewerContainer as HTMLElement | undefined;
  if (!selection || typeof selection.select !== 'function') return operation();

  const originalSelect = selection.select;
  const originalHome = selection.handleControlHomeKey;
  const priorSkipScroll = documentHelper?.skipScrollToPosition;
  const scrollTop = viewer?.scrollTop;
  const scrollLeft = viewer?.scrollLeft;
  const silentSelect = function (this: unknown, ...args: unknown[]) {
    const beforeSelect = documentHelper?.skipScrollToPosition;
    if (documentHelper) documentHelper.skipScrollToPosition = true;
    try {
      return originalSelect.apply(this, args);
    } finally {
      if (documentHelper) documentHelper.skipScrollToPosition = beforeSelect;
    }
  };
  const ignoreLayoutHome = () => undefined;

  selection.select = silentSelect;
  if (typeof originalHome === 'function')
    selection.handleControlHomeKey = ignoreLayoutHome;
  try {
    return operation();
  } finally {
    if (selection.select === silentSelect) selection.select = originalSelect;
    if (selection.handleControlHomeKey === ignoreLayoutHome)
      selection.handleControlHomeKey = originalHome;
    if (documentHelper) documentHelper.skipScrollToPosition = priorSkipScroll;
    if (viewer) {
      if (typeof scrollTop === 'number' && viewer.scrollTop !== scrollTop)
        viewer.scrollTop = scrollTop;
      if (typeof scrollLeft === 'number' && viewer.scrollLeft !== scrollLeft)
        viewer.scrollLeft = scrollLeft;
    }
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
  return preserveDocumentViewDuring(editor, () => {
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
  ambiguity?: BindingWriteAmbiguity;
  constructor(
    code: string,
    message?: string,
    details?: string[],
    retry?: 'never',
    ambiguity?: BindingWriteAmbiguity
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
    this.ambiguity = ambiguity;
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

/** The Word section index an anchor belongs to. */
const wordSectionOf = (anchor: string): string => anchor.split(';')[0];

/**
 * A TOP-LEVEL body paragraph: the only kind of block that can SHARE a paragraph
 * mark with another one.
 *
 * Tested positively rather than as `!== 'table_cell'` so that every kind which
 * is not a body paragraph - a table cell today, a header/footer/footnote story
 * block if one ever reaches this path - is excluded by default rather than by
 * enumeration.
 */
const isBodyParagraph = (block: FlatBlock): boolean =>
  block.kind === 'paragraph' || block.kind === 'heading';

/**
 * The end of a selection that must consume the trailing PARAGRAPH MARK of the
 * run it covers - the one rule `delete_paragraph` and the relocation primitive
 * share, owned here so they cannot drift apart.
 *
 * A mark sits BETWEEN two paragraphs, so when a following block exists IN THIS
 * WORD SECTION the end is the START of that block. Stopping at the last block's
 * own `length` leaves the mark behind, and both failures that produces are
 * silent: a delete_paragraph empties its paragraph in place instead of removing
 * it, and a relocated section's tail fuses with whatever it lands beside
 * ("g bodyAlpha") while accepting strands an empty paragraph behind.
 *
 * Crossing into `next` is therefore allowed only when `next` is a BODY PARAGRAPH
 * OF THE SAME WORD SECTION. Both halves of that condition exist because ending at
 * the start of the wrong kind of block silently drags that block into the range,
 * and they are the whole reason this lives in one place:
 *
 *   - a DIFFERENT Word section: ending at its first block puts the SECTION BREAK
 *     inside the range, and SyncFusion authors no rejectable revision for
 *     deleting one - so the page setup changes with no card to reject and a group
 *     rollback has nothing to put back. Live, that surfaced as the relocation's
 *     own `untracked_write` refusal on the captain's move, because the section
 *     being moved was a Word section of its own.
 *
 *   - NOT A BODY PARAGRAPH: `flattenSfdt` gives a table no block of its own - its
 *     CELLS are the blocks - so the block following a table is a `table_cell`
 *     whose Word section matches, which the section test alone waves through.
 *     Ending at a cell's offset 0 selects the ENTIRE neighbouring table (measured:
 *     the captured payload came back holding two tables and the paragraphs past
 *     them), so a split of a table that happens to sit directly against another
 *     one pasted a copy of its neighbour alongside its own rows. A split is how
 *     two tables come to be adjacent in the first place, so the second split of
 *     any table reached it. `delete_paragraph` already screened its own `next`
 *     through this same "body paragraph of this section" rule before calling; the
 *     rule belongs here, where every caller passes through it.
 *
 * With no usable following block the range ends at `length + 1`, which SyncFusion
 * accepts and reports back verbatim as the live endOffset.
 */
function markInclusiveRangeEnd(
  next: FlatBlock | undefined,
  last: FlatBlock
): string {
  if (
    next &&
    isBodyParagraph(next) &&
    wordSectionOf(next.anchor) === wordSectionOf(last.anchor)
  )
    return `${next.anchor};0`;
  return `${last.anchor};${last.length + 1}`;
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
    // Block content controls are transparent to addressing (see
    // `expandBlockContentControls`) and must be transparent here too: a table
    // wrapped in one otherwise projects as a single untracked empty paragraph,
    // which hides every tracked row inside it from both projections - so a
    // fully tracked paste of a wrapped table read as irreversible, and a write
    // into a wrapped table's cell was proven reversible vacuously.
    for (const entry of expandBlockContentControls(getBlocks(section))) {
      const block = entry.block;
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

// SyncFusion accepts CR, LF, and CRLF as paragraph boundaries but exposes
// paragraph boundaries through Selection as CR. Normalize that one boundary
// convention before planning or verifying text spans.
function normalizeParagraphBreaks(text: string): string {
  return text.replace(/\r\n|\r|\n/g, '\r');
}

// One post-write verifier for every block-backed text mutation. A text payload
// can create blocks (replace_selection, replace_text, insert_text), so verify
// the complete block span implied by the payload rather than re-reading only
// the pre-write anchor. Reversibility remains the separate reject-projection
// invariant in assertTrackedMutation.
/**
 * Write `replacement` over the current selection, deleting when it is empty.
 *
 * An empty replacement is a DELETION, and it cannot go through `insertText`:
 * SyncFusion returns immediately for the empty string, so the selection is left
 * untouched and the op silently writes nothing. `delete()` is the tracked
 * deletion primitive, and it is safe here for the same reason it is safe on the
 * live-story path - the selection is exactly the searched range, with no
 * paragraph mark in it.
 */
function writeOverSelection(editor: LiveEditor, replacement: string): void {
  if (replacement) replaceSelectedText(editor, replacement);
  else editor.editor.delete();
}

function verifyTextWrite(
  editor: LiveEditor,
  target: {
    startAnchor: string;
    endAnchor?: string;
    expected: string;
    exact?: boolean;
    /**
     * This write REMOVED text, so tolerate the format's spacing normalisation.
     *
     * Opt-in, and it has to be: the artefact only exists on removal. Measured in
     * a real browser, inserts preserve leading, trailing, internal and doubled
     * spaces EXACTLY, while deleting the first word leaves a lone leading space
     * that the document drops. Applying the tolerance everywhere - which is what
     * this did until review caught it - meant an INSERT that silently lost a
     * space still verified as correct, which is the same class of defect the
     * rest of this file exists to prevent.
     */
    removesText?: boolean;
  }
): any {
  const sfdt = serializeSfdt(editor);
  if (!target.exact && !target.expected) return sfdt;
  const blocks = flattenSfdt(sfdt);
  let startIndex = blocks.findIndex(
    (block) => block.anchor === target.startAnchor
  );
  const endAnchor = target.endAnchor ?? target.startAnchor;
  let endIndex = blocks.findIndex((block) => block.anchor === endAnchor);
  if (startIndex < 0) {
    startIndex = blocks.findIndex(
      (block) =>
        compareOffsets(block.anchor, target.startAnchor) >= 0 &&
        compareOffsets(block.anchor, endAnchor) <= 0
    );
  }
  if (endIndex < 0) {
    for (let index = blocks.length - 1; index >= 0; index--) {
      const block = blocks[index];
      if (
        compareOffsets(block.anchor, target.startAnchor) >= 0 &&
        compareOffsets(block.anchor, endAnchor) <= 0
      ) {
        endIndex = index;
        break;
      }
    }
  }
  if (startIndex < 0)
    throw new OpError(
      'post_write_anchor_not_found',
      `The edited anchor "${target.startAnchor}" disappeared after the write.`
    );
  const normalizedExpected = normalizeParagraphBreaks(target.expected);
  const createdParagraphMarks = (normalizedExpected.match(/\r/g) ?? []).length;
  const resultingEndIndex = Math.min(
    blocks.length - 1,
    Math.max(endIndex, startIndex) + createdParagraphMarks
  );
  const span = normalizeParagraphBreaks(
    blocks
      .slice(startIndex, resultingEndIndex + 1)
      .map((block) => block.text)
      .join('\r')
  );
  const matches = target.exact
    ? span === normalizedExpected ||
      (!!target.removesText && spacingOnlyDifference(span, normalizedExpected))
    : span.includes(normalizedExpected) ||
      (!!target.removesText &&
        collapseSpacing(span).includes(collapseSpacing(normalizedExpected)));
  if (!matches)
    throw new OpError(
      'text_verification_failed',
      target.endAnchor
        ? `Text verification failed across "${target.startAnchor}".."${endAnchor}".`
        : `Text verification failed at "${target.startAnchor}".`,
      [
        `${target.exact ? 'expected' : 'expected to contain'}: ${JSON.stringify(
          normalizedExpected
        )}`,
        `actual: ${JSON.stringify(span)}`
      ]
    );
  return sfdt;
}

/**
 * Collapse runs of spaces and tabs WITHIN each paragraph, leaving paragraph
 * marks untouched, and tolerate the ONE leading-space artefact the SDK actually
 * produces.
 *
 * `\s` is deliberately not used: it matches `\r`, and collapsing paragraph
 * marks would let a change in paragraph COUNT pass verification, which is a
 * structural change rather than a spacing one.
 *
 * MEASURED, in a real browser, because this used to `.trim()` both ends on the
 * strength of a comment and that tolerated a defect:
 *
 *   inserts                              spacing preserved EXACTLY, both ends,
 *                                        internal runs included
 *   delete a middle word                 naive surgery and the document AGREE
 *   delete the FIRST word, leaving a
 *     lone leading space                 the document DROPS it - " beta gamma"
 *                                        reads back as "beta gamma"
 *   delete the LAST word                 naive surgery and the document AGREE
 *
 * So exactly one artefact exists and it is at the START. Trimming the END too
 * meant a write that genuinely lost a trailing space reported SUCCESS and
 * nothing caught it. Narrowed to the leading side, which is the only side the
 * SDK was ever observed to touch.
 */
function collapseSpacing(value: string): string {
  return value
    .split('\r')
    .map((paragraph) => paragraph.replace(/[^\S\r\n]+/g, ' ').replace(/^ /, ''))
    .join('\r');
}

/**
 * True when two projections carry identical content and differ only in how
 * spacing is represented.
 *
 * Removing a run of text leaves a result that naive string surgery and the
 * serialized document disagree about: the document format normalizes spacing on
 * write - a lone leading space is dropped, an internal run collapses - while the
 * expected value is built by slicing the pre-write string. Without this,
 * `delete_text` and `replace_text` with an empty replacement can never verify,
 * because their expected value always carries the spacing the write removed.
 *
 * This tolerates that difference and nothing else: every non-space character
 * must still appear, in the same order, in the same paragraph.
 */
function spacingOnlyDifference(actual: string, expected: string): boolean {
  return collapseSpacing(actual) === collapseSpacing(expected);
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
  anchor?: string;
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
   * How many of the rows a `delete_row` removed were themselves unaccepted
   * insertions, and so were WITHDRAWN rather than marked deleted. Travels to the
   * result because the two outcomes read differently to a user: a withdrawn row
   * is simply gone with nothing left to review, and no reject can bring it back.
   */
  withdrewPendingInsertion?: number;
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

/**
 * Any op that inserts at a point rather than over a range. Only `position` and
 * `offset` are read, so every additive op can share one convention instead of
 * each inventing its own.
 */
interface PositionedInsert {
  position?: unknown;
  offset?: unknown;
}

function insertionPoint(op: PositionedInsert, block: FlatBlock): number {
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

// Hierarchical offsets are serialized-text coordinates. After an earlier
// tracked replacement in the same change set, those coordinates still count
// pending deletion/insertion runs and can point before the visible replacement.
// For paragraph-boundary inserts, let SyncFusion move within its live selection
// model; test doubles without those public methods retain the offset fallback.
function selectInsertionPoint(
  editor: LiveEditor,
  op: PositionedInsert,
  block: FlatBlock
): void {
  const position =
    typeof op.position === 'string' ? op.position.toLowerCase() : '';
  const method =
    position === 'after' || position === 'end'
      ? 'moveToParagraphEnd'
      : position === 'before' || position === 'start'
      ? 'moveToParagraphStart'
      : '';
  const move = method ? (editor.selection as any)?.[method] : undefined;
  if (typeof move === 'function') {
    selectRange(editor, block.anchor, 0, 0);
    move.call(editor.selection);
    return;
  }
  const offset = insertionPoint(op, block);
  selectRange(editor, block.anchor, offset, offset);
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
  refuseBoundWrite(op, block);
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
  refuseBoundWrite(op, block);
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

/**
 * Refuse a write that would land on a bound field or formula.
 *
 * Two independent reasons, either sufficient. A bound value is OWNED by the
 * document's binding engine, which recomputes it on the next reconcile, so a
 * value written here would be overwritten anyway. And the write primitive these
 * ops use - select a range, then insertText - DELETES a content control rather
 * than replacing its contents, so the attempt destroys the author's binding
 * instead of changing its value.
 *
 * A bound target carries `retry: 'never'` because no rewording of the same
 * request can succeed: the value moves by editing the inputs it is computed
 * from, or the form field it is bound to, not by writing the cell. The
 * neighbour refusal below it deliberately stays retryable - a different, exactly
 * addressable target in the same document can succeed.
 */
function requestedTextRange(
  op: EditOp,
  block: FlatBlock
): { start: number; end: number } | null {
  if (op.op === 'replace_text' || op.op === 'delete_text') {
    const find = String(op.find ?? '');
    if (!find) return { start: 0, end: block.length };
    const matches: number[] = [];
    for (
      let at = block.text.indexOf(find);
      at >= 0;
      at = block.text.indexOf(find, at + 1)
    )
      matches.push(at);
    if (!matches.length) return null;
    const preferred =
      typeof op.start === 'number' && matches.includes(op.start)
        ? op.start
        : matches[0];
    return { start: preferred, end: preferred + find.length };
  }
  if (op.op === 'replace_selection') {
    const start = offsetParts(offsetString(op.startOffset));
    const end = offsetParts(offsetString(op.endOffset));
    if (start.anchor !== block.anchor || end.anchor !== block.anchor)
      return null;
    return { start: start.offset, end: end.offset };
  }
  if (op.op === 'insert_text') {
    const at = insertionPoint(op as TypedEditOp<'insert_text'>, block);
    return { start: at, end: at };
  }
  return { start: 0, end: block.length };
}

/** Whether a requested text range touches a binding's range. */
function rangeTouchesBinding(
  requested: { start: number; end: number },
  range: { start: number; end: number }
): boolean {
  return requested.start === requested.end
    ? requested.start > range.start && requested.start < range.end
    : requested.start < range.end && requested.end > range.start;
}

function targetsBindingRange(op: EditOp, block: FlatBlock): boolean {
  const ranges = block.bindingRanges ?? [];
  if (!ranges.length) return !!block.boundTag;
  const requested = requestedTextRange(op, block);
  if (!requested) return true;
  return ranges.some((range) => rangeTouchesBinding(requested, range));
}

/**
 * WHICH binding in this block the write means.
 *
 * A block may carry several, so "the block's binding" is not an answer. The op
 * may name one with `field` - identity, which survives the text moving - and
 * otherwise the range it asks to write picks one out. When neither settles it,
 * refusing while naming the candidates is the only honest reply: silently
 * writing the first one is how a request to change the tax rate rewrote the
 * effective date.
 */
function bindingTagForOp(op: EditOp, block: FlatBlock): string | undefined {
  const ranges = block.bindingRanges ?? [];
  // Only a write has to choose. Formatting and every other op treats the block
  // as a whole, so asking them to name a field would refuse work that is not
  // ambiguous at all.
  if (ranges.length < 2 || !BOUND_WRITE_OPS.has(op.op)) return block.boundTag;

  const named = ranges.filter((range) => bindingNameOfTag(range.tag));
  const choices = [
    ...new Set(named.map((range) => bindingNameOfTag(range.tag)))
  ];
  const wanted = typeof (op as any).field === 'string' ? (op as any).field : '';
  if (wanted) {
    const hit = named.find((range) => bindingNameOfTag(range.tag) === wanted);
    if (hit) return hit.tag;
    throw new OpError(
      'binding_write_unroutable',
      `${op.op} names the field "${wanted}", which ${
        block.anchor
      } does not hold. It holds ${choices
        .map((name) => `"${name}"`)
        .join(' and ')}.`,
      [`anchor: ${block.anchor}`, `fields: ${choices.join(', ')}`],
      'never'
    );
  }

  const requested = requestedTextRange(op, block);
  const hits = requested
    ? named.filter((range) => rangeTouchesBinding(requested, range))
    : named;
  const distinct = [
    ...new Set(hits.map((range) => bindingNameOfTag(range.tag)))
  ];
  if (distinct.length === 1) return hits[0].tag;
  throw new OpError(
    'binding_ambiguous_field',
    `${op.op} at ${
      block.anchor
    } does not say which bound value it means: this text holds ${choices
      .map((name) => `"${name}"`)
      .join(
        ' and '
      )}. Send the same op again with \`field\` set to the one you mean.`,
    [`anchor: ${block.anchor}`, `fields: ${choices.join(', ')}`]
  );
}

function refuseBoundWrite(op: EditOp, block: FlatBlock): void {
  if (block.offsetsUntrusted && !block.boundTag) {
    // Not a binding itself, but sharing a paragraph or a container with one.
    // SyncFusion counts a control's boundary markers as offset positions while
    // this walker counts characters, so the range this op would select is off by
    // however many markers precede it - measured: a write to a header cell of a
    // bound table replaced three of its four characters. Refuse until the offset
    // model accounts for markers exactly; reading these blocks is unaffected.
    throw new OpError(
      'unaddressable_in_bound_document',
      `${op.op} cannot write ${block.anchor}: it sits alongside a document binding, and this engine cannot yet address that text exactly. Reading it is reliable; writing it is not. Re-read the nearby bound fields and target an editable binding value instead, or ask for a plain-text rewrite outside the bound container.`,
      [`anchor: ${block.anchor}`]
    );
  }
  if (!block.boundTag || !targetsBindingRange(op, block)) return;
  let name = '';
  let def: Definition | null = null;
  try {
    def = parseTag(block.boundTag);
    if (def && def.kind !== 'table') name = def.name;
  } catch {
    name = '';
  }
  if (def?.kind === 'formula')
    throw formulaRedirect(op, {
      def,
      key: '',
      name: def.name,
      path: [],
      tag: block.boundTag,
      text: block.text,
      tableId: null,
      rowId: def.options.row ?? null,
      lockContents: false
    });
  const described = name ? `the bound value "${name}"` : 'a bound value';
  throw new OpError(
    'target_is_bound',
    `${op.op} cannot write ${block.anchor}: it holds ${described}, and this document uses the binding engine for that value. Target the editable binding input directly so the engine can parse, store, and recompute it.`,
    [`anchor: ${block.anchor}`, `binding: ${block.boundTag}`],
    'never'
  );
}

function guardModelAuthoredNumber(
  op: EditOp,
  block: FlatBlock,
  byAnchor: Map<string, FlatBlock>,
  rendered?: ColumnFormatRender
): LiteralNumberWrite | undefined {
  const text = modelAuthoredCellText(op);
  if (text === undefined) return undefined;
  // Before the numeric-provenance gate, and before the table-cell narrowing:
  // prose bindings are just as destroyable as cell ones.
  refuseBoundWrite(op, block);
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

// ---------------------------------------------------------------------------
// Deterministic relocation - the engine half of move_section / swap_sections
//
// The model supplies identifiers and a position. It never supplies content, and
// that is the entire point of these two ops. Asked to move a section, a model
// with no relocation primitive RETYPED the whole section as a new one and left
// the original behind; asked to swap two subsections it improvised a three-way
// text shuffle through placeholder tokens and failed on a one-character offset.
// Every content write a model authors to express a STRUCTURAL intent is a fresh
// chance to mis-transcribe, mis-count or invent. Neither op has a content
// field, so neither can.
//
// The mechanism is SyncFusion's own and needs nothing new: select the range,
// take `selection.sfdt`, paste it at the target, delete the source. Under the
// executor's forced track changes that authors Insertions at the target and
// Deletions at the source, accepting completes the move, and rejecting restores
// the document byte for byte with the table's style, header row, shading,
// column widths and allowAutoFit intact.
//
// It runs INSIDE applyDocumentEdits, so it already inherits forced track
// changes, one revision group per op (stampRevisionGroup / groupNewRevisions ->
// one rail card, one accept, one reject, one undo), atomic rollback
// (rollbackGroup) and viewport stability (withSilentEditSelections). It adds no
// wrapper of its own - `preserveDocumentViewDuring` is the primitive for callers
// OUTSIDE the executor and a second wrapper here would be a second owner.
//
// SyncFusion has no producer for the MoveTo/MoveFrom revision types (it reads,
// writes, renders and resolves them, but nothing in the editor authors one), so
// a move appears in the rail as an insertion plus a deletion under one card -
// exactly what Word shows with "track moves" off. A fidelity limit, not a
// correctness one.
// ---------------------------------------------------------------------------

/** The `section;block` address of a top-level block, or of a cell's own table. */
function topLevelAddress(anchor: string): { section: number; block: number } {
  const [section, block] = anchor.split(';');
  return { section: Number(section), block: Number(block) };
}

function addressIsBefore(
  left: { section: number; block: number },
  right: { section: number; block: number }
): boolean {
  return (
    left.section < right.section ||
    (left.section === right.section && left.block < right.block)
  );
}

/** The raw (unflattened) top-level blocks of one Word section. */
function rawSectionBlocks(sfdt: any, section: number): any[] {
  const sections = pick(sfdt, 'sections', 'sec');
  return Array.isArray(sections) ? getBlocks(sections[section]) : [];
}

/**
 * Every top-level block address in DOCUMENT order, across Word sections.
 *
 * The relocation's position arithmetic runs in this sequence rather than in
 * per-section block counts, because a paste can change the Word SECTION
 * structure: when the payload carries a section break, pasting it splits the
 * destination section and the content after the paste point is renumbered into a
 * new section index. Measured per section, that reads as the destination section
 * LOSING blocks - a negative delta - and the source's computed post-paste anchor
 * lands back inside the copy that was just pasted. Live, that produced
 * `relocation_source_lost` on the captain's own move: expected 15 blocks, found
 * 14, because the range it found was the normalized copy rather than the source.
 *
 * A whole-document sequence has no such failure mode: the paste inserts N
 * entries at one position in it, and every entry after that position keeps its
 * order however the sections renumber.
 */
function topLevelSequence(
  sfdt: any
): Array<{ section: number; block: number }> {
  const sections = pick(sfdt, 'sections', 'sec');
  const out: Array<{ section: number; block: number }> = [];
  if (!Array.isArray(sections)) return out;
  sections.forEach((section, si) =>
    getBlocks(section).forEach((_block, bi) =>
      out.push({ section: si, block: bi })
    )
  );
  return out;
}

function sequenceIndexOf(
  sequence: Array<{ section: number; block: number }>,
  address: { section: number; block: number }
): number {
  return sequence.findIndex(
    (entry) =>
      entry.section === address.section && entry.block === address.block
  );
}

/**
 * A range's texts with trailing EMPTY paragraphs dropped.
 *
 * Identity has to tolerate them: pasting a payload whose tail is a run of empty
 * paragraphs normalizes one away, so a strict comparison rejects the correct
 * range over a paragraph that says nothing. Everything that carries content
 * still has to match exactly, in order - so this tolerates the normalization
 * without weakening what it proves. The extent that is actually deleted is the
 * re-derived range's own, so a dropped trailing empty cannot leave one behind.
 */
function rangeIdentity(blocks: FlatBlock[]): string {
  const texts = blocks.map((block) => block.text);
  while (texts.length > 1 && texts[texts.length - 1] === '') texts.pop();
  return texts.join('\r');
}

/** A resolved, contiguous run of blocks - one section unit, at one moment. */
interface BlockRange {
  /** The anchor the range was resolved from. */
  anchor: string;
  /** The flattened blocks it covers, in document order. */
  blocks: FlatBlock[];
  /** Selection start: offset 0 of the first block. */
  startAnchor: string;
  /** Selection end, from the shared mark-inclusive rule. */
  endAnchor: string;
  /** No following block at all: this range runs to the end of the document. */
  endsDocument: boolean;
}

/** Where a payload is pasted, as a caret and as a top-level insertion point. */
interface PasteTarget {
  /** The collapsed caret the paste happens at. */
  anchor: string;
  /** The top-level address the pasted blocks are inserted at. */
  address: { section: number; block: number };
  /**
   * The end-of-text caret a landing paragraph must be created at first, when
   * the destination is past the document's last paragraph mark.
   *
   * "After the last block" is the one destination the document has no caret
   * for: a block anchor addresses a paragraph's TEXT, so the furthest caret
   * that exists is `${tail.anchor};${tail.length}` - before the final paragraph
   * mark, not after it. Pasting there merges the payload's first block into the
   * document's last paragraph, which is the fusion Anthony read as
   * `...Friday.National Capabilities` wearing `Heading 2`.
   *
   * Consuming the mark by arithmetic is not available here the way it is for a
   * selection END: `${tail.anchor};${tail.length + 1}` was measured to produce
   * byte-identical output, because SyncFusion clamps a paste caret to the
   * paragraph it sits in. The payload needs a real paragraph to land at, so one
   * is created - as a TRACKED insertion inside the same card, which is what
   * keeps reject byte-exact.
   */
  appendParagraphAt?: string;
}

/**
 * What one paste did to the document's top-level block sequence. Positions are
 * indices into `topLevelSequence`, never per-section block numbers - see the
 * note there for the live failure that distinction caused.
 */
interface PasteEffect {
  /** Sequence index the pasted run starts at. */
  at: number;
  /** How many top-level blocks the paste actually added, measured. */
  blocks: number;
}

function relocationAnchorMissing(anchor: string, field: string): OpError {
  return new OpError(
    'relocation_anchor_not_found',
    `No block is addressed by ${JSON.stringify(
      anchor
    )}, so there is nothing to relocate. The document may have changed since it was read. Nothing was written.`,
    [
      `${field}: ${anchor}`,
      'Re-read getDocumentInventory with scope "structure" and use a current heading anchor.'
    ]
  );
}

/**
 * The blocks one anchor's section unit covers, plus the selection that spans it.
 * Shares `sectionUnitEnd` with the `scope: 'section'` inventory read, so what a
 * relocation moves is exactly what a section read reports - subsections
 * included, which is why moving a parent carries its children along and moving
 * a subsection leaves its parent behind.
 */
function resolveSectionRange(
  blocks: FlatBlock[],
  anchor: string,
  field: string
): BlockRange {
  if (!anchor) throw relocationAnchorMissing(anchor, field);
  const start = blocks.findIndex((candidate) => candidate.anchor === anchor);
  if (start < 0) throw relocationAnchorMissing(anchor, field);
  const from = blocks[start];
  if (from.kind === 'table_cell')
    throw new OpError(
      'relocation_anchor_in_table',
      `${JSON.stringify(
        anchor
      )} addresses a paragraph inside a table cell, and a table cell is not a section: a relocation moves whole top-level blocks. Nothing was written.`,
      [
        `${field}: ${anchor}`,
        'Use the heading anchor of the section itself, from a structure read. To move a table on its own, anchor the heading of the section that contains it.'
      ]
    );
  const end = sectionUnitEnd(blocks, start);
  const covered = blocks.slice(start, end);
  const last = covered[covered.length - 1];
  const next = blocks[end];
  return {
    anchor,
    blocks: covered,
    startAnchor: `${from.anchor};0`,
    endAnchor: markInclusiveRangeEnd(next, last),
    endsDocument: !next
  };
}

/** The caret and insertion point at the very start of a range. */
function pasteAtRangeStart(range: BlockRange): PasteTarget {
  return {
    anchor: range.startAnchor,
    address: topLevelAddress(range.blocks[0].anchor)
  };
}

/** Every raw block a range covers, for the reads flattening cannot answer. */
/**
 * The RAW block index an EXPANDED address refers to.
 *
 * Anchors count blocks the way a reader sees them, so a block-level content
 * control wrapping N blocks contributes N addresses while occupying ONE raw
 * slot. Indexing raw blocks with an expanded number therefore drifts by one per
 * extra child: in a section reading One / [wrapper: WrapA, WrapB] / Four /
 * Five, the anchor "0;3" means Four but selects raw block 3, which is Five -
 * and "0;4" runs off the end. A copy spanning such a wrapper took the wrong
 * blocks, and the read-back compared against that same wrong clone, so nothing
 * caught it.
 */
function rawIndexForExpanded(
  raw: any[],
  expandedIndex: number
): number | undefined {
  let seen = 0;
  for (let index = 0; index < raw.length; index++) {
    const contributed = expandBlockContentControls([raw[index]]).length || 1;
    if (expandedIndex < seen + contributed) return index;
    seen += contributed;
  }
  return undefined;
}

function rawBlocksInRange(sfdt: any, range: BlockRange): any[] {
  const first = topLevelAddress(range.blocks[0].anchor);
  const last = topLevelAddress(range.blocks[range.blocks.length - 1].anchor);
  const out: any[] = [];
  for (let section = first.section; section <= last.section; section++) {
    const blocks = rawSectionBlocks(sfdt, section);
    const from =
      section === first.section
        ? rawIndexForExpanded(blocks, first.block) ?? first.block
        : 0;
    const to =
      section === last.section
        ? rawIndexForExpanded(blocks, last.block) ?? last.block
        : blocks.length - 1;
    for (let index = from; index <= to; index++)
      if (blocks[index]) out.push(blocks[index]);
  }
  return out;
}

/** Every revision id anywhere inside one raw block, tables included. */
function collectRevisionIds(block: any, out: Set<string>): void {
  const add = (ids: unknown) => {
    if (Array.isArray(ids)) for (const id of ids) out.add(String(id));
  };
  const rows = getRows(block);
  if (rows) {
    for (const row of rows) {
      add(rowRevisionIds(row));
      const cells = pick(row, 'cells', 'c');
      if (!Array.isArray(cells)) continue;
      for (const cell of cells)
        for (const cellBlock of getBlocks(cell))
          collectRevisionIds(cellBlock, out);
    }
    return;
  }
  for (const nested of getBlocks(block)) collectRevisionIds(nested, out);
  add(paragraphMarkRevisionIds(block));
  for (const inline of getInlines(block))
    add(pick(inline, 'revisionIds', 'rids'));
}

/**
 * A pending revision inside the range that somebody else authored, if any.
 *
 * A relocation folds whatever it moves into its own card: the delete consumes a
 * pending insertion instead of authoring a Deletion beside it, so REJECTING the
 * move reverts that earlier edit too. For Robin's own pending edits that is
 * correct - reject restores the true original. For a human reviewer's pending
 * change it is not: their edit would disappear because we moved a section, and
 * nothing would say so. Read from the document's own revision table rather than
 * from widget state, and treat an unattributed revision as ours rather than
 * refusing a document we cannot name an author for.
 */
function foreignPendingAuthorInBlocks(
  sfdt: any,
  rawBlocks: any[]
): string | undefined {
  const revisions = pick(sfdt, 'revisions', 'r');
  if (!Array.isArray(revisions) || !revisions.length) return undefined;
  const authorById = new Map<string, string>();
  for (const revision of revisions) {
    const id = pick(revision, 'revisionID', 'revisionId', 'rid');
    if (id == null) continue;
    const author = pick(revision, 'author', 'a');
    authorById.set(String(id), typeof author === 'string' ? author : '');
  }
  const ids = new Set<string>();
  for (const block of rawBlocks) collectRevisionIds(block, ids);
  for (const id of Array.from(ids)) {
    const author = authorById.get(id);
    if (author && author !== ASSISTANT_DOCUMENT_AUTHOR) return author;
  }
  return undefined;
}

function foreignPendingAuthor(
  sfdt: any,
  range: BlockRange
): string | undefined {
  return foreignPendingAuthorInBlocks(sfdt, rawBlocksInRange(sfdt, range));
}

// ---------------------------------------------------------------------------
// The document-tail table deletion SyncFusion cannot accept
//
// ONE SyncFusion defect, and it presented as three before it was isolated:
// accepting a tracked deletion that removes the LAST ROW of a table which is the
// LAST BLOCK of the document throws, part-way through `acceptAll`. The deletion
// has already applied by then, so the edit lands and the review pane breaks when
// the user accepts the card - which is why this is a refusal and not a repair.
//
// The precondition was pinned by control, not inferred:
//
//   mid-document table, last row deleted   -> acceptAll OK
//   document-tail table, NON-last row      -> acceptAll OK
//   document-tail table, last row          -> acceptAll THROWS
//   document-tail table, last row, REJECT  -> clean, and byte-identical
//
// Do NOT key this guard off the exception: the same precondition throws
// `getTextPosBasedOnLogicalIndex` reading 'paragraph' (inside
// `deleteTrackedContents`), `getCharacterFormatInternalInTable` reading
// 'childWidgets' (inside `retrieveCharacterFormat`), or `nextSplitWidget`,
// depending only on where the selection happens to sit when the accept runs.
// Three messages, three stacks, one missing widget after the accept-side delete.
// Matching on any of them would have produced three guards for one defect.
//
// Three ops delete content that can cover that row, and they are three SHAPES of
// one rule rather than three rules: a relocation deletes a block RANGE,
// `delete_row` deletes a ROW SET, and `delete_table` deletes a WHOLE TABLE. All
// three ask this module the same question, so the FACT has one owner below and
// each caller only decides whether its own extent covers it. Their refusal
// messages differ because their remedies differ; the reason they share, so it
// cannot drift.
//
// `opContracts.spec.ts` enumerates the registry and fails when a registered op
// that deletes table content reaches SyncFusion without one of these shapes -
// `delete_table` bypassed the guard because nothing was checking the list.
// ---------------------------------------------------------------------------

/**
 * The last row of a table that is the document's last block, when there is one.
 *
 * Flattening emits a table's cells in row-major order, so the document's final
 * flattened block being a table cell IS "the document ends with a table", and
 * that cell's row index IS the table's last row. No second traversal needs to
 * agree with this one.
 */
function documentTailTableLastRow(
  blocks: FlatBlock[]
): { tableAnchor: string; row: number } | undefined {
  const last = blocks[blocks.length - 1];
  const tableAnchor = last ? tableAnchorForBlock(last) : undefined;
  if (!tableAnchor) return undefined;
  const row = Number(last.anchor.split(';')[2]);
  return Number.isInteger(row) ? { tableAnchor, row } : undefined;
}

/** The half of the refusal that is about SyncFusion, shared so it cannot drift. */
const DOCUMENT_TAIL_TABLE_REASON =
  'SyncFusion cannot accept the revision that would produce: `acceptAll` throws part-way through, after the deletion has already applied, so the edit would land and then break the review pane when the card is accepted. Rejecting is unaffected. Nothing was written.';

/**
 * The refusal that is about DELETING a block RANGE: the document's last section
 * when the document ends with a table.
 *
 * A range that ends the document at a table cell necessarily covers that table's
 * last row, which is why this is the range-shaped instance of the one rule above
 * rather than a rule of its own.
 *
 * A copy never deletes its source, so this does not apply to one.
 */
/**
 * A relocation must move blocks that all live in ONE Word section.
 *
 * A section unit runs to the next heading of the same or shallower level, so in
 * a document with no headings it runs to the END of the document - straight
 * across any Word section break on the way. Relocating such a range cannot be
 * authored as a rejectable revision, and the op discovers that only AFTER it has
 * already moved blocks: the refusal then arrives with the first section's text
 * destroyed and nothing restored. Refuse before anything is written.
 */
function assertRangeWithinOneSection(range: BlockRange): void {
  const sections = new Set(
    range.blocks.map((entry) => String(entry.anchor).split(';')[0])
  );
  if (sections.size <= 1) return;
  throw new OpError(
    'relocation_spans_section_break',
    `Refusing to relocate the section at ${JSON.stringify(
      range.anchor
    )}: the range it resolves to crosses a section break, and a section break cannot be relocated as a tracked change. Nothing was written.`,
    [
      `anchor: ${range.anchor}`,
      `sections covered: ${[...sections].join(', ')}`,
      'Anchor a heading whose section unit ends before the break, or move the blocks in smaller pieces.'
    ]
  );
}

function assertRangeIsRemovable(blocks: FlatBlock[], range: BlockRange): void {
  const last = range.blocks[range.blocks.length - 1];
  const tail = documentTailTableLastRow(blocks);
  if (
    !range.endsDocument ||
    !tail ||
    tableAnchorForBlock(last) !== tail.tableAnchor
  )
    return;
  throw new OpError(
    'relocation_document_tail_table',
    `Refusing to relocate the section at ${JSON.stringify(
      range.anchor
    )}: it is the last section of the document and the document ends with a table. ${DOCUMENT_TAIL_TABLE_REASON}`,
    [
      `anchor: ${range.anchor}`,
      `last block in range: ${last.anchor}`,
      `the document ends with the table at ${tail.tableAnchor}, whose last row is ${tail.row}`,
      'Express the change from the other side and the document tail stays put: move the section you want beside this one with move_section, using this section as the targetAnchor. To duplicate it rather than move it, copy_section leaves the tail alone.'
    ]
  );
}

/**
 * The refusal that is about DELETING a ROW SET - the same rule, the other shape.
 *
 * `delete_row` reaches this today with no guard at all: it reports `ok: true`
 * over a document whose accept will crash, so the failure surfaces later, to the
 * user, as a broken review pane on a card that looked applied.
 */
function assertRowsAreRemovable(
  blocks: FlatBlock[],
  tableAnchor: string,
  rows: number[]
): void {
  const tail = documentTailTableLastRow(blocks);
  if (!tail || tail.tableAnchor !== tableAnchor || !rows.includes(tail.row))
    return;
  throw new OpError(
    'document_tail_table_last_row',
    `Refusing to delete row ${tail.row} of the table at ${JSON.stringify(
      tableAnchor
    )}: it is the last row of that table, and that table is the last block of the document. ${DOCUMENT_TAIL_TABLE_REASON}`,
    [
      `table: ${tableAnchor}, last row: ${tail.row}`,
      `rows this edit would remove: ${rows.join(', ')}`,
      'Any other row of this table can be removed as usual. To remove this one, give the document a paragraph after the table first, so the table is no longer what the document ends with.'
    ]
  );
}

/**
 * The refusal that is about DELETING A WHOLE TABLE - the same rule, third shape.
 *
 * Deleting a table deletes every row it has, so a table that is the document's
 * last block always covers the row above. `delete_table` shipped on
 * `origin/master` with no guard at all, and it is reachable there today: it
 * answers `ok: true` and then `acceptAll` throws
 * `Cannot read properties of undefined (reading 'childWidgets')`, measured on a
 * real DocumentEditor, with a paragraph after the table as the control that
 * accepts cleanly.
 *
 * Its own remedy differs from the row-set one - there is no "some other row" to
 * offer when the request was the whole table - so it names its own, and takes
 * the SyncFusion half of the reason from the shared constant so the three
 * explanations of one defect cannot drift apart.
 */
/**
 * The same document-tail rule, for the copy rather than the deletion.
 *
 * A duplicate is not a delete, which is why the family above excluded it - but
 * it pastes a copy and then deletes rows out of that copy, so the tail-table
 * rule bites it all the same. It just bit AFTERWARDS: the paste had already
 * landed when `split_table_copy_lost` refused, and because that residue authors
 * no revision there was nothing for the rollback to reject. The refusal said
 * "nothing of this change set was kept" while the document disagreed.
 *
 * Asked before the paste instead, the same refusal is true. This is the whole
 * of the prevent-versus-detect distinction in one case: the guard did not need
 * to be smarter, it needed to run earlier.
 */
function assertTableIsDuplicable(
  blocks: FlatBlock[],
  tableAnchor: string
): void {
  const tail = documentTailTableLastRow(blocks);
  if (!tail || tail.tableAnchor !== tableAnchor) return;
  throw new OpError(
    'document_tail_table_last_row',
    `Refusing to duplicate the table at ${JSON.stringify(
      tableAnchor
    )}: it is the document's last block, so the copy has no following paragraph to be readable against and the engine would have to delete rows out of whatever it merged with. ${DOCUMENT_TAIL_TABLE_REASON}`,
    [`table: ${tableAnchor}`, `document tail table last row: ${tail.row}`],
    'never'
  );
}

function assertTableIsRemovable(
  blocks: FlatBlock[],
  tableAnchor: string
): void {
  const tail = documentTailTableLastRow(blocks);
  if (!tail || tail.tableAnchor !== tableAnchor) return;
  throw new OpError(
    'document_tail_table_last_row',
    `Refusing to delete the table at ${JSON.stringify(
      tableAnchor
    )}: that table is the last block of the document, so deleting it removes its last row. ${DOCUMENT_TAIL_TABLE_REASON}`,
    [
      `table: ${tableAnchor}, last row: ${tail.row}`,
      'this edit would remove every row of that table',
      'Give the document a paragraph after the table first, so the table is no longer what the document ends with, and the table can then be deleted as usual.'
    ]
  );
}

/**
 * The refusal that is about REJECTING the range: a pending change somebody else
 * authored inside it.
 *
 * A move folds whatever it moves into its own card - the delete consumes a
 * pending insertion rather than authoring a Deletion beside it - so rejecting the
 * move reverts that earlier edit too. For Robin's own pending edits that is
 * correct. For a human reviewer's it is not: their edit would disappear because
 * we moved a section, and nothing would say so.
 *
 * A copy leaves the source untouched, so it takes nothing away from anyone and
 * this does not apply to one either.
 */
/**
 * Refuse a selection-driven structural op over a table whose cells carry
 * bindings.
 *
 * A selection write deletes the content control it lands in - tag and all - and
 * that destruction authors no revision, so the reject-projection check cannot
 * restore it and `rejectRevisions` has nothing to reject. The result measured on
 * a bound costs table: a REFUSED split destroyed seven binding tags including
 * the `sum(costs.line_total)` subtotal, leaving numbers that still render and
 * never recompute again.
 *
 * The engine already has the sound path for bound tables - `insert_row`,
 * `delete_row`, `delete_table` and `duplicate_table` route through the binding
 * engine's mutation plan. `split_table` shares its physical row-delete with
 * `delete_row` but never consults the runtime, so it runs that same destruction
 * unguarded. Until it is composed from the engine primitives, refuse.
 */
function assertTableHasNoBindings(
  sfdt: any,
  tableAnchor: string,
  opName: string
): void {
  // Ask the binding scan what is bound - it is the one owner of that answer.
  // Reading raw SFDT for tag-shaped strings would be a second, weaker source of
  // truth that drifts the moment the grammar changes.
  const bound = flattenSfdt(sfdt).filter(
    (candidate) =>
      !!candidate.boundTag && candidate.anchor.startsWith(`${tableAnchor};`)
  );
  // A table can be bound by its own table-scope marker while no individual cell
  // carries a field tag - a bound repeating table with no data rows yet. Ask the
  // binding index about the table itself, not only its cells.
  const boundTable = bindingTablesByAnchor(sfdt).has(tableAnchor);
  if (!bound.length && !boundTable) return;
  throw new OpError(
    'structural_op_would_destroy_bindings',
    `${opName} cannot restructure the table at ${JSON.stringify(
      tableAnchor
    )}: its cells carry ${bound.length} binding${
      bound.length === 1 ? '' : 's'
    }, and the selection this op uses would delete their content controls outright. That destroys the binding rather than moving it, and rejecting the change cannot bring it back. Nothing was written.`,
    [
      `table: ${tableAnchor}`,
      `bound cells: ${bound.map((candidate) => candidate.anchor).join(', ')}`,
      'Use insert_row, delete_row or duplicate_table, which the binding engine performs safely, or change values with set_cell_text.'
    ]
  );
}

function assertRangeHasNoForeignEdits(sfdt: any, range: BlockRange): void {
  const author = foreignPendingAuthor(sfdt, range);
  if (author)
    throw new OpError(
      'relocation_source_has_pending_review',
      `Refusing to relocate the section at ${JSON.stringify(
        range.anchor
      )}: it contains a pending tracked change by ${JSON.stringify(
        author
      )}. A relocation folds what it moves into its own card, so rejecting this move would silently revert their edit as well. Nothing was written.`,
      [
        `anchor: ${range.anchor}`,
        `pending author: ${author}`,
        `Ask for ${author}'s change to be accepted or rejected first, then relocate the section.`
      ]
    );
}

function assertDuplicateSourceHasNoForeignEdits(
  sfdt: any,
  tableAnchor: string
): void {
  const container = tableContainerAt(sfdt, tableAnchor);
  const author = container
    ? foreignPendingAuthorInBlocks(sfdt, [container.block])
    : undefined;
  if (!author) return;
  throw new OpError(
    'duplicate_table_source_has_pending_review',
    `Refusing to duplicate the table at ${JSON.stringify(
      tableAnchor
    )}: it contains a pending tracked change by ${JSON.stringify(
      author
    )}. Cloning the table would also clone their pending review card into new content. Nothing was written.`,
    [
      `table: ${tableAnchor}`,
      `pending author: ${author}`,
      `Ask for ${author}'s change to be accepted or rejected first, then duplicate the table.`
    ]
  );
}

/**
 * Where a range's anchors moved to after a paste, re-derived and verified.
 *
 * Only a PASTE shifts block indices - a tracked delete marks its content and
 * leaves it exactly where it was, which is the property that makes a two-step
 * relocation (and the bottom-up swap) deterministic without predicting
 * anything. A paste shifts only the blocks at or after it, and only within its
 * own Word section.
 *
 * The arithmetic is then CHECKED against the document rather than trusted: the
 * re-derived range must cover the same blocks reading the same text. If it does
 * not, the op fails and the group rolls back, instead of deleting whatever
 * happens to sit at the computed index.
 */
function shiftedRange(
  sfdt: any,
  range: BlockRange,
  paste: PasteEffect,
  sourceIndex: number,
  // How to read the range back at its new address. A section range and a table
  // range are addressed differently - a table anchor is not among the flattened
  // blocks at all, its CELLS are - so the resolver that produced the range is
  // the only thing that can find it again.
  resolve: (blocks: FlatBlock[], anchor: string) => BlockRange = (
    blocks,
    anchor
  ) => resolveSectionRange(blocks, anchor, 'relocated anchor')
): BlockRange {
  const movedIndex =
    paste.at <= sourceIndex ? sourceIndex + paste.blocks : sourceIndex;
  // The invariant that makes landing on the copy impossible rather than merely
  // unlikely: the pasted run occupies exactly [at, at + blocks) of the sequence,
  // and the source is never inside it. Without this the two are almost
  // indistinguishable by content - which is the whole reason the live failure
  // got as far as a comparison instead of stopping here.
  if (movedIndex >= paste.at && movedIndex < paste.at + paste.blocks)
    throw new OpError(
      'relocation_source_lost',
      `Refusing to delete the source of the move at ${JSON.stringify(
        range.anchor
      )}: after the paste it resolves to block ${movedIndex}, which is inside the run this op just pasted (blocks ${
        paste.at
      }..${
        paste.at + paste.blocks - 1
      }). That would delete the copy instead of the original. Nothing of this change set was kept.`,
      [
        `source at sequence index ${sourceIndex}, paste of ${paste.blocks} blocks at ${paste.at}`
      ]
    );
  const sequence = topLevelSequence(sfdt);
  const address = sequence[movedIndex];
  const blocks = flattenSfdt(sfdt);
  const anchor = address ? `${address.section};${address.block}` : '';
  const moved = anchor ? resolve(blocks, anchor) : undefined;
  const before = rangeIdentity(range.blocks);
  const after = moved ? rangeIdentity(moved.blocks) : '';
  if (!moved || before !== after)
    throw new OpError(
      'relocation_source_lost',
      `The section that was at ${JSON.stringify(
        range.anchor
      )} is no longer readable at ${JSON.stringify(
        anchor || `sequence index ${movedIndex}`
      )} after the content was inserted at its destination, so the engine refused to delete what is there now. Nothing of this change set was kept.`,
      [
        `expected ${range.blocks.length} blocks reading ${JSON.stringify(
          before.slice(0, 200)
        )}`,
        `found ${
          moved ? moved.blocks.length : 0
        } blocks reading ${JSON.stringify(after.slice(0, 200))}`
      ]
    );
  return moved;
}

/**
 * The primitive behind the MOVING relocations - move_section, swap_sections
 * and split_table: capture a resolved range through the live selection, paste
 * it at a target caret, tracked, and optionally remove the original. The pure
 * copies (copy_section, duplicate_table) do not capture at all: they build
 * their payload from the document's own SFDT and paste it through
 * `pasteBlocksAsTrackedSegments`, which is what lets them carry a
 * block-wrapped table a multi-block selection paste silently loses.
 *
 * Returns the paste's measured effect on block positions, which is what a caller
 * relocating a SECOND range needs in order to find it again, and the document as
 * it stood immediately after the paste - every shift is already in it, because
 * the delete that may follow shifts nothing.
 */
function relocateBlockRange(
  editor: LiveEditor,
  preSfdt: any,
  source: BlockRange,
  target: PasteTarget,
  {
    removeSource,
    transformPayload
  }: {
    removeSource: boolean;
    /**
     * Relocate only PART of the captured range, by returning a narrowed payload.
     *
     * `split_table` is the caller: it needs a copy holding the header band and
     * the extracted rows only. Narrowing the payload BEFORE the paste rather
     * than deleting rows from the pasted copy afterwards is not a preference -
     * SyncFusion's `deleteRow` on a row that is itself an unaccepted insertion
     * writes rowSpan back into a DIFFERENT table, which left the source's
     * untouched rows reading rowSpan 0 and -1 with no revision to reject. Isolated
     * to that exact case: two ordinary tables are fine, and deleting a row from
     * either of them is fine, tracked or not.
     *
     * This reads and writes no content. It drops entries from a row array in the
     * same SFDT the engine parses everywhere else.
     */
    transformPayload?: (payload: string) => string;
  } = { removeSource: true }
): { paste: PasteEffect; pastedSfdt: any } {
  editor.selection.select(source.startAnchor, source.endAnchor);
  const captured = (editor.selection as any)?.sfdt;
  const payload =
    typeof captured === 'string' && captured && transformPayload
      ? transformPayload(captured)
      : captured;
  if (typeof payload !== 'string' || !payload)
    throw new OpError(
      'relocation_payload_unavailable',
      `SyncFusion returned no content for the range ${source.startAnchor} - ${source.endAnchor}, so there is nothing to relocate. Nothing was written.`
    );
  // Measured in the whole-document sequence, before any write: a paste that
  // carries a section break renumbers Word sections, so neither the paste point
  // nor the source can be tracked by (section, block) across it.
  const sequenceBefore = topLevelSequence(preSfdt);
  const pasteAt = (() => {
    const index = sequenceIndexOf(sequenceBefore, target.address);
    // One past the last block of the document - the `position: 'after'` tail.
    return index < 0 ? sequenceBefore.length : index;
  })();
  const sourceIndex = sequenceIndexOf(
    sequenceBefore,
    topLevelAddress(source.blocks[0].anchor)
  );
  if (sourceIndex < 0)
    throw new OpError(
      'relocation_source_lost',
      `The section at ${JSON.stringify(
        source.anchor
      )} is not addressable in the document as it stands, so nothing was moved.`
    );
  // The destination past the document's last paragraph mark has no caret until
  // one is made. Created AFTER the payload is captured, so the capture reads
  // the document the caller resolved its anchors against, and as a tracked
  // insertion inside this same card, so rejecting takes it away again.
  if (target.appendParagraphAt) {
    editor.selection.select(target.appendParagraphAt, target.appendParagraphAt);
    callEditor(editor, 'insertText', '\n');
  }
  editor.selection.select(target.anchor, target.anchor);
  callEditor(editor, 'paste', payload);
  const pastedSfdt = serializeSfdt(editor);
  const paste: PasteEffect = {
    at: pasteAt,
    // The ACTUAL number of blocks the paste added, never the source's own count:
    // SyncFusion normalizes a payload (a trailing empty paragraph in particular),
    // so the two are not the same number.
    blocks: topLevelSequence(pastedSfdt).length - sequenceBefore.length
  };
  if (removeSource) {
    const moved = shiftedRange(pastedSfdt, source, paste, sourceIndex);
    editor.selection.select(moved.startAnchor, moved.endAnchor);
    editor.editor.delete();
  }
  return { paste, pastedSfdt };
}

/** Resolves `targetAnchor` + `position` into the caret the payload lands at. */
function resolveRelocationTarget(
  blocks: FlatBlock[],
  op: EditOp,
  source: BlockRange
): PasteTarget {
  const anchor = String(op.targetAnchor ?? '').trim();
  const target = resolveSectionRange(blocks, anchor, 'targetAnchor');
  const first = topLevelAddress(source.blocks[0].anchor);
  const last = topLevelAddress(source.blocks[source.blocks.length - 1].anchor);
  const inSource = (address: { section: number; block: number }) =>
    !addressIsBefore(address, first) && !addressIsBefore(last, address);
  // Both the anchor the model named AND the caret it resolves to have to be
  // outside the range. They are not the same test: `position: 'after'` on a
  // section that runs to the end of the document resolves to the last block of
  // the document, which is inside the source whenever the source is the tail.
  const refuseInsideSource = (where: string): never => {
    throw new OpError(
      'relocation_target_inside_source',
      `Refusing to move the section at ${JSON.stringify(
        source.anchor
      )} to ${JSON.stringify(
        anchor
      )}: ${where} is inside the range that section covers, so the move has no destination outside what it is moving. Nothing was written.`,
      [
        `source range: ${source.blocks[0].anchor} .. ${
          source.blocks[source.blocks.length - 1].anchor
        }`,
        `targetAnchor: ${anchor}`,
        `resolved paste point: ${where}`,
        'Pick a targetAnchor outside that range. To move only a SUBSECTION of it, anchor that subsection heading instead - the range rule is depth-aware, so a subsection moves without its parent.'
      ]
    );
  };
  if (inSource(topLevelAddress(anchor))) refuseInsideSource(anchor);
  const after = op.position === 'after';
  const tail = target.blocks[target.blocks.length - 1];
  const following = after ? blocks[blocks.indexOf(tail) + 1] : undefined;
  const caretBlock = after ? following ?? tail : target.blocks[0];
  if (caretBlock.kind === 'table_cell')
    throw new OpError(
      'relocation_target_in_table',
      `Refusing to move the section at ${JSON.stringify(source.anchor)} ${
        after ? 'after' : 'before'
      } ${JSON.stringify(
        anchor
      )}: that lands the content inside the table cell at ${JSON.stringify(
        caretBlock.anchor
      )}. A section is relocated between top-level blocks, never into a cell. Nothing was written.`,
      [
        `targetAnchor: ${anchor}`,
        `resolved paste point: ${caretBlock.anchor}`,
        !after
          ? 'Use the anchor of a heading or body paragraph from a structure read.'
          : following
          ? 'Use position "before" on the section that follows this one instead.'
          : 'That table is the end of the document, so there is no body block after it: relocate the other section with position "before" this one instead.'
      ]
    );
  if (inSource(topLevelAddress(caretBlock.anchor)))
    refuseInsideSource(caretBlock.anchor);
  // `after` means after everything the target section covers, not after its
  // heading paragraph: both anchors name section UNITS, which is what makes
  // "move A below B" mean what the user said when B has subsections.
  if (after && !following) {
    // Past the document's last paragraph mark: there is no caret there, so the
    // primitive creates the paragraph the payload lands at. See
    // PasteTarget.appendParagraphAt for why arithmetic on the mark cannot do
    // this and what the fusion looked like before.
    const address = topLevelAddress(tail.anchor);
    return {
      anchor: `${address.section};${address.block + 1};0`,
      address: { ...address, block: address.block + 1 },
      appendParagraphAt: `${tail.anchor};${tail.length}`
    };
  }
  return {
    anchor: `${caretBlock.anchor};0`,
    address: topLevelAddress(caretBlock.anchor)
  };
}

/** A clone of the range's raw blocks, resolved to what the user currently sees. */
/**
 * The block to clone when duplicating ONE table.
 *
 * A content control can wrap a table together with sibling paragraphs, and
 * cloning the whole container duplicates those siblings as well - reported as a
 * successful table duplicate, because the read-back afterwards verifies only
 * the table's own blocks and never looks at what else came along. Keep the
 * wrapper, because the table needs it, and carry only the addressed table
 * inside it.
 *
 * Used by both duplication routes. A bound table duplicates through the binding
 * engine and an unbound one through the editor, and a rule that only one of
 * them obeys is how the two drift apart.
 */
function containerCarryingOnlyTable(container: any, table: any): any {
  if (!container || !table || getRows(container)) return container;
  const children = pick(container, 'blocks', 'b');
  if (!Array.isArray(children) || children.length <= 1) return container;
  return 'blocks' in container
    ? { ...container, blocks: [table] }
    : { ...container, b: [table] };
}

function clonedRangeBlocks(sfdt: any, range: BlockRange): any[] {
  return clonedWithoutRevisions(sfdt, rawBlocksInRange(sfdt, range));
}

/** A table wrapped in a block-level content control - the one paste-hostile shape. */
function isBlockWrappedTable(block: any): boolean {
  return (
    !!block &&
    pick(block, 'contentControlProperties', 'ccp') !== undefined &&
    !getRows(block) &&
    !!firstTableBlockIn(block)
  );
}

/**
 * The cloned blocks partitioned into the pastes SyncFusion executes completely.
 *
 * A multi-block payload is truncated - blocks silently lost - whenever it holds
 * a table wrapped in a block-level content control, while the SAME wrapped
 * table pasted alone lands intact (it is the payload the table duplicate has
 * always pasted). So each wrapped table becomes its own paste and the maximal
 * runs between them paste as one payload each.
 *
 * Word renders two adjacent tables as ONE table, so an empty separator
 * paragraph is added wherever a cloned table would land flush against another
 * table - a neighbour inside the clone, or the document block on either side
 * of the paste point - the same adjacency rule the table duplicate encodes.
 */
function copyPasteSegments(
  cloned: any[],
  sfdt: any,
  target: PasteTarget
): any[][] {
  const sequence = topLevelSequence(sfdt);
  const tableAt = (index: number): boolean => {
    const address = sequence[index];
    return address
      ? !!firstTableBlockIn(
          rawSectionBlocks(sfdt, address.section)[address.block]
        )
      : false;
  };
  const resolved = sequenceIndexOf(sequence, target.address);
  // One past the last block of the document - the tail destination.
  const at =
    target.appendParagraphAt || resolved < 0 ? sequence.length : resolved;
  const composed: any[] = [];
  for (const block of cloned) {
    if (firstTableBlockIn(block)) {
      const previous = composed[composed.length - 1];
      if (previous ? firstTableBlockIn(previous) : tableAt(at - 1))
        composed.push(emptyParagraphBlock(sfdt));
    }
    composed.push(block);
  }
  if (
    firstTableBlockIn(composed[composed.length - 1]) &&
    !target.appendParagraphAt &&
    tableAt(at)
  )
    composed.push(emptyParagraphBlock(sfdt));
  const segments: any[][] = [];
  let run: any[] = [];
  for (const block of composed) {
    if (isBlockWrappedTable(block)) {
      if (run.length) segments.push(run);
      run = [];
      segments.push([block]);
    } else run.push(block);
  }
  if (run.length) segments.push(run);
  return segments;
}

/**
 * Paste the segments at the target, sequentially, as parts of one tracked
 * insertion run - the precedent for several pastes in one revision group is
 * `swap_sections`.
 *
 * The measured paste physics this encodes: a payload's LAST paragraph merges
 * into the block the caret sits in, so every paragraph-final segment is sent
 * with a trailing empty merge-guard paragraph, which the merge absorbs. A
 * table cannot merge, so a table-final segment needs no guard. With the guard
 * in place each paste adds exactly its content blocks, all of them BEFORE the
 * caret block - so the caret block's own measured position is where the next
 * segment continues, and a normalized-away paragraph cannot skew the run.
 *
 * Returns the aggregate effect over the whole run plus the document as pasted,
 * in the same shape `relocateBlockRange` reports a single paste.
 */
function pasteBlocksAsTrackedSegments(
  editor: LiveEditor,
  preSfdt: any,
  segments: any[][],
  target: PasteTarget
): { paste: PasteEffect; pastedSfdt: any } {
  // The destination past the document's last paragraph mark has no caret until
  // one is made - a tracked insertion inside this same card, exactly as
  // `relocateBlockRange` creates it. Measured AFTER the landing paragraph
  // exists, so the aggregate covers pasted content only.
  if (target.appendParagraphAt) {
    editor.selection.select(target.appendParagraphAt, target.appendParagraphAt);
    callEditor(editor, 'insertText', '\n');
  }
  let pastedSfdt = target.appendParagraphAt ? serializeSfdt(editor) : preSfdt;
  const pasteAt = (() => {
    const sequence = topLevelSequence(pastedSfdt);
    const index = sequenceIndexOf(sequence, target.address);
    // One past the last block of the document - the tail destination.
    return index < 0 ? sequence.length : index;
  })();
  let caret = target.anchor;
  let added = 0;
  for (const segment of segments) {
    const lengthBefore = topLevelSequence(pastedSfdt).length;
    const guarded = firstTableBlockIn(segment[segment.length - 1])
      ? segment
      : [...segment, emptyParagraphBlock(pastedSfdt)];
    editor.selection.select(caret, caret);
    // The envelope must speak the document's own key convention: the paste
    // parser reads a payload in one dialect only, and blocks in the other one
    // are silently dropped rather than refused.
    callEditor(
      editor,
      'paste',
      JSON.stringify(
        pastedSfdt?.sections !== undefined
          ? { sections: [{ blocks: guarded, headersFooters: {} }] }
          : { optimizeSfdt: true, sec: [{ b: guarded, hf: {} }] }
      )
    );
    pastedSfdt = serializeSfdt(editor);
    added += topLevelSequence(pastedSfdt).length - lengthBefore;
    const next = topLevelSequence(pastedSfdt)[pasteAt + added];
    if (next) caret = `${next.section};${next.block};0`;
  }
  return { paste: { at: pasteAt, blocks: added }, pastedSfdt };
}

/**
 * The pasted run, read back from the document and compared against what was
 * sent. `ok: true` from a paste only means the paste did not throw; this is
 * the integrity backstop that turns a silently truncated copy into a refusal
 * that rolls the whole group back - the same discipline `shiftedRange` applies
 * to a relocation's source and `assertPastedTableMatches` to a table copy.
 */
function assertPastedRangeMatches(
  pastedSfdt: any,
  paste: PasteEffect,
  source: BlockRange,
  expectedBlocks: any[]
): void {
  const sequence = topLevelSequence(pastedSfdt);
  const window = new Set<string>();
  for (let index = paste.at; index < paste.at + paste.blocks; index++) {
    const address = sequence[index];
    if (address) window.add(`${address.section};${address.block}`);
  }
  const copied = flattenSfdt(pastedSfdt).filter((block) => {
    const parts = block.anchor.split(';');
    return window.has(`${parts[0]};${parts[1]}`);
  });
  const expected = rangeIdentity(
    flattenSfdt({ sections: [{ blocks: expectedBlocks }] })
  );
  const actual = rangeIdentity(copied);
  if (expected !== actual)
    throw new OpError(
      'relocation_copy_lost',
      `The copy of the section at ${JSON.stringify(
        source.anchor
      )} is not readable at the position it was pasted into, so the engine refused to keep an incomplete copy. Nothing of this change set was kept.`,
      [
        `paste of ${paste.blocks} block(s) at sequence index ${paste.at}`,
        `expected blocks reading ${JSON.stringify(expected.slice(0, 200))}`,
        `found blocks reading ${JSON.stringify(actual.slice(0, 200))}`
      ]
    );
}

// ---------------------------------------------------------------------------
// split_table - one table becomes two, and the engine writes no content
//
// The captain: "we need split to work too. Also smart split we can be like split
// this table into two table one with all of a specific items from the first
// table. And the items could be in any rows in the main table."
//
// Two shapes, and the second is the one that matters: the extracted rows are NOT
// contiguous. `splitAtRow` expresses the positional shape and `rows` the
// selective one; both normalize to one row set on the way in, so there is one
// code path rather than two.
//
// The mechanism: capture the WHOLE TABLE through the live selection, narrow the
// captured payload to the header band plus the extracted rows, paste that at the
// target, and delete the extracted rows from the source. Capturing the whole table is
// what makes the row indices trivially correspond - payload row i is source row i
// - and narrowing before the paste rather than pruning the pasted copy afterwards
// is forced by a SyncFusion defect: `deleteRow` on a row that is itself an
// unaccepted insertion writes rowSpan back into a DIFFERENT table, which left the
// source's untouched rows reading rowSpan 0 and -1 with nothing to reject.
//
// That choice is what keeps the model out of the content:
//
//   * the new table's appearance is IDENTITY, not inheritance - it is the source
//     table's own serialized content pasted back, so it renders the same by
//     construction. Measured through the RESOLVED read (`cellFormat.background`
//     per row), not merely the stated SFDT.
//   * the HEADER BAND lands in both tables for free, because the copy is the
//     whole table. Nothing reproduces or re-authors a header.
//   * the alternative - build a table and fill it - would have to author every
//     cell it moved, which is exactly what produced a duplicated section and
//     placeholder tokens in a client proposal before move_section existed.
//
// SPLIT IS THEREFORE NOT A CONTENT-CREATING OP, and it deliberately does not
// consult `creationAppearance`. That resolver answers "what should content with
// NO source look like" - a composed section, an inserted table, a new row. A
// split's new table HAS a source: the table it came out of. Routing it through
// the resolver would replace an exact copy with an inferred one, and put a
// second owner on the same pixels. `copy_section` sits outside
// CONTENT_CREATING_OPS for the identical reason. Do not "fix" this by adding it.
//
// Row indices are read from a table_facts read (`TableRowFact.row`), never
// counted - and `splitAtRow` exists so the positional shape needs no enumeration
// of a long tail either.
//
// NO TITLE, and no option for one. The captain: "ok i am fine with defaulting to
// no title when split." A title is CONTENT, so putting one on this op - even
// routed internally through the composed-heading path - would give it a
// model-authored text field and lose the schema-level guarantee that it cannot
// retype or fabricate anything. A title is therefore a separate composed heading
// through the section composer, which also means "add a title later" is the SAME
// operation as adding one now, rather than a second path that could disagree
// about style. Proven as two ordinary turns in splitTable.spec.ts.
// ---------------------------------------------------------------------------

/**
 * The whole-table range: the table's own cells, and the selection spanning them.
 *
 * Sliced by INDEX rather than filtered by table anchor, so a nested table's
 * cells - which carry deeper anchors and belong to no top-level table - stay
 * inside the extent instead of silently dropping out of it and breaking the
 * identity check that re-resolution depends on.
 */
function resolveTableRange(
  blocks: FlatBlock[],
  tableAnchor: string
): BlockRange {
  const first = blocks.findIndex(
    (block) => tableAnchorForBlock(block) === tableAnchor
  );
  if (first < 0) throw relocationAnchorMissing(tableAnchor, 'anchor');
  let last = first;
  for (let index = first; index < blocks.length; index++)
    if (tableAnchorForBlock(blocks[index]) === tableAnchor) last = index;
  const covered = blocks.slice(first, last + 1);
  const next = blocks[last + 1];
  return {
    anchor: tableAnchor,
    blocks: covered,
    startAnchor: `${blocks[first].anchor};0`,
    endAnchor: markInclusiveRangeEnd(next, blocks[last]),
    endsDocument: !next
  };
}

/**
 * Every vertically merged cell's span, as { row, span }.
 *
 * The key set must match the inventory's own cell-format read: `tcpr` is the
 * OPTIMIZED key and the live editor always serializes optimized SFDT, so
 * omitting it made every merge span invisible in production once already while
 * long-key fixtures kept the spec green.
 */
/**
 * A plain-language account of a table's merged cells, or null when it has none.
 *
 * `insert_row` next to a vertical merge refuses through a generic post-write
 * formatting failure that never mentions merges, so a model reading it cannot
 * tell what to change. `split_table` already names the exact span it would tear;
 * this brings the row insert up to that standard. Message only - nothing about
 * which inserts are allowed changes.
 */
function describeTableMerges(tableBlock: any): string | null {
  const spans = verticalSpans(tableBlock);
  const rows = getRows(tableBlock) ?? [];
  let gridSpans = 0;
  for (const row of rows) {
    const cells = pick(row, 'cells', 'c');
    if (!Array.isArray(cells)) continue;
    for (const cell of cells) {
      const format = pick(cell, 'cellFormat', 'tcpr', 'cf') ?? {};
      const span = Number(pick(format, 'gridSpan', 'gs') ?? 1);
      if (Number.isFinite(span) && span > 1) gridSpans++;
    }
  }
  if (!spans.length && !gridSpans) return null;
  const parts: string[] = [];
  for (const { row, span } of spans)
    parts.push(`rows ${row}..${row + span - 1} are vertically merged`);
  if (gridSpans)
    parts.push(
      `${gridSpans} cell${
        gridSpans === 1 ? ' spans' : 's span'
      } more than one column`
    );
  return parts.join('; ');
}

function verticalSpans(tableBlock: any): Array<{ row: number; span: number }> {
  const out: Array<{ row: number; span: number }> = [];
  const rows = getRows(tableBlock);
  if (!rows) return out;
  rows.forEach((row: any, index: number) => {
    const cells = pick(row, 'cells', 'c');
    if (!Array.isArray(cells)) return;
    for (const cell of cells) {
      const format = pick(cell, 'cellFormat', 'tcpr', 'cf') ?? {};
      const span = Number(pick(format, 'rowSpan', 'rwsp') ?? 1);
      if (Number.isFinite(span) && span > 1) out.push({ row: index, span });
    }
  });
  return out;
}

/** The rows a split takes, the rows it leaves, and the band it never touches. */
interface SplitRowPlan {
  /** Ascending, deduped, every one a data row. Goes to the NEW table. */
  extract: number[];
  /** Ascending. Stays in the SOURCE table. */
  keep: number[];
  headerRows: number;
  rowCount: number;
}

function splitRefusal(
  code: string,
  message: string,
  details: string[]
): OpError {
  return new OpError(code, `${message} Nothing was written.`, details);
}

/**
 * Normalize `rows` / `splitAtRow` into one row set, refusing everything the
 * document itself says cannot be a split.
 *
 * Every refusal here is derived from the table - its header band, its real row
 * count, its merges - rather than enumerated from cases, which is why a
 * two-row header band or a headerless table needs no special branch.
 */
function resolveSplitRows(
  op: EditOp,
  tableAnchor: string,
  source: TableAppearance,
  headerRows: number,
  tableBlock: any
): SplitRowPlan {
  const rowCount = source.rows.length;
  const data: number[] = [];
  for (let row = headerRows; row < rowCount; row++) data.push(row);
  const where = `table ${tableAnchor}: ${rowCount} rows, header band ${headerRows}`;
  if (!data.length)
    throw splitRefusal(
      'split_table_header_only',
      `The table at ${JSON.stringify(
        tableAnchor
      )} has no data rows - every row it has is part of its header band - so there is nothing to split out of it.`,
      [where, 'Re-read the table with a table_facts read.']
    );

  const asked = Array.isArray(op.rows) ? op.rows : undefined;
  const at = typeof op.splitAtRow === 'number' ? op.splitAtRow : undefined;
  if (asked && at !== undefined)
    throw splitRefusal(
      'split_table_rows_ambiguous',
      'split_table takes either `rows` (the row indices to extract) or `splitAtRow` (extract that row and every row below it), not both - and these two do not agree on one answer.',
      [
        where,
        `rows: ${asked.join(', ')}`,
        `splitAtRow: ${at}`,
        'Send `rows` for a set of specific rows, or `splitAtRow` for a positional split.'
      ]
    );
  if (!asked && at === undefined)
    throw splitRefusal(
      'split_table_no_rows',
      'split_table needs to know which rows to extract: send `rows` with the row indices from a table_facts read, or `splitAtRow` to extract that row and every row below it.',
      [where]
    );

  const requested = asked ?? data.filter((row) => row >= (at as number));
  const outOfRange = (asked ?? [at as number]).filter(
    (row) => !Number.isInteger(row) || row < 0 || row >= rowCount
  );
  if (outOfRange.length)
    throw splitRefusal(
      'split_table_row_out_of_range',
      `The table at ${JSON.stringify(tableAnchor)} has ${rowCount} rows (0..${
        rowCount - 1
      }), so ${outOfRange.join(', ')} ${
        outOfRange.length > 1 ? 'do' : 'does'
      } not address a row in it.`,
      [
        where,
        'The document may have changed since it was read. Re-read it with a table_facts read and use its row numbers.'
      ]
    );

  const inHeader = (asked ?? [at as number]).filter((row) => row < headerRows);
  if (inHeader.length)
    throw splitRefusal(
      'split_table_header_row',
      `Row${inHeader.length > 1 ? 's' : ''} ${inHeader.join(
        ', '
      )} of the table at ${JSON.stringify(tableAnchor)} ${
        inHeader.length > 1 ? 'are' : 'is'
      } part of its header band, and a split REPRODUCES the header band in both tables rather than moving it - so a header row is not something to extract.`,
      [
        where,
        "Name only data rows. Both tables come out with this table's header already on them."
      ]
    );

  const extract = Array.from(new Set(requested)).sort(
    (left, right) => left - right
  );
  if (!extract.length)
    throw splitRefusal(
      'split_table_no_rows',
      at !== undefined
        ? `Splitting the table at ${JSON.stringify(
            tableAnchor
          )} at row ${at} would move no rows: there are no data rows at or below it.`
        : `No rows were named to extract from the table at ${JSON.stringify(
            tableAnchor
          )}.`,
      [where, `data rows: ${data.join(', ')}`]
    );

  const keep = data.filter((row) => !extract.includes(row));
  if (!keep.length)
    throw splitRefusal(
      'split_table_takes_every_row',
      `Extracting rows ${extract.join(
        ', '
      )} takes EVERY data row of the table at ${JSON.stringify(
        tableAnchor
      )}, so the original would be left holding nothing but its header. That is a move, not a split.`,
      [
        where,
        'Leave at least one data row behind, or move the whole thing: move_section relocates the section that contains this table, with its formatting, as one tracked change.'
      ]
    );

  // A vertical merge spanning the boundary cannot be split without tearing the
  // merged cell in half. Derived from the table's own spans, so a merge anywhere
  // in it is covered rather than only the shapes anybody thought to try.
  const torn = verticalSpans(tableBlock).find(({ row, span }) => {
    const covered: number[] = [];
    for (let index = row; index < Math.min(row + span, rowCount); index++)
      covered.push(index);
    const taken = covered.filter((index) => extract.includes(index)).length;
    return taken > 0 && taken < covered.length;
  });
  if (torn)
    throw splitRefusal(
      'split_table_merged_row_span',
      `A cell in the table at ${JSON.stringify(
        tableAnchor
      )} is vertically merged across rows ${torn.row}..${
        torn.row + torn.span - 1
      }, and this split would put some of those rows in each table - which would tear the merged cell in half.`,
      [
        where,
        `merged span: rows ${torn.row}..${torn.row + torn.span - 1}`,
        'Extract all of those rows together, or none of them.'
      ]
    );

  return { extract, keep, headerRows, rowCount };
}

/**
 * Each row of one table paired with its HIGHEST column index, read off the
 * flattened cells rather than counted - so a row that carries a grid offset or a
 * horizontal merge still reports the cell a spanning selection has to end in,
 * and a row the table does not have is simply absent instead of guessed at.
 */
function tableRowColumns(
  blocks: FlatBlock[],
  tableAnchor: string
): Map<number, number> {
  const columns = new Map<number, number>();
  for (const candidate of blocks) {
    if (tableAnchorForBlock(candidate) !== tableAnchor) continue;
    const parts = candidate.anchor.split(';');
    const row = Number(parts[2]);
    const column = Number(parts[3]);
    if (!Number.isInteger(row) || !Number.isInteger(column)) continue;
    columns.set(row, Math.max(columns.get(row) ?? 0, column));
  }
  return columns;
}

/**
 * A row set as its MAXIMAL CONTIGUOUS RUNS, ascending.
 *
 * A row set is one write per run, not one write per row: a selection spanning a
 * run covers every row in it, so the runs are exactly the coarsest safe
 * decomposition of any request. The captain's "delete the mock coverage 3 to 7"
 * is one run and therefore one write and one card; a scattered set (which
 * `split_table` already accepts, so the model will send one here too) costs one
 * write per run and no more.
 */
function contiguousRuns(
  rows: number[]
): Array<{ first: number; last: number }> {
  const runs: Array<{ first: number; last: number }> = [];
  for (const row of [...new Set(rows)].sort((a, b) => a - b)) {
    const open = runs[runs.length - 1];
    if (open && row === open.last + 1) open.last = row;
    else runs.push({ first: row, last: row });
  }
  return runs;
}

/**
 * Delete a CONTIGUOUS RUN of one table's rows, tracked, in ONE write.
 *
 * One `deleteRow` over a selection spanning the whole run, never one call per
 * row, because the two are not equivalent under track changes: SyncFusion folds
 * a spanning delete into a SINGLE revision - withdrawing whichever of those rows
 * were themselves unaccepted insertions and marking the rest deleted - which is
 * one card the reviewer resolves once, and rejecting it restores the pristine
 * rows. Row by row, the first withdrawal physically removes its row, every row
 * below it shifts, and the next call's anchor no longer identifies what it was
 * resolved against.
 *
 * Defaults to the single row, which is what every caller before the row set
 * wanted, so `delete_row` and `split_table` share one primitive rather than two
 * spellings of one selection.
 *
 * The selection runs from the run's first cell to its last row's last cell; the
 * caller supplies that column because it reads the table's shape already.
 */
function deleteTableRows(
  editor: LiveEditor,
  tableAnchor: string,
  firstRow: number,
  lastRow: number = firstRow,
  lastColumn = 0
): void {
  editor.selection.select(
    `${tableAnchor};${firstRow};0;0;0`,
    `${tableAnchor};${lastRow};${lastColumn};0;0`
  );
  callEditor(editor, 'deleteRow');
}

/**
 * The captured payload with only `keep`'s rows left in its table.
 *
 * Row indices survive this unchanged relative to the SOURCE, because the payload
 * is the WHOLE table - payload row i is source row i. That correspondence is the
 * reason a split copies the whole table and narrows the copy, rather than trying
 * to select the extracted rows in the first place: a non-contiguous selection
 * does not exist, and the header band is not adjacent to the rows being taken.
 *
 * Reads and writes no content: it keeps a subset of a row array, under the very
 * key it found the array on, so an optimized payload (`r`) and a long-key one
 * (`rows`) both come back in their own shape. Everything else in the payload -
 * styles, lists, the image table, the table's own format - is untouched and stays
 * opaque.
 */
function prunePayloadRows(payload: string, keep: number[]): string {
  const parsed = JSON.parse(payload);
  const sections = pick(parsed, 'sections', 'sec');
  if (!Array.isArray(sections)) return payload;
  let pruned = false;
  for (const section of sections)
    for (const block of getBlocks(section)) {
      const key = ['rows', 'r', 'rw'].find((candidate) =>
        Array.isArray(block?.[candidate])
      );
      if (!key) continue;
      const rows = block[key];
      block[key] = keep
        .map((index) => rows[index])
        .filter((row) => row !== undefined);
      pruned = true;
    }
  // A payload with no table in it means the capture did not return the table
  // this op resolved, and pasting it would put the wrong thing at the target.
  if (!pruned)
    throw new OpError(
      'split_table_payload_not_a_table',
      'SyncFusion returned no table for the range this split captured, so there is nothing to divide. Nothing was written.'
    );
  return JSON.stringify(parsed);
}

/** The cell blocks of a range that belong to one of `rows`. */
function rangeRowBlocks(range: BlockRange, rows: number[]): FlatBlock[] {
  const wanted = new Set(rows);
  return range.blocks.filter((block) => {
    const parts = block.anchor.split(';');
    return parts.length === 5 && wanted.has(Number(parts[2]));
  });
}

/**
 * The table the paste produced, found in the run the paste actually added.
 *
 * Measured, never guessed: the copy occupies exactly
 * `[paste.at, paste.at + paste.blocks)` of the whole-document sequence, and
 * which SIDE of the source it lands on depends on the target. Its row texts are
 * then checked against the source's, so deleting rows out of the wrong table is
 * impossible rather than unlikely - the same discipline `shiftedRange` applies
 * to the source.
 */
function assertPastedTableMatches(
  pastedSfdt: any,
  paste: PasteEffect,
  source: BlockRange,
  expectedBlocks: FlatBlock[]
): string {
  const sequence = topLevelSequence(pastedSfdt);
  const blocks = flattenSfdt(pastedSfdt);
  const expected = rangeIdentity(expectedBlocks);
  for (let index = paste.at; index < paste.at + paste.blocks; index++) {
    const address = sequence[index];
    if (!address) continue;
    const anchor = `${address.section};${address.block}`;
    if (!collectTableAppearance(tableBlockAt(pastedSfdt, anchor))) continue;
    const copy = resolveTableRange(blocks, anchor);
    if (rangeIdentity(copy.blocks) === expected) return anchor;
  }
  throw new OpError(
    'split_table_copy_lost',
    `The copy of the table at ${JSON.stringify(
      source.anchor
    )} is not readable at the position it was pasted into, so the engine refused to delete rows from whatever is there instead. Nothing of this change set was kept.`,
    [
      `paste of ${paste.blocks} block(s) at sequence index ${paste.at}`,
      `expected rows reading ${JSON.stringify(expected.slice(0, 200))}`
    ]
  );
}

// Exported for the registry parity spec: the spec re-asserts at runtime what
// the mapped types already guarantee at compile time, guarding the emitted JS
// against an `as any` regression at the table itself.
/**
 * A break inside a table cell is not a change the user can reject.
 *
 * Measured: at an ordinary paragraph SyncFusion authors two Insertion
 * revisions for a page break and rejecting them restores the document. At a
 * table row it authors NONE, so the break survives its own rejection and
 * leaves a stray empty element inside the table - the user rejects the card and
 * the document does not come back, which is the one promise tracked changes
 * make.
 *
 * This has to PREVENT rather than detect. Checking afterwards is what the row
 * withdrawal already taught: the structural assertion refused after the write
 * had landed, and the rollback rejects revisions, of which an untracked write
 * has none - so the engine reported "nothing was written" over a document it
 * had permanently changed. A refusal that lies is worse than the silent
 * success it replaced.
 */
function refuseBreakInsideTable(op: string, block: FlatBlock): void {
  if (block.kind !== 'table_cell') return;
  throw new OpError(
    'break_inside_table_not_rejectable',
    `${op} cannot be inserted inside a table cell: this engine cannot make it a tracked change there, so it could not be rejected and the table would keep an empty element the user never asked for. Nothing was written. Insert the break at a body paragraph before or after the table instead.`,
    [`anchor: ${block.anchor}`],
    'never'
  );
}

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
        // No `find`: this overwrites the WHOLE block, so every revision in it
        // is genuinely in range - block granularity, no range argument.
        assertNoForeignPendingRevisions(editor, block, op);
        selectBlock(editor, block);
        replaceSelectedText(editor, String(replacement));
        return {
          postWriteSfdt: verifyTextWrite(editor, {
            startAnchor: block.anchor,
            expected: String(replacement),
            exact: true
          })
        };
      }
      throw new OpError(
        'missing_find',
        'replace_text needs `find` and `replace`.'
      );
    }
    // Selecting a whole paragraph by visible length can stop before text that
    // follows a content control because the live caret space also counts the
    // control's boundary markers. The serialized projection remains exact, and
    // Search below resolves the actual live range including those markers.
    const idx = block.offsetsUntrusted
      ? block.text.indexOf(find)
      : liveText.indexOf(find);
    if (idx < 0)
      throw new OpError('text_not_found', `"${find}" not found at anchor.`, [
        `live text at ${block.anchor}: ${JSON.stringify(block.text)}`,
        "Copy `find` from the block's CURRENT text - re-read it with getDocumentInventory if this anchor has already been edited in this change set."
      ]);
    // Only the matched substring is overwritten, so only revisions touching it
    // matter. When offsets are untrusted the index came from a different
    // projection than the one revisionRangesOf walks, so the range would be
    // meaningless - fall back to the block-wide check rather than compare two
    // offset spaces that do not correspond.
    assertNoForeignPendingRevisions(
      editor,
      block,
      op,
      block.offsetsUntrusted
        ? undefined
        : { start: idx, end: idx + find.length }
    );
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
      writeOverSelection(editor, String(replacement ?? ''));
      return {
        postWriteSfdt: verifyTextWrite(editor, {
          startAnchor: block.anchor,
          expected: next,
          exact: true
        })
      };
    }
    writeOverSelection(editor, String(replacement ?? ''));
    return {
      postWriteSfdt: verifyTextWrite(editor, {
        startAnchor: block.anchor,
        expected: next,
        exact: true,
        // Only an EMPTY replacement is a deletion; a substitution writes text
        // and must be measured exactly, like an insert.
        removesText: String(replacement ?? '') === ''
      })
    };
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
      postWriteSfdt: verifyTextWrite(editor, {
        startAnchor: range.startAnchor,
        endAnchor: range.endAnchor,
        expected: String(replacement)
      })
    };
  },
  delete_text: ({ editor, op, block, liveText }) => {
    const find = String(op.find ?? '');
    if (!find) throw new OpError('missing_find', 'delete_text needs `find`.');
    const idx = liveText.indexOf(find);
    if (idx < 0)
      throw new OpError('text_not_found', `"${find}" not found at anchor.`, [
        `live text at ${block.anchor}: ${JSON.stringify(block.text)}`,
        "Copy `find` from the block's CURRENT text - re-read it with getDocumentInventory if this anchor has already been edited in this change set."
      ]);
    // Same narrowing as replace_text: only the matched substring is removed, so
    // only revisions touching it matter. selectRange below uses exactly these
    // offsets, so the guard and the write agree on what "the range" is.
    assertNoForeignPendingRevisions(
      editor,
      block,
      op,
      block.offsetsUntrusted
        ? undefined
        : { start: idx, end: idx + find.length }
    );
    const next = block.text.slice(0, idx) + block.text.slice(idx + find.length);
    selectRange(editor, block.anchor, idx, idx + find.length);
    editor.editor.delete();
    return {
      postWriteSfdt: verifyTextWrite(editor, {
        startAnchor: block.anchor,
        expected: next,
        exact: true,
        removesText: true
      })
    };
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
    // A paragraph only disappears when its MARK goes with it, and a mark sits
    // BETWEEN two paragraphs - so this path has to know where the document, and
    // its own section, ends.
    //
    // Both ends of the range must be in this section. Selecting from here to a
    // block in the NEXT section spans the section break, and deleting a section
    // break is not something SyncFusion authors a rejectable revision for: the
    // page setup would change with no card to reject, so a group rollback would
    // have nothing to put back.
    //
    // At the end of a section (the document's last paragraph included) there is
    // no following mark left to consume. Consume the PRECEDING one instead -
    // exactly the range a person removes a trailing empty paragraph with - so
    // the paragraph is really gone rather than emptied in place. When neither
    // neighbour is a body paragraph of this section there is no mark to take at
    // all, and nothing is written.
    const sectionOf = (anchor: string) => anchor.split(';')[0];
    const section = sectionOf(block.anchor);
    const blocks = Array.from(byAnchor.values());
    const index = blocks.findIndex(
      (candidate) => candidate.anchor === block.anchor
    );
    const bodyNeighbour = (offset: number): FlatBlock | undefined => {
      const candidate = index >= 0 ? blocks[index + offset] : undefined;
      if (!candidate || candidate.kind === 'table_cell') return undefined;
      return sectionOf(candidate.anchor) === section ? candidate : undefined;
    };
    const next = bodyNeighbour(1);
    const previous = bodyNeighbour(-1);
    if (next)
      editor.selection.select(
        `${block.anchor};0`,
        markInclusiveRangeEnd(next, block)
      );
    else if (previous && previous.offsetsUntrusted)
      // The preceding paragraph's live caret positions count content-control
      // boundary markers that its serialized length does not, so
      // `${previous.anchor};${previous.length}` is NOT the end of that
      // paragraph in the live document - it lands earlier, and the selection
      // runs from there to the end of the document. Deleting it wiped every
      // block on four of eight real shapes while reporting success. There is no
      // exact range to take here, so refuse, as every other op does when it
      // cannot address a bound range precisely.
      throw new OpError(
        'paragraph_mark_unaddressable',
        `The paragraph at "${block.anchor}" can only be removed by consuming the paragraph mark of "${previous.anchor}", and that block sits alongside a document binding whose live offsets this engine cannot address exactly. Deleting it could remove far more than the paragraph. Nothing was written.`,
        [
          `anchor: ${block.anchor}`,
          `preceding block: ${previous.anchor}`,
          'Clear the content with delete_text or replace_text if the paragraph should stay in place but read empty.'
        ]
      );
    else if (previous)
      editor.selection.select(
        `${previous.anchor};${previous.length}`,
        `${block.anchor};${block.length}`
      );
    else
      throw new OpError(
        'paragraph_mark_unavailable',
        `The paragraph at "${block.anchor}" has no paragraph mark that can be removed with it: it is the only body paragraph of its section, so the only mark beside it is the section break itself, and deleting that leaves no card to reject. Nothing was written.`,
        [
          `anchor: ${block.anchor}`,
          `paragraph text: ${JSON.stringify(block.text)}`,
          'Clear the content with delete_text or replace_text if the paragraph should stay in place but read empty.'
        ]
      );
    editor.editor.delete();
  },
  move_section: ({ editor, op, block, byAnchor }) => {
    const blocks = Array.from(byAnchor.values());
    // One read of the raw document for the whole op: the revision table and the
    // block sequence are both things flattening drops.
    const sfdt = serializeSfdt(editor);
    const source = resolveSectionRange(blocks, block.anchor, 'anchor');
    assertRangeWithinOneSection(source);
    assertRangeIsRemovable(blocks, source);
    assertRangeHasNoForeignEdits(sfdt, source);
    relocateBlockRange(
      editor,
      sfdt,
      source,
      resolveRelocationTarget(blocks, op, source)
    );
  },
  /**
   * A copy is not a move: the duplicate must not inherit the original's binding
   * identities. The copy is built from the document's own SFDT - cloned,
   * resolved to what the user sees, given identities of its own - and pasted
   * through the native tracked paste in wrapper-safe segments, then read back
   * and verified before the group is allowed to stand.
   */
  copy_section: ({ editor, op, block, byAnchor }) => {
    const blocks = Array.from(byAnchor.values());
    const sfdt = serializeSfdt(editor);
    const source = resolveSectionRange(blocks, block.anchor, 'anchor');
    // Neither source-side refusal applies to a duplication: nothing is deleted,
    // so there is no document-tail delete to crash `acceptAll` and no pending
    // edit of anyone else's that rejecting could take away. The target-side
    // refusals are the same ones a move gets, from the same resolver.
    const target = resolveRelocationTarget(blocks, op, source);
    const clone = clonedRangeBlocks(sfdt, source);
    const sourceIndex = scanReadableBindings(sfdt);
    if (sourceIndex) rewriteCloneIdentities(clone, sourceIndex);
    const segments = copyPasteSegments(clone, sfdt, target);
    const { paste, pastedSfdt } = pasteBlocksAsTrackedSegments(
      editor,
      sfdt,
      segments,
      target
    );
    assertPastedRangeMatches(pastedSfdt, paste, source, segments.flat());
  },
  swap_sections: ({ editor, op, block, byAnchor }) => {
    const blocks = Array.from(byAnchor.values());
    const sfdt = serializeSfdt(editor);
    const one = resolveSectionRange(blocks, block.anchor, 'anchor');
    const other = resolveSectionRange(
      blocks,
      String(op.otherAnchor ?? '').trim(),
      'otherAnchor'
    );
    const [earlier, later] = addressIsBefore(
      topLevelAddress(one.blocks[0].anchor),
      topLevelAddress(other.blocks[0].anchor)
    )
      ? [one, other]
      : [other, one];
    const earlierLast = topLevelAddress(
      earlier.blocks[earlier.blocks.length - 1].anchor
    );
    const laterFirst = topLevelAddress(later.blocks[0].anchor);
    if (!addressIsBefore(earlierLast, laterFirst))
      throw new OpError(
        'swap_sections_overlap',
        `Refusing to swap ${JSON.stringify(one.anchor)} with ${JSON.stringify(
          other.anchor
        )}: one of them is inside the other (or they are the same section), so there is nothing to exchange. Nothing was written.`,
        [
          `${earlier.anchor} covers ${earlier.blocks[0].anchor} .. ${
            earlier.blocks[earlier.blocks.length - 1].anchor
          }`,
          `${later.anchor} covers ${later.blocks[0].anchor} .. ${
            later.blocks[later.blocks.length - 1].anchor
          }`,
          'To move a subsection out of the section that contains it, use move_section with a targetAnchor outside that section.'
        ]
      );
    assertRangeIsRemovable(blocks, earlier);
    assertRangeIsRemovable(blocks, later);
    assertRangeHasNoForeignEdits(sfdt, earlier);
    assertRangeHasNoForeignEdits(sfdt, later);
    // Bottom-up, and the ordering is the whole reason a swap needs no
    // prediction. Both ranges and both payloads are resolved BEFORE any write.
    // The first relocation's paste lands at `later`'s start and its delete
    // marks `earlier` in place, so nothing above `later` moves: `earlier`'s
    // originally resolved anchors are still valid when its turn comes, and only
    // `later` has to be found again - which is arithmetic the paste itself
    // reports, checked against the document.
    //
    // One op, therefore one revision group, therefore one rail card: a failure
    // in the second relocation rolls the first back through rollbackGroup, so a
    // half-swap cannot survive.
    const laterIndex = sequenceIndexOf(topLevelSequence(sfdt), laterFirst);
    const first = relocateBlockRange(
      editor,
      sfdt,
      earlier,
      pasteAtRangeStart(later)
    );
    relocateBlockRange(
      editor,
      first.pastedSfdt,
      // `later` has to be found again, by the same measured arithmetic and with
      // the same not-the-copy assertion: the first relocation's paste landed at
      // its start and moved it down. `earlier`'s anchors need no such fix-up -
      // nothing above them was pasted, and its tracked delete shifted nothing.
      shiftedRange(first.pastedSfdt, later, first.paste, laterIndex),
      pasteAtRangeStart(earlier)
    );
  },
  split_table: ({ editor, op, block, byAnchor }) => {
    const blocks = Array.from(byAnchor.values());
    const tableAnchor = tableAnchorForBlock(block);
    if (!tableAnchor)
      throw new OpError(
        'split_table_requires_cell_anchor',
        `split_table splits the table an anchor sits in, and ${JSON.stringify(
          block.anchor
        )} is not a table cell. Nothing was written.`,
        [
          `anchor: ${block.anchor}`,
          'Use any cell anchor from the table ("section;block;row;cell;paragraph"), copied from a table_facts read.'
        ]
      );
    // One raw read for the whole op: the revision table, the block sequence and
    // the merge spans are all things flattening drops.
    const sfdt = serializeSfdt(editor);
    const tableBlock = tableBlockAt(sfdt, tableAnchor);
    assertTableHasNoBindings(sfdt, tableAnchor, 'split_table');
    const appearance = collectTableAppearance(tableBlock);
    if (!appearance)
      throw new OpError(
        'table_not_found',
        `No table answers to the anchor "${tableAnchor}". Re-read the structure and use a current anchor.`
      );
    const source = resolveTableRange(blocks, tableAnchor);
    // Header-ness through its ONE owner, reading what the page shows rather than
    // any single encoding of it - the refusal below depends on getting a
    // style-only header right, and this document has one.
    const headerRows = effectiveHeaderRows({
      blocks,
      sfdt,
      tableAnchor,
      source: appearance,
      rendered: renderedRowFormatReader(editor, byAnchor)
    });
    const plan = resolveSplitRows(
      op,
      tableAnchor,
      appearance,
      headerRows,
      tableBlock
    );
    // A split DELETES rows from the source, so both source-side refusals apply
    // exactly as they do to a move: rejecting this card would fold away a third
    // party's pending edit, and SyncFusion cannot accept a delete of the last
    // row of a document-tail table.
    assertRangeHasNoForeignEdits(sfdt, source);
    assertRowsAreRemovable(blocks, tableAnchor, plan.extract);
    const target = resolveRelocationTarget(blocks, op, source);
    const sourceIndex = sequenceIndexOf(
      topLevelSequence(sfdt),
      topLevelAddress(source.blocks[0].anchor)
    );
    // The new table is the header band plus the extracted rows, in the source's
    // own order - so "they should have same column names" is satisfied by the
    // header rows travelling with the copy, not by anything authoring them.
    const header: number[] = [];
    for (let row = 0; row < plan.headerRows; row++) header.push(row);
    const copied = [...header, ...plan.extract];
    const { paste, pastedSfdt } = relocateBlockRange(
      editor,
      sfdt,
      source,
      target,
      {
        removeSource: false,
        transformPayload: (payload) => prunePayloadRows(payload, copied)
      }
    );
    // Nothing is written to the copy, so its address is not needed - but it is
    // still read back and checked, because `ok: true` from a paste only means the
    // paste did not throw. If the new table is not there reading what it should,
    // this fails and the group rolls back.
    assertPastedTableMatches(
      pastedSfdt,
      paste,
      source,
      rangeRowBlocks(source, copied)
    );
    const moved = shiftedRange(
      pastedSfdt,
      source,
      paste,
      sourceIndex,
      resolveTableRange
    );
    // The copy needs no deletion at all - it arrived holding exactly its rows.
    // The source's extracted rows go DESCENDING; a tracked delete shifts nothing,
    // so the order is not load-bearing, but it keeps the invariant visible.
    for (const row of [...plan.extract].reverse())
      deleteTableRows(editor, moved.anchor, row);
  },
  duplicate_table: ({ editor, block, byAnchor }) => {
    const blocks = Array.from(byAnchor.values());
    const sfdt = serializeSfdt(editor);
    const tableAnchor = tableAnchorForBlock(block);
    if (!tableAnchor)
      throw new OpError(
        'duplicate_table_requires_table_anchor',
        'duplicate_table needs an anchor inside the table, or the table anchor from a structure read.'
      );
    assertDuplicateSourceHasNoForeignEdits(sfdt, tableAnchor);
    assertTableIsDuplicable(blocks, tableAnchor);
    const source = resolveTableRange(blocks, tableAnchor);
    const container = tableContainerAt(sfdt, tableAnchor);
    if (!container)
      throw new OpError(
        'table_not_found',
        `No table answers to "${tableAnchor}". Nothing was written.`
      );
    const sourceAddress = topLevelAddress(source.blocks[0].anchor);
    // The paste point is the first caret after the table: the next body
    // paragraph's start. Unlike a model-supplied relocation target, it is
    // derived from the already-resolved source and cannot land inside its
    // cells. The block preceding it is the source table itself, so the
    // segment builder's adjacency rule supplies the separator paragraph that
    // keeps Word from rendering source and copy as one table.
    const target: PasteTarget = {
      anchor: source.endAnchor,
      address: { ...sourceAddress, block: sourceAddress.block + 1 }
    };
    const clone = clonedWithoutRevisions(
      sfdt,
      containerCarryingOnlyTable(
        container.block,
        tableBlockAt(sfdt, tableAnchor)
      )
    );
    const { paste, pastedSfdt } = pasteBlocksAsTrackedSegments(
      editor,
      sfdt,
      copyPasteSegments([clone], sfdt, target),
      target
    );
    const anchor = assertPastedTableMatches(
      pastedSfdt,
      paste,
      source,
      source.blocks
    );
    return {
      anchor,
      postWriteSfdt: pastedSfdt
    };
  },
  insert_text: ({ editor, op, block }) => {
    const offset = insertionPoint(op, block);
    const inserted = insertionText(op);
    const next =
      block.text.slice(0, offset) + inserted + block.text.slice(offset);
    selectInsertionPoint(editor, op, block);
    editor.editor.insertText(inserted);
    return {
      postWriteSfdt: verifyTextWrite(editor, {
        startAnchor: block.anchor,
        expected: next,
        exact: true
        // No removesText: insert_text only ADDS. Measured in a real browser,
        // inserts preserve leading, trailing, internal and doubled spaces
        // exactly, so this path must be verified exactly - tolerating spacing
        // here would let an insert that silently lost a space pass.
      })
    };
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
    assertNoForeignPendingRevisions(editor, block, op);
    // Overwrite the (cell) block's content.
    selectBlock(editor, block);
    const replacement = String(op.text ?? '');
    replaceSelectedText(editor, replacement);
    return {
      postWriteSfdt: verifyTextWrite(editor, {
        startAnchor: block.anchor,
        expected: replacement,
        exact: true
      })
    };
  },
  set_cell_formula: ({ editor, op, block, byAnchor }) =>
    runFormulaCellWrite(editor, op, block, byAnchor),
  set_column_formula: ({ editor, op, block, byAnchor }) =>
    runColumnFormulaWrite(editor, op, block, byAnchor),
  change_case: ({ editor, op, block, liveText }) => {
    assertNoForeignPendingRevisions(editor, block, op);
    const replacement = changeCase(liveText, String(op.caseType ?? ''));
    selectBlock(editor, block);
    editor.editor.insertText(replacement);
    return {
      postWriteSfdt: verifyTextWrite(editor, {
        startAnchor: block.anchor,
        expected: replacement,
        exact: true
      })
    };
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
  // insertHyperlink REPLACES the current selection. Selecting the whole
  // paragraph first therefore deleted the paragraph's text and reported
  // success, and rejecting our revisions did not bring it back: verified in a
  // real browser, where "Acme Insurance Proposal" became the link. Adding a
  // link is an ADDITION, so it takes a caret, positioned by the same
  // position/offset convention every other additive op uses.
  insert_hyperlink: ({ editor, op, block }) => {
    selectInsertionPoint(editor, op, block);
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
    refuseBreakInsideTable('insert_page_break', block);
    selectRange(editor, block.anchor, 0, 0);
    callEditor(editor, 'insertPageBreak');
  },
  insert_column_break: ({ editor, block }) => {
    refuseBreakInsideTable('insert_column_break', block);
    selectRange(editor, block.anchor, 0, 0);
    callEditor(editor, 'insertColumnBreak');
  },
  // Same defect as insert_hyperlink, found by asking which OTHER additive ops
  // pair a whole-paragraph selection with a consuming SDK call: insertPageNumber
  // consumes too, verified in the same browser probe.
  insert_page_number: ({ editor, op, block }) => {
    selectInsertionPoint(editor, op, block);
    callEditor(editor, 'insertPageNumber', op.numberFormat);
  },
  // Table structure. These once fell to a generic snake_case->camelCase
  // dispatch that called the SyncFusion method with no arguments at all, so
  // `above`, `count`, `rows` and `columns` were advertised in the tool schema
  // and silently dropped: every insert_row was one row below, every
  // insert_table was 1x1. Every op maps its arguments explicitly now.
  insert_row: ({ editor, op, block }) => {
    selectBlock(editor, block);
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
    const tableAnchor = resultingInsertedTableAnchor(op);
    let selectedInsertion = false;
    if (position === 'after') {
      const parts = block.anchor.split(';');
      const blockIndex = Number(parts[1]);
      const nextAnchor =
        parts.length >= 2 && Number.isInteger(blockIndex)
          ? `${parts[0]};${blockIndex + 1}`
          : '';
      const next = nextAnchor ? byAnchor.get(nextAnchor) : undefined;
      if (next) {
        selectRange(editor, next.anchor, 0, 0);
        selectedInsertion = true;
      } else {
        // Syncfusion inserts a table AT the selected paragraph, not after it.
        // At the document tail first split the resolved paragraph to create the
        // address the op promises, then replace that new paragraph with the
        // table. Both writes are tracked in the same operation.
        selectRange(editor, block.anchor, block.length, block.length);
        callEditor(editor, 'insertText', '\n');
        selectRange(editor, tableAnchor, 0, 0);
        selectedInsertion = true;
      }
    }
    if (!selectedInsertion) selectRange(editor, block.anchor, 0, 0);
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
            `${tableAnchor};${rowIndex};${columnIndex};0`,
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
  delete_table: ({ editor, block, byAnchor }) => {
    // The whole-table shape of the deletion SyncFusion cannot accept. Guarded
    // only when the anchor really is a cell, exactly as delete_row below: a
    // non-cell anchor is a different failure the structural tracked-op check
    // already owns.
    const tableAnchor = tableAnchorForBlock(block);
    if (tableAnchor)
      assertTableIsRemovable(Array.from(byAnchor.values()), tableAnchor);
    callEditor(editor, 'deleteTable');
  },
  // Deletes a ROW SET, in as few writes as the set allows - `rows` is the shape
  // "remove mock coverage 3 to 7" needs. One op per row cannot express it: a
  // withdrawal physically removes its row (see assertTrackedMutation), so every
  // row below shifts, and the next op's anchor has to be re-resolved by text -
  // which empty, freshly-inserted rows cannot be distinguished by, so the second
  // op refused with `anchor_relocation_ambiguous` and four of the captain's five
  // rows stayed behind. Here the whole run goes down in one `deleteRow`, which is
  // also what makes it ONE card.
  delete_row: ({ editor, op, block, byAnchor }) => {
    const tableAnchor = tableAnchorForBlock(block);
    const blocks = Array.from(byAnchor.values());
    // Guarded only when the anchor really is a cell: a non-cell anchor is a
    // different failure and the structural tracked-op check already owns it. A
    // row set has no meaning without the table to read it against, so that one
    // says so rather than deleting the anchored row and calling it done.
    if (!tableAnchor) {
      if (op.rows?.length)
        throw new OpError(
          'not_a_cell_anchor',
          `delete_row was given a \`rows\` set, but its anchor ${JSON.stringify(
            block.anchor
          )} is not a table cell, so there is no table to read those row numbers against. Nothing was written. Copy a cell anchor for the table from a table_facts read.`,
          [`rows: ${op.rows.join(', ')}`]
        );
      callEditor(editor, 'deleteRow');
      return;
    }
    const columns = tableRowColumns(blocks, tableAnchor);
    const requested = op.rows?.length
      ? [...new Set(op.rows)]
      : [Number(block.anchor.split(';')[2])];
    const missing = requested.filter((row) => !columns.has(row));
    if (missing.length)
      throw new OpError(
        'row_not_found',
        `The table at ${JSON.stringify(tableAnchor)} has no row ${missing.join(
          ', '
        )}, so nothing was written. Read the table with table_facts and send the row indices it reports (\`TableRowFact.row\`) rather than counted ones.`,
        [
          `rows asked for: ${requested.join(', ')}`,
          `rows this table has: 0..${Math.max(...columns.keys())}`
        ]
      );
    // The whole set, so the tail-table refusal sees every row this op would
    // remove rather than only the anchored one - it was written for a row set
    // and was simply being handed one row at a time.
    assertRowsAreRemovable(blocks, tableAnchor, requested);
    // DESCENDING, so that a run whose rows are withdrawn - physically removed,
    // unlike a tracked delete, which leaves them in place - cannot shift the rows
    // a later run still has to address: every run left to do sits above it.
    for (const run of contiguousRuns(requested).reverse())
      deleteTableRows(
        editor,
        tableAnchor,
        run.first,
        run.last,
        columns.get(run.last) ?? 0
      );
    // How many of those rows were WITHDRAWN rather than marked deleted, read as
    // the observable it is: a tracked deletion leaves its row in the document
    // until someone accepts it, a withdrawal takes it out now, so the rows that
    // are physically gone are exactly the withdrawn ones. The executor reuses
    // this snapshot for its own assertions, so measuring costs no extra
    // serialize.
    const postWriteSfdt = serializeSfdt(editor);
    const withdrew =
      columns.size -
      tableRowColumns(flattenSfdt(postWriteSfdt), tableAnchor).size;
    return {
      postWriteSfdt,
      ...(withdrew > 0 ? { withdrewPendingInsertion: withdrew } : {})
    };
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
  // This one made no selection call at all, so it wrote over whatever the
  // dispatcher happened to leave selected - the whole block. The probe says
  // insertSectionBreak does not consume its selection today, so no text was
  // lost, but that is the SDK's behaviour rather than this op's intent. Its
  // siblings insert_page_break and insert_column_break both collapse
  // explicitly; the asymmetry was the tell.
  insert_section_break: ({ editor, op, block }) => {
    refuseBreakInsideTable('insert_section_break', block);
    selectRange(editor, block.anchor, 0, 0);
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
    const currentStyleName = comparableFormatValue(
      editor.selection?.paragraphFormat?.styleName
    );
    // Applying the already-resolved Normal style is not a no-op in Syncfusion:
    // it writes an explicit styleName onto the paragraph mark. On a split that
    // excludes the source mark, that residue survives rejection. Follow the
    // same write-only-on-difference rule as the direct properties below.
    if (currentStyleName !== styleName)
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

function tableWidgetAt(editor: LiveEditor, tableAnchor: string): any {
  const table = liveTableWidgetAt(editor, tableAnchor);
  if (!table)
    throw new OpError(
      'table_not_found',
      `No table answers to the anchor "${tableAnchor}".`
    );
  return table;
}

// SyncFusion spells "unset" differently per code path (a docx import reads
// back null where a fresh insert reads back undefined), so the shared facts
// reader collapses them, keeping desired-vs-after equality about real values.
function tablePropertyFacts(format: any): TablePropertyFacts {
  return {
    cellSpacing: Number(format.cellSpacing) || 0,
    leftMargin: format.leftMargin ?? null,
    rightMargin: format.rightMargin ?? null,
    topMargin: format.topMargin ?? null,
    bottomMargin: format.bottomMargin ?? null,
    bidi: !!format.bidi,
    styleName: format.styleName ?? undefined,
    title: format.title ?? undefined,
    description: format.description ?? undefined,
    horizontalPositionAbs: format.horizontalPositionAbs ?? undefined,
    horizontalPosition: format.horizontalPosition ?? undefined
  };
}

function rowPropertyFacts(format: any): RowPropertyFacts {
  const gridBefore = Number(format.gridBefore) || 0;
  const gridAfter = Number(format.gridAfter) || 0;
  return {
    allowBreakAcrossPages: format.allowBreakAcrossPages !== false,
    height: Number(format.height) || 0,
    heightType: String(format.heightType ?? 'AtLeast'),
    gridBefore,
    // A zero grid offset has no width: Word only stores wBefore/wAfter beside
    // a positive gridBefore/gridAfter, and SyncFusion normalizes the inert
    // type differently per code path ('Point' after import, 'Auto' after a
    // fresh insert). Read the inert fields as their one canonical value.
    gridBeforeWidth: gridBefore ? Number(format.gridBeforeWidth) || 0 : 0,
    gridBeforeWidthType: gridBefore
      ? format.gridBeforeWidthType ?? 'Auto'
      : 'Auto',
    gridAfter,
    gridAfterWidth: gridAfter ? Number(format.gridAfterWidth) || 0 : 0,
    gridAfterWidthType: gridAfter
      ? format.gridAfterWidthType ?? 'Auto'
      : 'Auto',
    leftMargin: format.leftMargin ?? null,
    rightMargin: format.rightMargin ?? null,
    topMargin: format.topMargin ?? null,
    bottomMargin: format.bottomMargin ?? null,
    leftIndent: Number(format.leftIndent) || 0
  };
}

function cellPropertyFacts(format: any): CellPropertyFacts {
  return {
    leftMargin: format.leftMargin ?? null,
    rightMargin: format.rightMargin ?? null,
    topMargin: format.topMargin ?? null,
    bottomMargin: format.bottomMargin ?? null
  };
}

function liveTablePropertyRestore(
  editor: LiveEditor,
  tableAnchor: string
): TablePropertyRestore {
  const table = tableWidgetAt(editor, tableAnchor);
  return {
    table: tablePropertyFacts(table.tableFormat),
    rows: (table.childWidgets ?? []).map((row: any) => ({
      row: rowPropertyFacts(row.rowFormat),
      cells: (row.childWidgets ?? []).map((cell: any) =>
        cellPropertyFacts(cell.cellFormat)
      )
    }))
  };
}

function tablePropertiesForTarget(
  source: TablePropertyRestore,
  sourceAppearance: TableAppearance,
  headerRows: number,
  target: TablePropertyRestore
): TablePropertyRestore {
  return {
    table: source.table,
    rows: target.rows.map((targetRow, rowIndex) => {
      const sourceRow =
        source.rows[sourceRowForTarget(sourceAppearance, headerRows, rowIndex)];
      return sourceRow
        ? {
            row: sourceRow.row,
            cells: targetRow.cells.map(
              (_, column) =>
                sourceRow.cells[Math.min(column, sourceRow.cells.length - 1)]
            )
          }
        : targetRow;
    })
  };
}

function tablePropertiesEqual(
  left: TablePropertyRestore,
  right: TablePropertyRestore
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function resolveLiveSourceTableAnchor(
  editor: LiveEditor,
  intendedAnchor: string,
  targetAnchor: string,
  source: TableAppearance
): string {
  try {
    tableWidgetAt(editor, intendedAnchor);
    return intendedAnchor;
  } catch {
    // A structural insert before a following sibling shifts the live anchor;
    // its preflight appearance remains the stable identity for the search.
  }
  const sfdt = serializeSfdt(editor);
  const sections: any[] = pick(sfdt, 'sections', 'sec') ?? [];
  for (let section = 0; section < sections.length; section++) {
    const blocks = getBlocks(sections[section]);
    for (let block = 0; block < blocks.length; block++) {
      const anchor = `${section};${block}`;
      if (anchor === targetAnchor) continue;
      // A BOUND table is wrapped in a block-level content control, so its rows
      // sit one level down and a raw `getRows` probe skips it entirely - the
      // sibling being searched for is then invisible and the search fails on
      // exactly the documents that have one. Resolve through the wrapper, the
      // same way `tableBlockAt` does.
      const candidate = blocks[block];
      const tableBlock = getRows(candidate)
        ? candidate
        : getBlocks(candidate).find((inner: any) => getRows(inner));
      if (!tableBlock) continue;
      const appearance = collectTableAppearance(tableBlock);
      if (appearance && JSON.stringify(appearance) === JSON.stringify(source))
        return anchor;
    }
  }
  throw new OpError(
    'table_not_found',
    `No table answers to the anchor "${intendedAnchor}".`
  );
}

/**
 * SyncFusion coalesces cell-edge writes when tables use cell spacing. Copy the
 * sibling's stored border objects after the public writes so separated tables
 * retain the same defined flags and therefore paint exactly like the source.
 */
function copySeparatedTableBorders(
  editor: LiveEditor,
  sourceAnchor: string,
  targetAnchor: string,
  sourceAppearance: TableAppearance,
  headerRows: number
): void {
  const source = tableWidgetAt(editor, sourceAnchor);
  const target = tableWidgetAt(editor, targetAnchor);
  target.tableFormat.borders.copyFormat(source.tableFormat.borders);
  const sourceRows: any[] = source.childWidgets ?? [];
  (target.childWidgets ?? []).forEach((targetRow: any, rowIndex: number) => {
    const sourceRow =
      sourceRows[sourceRowForTarget(sourceAppearance, headerRows, rowIndex)];
    const sourceCells: any[] = sourceRow?.childWidgets ?? [];
    (targetRow.childWidgets ?? []).forEach(
      (targetCell: any, column: number) => {
        const sourceCell =
          sourceCells[Math.min(column, sourceCells.length - 1)];
        if (sourceCell)
          targetCell.cellFormat.borders.copyFormat(
            sourceCell.cellFormat.borders
          );
      }
    );
  });
}

/**
 * The layout a table currently RENDERS with, widget values and all - the
 * DESIRED-value reader, for "make the target look like this source". It samples
 * rendered `cellWidth` when no preferred width was stated, which is what makes
 * an inherited grid match a sibling that Word laid out.
 *
 * Never use it for a restore. A restore must put back what the SFDT stated
 * (`collectTableAppearance(...).layout`, defaulting to `UNSTATED_TABLE_LAYOUT`);
 * replaying a widget reading writes concrete values the document never carried,
 * so rejecting the write would ADD untracked damage instead of removing it.
 */
function liveTableLayout(
  editor: LiveEditor,
  tableAnchor: string
): TableLayoutFacts {
  const table = tableWidgetAt(editor, tableAnchor);
  const format = table.tableFormat;
  const rows: any[] = table.childWidgets ?? [];
  const cells: any[] = [...rows].sort(
    (left, right) =>
      (right.childWidgets?.length ?? 0) - (left.childWidgets?.length ?? 0)
  )[0]?.childWidgets;
  let columnWidths: number[] | undefined;
  let columnWidthType: TableLayoutFacts['columnWidthType'];
  if (cells?.length) {
    const preferred = cells.map((cell) =>
      Number(cell.cellFormat?.preferredWidth)
    );
    const types = cells.map((cell) => cell.cellFormat?.preferredWidthType);
    if (
      preferred.every((width) => Number.isFinite(width) && width > 0) &&
      types.every((type) => type === types[0])
    ) {
      columnWidths = preferred;
      columnWidthType = types[0];
    } else {
      const rendered = cells.map((cell) => Number(cell.cellFormat?.cellWidth));
      if (rendered.every((width) => Number.isFinite(width) && width > 0)) {
        columnWidths = rendered;
        columnWidthType = 'Point';
      }
    }
  }
  return {
    preferredWidth: Number(format.preferredWidth) || 0,
    preferredWidthType: format.preferredWidthType ?? 'Auto',
    leftIndent: Number(format.leftIndent) || 0,
    tableAlignment: format.tableAlignment ?? 'Left',
    allowAutoFit: format.allowAutoFit ?? true,
    ...(columnWidths && columnWidthType
      ? { columnWidths, columnWidthType }
      : {})
  };
}

/** Capture all six table/row border members as replayable public writes. */
function borderRestoreFor(borders: any): BorderWrite[] {
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

/** Capture all six table border members before a table-level normalization. */
function liveTableBorderRestore(
  editor: LiveEditor,
  tableAnchor: string
): BorderWrite[] {
  return borderRestoreFor(
    tableWidgetAt(editor, tableAnchor).tableFormat.borders
  );
}

function liveRowBorderRestores(
  editor: LiveEditor,
  tableAnchor: string
): BorderWrite[][] {
  return (tableWidgetAt(editor, tableAnchor).childWidgets ?? []).map(
    (row: any) => borderRestoreFor(row.rowFormat.borders)
  );
}

function copyMappedRowBorders(
  editor: LiveEditor,
  sourceAnchor: string,
  targetAnchor: string,
  sourceAppearance: TableAppearance,
  headerRows: number
): void {
  const sourceRows: any[] =
    tableWidgetAt(editor, sourceAnchor).childWidgets ?? [];
  const targetRows: any[] =
    tableWidgetAt(editor, targetAnchor).childWidgets ?? [];
  targetRows.forEach((targetRow, rowIndex) => {
    const sourceRow =
      sourceRows[sourceRowForTarget(sourceAppearance, headerRows, rowIndex)];
    if (sourceRow)
      targetRow.rowFormat.borders.copyFormat(sourceRow.rowFormat.borders);
  });
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

/**
 * Undo this change set's own appearance writes mid-apply, newest first.
 *
 * Rollback only, never a card's inverse: it runs inside the failing write, so
 * the anchors it names are still exactly what they were, and a failure has to
 * surface as an OpError rather than be swallowed. Resolving a card is the other
 * situation entirely - the content has moved by then - and that inverse has one
 * owner, `groupRevisionsAtomic`.
 */
function rollbackAppearanceWrites(
  editor: LiveEditor,
  restores: AppearanceRestore[]
): void {
  for (let index = restores.length - 1; index >= 0; index--) {
    const restore = restores[index];
    if (restore.tableProperties)
      writeTableProperties(
        editor,
        restore.cellAnchor.split(';').slice(0, 2).join(';'),
        restore.tableProperties
      );
    if (restore.tableLayout)
      writeTableLayout(
        editor,
        restore.cellAnchor.split(';').slice(0, 2).join(';'),
        restore.tableLayout
      );
    if (restore.tableBorders)
      writeTableBorders(
        editor,
        restore.cellAnchor.split(';').slice(0, 2).join(';'),
        restore.tableBorders
      );
    if (restore.rowBorders)
      writeAppearance(
        editor,
        restore.cellAnchor,
        { borders: restore.rowBorders },
        'row'
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
      rollbackAppearanceWrites(editor, restores);
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

/**
 * Enforce the header flag each inserted row resolved to. SyncFusion clones the
 * anchored row's `rowFormat.isHeader`, so without this an insert anchored on
 * the header hands back a second header row: it repeats on every page and Word
 * renders it with the table style's first-row treatment, which is how a new
 * team member arrived navy and bold instead of as a data row.
 */
function applyPlannedRowHeaders(
  editor: LiveEditor,
  tableAnchor: string,
  current: TableAppearance,
  planned: Array<{ row: number; isHeader: boolean }>
): AppearanceWriteOutcome {
  const report = emptyAppearanceReport();
  const transaction = runAppearanceTransaction(editor, (record) => {
    for (const { row, isHeader } of planned) {
      const target = current.rows[row];
      if (!target?.cells.length || !!target.isHeader === isHeader) continue;
      const cellAnchor = cellAnchorOf(tableAnchor, row, 0);
      record({ cellAnchor, rowIsHeader: !!target.isHeader });
      writeRowIsHeader(editor, cellAnchor, isHeader);
      report.rowsWritten++;
    }
  });
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
  const liveSourceAnchor = resolveLiveSourceTableAnchor(
    editor,
    sourceAnchor,
    targetAnchor,
    source
  );
  const sourceProperties = liveTablePropertyRestore(editor, liveSourceAnchor);
  const targetProperties = liveTablePropertyRestore(editor, targetAnchor);
  const desiredProperties = tablePropertiesForTarget(
    sourceProperties,
    source,
    headerRows,
    targetProperties
  );
  const copyProperties = !tablePropertiesEqual(
    desiredProperties,
    targetProperties
  );
  const sourceRowBorders = liveRowBorderRestores(editor, liveSourceAnchor);
  const rowBordersBefore = liveRowBorderRestores(editor, targetAnchor);
  const desiredRowBorders = target.rows.map(
    (_, rowIndex) =>
      sourceRowBorders[sourceRowForTarget(source, headerRows, rowIndex)] ?? [
        { type: 'NoBorder', style: 'None' }
      ]
  );
  const copyRowBorders =
    JSON.stringify(desiredRowBorders) !== JSON.stringify(rowBordersBefore);
  const targetColumns = target.rows.reduce(
    (widest, row) => Math.max(widest, row.cells.length),
    0
  );
  const desiredLayout = tableLayoutForTarget(
    liveTableLayout(editor, liveSourceAnchor),
    targetColumns
  );
  const copyLayout =
    !!desiredLayout && !tableLayoutEquals(desiredLayout, target.layout);
  // The restore is what the SFDT STATED, not what SyncFusion materialized. The
  // live widget always answers with a concrete `allowAutoFit` and, once laid
  // out, with rendered `cellWidth` values that the document never stated - so
  // replaying a widget reading as the restore wrote `allowAutoFit: false` and a
  // point-width grid INTO a table that had neither, which is untracked damage a
  // reject is supposed to remove rather than add. `target` is the pre-write SFDT
  // reading this path already compares against; `UNSTATED_TABLE_LAYOUT` is what
  // the same reader means by "the document stated no layout".
  const layoutBefore = copyLayout
    ? target.layout ?? UNSTATED_TABLE_LAYOUT
    : undefined;
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
  const separatedBorders = sourceProperties.table.cellSpacing > 0;
  const uniformAllBorder =
    !separatedBorders &&
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
  const tableBordersBefore =
    uniformAllBorder || separatedBorders
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
    if (copyProperties) {
      record({
        cellAnchor: cellAnchorOf(targetAnchor, 0, 0),
        tableProperties: targetProperties
      });
      writeTableProperties(editor, targetAnchor, desiredProperties);
    }
    target.rows.forEach((targetRow, row) => {
      // The same mapping copiedCellAppearance uses, so the header flag and the
      // cell appearance can never be taken from two different source rows.
      let rowTouched = false;
      const wantsHeader = copiedRowIsHeader(
        source,
        sourceRowForTarget(source, headerRows, row)
      );
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
    if (copyLayout && desiredLayout && layoutBefore) {
      record({
        cellAnchor: cellAnchorOf(targetAnchor, 0, 0),
        tableLayout: layoutBefore
      });
      writeTableLayout(editor, targetAnchor, desiredLayout);
    }
    if (copyRowBorders) {
      rowBordersBefore.forEach((rowBorders, rowIndex) =>
        record({
          cellAnchor: cellAnchorOf(targetAnchor, rowIndex, 0),
          rowBorders
        })
      );
      copyMappedRowBorders(
        editor,
        liveSourceAnchor,
        targetAnchor,
        source,
        headerRows
      );
    }
    if (separatedBorders) {
      record({
        cellAnchor: cellAnchorOf(targetAnchor, 0, 0),
        tableBorders: tableBordersBefore
      });
      copySeparatedTableBorders(
        editor,
        liveSourceAnchor,
        targetAnchor,
        source,
        headerRows
      );
    }
    if (copyProperties || copyLayout || copyRowBorders || separatedBorders)
      invalidateDocumentLayout(editor);
    const afterProperties = liveTablePropertyRestore(editor, targetAnchor);
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
    if (!tablePropertiesEqual(desiredProperties, afterProperties))
      mismatches.push(
        `table properties: expected ${JSON.stringify(
          desiredProperties
        )}, got ${JSON.stringify(afterProperties)}`
      );
    const afterRowBorders = liveRowBorderRestores(editor, targetAnchor);
    if (JSON.stringify(desiredRowBorders) !== JSON.stringify(afterRowBorders))
      mismatches.push(
        `row borders: expected ${JSON.stringify(
          desiredRowBorders
        )}, got ${JSON.stringify(afterRowBorders)}`
      );
    if (desiredLayout && !tableLayoutEquals(desiredLayout, after.layout))
      mismatches.push(
        `table layout: expected ${JSON.stringify(
          desiredLayout
        )}, got ${JSON.stringify(after.layout)}`
      );
    // Both sides of the comparison are read as a GRID, so a shared interior
    // edge is judged by whether it is drawn rather than by which of the two
    // cells happens to store it. See effectiveCellAppearance.
    const wanted = after.rows.map((row, rowIndex) =>
      row.cells.map((_unused, column) =>
        copiedCellAppearance(source, banding, headerRows, rowIndex, column, {
          rows: after.rows.length,
          columns: row.cells.length
        })
      )
    );
    const wantedAt = (row: number, column: number) => wanted[row]?.[column];
    // A single-cell table has no interior edges, so its whole border box is
    // outer and SyncFusion keeps it at TABLE level with nothing on the cell.
    // Reading such a target cell-first reports no borders at all and rejects a
    // write that in fact landed correctly, so resolve it the same way a uniform
    // border set is resolved.
    const singleCellTarget =
      after.rows.length === 1 && after.rows[0]?.cells.length === 1;
    const actualAt = (row: number, column: number) =>
      uniformAllBorder || singleCellTarget
        ? resolvedCellAppearanceAt(after, row, column)
        : cellAppearanceAt(after, row, column);
    after.rows.forEach((row, rowIndex) => {
      const mapped =
        source.rows[sourceRowForTarget(source, headerRows, rowIndex)];
      if (!!row.isHeader !== !!mapped?.isHeader)
        mismatches.push(
          `row ${rowIndex} header: expected ${!!mapped?.isHeader}, got ${!!row.isHeader}`
        );
      for (let column = 0; column < row.cells.length; column++) {
        const expected = effectiveCellAppearance(wantedAt, rowIndex, column);
        const actual = effectiveCellAppearance(actualAt, rowIndex, column);
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

function revisionCollectionIsObservable(editor: LiveEditor): boolean {
  const collection = editor.revisions;
  return !!(
    Array.isArray(collection?.changes) ||
    (typeof collection?.length === 'number' &&
      typeof collection?.get === 'function')
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
  // A relocation is content moving, so it carries the same requirement as any
  // other content write - and for these two the reject-projection comparison
  // that membership buys IS the property they exist to have: rejecting the card
  // must restore the document exactly, which is what makes a move reviewable
  // rather than merely applied.
  'move_section',
  'swap_sections',
  'copy_section',
  // `split_table` moves content the same way - paste a copy, delete the
  // extracted rows from the source - so it carries the same
  // requirement and was simply missed. Being in neither tracked set meant
  // `assertTrackedMutation` returned on its first branch and the op was never
  // checked at all. The docstring beside `resolveRelocationTarget` that tells
  // the next reader not to add `copy_section` is about CONTENT_CREATING_OPS,
  // the appearance-resolver set, which is a different question: `copy_section`
  // is outside that set and inside this one, and is the precedent FOR this
  // line rather than against it.
  'split_table',
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

// A structural edit is content just as much as text is, so it carries the same
// requirement: SyncFusion must author a rejectable card of the right kind.
// `delete_paragraph` belongs here for both reasons a structural op can fail
// silently - a selection that mutates something SyncFusion does not track, and a
// delete that had nothing left to consume and changed nothing at all. Either way
// this reports the op failed rather than `ok: true` over an untouched document.
export const TRACKED_STRUCTURAL_OPS = new Map([
  ['insert_row', 'insertion'],
  ['delete_row', 'deletion'],
  ['delete_table', 'deletion'],
  ['delete_paragraph', 'deletion']
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
  targetText?: string,
  priorAcceptStream?: string
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
    if (revisions.length && types.has(structural)) return;
    // A WITHDRAWAL is a tracked outcome too, and this branch used to call it an
    // untracked write. SyncFusion does not mark content that is ITSELF an
    // unaccepted insertion as deleted - it removes it, because it was never in
    // the document a reviewer had agreed to and there is nothing for a reject to
    // put back. So no Deletion revision exists to find, and demanding one
    // refused a delete_row over a row the assistant had just inserted - AFTER
    // the row was already gone, with a rollback that rejects revisions and
    // therefore had nothing to restore. The captain's decision: "we want to be
    // able to delete the trackd changes and its fine if its gone from the
    // tracked changes."
    //
    // Proven, not assumed, by the same two projections the text ops already use
    // (this branch was simply the last user of the revision-type proxy, which
    // the comment above records being replaced once already for set_cell_text):
    // rejecting every revision still yields the pre-write document, which IS
    // reversibility, and accepting them yields a different one, which is "the
    // write did something". Together they are what a tracked, reviewable write
    // means, and they are what separates a withdrawal from a write that did
    // nothing at all.
    //
    // Inherent to these semantics, and deliberate rather than a defect: once a
    // pending insertion is withdrawn NO LATER REJECT CAN RESTORE IT, because no
    // revision is left to reject. That is why the row count travels back on the
    // result as `withdrewPendingInsertion` - so the model tells the user those
    // rows are simply gone with nothing left to review, instead of describing
    // them as tracked deletions it could offer to undo.
    const rejectsToPriorDocument =
      priorRejectStream !== undefined &&
      rejectProjectionStream(postWriteSfdt) === priorRejectStream;
    if (rejectsToPriorDocument && priorAcceptStream !== undefined) {
      if (acceptProjectionStream(postWriteSfdt) !== priorAcceptStream) return;
      // Both projections unchanged: the write really did nothing. That is the
      // only thing this refusal means now, so it says that rather than blaming
      // SyncFusion for a rule we chose, and it names the read that fixes it.
      throw new OpError(
        'untracked_write',
        `${op.op} at ${JSON.stringify(
          op.anchor ?? ''
        )} changed nothing: there was no ${
          structural === 'insertion'
            ? 'place to insert at'
            : 'row or paragraph to delete at'
        } that anchor, so no ${structural} was recorded and the document reads exactly as it did before. Re-read the structure - table_facts for a table - and use a current anchor from that read.`,
        [`anchor: ${op.anchor ?? '(none)'}`]
      );
    }
    throw new OpError(
      'untracked_write',
      `${op.op} at ${JSON.stringify(
        op.anchor ?? ''
      )} produced no reviewable ${structural}: SyncFusion recorded no ${structural} revision, and the change it did make cannot be shown to reject back to the document as it was, so it was rolled back. Re-read the structure and retry against a current anchor.`,
      [`anchor: ${op.anchor ?? '(none)'}`]
    );
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
    resolveRevisionIndividually(revision, false);
  }
}

/** The accept group an op belongs to; ungrouped ops share the change set id. */
function opGroupId(op: EditOp, changeSetId: string): string {
  return typeof op.group === 'string' && op.group.trim()
    ? op.group.trim()
    : changeSetId;
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
  restoresByGroup?: Map<string, AppearanceRestore[]>,
  stylesByGroup?: Map<string, ParagraphStyleRestore[]>,
  revisionsWereReloaded = false
): RevisionGroupingReport {
  const created = revisionsWereReloaded
    ? (() => {
        // Binding commands reload one SFDT. Syncfusion recreates live Revision
        // objects during open(), so persisted ids are their stable identity.
        const beforeIds = new Set(
          before
            .map((revision) => revision.revisionID)
            .filter((id): id is string => typeof id === 'string' && !!id)
        );
        return snapshotRevisions(editor).filter((revision) =>
          revision.revisionID
            ? !beforeIds.has(revision.revisionID)
            : !before.includes(revision)
        );
      })()
    : createdRevisions(editor, before);
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
    const styles = stylesByGroup?.get(group);
    if (restores?.length || styles?.length) {
      // The live closures below disappear on reload; the same customData that
      // carries group identity therefore carries the exact appearance inverse.
      // SyncFusion removes the revision metadata when the group resolves and
      // revives it with the revision on undo.
      for (const revision of partition) {
        const tag = parseRevisionGroupTag(revision.customData);
        if (tag?.changeSetId === changeSetId && tag.group === group)
          revision.customData = revisionGroupTag(
            changeSetId,
            group,
            restores,
            styles
          );
      }
    }
    if (restores?.length) appearanceGroups.add(group);
    // Both inverses belong to the group primitive: it is the only place that
    // knows when a card is finished and whether anything in it was kept.
    groupRevisionsAtomic(
      editor,
      partition,
      changeSetId,
      group,
      restores,
      styles
    );
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
// `split_table` belongs here for exactly the same reason and it was missed:
// `TableFacts.tableAnchor` IS the table's block address, so a model that reads a
// table and names it sends `"0;7"` - and without the retarget that failed with
// `anchor_not_found` plus a suggestion to "supply `expect` or `find`", which is
// meaningless for a table (a table has no one text) and named a cause that was
// not the problem. Live evidence: the model sent
// `{"op":"split_table","anchor":"5;61","rows":[4,5,9],...}` - the right rows,
// refused on the anchor form. A split acts on the whole table and takes its rows
// from `rows`, so any cell of that table identifies the same work; the retarget
// is lossless here in the way it is NOT for a row-scoped op.
export const TABLE_SCOPED_OPS = new Set([
  'copy_table_format',
  'restripe_table',
  'split_table',
  'duplicate_table'
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
  /**
   * Whether each inserted row is part of the table's header band, decided by
   * the SAME source-row mapping its cell appearance uses. SyncFusion clones the
   * ANCHORED row's `isHeader`, so a row added below a header came out flagged
   * as a second header - navy, bold and repeating on every page.
   */
  rowHeaders?: Array<{ row: number; isHeader: boolean }>;
  /** When no stripe resolves, the locally observed fill for each new row. */
  fallbackShadings?: Array<{ row: number; shading: string | null }>;
}

interface PlannedInsertInheritance {
  anchor: string;
  /**
   * Set INSTEAD of a donor when the document could not answer what this
   * component should look like. It carries no formatting, so the write happens
   * with the editor's defaults - and says so, in the op's result, rather than
   * letting a default read as a successful inheritance.
   */
  unresolved?: CreationGap;
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

/**
 * Every op that brings CONTENT into existence, and therefore every op that
 * must consult `creationAppearance` before writing. This is the enforcement
 * point for that rule: tests enumerate this set and require each member to
 * demonstrably inherit the document's look, so adding a creating op without
 * routing it through the resolver fails CI rather than shipping a path that
 * quietly writes the editor's defaults.
 *
 * `insert_section` is here because it composes; the primitives are here
 * because a model that prefers primitives hand-builds the same thing out of
 * them, and the guarantee has to hold either way or the door is still open.
 */
export const CONTENT_CREATING_OPS = new Set([
  'insert_section',
  'insert_table',
  'insert_row',
  'insert_text'
]);

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
  if (!op?.op || !TABLE_SCOPED_OPS.has(op.op)) return op;
  const anchor = String(op.anchor ?? '');
  if (!anchor || byAnchor.has(anchor)) return op;
  const tableAnchor = normalizeTableAnchor(anchor);
  if (!tableAnchor) return op;
  const firstCell = `${tableAnchor};0;0;0`;
  return byAnchor.has(firstCell) ? { ...op, anchor: firstCell } : op;
}

type DocxEditRoute = 'engine' | 'editor';

interface BindingTableRoute {
  anchor: string;
  tableId: string;
  table: TableEntry;
}

interface BindingRuntime {
  surface: BindingCommandSurface;
  index: BindingIndex;
  occurrencesByTag: Map<string, Occurrence[]>;
  tablesByAnchor: Map<string, BindingTableRoute>;
}

interface EngineMutationState {
  sfdt: any;
  index: BindingIndex;
}

interface EngineMutationOutcome {
  sfdt: any;
  anchor?: string;
  details?: string[];
}

interface EngineMutationPlan {
  route: 'engine';
  index: number;
  op: EditOp;
  anchor?: string;
  /**
   * Every figure this plan writes on the strength of a declared provenance, with
   * the cell each one licenses. Carried on the PLAN rather than on the result
   * so the single-use licence for a user-stated figure is judged before the
   * all-or-nothing engine transaction runs.
   */
  literalNumbers?: Array<{ where: string; write: LiteralNumberWrite }>;
  /** Lets the batch collapse repeated writes to one explicit global identity. */
  bindingWrite?: {
    identity: BindingWireIdentity;
    canonical: string;
  };
  execute(state: EngineMutationState): EngineMutationOutcome;
}

interface BoundInsertRowsPlan extends EngineMutationPlan {
  kind: 'bound_insert_rows';
  tableId: string;
  tableAnchor: string;
  firstVisualRow: number;
  createdRowIds: string[];
}

interface CreatedBoundRowTarget {
  plan: BoundInsertRowsPlan;
  offset: number;
}

interface BoundDuplicateRowValue {
  field: string;
  canonical: string;
  display: string;
  literalNumber?: LiteralNumberWrite;
}

interface BoundDuplicateRowPlan {
  values: BoundDuplicateRowValue[];
}

const BOUND_TEXT_WRITE_OPS = new Set([
  'set_cell_text',
  'replace_text',
  'replace_selection',
  'delete_text',
  'insert_text'
]);

const BOUND_WRITE_OPS = new Set([
  ...BOUND_TEXT_WRITE_OPS,
  'set_cell_formula',
  'set_column_formula',
  'change_case'
]);

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function stripRevisionIds(node: any): void {
  if (Array.isArray(node)) {
    node.forEach(stripRevisionIds);
    return;
  }
  if (!node || typeof node !== 'object') return;
  delete node.revisionIds;
  delete node.rids;
  for (const value of Object.values(node)) stripRevisionIds(value);
}

/**
 * A clone of what the document currently READS, referencing no tracked change:
 * pending deletions inside it are dropped, pending insertions kept, and every
 * `revisionIds` reference removed.
 *
 * `revisionIds` name entries in the document's own `revisions` array, so a
 * verbatim clone makes ONE pending card span the source AND the copy: rejecting
 * it would reach into the copy the user just asked for and mutate it. A FOREIGN
 * author's pending edit is refused outright, but the assistant's own pending
 * edits accumulate across turns until the user reviews them, and those must not
 * block a duplicate for the rest of a session.
 *
 * Stripping the ids alone is not enough: a tracked replacement leaves BOTH the
 * old run (marked deleted) and the new one, so an unresolved clone would read
 * "AcmeGamma". The copy is what the user was looking at when they asked for it,
 * and it is new content no existing card describes.
 */
function clonedWithoutRevisions<T>(sfdt: any, value: T): T {
  const clone = cloneJson(value);
  dropDeletedRevisionContent(clone, deletedRevisionIds(sfdt));
  stripRevisionIds(clone);
  return clone;
}

function dropDeletedRevisionContent(node: any, deleted: Set<string>): void {
  if (Array.isArray(node)) {
    node.forEach((entry) => dropDeletedRevisionContent(entry, deleted));
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const key of ['inlines', 'i'])
    if (Array.isArray(node[key]))
      node[key] = node[key].filter(
        (inline: any) =>
          !allRevisionIdsIn(pick(inline, 'revisionIds', 'rids'), deleted)
      );
  if (getRows(node)) {
    const key = ['rows', 'r', 'rw'].find((candidate) =>
      Array.isArray(node[candidate])
    ) as string;
    node[key] = node[key].filter(
      (row: any) => !allRevisionIdsIn(rowRevisionIds(row), deleted)
    );
  }
  for (const value of Object.values(node))
    dropDeletedRevisionContent(value, deleted);
}

function pathHasPrefix(prefix: unknown[], path: unknown[]): boolean {
  if (prefix.length > path.length) return false;
  return prefix.every((part, index) => String(part) === String(path[index]));
}

function pathCellIndex(path: unknown[]): number | null {
  const cells = path.findIndex((part) => part === 'cells');
  if (cells < 0) return null;
  const value = Number(path[cells + 1]);
  return Number.isInteger(value) ? value : null;
}

function rowIndexFromAnchor(anchor: unknown): number | null {
  const parts = String(anchor ?? '').split(';');
  if (parts.length < 5) return null;
  const row = Number(parts[2]);
  return Number.isInteger(row) && row >= 0 ? row : null;
}

function columnIndexFromAnchor(anchor: unknown): number | null {
  const parts = String(anchor ?? '').split(';');
  if (parts.length < 5) return null;
  const column = Number(parts[3]);
  return Number.isInteger(column) && column >= 0 ? column : null;
}

function bindingRuntime(editor: LiveEditor, sfdt: any): BindingRuntime | null {
  const surface = bindingCommandSurfaceFor(editor);
  if (!surface) return null;
  const index = scanReadableBindings(sfdt);
  if (!index) return null;
  const occurrencesByTag = new Map<string, Occurrence[]>();
  for (const occurrence of index.occurrences) {
    const bucket = occurrencesByTag.get(occurrence.tag);
    if (bucket) bucket.push(occurrence);
    else occurrencesByTag.set(occurrence.tag, [occurrence]);
  }
  const tablesByAnchor = new Map<string, BindingTableRoute>();
  for (const table of index.tables.values()) {
    const anchor = boundTableAnchor(sfdt, table);
    if (!anchor) continue;
    tablesByAnchor.set(anchor, {
      anchor,
      tableId: table.tableId,
      table
    });
  }
  return { surface, index, occurrencesByTag, tablesByAnchor };
}

function requireBindingRuntime(
  editor: LiveEditor,
  sfdt: any,
  op: EditOp,
  // Absent when the op addresses a row an earlier edit in this same batch will
  // create; the anchor it asked for is then the only address there is.
  target?: FlatBlock | LiveStoryTarget
): BindingRuntime {
  const runtime = bindingRuntime(editor, sfdt);
  if (runtime) return runtime;
  const anchor =
    target && !isLiveStoryTarget(target)
      ? target.anchor
      : String(op.anchor ?? '');
  const boundTag =
    target && !isLiveStoryTarget(target) ? target.boundTag : undefined;
  throw new OpError(
    'binding_engine_unavailable',
    `${op.op} targets a document binding at "${anchor}", but the binding command bridge is not attached. Nothing was written.`,
    [`anchor: ${anchor}`, boundTag ? `binding: ${boundTag}` : 'binding: table']
  );
}

function occurrenceForBlock(
  runtime: BindingRuntime,
  block: FlatBlock,
  op: EditOp
): Occurrence | undefined {
  // WHICH binding, before which occurrence of it: a block may hold several.
  const tag = bindingTagForOp(op, block);
  if (!tag) return undefined;
  const occurrences = runtime.occurrencesByTag.get(tag) ?? [];
  if (occurrences.length <= 1) return occurrences[0];
  const def = parseTag(tag);
  if (!def || def.kind === 'table') return occurrences[0];
  const tableAnchor = tableAnchorForBlock(block);
  const tableId = tableAnchor
    ? runtime.tablesByAnchor.get(tableAnchor)?.tableId
    : undefined;
  const rowId = def.options.row ?? null;
  return (
    occurrences.find(
      (occurrence) =>
        occurrence.name === def.name &&
        occurrence.tableId === (tableId ?? null) &&
        occurrence.rowId === rowId
    ) ?? occurrences[0]
  );
}

/**
 * The refusal that REDIRECTS: a computed binding is written by changing the
 * inputs it is computed from, so the message names those inputs and `retry` is
 * `'never'` - re-sending the same write cannot succeed no matter how it is
 * worded, and the remedy is a different target rather than a different phrasing.
 */
function formulaRedirect(op: EditOp, occurrence: Occurrence): OpError {
  const expr =
    occurrence.def.kind === 'formula' ? occurrence.def.expression : '';
  let refs: string[] = [];
  try {
    refs = [...new Set(collectRefs(parseExpression(expr)))];
  } catch {
    refs = [];
  }
  const readableRefs = refs.length ? refs.join(', ') : 'its source inputs';
  return new OpError(
    'target_is_bound_formula',
    `${op.op} cannot write the computed binding "${occurrence.name}". Change ${readableRefs} instead; the binding engine will recompute this value.`,
    [
      `binding: ${occurrence.tag}`,
      `expr: ${expr || '(unreadable)'}`,
      ...(refs.length ? [`inputs: ${readableRefs}`] : [])
    ],
    'never'
  );
}

function retryableBoundNeighborRefusal(op: EditOp, block: FlatBlock): OpError {
  return new OpError(
    'unaddressable_in_bound_document',
    `${op.op} cannot write ${block.anchor}: that text sits next to a document binding, and this engine cannot address its raw offsets without risking the content control. Re-read the nearby bound fields and target an editable binding value instead, or ask for a plain-text rewrite outside the bound container.`,
    [`anchor: ${block.anchor}`]
  );
}

function bindingValueParseError(
  op: EditOp,
  occurrence: Occurrence,
  value: string,
  err: unknown
): OpError {
  return new OpError(
    'binding_value_parse_failed',
    `${op.op} could not set "${occurrence.name}" to ${JSON.stringify(
      value
    )}: ${describeUnexpectedError(err)}. Nothing was written.`,
    [
      `binding: ${occurrence.tag}`,
      `value: ${JSON.stringify(value)}`,
      `type: ${occurrence.def.fieldType.kind}`
    ]
  );
}

function boundNumericWriteNeedsProvenance(
  occurrence: Occurrence,
  value: string
): boolean {
  return (
    ['integer', 'decimal', 'currency', 'percent'].includes(
      occurrence.def.fieldType.kind
    ) && classifyNumericText(value).numeric
  );
}

/**
 * Refuse a bound numeric write with no declared provenance, and hand back the
 * audit record when there is one.
 *
 * The record is the caller's to keep: `literal: true` is a ONE-CELL licence
 * within a change set, and the plan that carries the record is what lets the
 * boundary see a figure being spent twice.
 */
function guardBoundNumericReplacement(
  op: EditOp,
  occurrence: Occurrence,
  value: string
): LiteralNumberWrite | undefined {
  if (!boundNumericWriteNeedsProvenance(occurrence, value)) return undefined;
  const { record, citationFailure } = resolveNumberProvenance(
    { ...op, op: 'set_cell_text', text: value } as TypedEditOp<'set_cell_text'>,
    value.trim(),
    occurrence.text
  );
  if (record) return record;
  throw new OpError(
    'model_authored_number',
    `Refusing to write the numeric value ${JSON.stringify(
      value.trim()
    )} into bound input "${occurrence.name}" through ${
      op.op
    }: the engine did not compute it, so the request must say where it came from. Add \`literal: true\` if the user stated this exact value, or provide both \`quotedFrom\` and \`quotedText\` with an excerpt containing the figure.${citationFailure}`,
    [
      `binding: ${occurrence.tag}`,
      `field: ${occurrence.name}`,
      `value: ${JSON.stringify(value)}`,
      `current content: ${JSON.stringify(occurrence.text)}`
    ]
  );
}

function desiredBoundDisplayText(
  op: EditOp,
  block: FlatBlock,
  occurrence: Occurrence
): string {
  const current = occurrence.text;
  switch (op.op) {
    case 'set_cell_text':
      return String(op.text ?? '');
    case 'replace_text': {
      const replacement = String(op.replace ?? op.text ?? op.newText ?? '');
      const find = op.find != null ? String(op.find) : '';
      if (!find) {
        if (block.text === current) return replacement;
        throw new OpError(
          'binding_write_unroutable',
          `replace_text at "${block.anchor}" did not say which part of the bound text to replace. Send \`find\` inside the binding value, or set the entire bound value with set_cell_text.`,
          [
            `binding: ${occurrence.tag}`,
            `current value: ${JSON.stringify(current)}`
          ]
        );
      }
      if (!current.includes(find)) {
        throw new OpError(
          'binding_write_unroutable',
          `replace_text found ${JSON.stringify(
            find
          )} in the block but not inside the binding value "${
            occurrence.name
          }". The surrounding text is not safely addressable through this route.`,
          [`binding value: ${JSON.stringify(current)}`]
        );
      }
      return current.replace(find, replacement);
    }
    case 'delete_text': {
      const find = String(op.find ?? '');
      if (!find) throw new OpError('missing_find', 'delete_text needs `find`.');
      if (!current.includes(find)) {
        throw new OpError(
          'binding_write_unroutable',
          `delete_text cannot remove ${JSON.stringify(
            find
          )} because it is not inside the binding value "${occurrence.name}".`,
          [`binding value: ${JSON.stringify(current)}`]
        );
      }
      return current.replace(find, '');
    }
    case 'insert_text': {
      if (block.text !== current) {
        throw new OpError(
          'binding_write_unroutable',
          `insert_text at "${block.anchor}" targets a paragraph that mixes binding text with surrounding prose. Set or replace the bound value itself instead.`,
          [`binding: ${occurrence.tag}`]
        );
      }
      const offset = insertionPoint(op as TypedEditOp<'insert_text'>, {
        ...block,
        text: current,
        length: current.length
      });
      return (
        current.slice(0, offset) +
        insertionText(op as TypedEditOp<'insert_text'>) +
        current.slice(offset)
      );
    }
    case 'replace_selection': {
      if (block.text !== current || op.expect !== current) {
        throw new OpError(
          'binding_write_unroutable',
          `replace_selection can route through a binding only when the selected text is exactly the binding value. Send set_cell_text for "${occurrence.name}" instead.`,
          [`binding: ${occurrence.tag}`]
        );
      }
      return String(op.replace ?? op.text ?? op.newText ?? '');
    }
    default:
      throw new OpError(
        'binding_write_unroutable',
        `${op.op} is not an engine-routable write for binding "${occurrence.name}".`,
        [`binding: ${occurrence.tag}`]
      );
  }
}

function setBoundOccurrenceCanonical(
  state: EngineMutationState,
  occurrence: Occurrence,
  canonical: string
): EngineMutationState {
  if (occurrence.tableId && occurrence.rowId) {
    return {
      sfdt: setOccurrenceText(
        state.sfdt,
        occurrence,
        renderDisplay(occurrence.def.fieldType, canonical)
      ),
      index: state.index
    };
  }
  return {
    sfdt: setTaggedValue(state.sfdt, occurrence.name, canonical, state.index),
    index: state.index
  };
}

interface IndependentDocumentField {
  name: string;
  occurrences: Occurrence[];
  locations: string[];
}

function containingBindingTable(
  index: BindingIndex,
  occurrence: Occurrence
): TableEntry | undefined {
  return [...index.tables.values()].find((table) =>
    pathHasPrefix(table.markerPath, occurrence.path)
  );
}

/**
 * A duplicated table prefixes its private document fields with the new table
 * id. Strip only that owning prefix when comparing field identity, so a write
 * to `tax_rate` can see the independent `expenses_copy_tax_rate` instance the
 * duplicate created without conflating unrelated fields elsewhere.
 */
/**
 * The family a document field belongs to, with the marks a COPY adds stripped
 * off - so a copy and its source are recognised as instances of one thing.
 *
 * Copies are marked two different ways, and only one of them was handled here.
 * A table duplicate namespaces its fields with the new table's id
 * (`costs_copy_tax`), and a section copy appends a numeric suffix instead
 * (`project.name_2`, from `uniqueBindingName`). Recognising only the prefix
 * meant a section copy and its source read as unrelated fields, so the
 * ambiguity flow - the thing that asks the user WHICH instance they meant -
 * never fired for exactly the case that produces two instances.
 *
 * The suffix is the allocator's own spelling, matched as it is written, so this
 * cannot drift from it silently.
 */
function documentFieldIdentity(
  index: BindingIndex,
  occurrence: Occurrence
): string {
  const owner = containingBindingTable(index, occurrence);
  const prefix = owner ? `${owner.tableId}_` : '';
  const withoutPrefix =
    prefix && occurrence.name.startsWith(prefix)
      ? occurrence.name.slice(prefix.length)
      : occurrence.name;
  // The family this binding belongs to, as recorded when it was copied. A
  // trailing number is not proof of being a copy: `revenue_2024` and `q_1` are
  // names an author chooses, and stripping their digits made them claim
  // membership in `revenue`'s and `q`'s families - so a write to one offered
  // the other as an instance of itself, and confirming "all" would have fanned
  // that write onto a field the user never named.
  return occurrence.def.options?.copyOf ?? withoutPrefix;
}

function independentDocumentFields(
  index: BindingIndex,
  target: Occurrence
): IndependentDocumentField[] {
  if (
    target.tableId ||
    target.rowId ||
    target.def.kind !== 'field' ||
    target.def.isGlobal
  )
    return [];
  const identity = documentFieldIdentity(index, target);
  const fields: IndependentDocumentField[] = [];
  for (const [name, occurrences] of index.fields) {
    const first = occurrences[0];
    if (
      !first ||
      first.def.isGlobal ||
      documentFieldIdentity(index, first) !== identity
    )
      continue;
    const locations = [
      ...new Set(
        occurrences.map((occurrence) => {
          const table = containingBindingTable(index, occurrence);
          return table
            ? `table "${table.tableId}"`
            : `document path ${occurrence.path.join('/')}`;
        })
      )
    ];
    fields.push({ name, occurrences, locations });
  }
  return fields;
}

function independentFieldDetails(fields: IndependentDocumentField[]): string[] {
  return fields.map(
    (field, index) =>
      `instance ${index + 1}: "${field.name}" at ${field.locations.join(', ')}`
  );
}

function bindingInstanceChoice(
  index: BindingIndex,
  field: IndependentDocumentField
): BindingInstanceChoice {
  return {
    instanceId: field.name,
    identity: { id: field.name, global: false },
    occurrences: field.occurrences.map((occurrence) => {
      const table = containingBindingTable(index, occurrence);
      const location = table
        ? `table "${table.tableId}"`
        : `document path ${occurrence.path.join('/')}`;
      return {
        occurrenceId: `${field.name}@${occurrence.path.join('/')}`,
        bindingId: field.name,
        value: occurrence.text,
        location,
        ...(table ? { tableId: table.tableId } : {}),
        documentPath: occurrence.path.join('/')
      };
    })
  };
}

function bindingWriteAmbiguity(
  runtime: BindingRuntime,
  target: Occurrence,
  fields: IndependentDocumentField[]
): BindingWriteAmbiguity {
  const instances = fields
    .map((field) => bindingInstanceChoice(runtime.index, field))
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  const signature = instances.map((instance) => ({
    id: instance.instanceId,
    occurrences: instance.occurrences.map((occurrence) => ({
      id: occurrence.occurrenceId,
      value: occurrence.value
    }))
  }));
  return {
    kind: 'binding_write',
    ambiguityId: JSON.stringify({
      field: documentFieldIdentity(runtime.index, target),
      instances: signature
    }),
    field: documentFieldIdentity(runtime.index, target),
    instanceCount: instances.length,
    occurrenceCount: instances.reduce(
      (count, instance) => count + instance.occurrences.length,
      0
    ),
    instances
  };
}

function bindingResolutionFrom(op: EditOp): BindingWriteResolution | undefined {
  const value = op.bindingResolution;
  if (value === undefined) return undefined;
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.ambiguityId !== 'string' ||
    (value.choice !== 'all' && value.choice !== 'one') ||
    (value.choice === 'one' && typeof value.instanceId !== 'string')
  )
    throw new OpError(
      'binding_resolution_invalid',
      'bindingResolution must copy the returned ambiguityId and choose either all instances or one returned instanceId. Nothing was written.'
    );
  return value as BindingWriteResolution;
}

function leaveEngineAtAddressableBodySelection(
  editor: LiveEditor,
  blocks: FlatBlock[]
): void {
  const target = blocks.find(
    (block) =>
      /^\d+;\d+$/.test(block.anchor) &&
      block.kind !== 'table_cell' &&
      !block.boundTag &&
      !block.offsetsUntrusted
  );
  if (target) selectRange(editor, target.anchor, target.length, target.length);
}

function ambiguousIndependentFieldWrite(
  op: EditOp,
  index: BindingIndex,
  target: Occurrence,
  fields: IndependentDocumentField[],
  reason: string,
  ambiguity: BindingWriteAmbiguity
): OpError {
  return new OpError(
    'independent_binding_instances_ambiguous',
    `${op.op} names field "${documentFieldIdentity(
      index,
      target
    )}", but it resolves to ${
      fields.length
    } independent binding instances across ${
      ambiguity.occurrenceCount
    } places. ${reason} Ask the user whether to update all instances or one listed instance. Nothing was written.`,
    independentFieldDetails(fields),
    undefined,
    ambiguity
  );
}

function boundInputTextPlan(
  index: number,
  op: EditOp,
  block: FlatBlock,
  occurrence: Occurrence,
  runtime: BindingRuntime
): EngineMutationPlan {
  const desired = desiredBoundDisplayText(op, block, occurrence);
  const sameId = runtime.index.fields.get(occurrence.name) ?? [];
  if (
    sameId.some(
      (candidate) => candidate.def.isGlobal !== occurrence.def.isGlobal
    )
  )
    throw new OpError(
      'global_binding_identity_conflict',
      `Binding "${occurrence.name}" mixes global and non-global occurrences. Nothing was written; make every occurrence of one binding id agree on global scope.`,
      sameId.map(
        (candidate) =>
          `${
            candidate.def.isGlobal ? 'global' : 'non-global'
          } at document path ${candidate.path.join('/')}`
      )
    );
  const independent = independentDocumentFields(runtime.index, occurrence);
  const ambiguity =
    independent.length > 1
      ? bindingWriteAmbiguity(runtime, occurrence, independent)
      : undefined;
  if (ambiguity && op.op !== 'set_cell_text')
    throw ambiguousIndependentFieldWrite(
      op,
      runtime.index,
      occurrence,
      independent,
      'Only set_cell_text can carry the explicit user resolution and one complete replacement value.',
      ambiguity
    );
  const resolution = bindingResolutionFrom(op);
  if (!ambiguity && resolution)
    throw new OpError(
      'binding_resolution_stale',
      'The supplied binding ambiguity no longer exists in the live document. Re-read before writing; nothing was written.'
    );
  if (ambiguity && !resolution)
    throw ambiguousIndependentFieldWrite(
      op,
      runtime.index,
      occurrence,
      independent,
      'No global identity joins them.',
      ambiguity
    );
  if (ambiguity && resolution?.ambiguityId !== ambiguity.ambiguityId)
    throw ambiguousIndependentFieldWrite(
      op,
      runtime.index,
      occurrence,
      independent,
      'The supplied confirmation is stale and does not match these live instances.',
      ambiguity
    );
  const selectedFields = !ambiguity
    ? independent
    : resolution?.choice === 'all'
    ? independent
    : independent.filter((field) => field.name === resolution?.instanceId);
  if (ambiguity && resolution?.choice === 'one' && !selectedFields.length)
    throw ambiguousIndependentFieldWrite(
      op,
      runtime.index,
      occurrence,
      independent,
      `The chosen instance id ${JSON.stringify(
        resolution.instanceId
      )} is not one of the live choices.`,
      ambiguity
    );
  if (
    ambiguity &&
    resolution?.choice === 'all' &&
    selectedFields.some(
      (field) =>
        field.occurrences[0]?.def.kind !== 'field' ||
        !field.occurrences[0]?.def.isEditable ||
        JSON.stringify(field.occurrences[0]?.def.fieldType) !==
          JSON.stringify(occurrence.def.fieldType)
    )
  )
    throw ambiguousIndependentFieldWrite(
      op,
      runtime.index,
      occurrence,
      independent,
      'The user chose all, but their types or editability differ, so one value cannot be written safely to all of them.',
      ambiguity
    );
  const selectedOccurrence = selectedFields[0]?.occurrences[0] ?? occurrence;
  if (
    selectedOccurrence.def.kind !== 'field' ||
    !selectedOccurrence.def.isEditable
  )
    throw new OpError(
      'binding_instance_not_editable',
      `The selected binding instance "${selectedOccurrence.name}" is not editable. Nothing was written.`
    );
  const literalNumber = guardBoundNumericReplacement(
    op,
    selectedOccurrence,
    desired
  );
  let canonical: string;
  try {
    canonical = parseDisplay(selectedOccurrence.def.fieldType, desired);
  } catch (err) {
    if (isValueError(err))
      throw bindingValueParseError(op, selectedOccurrence, desired, err);
    throw err;
  }
  return {
    route: 'engine',
    index,
    op,
    anchor: block.anchor,
    ...(literalNumber
      ? { literalNumbers: [{ where: block.anchor, write: literalNumber }] }
      : {}),
    bindingWrite: {
      identity: { id: occurrence.name, global: occurrence.def.isGlobal },
      canonical
    },
    execute(state) {
      const liveOccurrence =
        state.index.occurrences.find(
          (candidate) =>
            candidate.name === occurrence.name &&
            candidate.tableId === occurrence.tableId &&
            candidate.rowId === occurrence.rowId &&
            candidate.tag === occurrence.tag
        ) ??
        state.index.occurrences.find(
          (candidate) =>
            candidate.name === occurrence.name &&
            candidate.tableId === occurrence.tableId &&
            candidate.rowId === occurrence.rowId
        );
      if (!liveOccurrence)
        throw new OpError(
          'binding_target_lost',
          `The binding "${occurrence.name}" could not be found when applying ${op.op}. Nothing was written.`,
          [`binding: ${occurrence.tag}`]
        );
      let next = state;
      if (selectedFields.length) {
        for (const field of selectedFields)
          next = {
            sfdt: setTaggedValue(next.sfdt, field.name, canonical, state.index),
            index: state.index
          };
      } else {
        next = setBoundOccurrenceCanonical(state, liveOccurrence, canonical);
      }
      const details = [
        ...(occurrence.def.isGlobal
          ? [
              `updated global identity "${occurrence.name}" across ${sameId.length} occurrences`
            ]
          : []),
        ...(ambiguity && resolution?.choice === 'all'
          ? [
              `user confirmed all ${
                selectedFields.length
              } independent instances of field "${documentFieldIdentity(
                state.index,
                liveOccurrence
              )}"`,
              ...independentFieldDetails(selectedFields)
            ]
          : []),
        ...(ambiguity && resolution?.choice === 'one'
          ? [`user confirmed only binding instance "${selectedFields[0].name}"`]
          : []),
        ...(desired ===
        renderDisplay(selectedOccurrence.def.fieldType, canonical)
          ? []
          : [
              `display normalized from ${JSON.stringify(
                desired
              )} to ${JSON.stringify(
                renderDisplay(selectedOccurrence.def.fieldType, canonical)
              )}`
            ])
      ];
      return {
        sfdt: next.sfdt,
        anchor: block.anchor,
        ...(details.length ? { details } : {})
      };
    }
  };
}

function boundTableForBlock(
  runtime: BindingRuntime,
  block: FlatBlock
): BindingTableRoute | undefined {
  const tableAnchor = tableAnchorForBlock(block);
  return tableAnchor ? runtime.tablesByAnchor.get(tableAnchor) : undefined;
}

function rowIdAtVisualRow(table: TableEntry, rowIndex: number): string | null {
  for (const row of table.rows) {
    if (!row.path) continue;
    const rawIndex = Number(row.path[row.path.length - 1]);
    if (rawIndex === rowIndex) return row.rowId;
  }
  return null;
}

function fieldOccurrenceAtColumn(
  table: TableEntry,
  column: number
): Occurrence | undefined {
  for (const row of table.rows) {
    for (const occurrence of row.bindings.values()) {
      if (pathCellIndex(occurrence.path) === column) return occurrence;
    }
  }
  return undefined;
}

function boundInsertRowsPlan(
  index: number,
  op: EditOp,
  block: FlatBlock,
  tableRoute: BindingTableRoute
): BoundInsertRowsPlan {
  const rowIndex = rowIndexFromAnchor(block.anchor);
  if (rowIndex == null)
    throw new OpError(
      'not_a_cell_anchor',
      'insert_row in a bound table needs a cell anchor from that table.'
    );
  const count = positiveCount(op.count);
  const above = op.above === true;
  const afterVisualRow = above ? rowIndex - 1 : rowIndex;
  const afterRowId = rowIdAtVisualRow(tableRoute.table, afterVisualRow);
  if (!afterRowId)
    throw new OpError(
      'bound_row_insert_unroutable',
      `insert_row cannot add a bound line item ${
        above ? 'above' : 'below'
      } row ${rowIndex} because there is no bound data row on that side to clone from. Anchor a data row and insert below it, or read table_facts for current row ids.`,
      [`table: ${tableRoute.tableId}`, `anchor: ${block.anchor}`]
    );
  const firstVisualRow = above ? rowIndex : rowIndex + 1;
  const plan: BoundInsertRowsPlan = {
    route: 'engine',
    kind: 'bound_insert_rows',
    index,
    op,
    anchor: block.anchor,
    tableId: tableRoute.tableId,
    tableAnchor: tableRoute.anchor,
    firstVisualRow,
    createdRowIds: [],
    execute(state) {
      let next = state.sfdt;
      let nextIndex = state.index;
      let after = afterRowId;
      plan.createdRowIds.splice(0, plan.createdRowIds.length);
      for (let offset = 0; offset < count; offset++) {
        const added = addLineItem(next, tableRoute.tableId, after, nextIndex);
        next = added.sfdt;
        after = added.rowId;
        plan.createdRowIds.push(added.rowId);
        nextIndex = scanBindings(next);
      }
      const table = nextIndex.tables.get(tableRoute.tableId);
      if (!table)
        throw new OpError(
          'bound_table_lost',
          `insert_row added rows but the table "${tableRoute.tableId}" was no longer readable. Nothing was kept.`
        );
      for (const rowId of plan.createdRowIds) {
        if (!table.rows.some((row) => row.rowId === rowId))
          throw new OpError(
            'bound_row_insert_not_observable',
            `insert_row reported new row "${rowId}", but it was not present after the engine transaction. Nothing was kept.`
          );
      }
      return {
        sfdt: next,
        anchor: block.anchor,
        details: [
          `table: ${tableRoute.tableId}`,
          `created row ids: ${plan.createdRowIds.join(', ')}`
        ]
      };
    }
  };
  return plan;
}

function boundDeleteRowsPlan(
  index: number,
  op: EditOp,
  block: FlatBlock,
  tableRoute: BindingTableRoute
): EngineMutationPlan {
  const rowIndex = rowIndexFromAnchor(block.anchor);
  if (rowIndex == null)
    throw new OpError(
      'not_a_cell_anchor',
      'delete_row in a bound table needs a cell anchor from that table.'
    );
  const requested =
    Array.isArray(op.rows) && op.rows.length
      ? [...new Set(op.rows.map(Number).filter((row) => Number.isInteger(row)))]
      : [rowIndex];
  const rowIds = requested.map((row) => ({
    row,
    rowId: rowIdAtVisualRow(tableRoute.table, row)
  }));
  const missing = rowIds.filter((entry) => !entry.rowId);
  if (missing.length)
    throw new OpError(
      'bound_row_not_found',
      `delete_row can remove only bound data rows. Row ${missing
        .map((entry) => entry.row)
        .join(', ')} has no row binding in table "${tableRoute.tableId}".`,
      [`rows: ${requested.join(', ')}`]
    );
  return {
    route: 'engine',
    index,
    op,
    anchor: block.anchor,
    execute(state) {
      let next = state.sfdt;
      let nextIndex = state.index;
      for (const { rowId } of rowIds) {
        next = removeLineItem(
          next,
          tableRoute.tableId,
          rowId as string,
          nextIndex
        );
        nextIndex = scanBindings(next);
      }
      const table = nextIndex.tables.get(tableRoute.tableId);
      if (!table)
        throw new OpError(
          'bound_table_lost',
          `delete_row removed rows but the table "${tableRoute.tableId}" was no longer readable. Nothing was kept.`
        );
      const stillPresent = rowIds.filter((entry) =>
        table.rows.some((row) => row.rowId === entry.rowId)
      );
      if (stillPresent.length)
        throw new OpError(
          'bound_row_delete_not_observable',
          `delete_row did not remove row id(s) ${stillPresent
            .map((entry) => entry.rowId)
            .join(', ')} from table "${tableRoute.tableId}". Nothing was kept.`
        );
      return {
        sfdt: next,
        anchor: block.anchor,
        details: [
          `table: ${tableRoute.tableId}`,
          `removed row ids: ${rowIds.map((entry) => entry.rowId).join(', ')}`
        ]
      };
    }
  };
}

function boundDeleteTablePlan(
  index: number,
  op: EditOp,
  block: FlatBlock,
  tableRoute: BindingTableRoute
): EngineMutationPlan {
  return {
    route: 'engine',
    index,
    op,
    anchor: block.anchor,
    execute(state) {
      const liveTable = state.index.tables.get(tableRoute.tableId);
      if (!liveTable)
        throw new OpError(
          'bound_table_not_found',
          `No bound table "${tableRoute.tableId}" was found when applying delete_table. Nothing was written.`
        );
      const markerPath = liveTable.markerPath;
      const blocksPath = markerPath.slice(0, -1);
      const at = Number(markerPath[markerPath.length - 1]);
      const siblings = getAt(state.sfdt, blocksPath);
      if (!Array.isArray(siblings) || !Number.isInteger(at))
        throw new OpError(
          'bound_table_delete_unroutable',
          `delete_table could not locate the table block for "${tableRoute.tableId}". Nothing was written.`
        );
      const next = setAt(state.sfdt, blocksPath, [
        ...siblings.slice(0, at),
        ...siblings.slice(at + 1)
      ]);
      const nextIndex = scanBindings(next);
      if (nextIndex.tables.has(tableRoute.tableId))
        throw new OpError(
          'bound_table_delete_not_observable',
          `delete_table did not remove bound table "${tableRoute.tableId}". Nothing was kept.`
        );
      return {
        sfdt: next,
        anchor: tableRoute.anchor,
        details: [`removed bound table: ${tableRoute.tableId}`]
      };
    }
  };
}

// Every candidate must satisfy the tag grammar's NAME rule, not just the first
// one: a table id may legally start with a digit, so a collision that rebuilt the
// name from `base` used to emit a tag the scanner then rejected as malformed.
function bindingNameCandidate(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_.]/g, '_');
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `binding_${cleaned}`;
}

function uniqueBindingName(base: string, used: Set<string>): string {
  let candidate = bindingNameCandidate(base);
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = bindingNameCandidate(`${base}_${suffix}`);
    suffix++;
  }
  used.add(candidate);
  return candidate;
}

/**
 * `taken` carries the ids allocated EARLIER IN THE SAME COPY, which the index
 * cannot know about yet.
 *
 * Sanitizing collapses distinct ids onto one candidate - `costs-us` and
 * `costs_us` both want `costs_us_copy` - so a range holding both tables gave
 * their copies the same id and merged two tables into one identity. Checking
 * only the existing index cannot see that, because neither copy is in it yet.
 * The binding-NAME allocator beside this one already reserves as it goes; this
 * one did not, and that was the whole difference.
 */
function uniqueTableId(
  base: string,
  index: BindingIndex,
  taken: Set<string> = new Set()
): string {
  const cleanBase = `${base}_copy`.replace(/[^A-Za-z0-9_]/g, '_');
  let candidate = cleanBase;
  let suffix = 2;
  while (index.tables.has(candidate) || taken.has(candidate)) {
    candidate = `${cleanBase}_${suffix}`;
    suffix++;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * `tableIds` maps each table id in the cloned range to the id its copy takes.
 * A range can hold several bound tables, and a table absent from the map is not
 * part of this clone, so its references are left alone.
 */
function rewriteBindingExpression(
  expression: string,
  tableIds: Map<string, string>,
  renamedDocBindings: Map<string, string>,
  preservedDocBindings: Set<string>
): string {
  return String(expression).replace(
    /\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?\b/g,
    (token, offset, source) => {
      const after = source.slice(offset + token.length).match(/^\s*(.)/)?.[1];
      if (after === '(') return token;
      const renamed = renamedDocBindings.get(token);
      if (renamed) return renamed;
      if (preservedDocBindings.has(token)) return token;
      const dot = token.indexOf('.');
      if (dot > 0) {
        const mapped = tableIds.get(token.slice(0, dot));
        if (mapped) return `${mapped}${token.slice(dot)}`;
      }
      return token;
    }
  );
}

function firstTableBlockIn(container: any): any {
  if (getRows(container)) return container;
  return getBlocks(container).find((block) => getRows(block));
}

/** An empty paragraph in the key convention the document already uses. */
function emptyParagraphBlock(sfdt: any): any {
  return sfdt?.sections !== undefined ? { inlines: [] } : { i: [] };
}

/**
 * `siblings` with `clone` inserted after index `at`, separated from its
 * neighbours by empty paragraphs wherever it would otherwise sit table-to-table.
 *
 * Word renders two adjacent tables as ONE table, so the duplicate landed flush
 * against its source and the pair read as a single table with its rows repeated -
 * reproduced live, on both the bound and the plain route. An empty paragraph
 * always goes between the source and the copy, and a second one after the copy
 * when the block it lands in front of is another table.
 */
function spliceDuplicateAfter(
  sfdt: any,
  siblings: any[],
  at: number,
  clone: any
): any[] {
  return [
    ...siblings.slice(0, at + 1),
    emptyParagraphBlock(sfdt),
    clone,
    ...(firstTableBlockIn(siblings[at + 1]) ? [emptyParagraphBlock(sfdt)] : []),
    ...siblings.slice(at + 1)
  ];
}

function freshRowIdsFor(
  table: TableEntry,
  newTableId: string
): Map<string, string> {
  const out = new Map<string, string>();
  let ordinal = 1;
  for (const row of table.rows) {
    if (!row.rowId || out.has(row.rowId)) continue;
    out.set(row.rowId, `${newTableId}_r${ordinal}`);
    ordinal++;
  }
  return out;
}

function rewriteBindingsInClone(
  node: any,
  options: {
    /** OLD table id -> new table id, for every bound table in this clone. */
    tableIds: Map<string, string>;
    rowIds: Map<string, string>;
    renameDocBindings: Map<string, string>;
    preservedDocBindings: Set<string>;
    copyRows: boolean;
  }
): void {
  if (Array.isArray(node)) {
    node.forEach((entry) => rewriteBindingsInClone(entry, options));
    return;
  }
  if (!node || typeof node !== 'object') return;
  const props = node.contentControlProperties;
  if (props?.tag) {
    let def: Definition | null = null;
    try {
      def = parseTag(String(props.tag));
    } catch {
      def = null;
    }
    const mappedTableId =
      def?.kind === 'table' ? options.tableIds.get(def.tableId) : undefined;
    if (def?.kind === 'table' && mappedTableId) {
      def.tableId = mappedTableId;
      node.contentControlProperties = { ...props, tag: formatTag(def) };
    } else if (def && (def.kind === 'field' || def.kind === 'formula')) {
      let changed = false;
      const oldRow = def.options.row;
      if (oldRow && options.rowIds.has(oldRow)) {
        def.options = { ...def.options, row: options.rowIds.get(oldRow) };
        changed = true;
        if (def.kind === 'field' && !options.copyRows) {
          node.inlines = [
            {
              text: renderDisplay(def.fieldType, defaultValue(def)),
              ...(node.inlines?.[0]?.characterFormat
                ? { characterFormat: node.inlines[0].characterFormat }
                : {})
            }
          ];
        }
      }
      const renamed = def.isGlobal
        ? undefined
        : options.renameDocBindings.get(def.name);
      if (renamed) {
        // Provenance is a fact known HERE, at the moment the copy is made.
        // Recording it is what lets a copy and its source be recognised as one
        // family later without guessing from the shape of the name. A copy of a
        // copy keeps pointing at the original, so a family has a single root.
        def.options = {
          ...def.options,
          copyOf: def.options?.copyOf ?? def.name
        };
        def.name = renamed;
        changed = true;
      }
      if (def.kind === 'formula' && !def.isGlobal) {
        const nextExpression = rewriteBindingExpression(
          def.expression,
          options.tableIds,
          options.renameDocBindings,
          options.preservedDocBindings
        );
        if (nextExpression !== def.expression) {
          def.expression = nextExpression;
          changed = true;
        }
      }
      if (changed)
        node.contentControlProperties = { ...props, tag: formatTag(def) };
      return;
    }
  }
  for (const value of Object.values(node))
    rewriteBindingsInClone(value, options);
}

function materializeBoundRows(
  state: EngineMutationState,
  tableId: string,
  rows: BoundDuplicateRowPlan[] | null,
  rowIds: string[]
): any {
  if (!rows) return state.sfdt;
  let next = state.sfdt;
  // ONE scan for the whole materialization: `setOccurrenceText` writes through
  // `occurrence.path` and leaves every path intact, so the index taken before the
  // first value stays valid for the last one. Rescanning per cell walked the
  // whole document once per figure - 160 whole-document scans for a 40-row,
  // 4-column payload inside a single synchronous transaction.
  const table = state.index.tables.get(tableId);
  rows.forEach((rowPlan, rowOffset) => {
    const rowId = rowIds[rowOffset];
    if (!rowId) return;
    const row = table?.rows.find((entry) => entry.rowId === rowId);
    if (!row) return;
    rowPlan.values.forEach(({ field, canonical }) => {
      const occurrence = row.bindings.get(field);
      if (!occurrence || occurrence.def.kind !== 'field')
        throw new OpError(
          'duplicate_table_unknown_field',
          `duplicate_table rows supplied "${field}", but that is not an editable input column in table "${tableId}". Nothing was written.`
        );
      next = setOccurrenceText(
        next,
        occurrence,
        renderDisplay(occurrence.def.fieldType, canonical)
      );
    });
  });
  return next;
}

function validateBoundDuplicateRows(
  op: EditOp,
  tableRoute: BindingTableRoute
): BoundDuplicateRowPlan[] | null {
  if (op.rows === undefined || op.rows === 'copy') return null;
  if (!Array.isArray(op.rows))
    throw new OpError(
      'duplicate_table_invalid_rows',
      'duplicate_table rows must be "copy" or an array of row value objects. Nothing was written.'
    );
  return op.rows.map((rowValues: unknown, rowIndex: number) => {
    if (!rowValues || typeof rowValues !== 'object' || Array.isArray(rowValues))
      throw new OpError(
        'duplicate_table_invalid_rows',
        `duplicate_table rows[${rowIndex}] must be an object keyed by bound input names. Nothing was written.`
      );
    const values: BoundDuplicateRowValue[] = [];
    for (const [field, rawValue] of Object.entries(
      rowValues as Record<string, unknown>
    )) {
      const occurrence = tableRoute.table.rows
        .map((row) => row.bindings.get(field))
        .find((candidate): candidate is Occurrence => !!candidate);
      if (!occurrence)
        throw new OpError(
          'duplicate_table_unknown_field',
          `duplicate_table rows[${rowIndex}] supplied "${field}", but table "${tableRoute.tableId}" has no such bound column. Nothing was written.`
        );
      if (occurrence.def.kind === 'formula')
        throw formulaRedirect(op, occurrence);
      const display = String(rawValue ?? '');
      const literalNumber = guardBoundNumericReplacement(
        op,
        occurrence,
        display
      );
      let canonical: string;
      try {
        canonical = parseDisplay(occurrence.def.fieldType, display);
      } catch (err) {
        if (isValueError(err))
          throw bindingValueParseError(op, occurrence, display, err);
        throw err;
      }
      values.push({
        field,
        canonical,
        display,
        ...(literalNumber ? { literalNumber } : {})
      });
    }
    return { values };
  });
}

/**
 * One accounting entry per figure a `duplicate_table` payload writes.
 *
 * `literal: true` on the op is not a blanket licence for every number in every
 * row: the same single-use rule the cell-by-cell path enforces applies here, one
 * cell at a time, so the boundary can see a stated figure being spent twice.
 */
function duplicateRowLiteralNumbers(
  op: EditOp,
  rows: BoundDuplicateRowPlan[] | null
): Array<{ where: string; write: LiteralNumberWrite }> {
  if (!rows) return [];
  const out: Array<{ where: string; write: LiteralNumberWrite }> = [];
  rows.forEach((row, rowIndex) => {
    for (const value of row.values) {
      if (!value.literalNumber) continue;
      out.push({
        where: `${op.anchor ?? ''} rows[${rowIndex}].${value.field}`,
        write: value.literalNumber
      });
    }
  });
  return out;
}

/**
 * The identity rule for a CLONE of any block range, in one place.
 *
 * A global binding keeps its name, so the copy joins the same document-wide
 * identity and shows its live value. Every other document-scoped binding inside
 * the range gets a fresh unique name, so the copy is an independent field.
 * Table-SCOPED bindings are skipped here: `rewriteBindingsInClone` re-scopes
 * those through the table id, and renaming them twice would break their
 * formulas.
 *
 * `containsPath` decides what "inside the range" means - a single table marker
 * for a table duplicate, any block in the range for a section copy - and
 * `freshName` decides how a copy is named, so a table duplicate can namespace
 * against its new table id while a section copy simply uniquifies the original.
 */
function cloneIdentityRewrite(
  index: BindingIndex,
  /**
   * The bindings being cloned. A table duplicate filters the document index by
   * path; a section copy reads them out of its cloned blocks, which carry no
   * document paths at all.
   */
  cloned: Iterable<{ name: string; tableId: string | null; isGlobal: boolean }>,
  freshName: (name: string, used: Set<string>) => string
): {
  renameDocBindings: Map<string, string>;
  preservedDocBindings: Set<string>;
} {
  const usedNames = new Set(
    index.occurrences.map((occurrence) => occurrence.name)
  );
  const renameDocBindings = new Map<string, string>();
  for (const binding of cloned) {
    if (binding.tableId) continue;
    if (binding.isGlobal) continue;
    if (!renameDocBindings.has(binding.name))
      renameDocBindings.set(binding.name, freshName(binding.name, usedNames));
  }
  const preservedDocBindings = new Set(
    [...index.fields.keys(), ...index.formulas.keys()].filter(
      (name) => !renameDocBindings.has(name)
    )
  );
  return { renameDocBindings, preservedDocBindings };
}

/**
 * Give a clone of document blocks its own binding identities before it is
 * pasted, using the same rule a bound table duplicate uses: a global binding
 * keeps its name so the copy joins that document-wide identity, every other
 * binding gets a fresh one, each bound table gets a fresh table id and fresh row
 * ids, and formulas are rewritten to follow.
 *
 * `copyRows: true` keeps the values the user can see: a copy of a line reading
 * 5% reads 5%, not the tag's `default`.
 */
function rewriteCloneIdentities(
  cloned: any[],
  sourceIndex: BindingIndex
): void {
  const { bindings, tableIds: clonedTableIds } = clonedBindingTags(cloned);
  if (!bindings.length && !clonedTableIds.size) return;
  const tableIds = new Map<string, string>();
  const rowIds = new Map<string, string>();
  const allocatedTableIds = new Set<string>();
  for (const oldTableId of clonedTableIds) {
    const newTableId = uniqueTableId(
      oldTableId,
      sourceIndex,
      allocatedTableIds
    );
    tableIds.set(oldTableId, newTableId);
    const entry = sourceIndex.tables.get(oldTableId);
    if (entry)
      for (const [oldRowId, newRowId] of freshRowIdsFor(entry, newTableId))
        rowIds.set(oldRowId, newRowId);
  }
  const { renameDocBindings, preservedDocBindings } = cloneIdentityRewrite(
    sourceIndex,
    bindings,
    (name, used) => uniqueBindingName(name, used)
  );
  rewriteBindingsInClone(cloned, {
    tableIds,
    rowIds,
    renameDocBindings,
    preservedDocBindings,
    copyRows: true
  });
}

/**
 * Every binding tag inside a cloned block tree, flattened to what the
 * identity rule needs. `tableId` is non-null only for a table-SCOPED binding,
 * which `rewriteBindingsInClone` re-scopes through the table map instead of
 * renaming - matching the document-index rule exactly.
 */
function clonedBindingTags(
  node: any,
  out: Array<{ name: string; tableId: string | null; isGlobal: boolean }> = [],
  tableIdsSeen: Set<string> = new Set(),
  insideTable: string | null = null
): {
  bindings: Array<{ name: string; tableId: string | null; isGlobal: boolean }>;
  tableIds: Set<string>;
} {
  if (Array.isArray(node)) {
    node.forEach((entry) =>
      clonedBindingTags(entry, out, tableIdsSeen, insideTable)
    );
    return { bindings: out, tableIds: tableIdsSeen };
  }
  if (!node || typeof node !== 'object')
    return { bindings: out, tableIds: tableIdsSeen };
  let scope = insideTable;
  const raw = node.contentControlProperties?.tag;
  if (typeof raw === 'string' && raw) {
    let def: Definition | null = null;
    try {
      def = parseTag(raw);
    } catch {
      def = null;
    }
    if (def?.kind === 'table') {
      tableIdsSeen.add(def.tableId);
      scope = def.tableId;
    } else if (def && (def.kind === 'field' || def.kind === 'formula')) {
      out.push({
        name: def.name,
        tableId: def.options.row ? scope : null,
        isGlobal: !!def.isGlobal
      });
    }
  }
  for (const value of Object.values(node))
    clonedBindingTags(value, out, tableIdsSeen, scope);
  return { bindings: out, tableIds: tableIdsSeen };
}

function boundDuplicateTablePlan(
  index: number,
  op: EditOp,
  block: FlatBlock,
  tableRoute: BindingTableRoute
): EngineMutationPlan {
  const copyRows = op.rows === undefined || op.rows === 'copy';
  const replacementRows = validateBoundDuplicateRows(op, tableRoute);
  const literalNumbers = duplicateRowLiteralNumbers(op, replacementRows);
  return {
    route: 'engine',
    index,
    op,
    anchor: block.anchor,
    ...(literalNumbers.length ? { literalNumbers } : {}),
    execute(state) {
      const liveTable = state.index.tables.get(tableRoute.tableId);
      if (!liveTable)
        throw new OpError(
          'bound_table_not_found',
          `No bound table "${tableRoute.tableId}" was found when applying duplicate_table. Nothing was written.`
        );
      assertDuplicateSourceHasNoForeignEdits(state.sfdt, tableRoute.anchor);
      const markerPath = liveTable.markerPath;
      const blocksPath = markerPath.slice(0, -1);
      const at = Number(markerPath[markerPath.length - 1]);
      const siblings = getAt(state.sfdt, blocksPath);
      if (!Array.isArray(siblings) || !Number.isInteger(at))
        throw new OpError(
          'duplicate_table_unroutable',
          `duplicate_table could not locate the table block for "${tableRoute.tableId}". Nothing was written.`
        );
      const markerBlock = getAt(state.sfdt, markerPath);
      const clone = clonedWithoutRevisions(
        state.sfdt,
        containerCarryingOnlyTable(
          markerBlock,
          getBlocks(markerBlock).find((candidate: any) => getRows(candidate))
        )
      );
      const newTableId = uniqueTableId(tableRoute.tableId, state.index);
      // One bound table in this clone, so a single-entry map. A section copy
      // builds the same map with one entry per bound table in its range.
      const tableIds = new Map([[tableRoute.tableId, newTableId]]);
      const { renameDocBindings, preservedDocBindings } = cloneIdentityRewrite(
        state.index,
        state.index.occurrences
          .filter((occurrence) => pathHasPrefix(markerPath, occurrence.path))
          .map((occurrence) => ({
            name: occurrence.name,
            tableId: occurrence.tableId,
            isGlobal: !!occurrence.def.isGlobal
          })),
        (name, used) => {
          const suffix = name.startsWith(`${tableRoute.tableId}_`)
            ? name.slice(tableRoute.tableId.length + 1)
            : name;
          return uniqueBindingName(`${newTableId}_${suffix}`, used);
        }
      );
      const rowIds = freshRowIdsFor(liveTable, newTableId);
      if (replacementRows) {
        const rawTable = firstTableBlockIn(clone);
        const sourceTable = firstTableBlockIn(getAt(state.sfdt, markerPath));
        const rows = getRows(rawTable);
        const sourceRows = getRows(sourceTable);
        const dataIndices = liveTable.rows
          .map((row) => (row.path ? Number(row.path[row.path.length - 1]) : -1))
          .filter((row) => row >= 0);
        const firstData = Math.min(...dataIndices);
        const lastData = Math.max(...dataIndices);
        if (!rows || !sourceRows || !Number.isFinite(firstData))
          throw new OpError(
            'duplicate_table_no_prototype_row',
            `duplicate_table could not find a bound prototype row in "${tableRoute.tableId}". Nothing was written.`
          );
        const prototype = sourceRows[firstData];
        const prototypeEntry = liveTable.rows.find(
          (row) =>
            row.path &&
            Number(row.path[row.path.length - 1]) === firstData &&
            row.rowId
        );
        if (!prototypeEntry?.rowId)
          throw new OpError(
            'duplicate_table_no_prototype_row',
            `duplicate_table could not identify the prototype row binding in "${tableRoute.tableId}". Nothing was written.`
          );
        const suppliedRowIds = replacementRows.map(
          (_row: unknown, rowIndex: number) => `${newTableId}_r${rowIndex + 1}`
        );
        rowIds.clear();
        const dataRows = suppliedRowIds.map((newRowId) => {
          const rowClone = clonedWithoutRevisions(state.sfdt, prototype);
          rewriteBindingsInClone(rowClone, {
            tableIds,
            rowIds: new Map([[prototypeEntry.rowId as string, newRowId]]),
            renameDocBindings,
            preservedDocBindings,
            copyRows: false
          });
          return rowClone;
        });
        rawTable.rows = [
          ...rows.slice(0, firstData),
          ...dataRows,
          ...rows.slice(lastData + 1)
        ];
      }
      rewriteBindingsInClone(clone, {
        tableIds,
        rowIds,
        renameDocBindings,
        preservedDocBindings,
        copyRows
      });
      let next = setAt(
        state.sfdt,
        blocksPath,
        spliceDuplicateAfter(state.sfdt, siblings, at, clone)
      );
      let nextIndex = scanBindings(next);
      const newTable = nextIndex.tables.get(newTableId);
      if (!newTable)
        throw new OpError(
          'duplicate_table_not_observable',
          `duplicate_table inserted a clone but the isolated table "${newTableId}" was not readable. Nothing was kept.`
        );
      next = materializeBoundRows(
        { sfdt: next, index: nextIndex },
        newTableId,
        replacementRows,
        newTable.rows
          .map((row) => row.rowId)
          .filter((row): row is string => !!row)
      );
      nextIndex = scanBindings(next);
      const verified = nextIndex.tables.get(newTableId);
      if (!verified)
        throw new OpError(
          'duplicate_table_not_observable',
          `duplicate_table materialized rows but the isolated table "${newTableId}" was no longer readable. Nothing was kept.`
        );
      const sourceColumns = [...liveTable.columnDefs.keys()];
      const cloneColumns = [...verified.columnDefs.keys()];
      if (JSON.stringify(sourceColumns) !== JSON.stringify(cloneColumns))
        throw new OpError(
          'duplicate_table_shape_mismatch',
          `duplicate_table cloned "${tableRoute.tableId}" as "${newTableId}", but its columns changed. Nothing was kept.`,
          [
            `source columns: ${sourceColumns.join(', ')}`,
            `clone columns: ${cloneColumns.join(', ')}`
          ]
        );
      if (replacementRows && verified.rows.length !== replacementRows.length)
        throw new OpError(
          'duplicate_table_row_count_mismatch',
          `duplicate_table expected ${replacementRows.length} materialized rows but found ${verified.rows.length}. Nothing was kept.`
        );
      return {
        sfdt: next,
        anchor: boundTableAnchor(next, verified) ?? tableRoute.anchor,
        details: [
          `source table: ${tableRoute.tableId}`,
          `new table: ${newTableId}`,
          `row ids: ${verified.rows.map((row) => row.rowId).join(', ')}`
        ]
      };
    }
  };
}

function planCreatedBoundRowWrite(
  index: number,
  op: EditOp,
  created: CreatedBoundRowTarget,
  runtime: BindingRuntime
): EngineMutationPlan {
  if (op.op !== 'set_cell_text')
    throw new OpError(
      'binding_write_unroutable',
      `${op.op} cannot target a bound row that is being created earlier in the same batch. Use set_cell_text for the new row input.`,
      [`anchor: ${op.anchor ?? ''}`]
    );
  const table = runtime.index.tables.get(created.plan.tableId);
  const column = columnIndexFromAnchor(op.anchor);
  const templateOccurrence =
    table && column != null
      ? fieldOccurrenceAtColumn(table, column)
      : undefined;
  if (!templateOccurrence)
    throw new OpError(
      'bound_column_not_found',
      `set_cell_text targets column ${
        column ?? '(unknown)'
      }, but no binding column was found in table "${
        created.plan.tableId
      }". Nothing was written.`
    );
  if (templateOccurrence.def.kind === 'formula')
    throw formulaRedirect(op, templateOccurrence);
  // The row does not exist yet, so there is no content for `expect` to describe -
  // and the pre-insert document holds a DIFFERENT row at this index. Refuse
  // rather than check the guard against that row or drop it silently.
  if (typeof op.expect === 'string' && op.expect !== '')
    throw new OpError(
      'expect_on_created_row',
      `set_cell_text sent \`expect\` ${JSON.stringify(
        op.expect
      )} for a bound row that edit ${
        created.plan.index + 1
      } is still creating, so there is nothing for it to match. Send this write without \`expect\`.`,
      [`anchor: ${op.anchor ?? ''}`]
    );
  const display = String(op.text ?? '');
  const literalNumber = guardBoundNumericReplacement(
    op,
    templateOccurrence,
    display
  );
  let canonical: string;
  try {
    canonical = parseDisplay(templateOccurrence.def.fieldType, display);
  } catch (err) {
    if (isValueError(err))
      throw bindingValueParseError(op, templateOccurrence, display, err);
    throw err;
  }
  return {
    route: 'engine',
    index,
    op,
    anchor: String(op.anchor ?? ''),
    ...(literalNumber
      ? {
          literalNumbers: [
            { where: String(op.anchor ?? ''), write: literalNumber }
          ]
        }
      : {}),
    execute(state) {
      const rowId = created.plan.createdRowIds[created.offset];
      if (!rowId)
        throw new OpError(
          'bound_created_row_lost',
          `set_cell_text could not find the row created by edit ${
            created.plan.index + 1
          }. Nothing was kept.`,
          [`anchor: ${op.anchor ?? ''}`]
        );
      const table = state.index.tables.get(created.plan.tableId);
      const row = table?.rows.find((entry) => entry.rowId === rowId);
      const occurrence = row?.bindings.get(templateOccurrence.name);
      if (!occurrence)
        throw new OpError(
          'bound_created_cell_lost',
          `set_cell_text could not find "${templateOccurrence.name}" in created row "${rowId}". Nothing was kept.`
        );
      return {
        sfdt: setOccurrenceText(
          state.sfdt,
          occurrence,
          renderDisplay(occurrence.def.fieldType, canonical)
        ),
        anchor: String(op.anchor ?? ''),
        details: [
          `table: ${created.plan.tableId}`,
          `row id: ${rowId}`,
          `field: ${templateOccurrence.name}`
        ]
      };
    }
  };
}

/**
 * The routing decision, taken in preflight before anything is written: an
 * engine plan when the op touches a binding, `null` when it does not and the
 * ordinary tracked-editor path should have it.
 *
 * Bound is decided by what the op TARGETS, not by the document: a bound tag on
 * the target block, a structural op on a bound table, or a write into a row an
 * earlier engine-routed `insert_row` in this same batch is about to create.
 * Everything else in a bound document still routes to the editor - which is why
 * a heading in a document full of bindings is still an ordinary tracked write.
 *
 * Three things it refuses rather than routes, because no path can honour them:
 * writing a formula (redirected to the inputs it is computed from), a write
 * that would land in a bound block's neighbour whose offsets cannot be trusted,
 * and an op with no binding-engine equivalent for a binding it does reach.
 */
function planBindingRoutedOp(
  editor: LiveEditor,
  sfdt: any,
  index: number,
  op: EditOp,
  target: FlatBlock | LiveStoryTarget | undefined,
  createdRows: Map<string, CreatedBoundRowTarget>
): EngineMutationPlan | null {
  if (target && isLiveStoryTarget(target)) return null;
  // A write into a row an earlier engine-routed insert_row is about to create is
  // routed FIRST, before the missing-target guards below. Its anchor names a row
  // that does not exist yet, so the preflight deliberately hands it over with no
  // resolved target (`deferredNewCell`); requiring one here left this route
  // unreachable and sent "append a bound line item, then fill it" down the native
  // editor path, which would write into whichever row happened to hold that index
  // before the insert.
  const createdKey = String(op.anchor ?? '')
    .split(';')
    .slice(0, 3)
    .join(';');
  const created = createdRows.get(createdKey);
  if (created) {
    const runtime = requireBindingRuntime(editor, sfdt, op, target);
    return planCreatedBoundRowWrite(index, op, created, runtime);
  }
  if (!target) return null;
  if (op.op === 'duplicate_table') {
    const runtime = bindingRuntime(editor, sfdt);
    const tableAnchor = tableAnchorForBlock(target);
    const tableRoute = tableAnchor
      ? runtime?.tablesByAnchor.get(tableAnchor)
      : undefined;
    return tableRoute
      ? boundDuplicateTablePlan(index, op, target, tableRoute)
      : null;
  }
  // A paragraph can mix an inline binding with ordinary prose. Exact scoped
  // text outside every binding remains an editor write; Syncfusion Search owns
  // its live range and accounts for the control boundary markers precisely.
  if (
    target.boundTag &&
    BOUND_WRITE_OPS.has(op.op) &&
    !targetsBindingRange(op, target)
  )
    return null;
  const tableStructuralOp =
    target.kind === 'table_cell' &&
    ['insert_row', 'delete_row', 'delete_table'].includes(op.op);
  let maybeRuntime: BindingRuntime | null = null;
  if (target.boundTag) {
    maybeRuntime = requireBindingRuntime(editor, sfdt, op, target);
  } else if (tableStructuralOp) {
    maybeRuntime = bindingRuntime(editor, sfdt);
    if (!maybeRuntime && target.offsetsUntrusted)
      maybeRuntime = requireBindingRuntime(editor, sfdt, op, target);
  }
  const tableRoute = maybeRuntime
    ? boundTableForBlock(maybeRuntime, target)
    : undefined;
  if (tableRoute) {
    if (op.op === 'insert_row') {
      const plan = boundInsertRowsPlan(index, op, target, tableRoute);
      for (let offset = 0; offset < positiveCount(op.count); offset++)
        createdRows.set(
          `${tableRoute.anchor};${plan.firstVisualRow + offset}`,
          { plan, offset }
        );
      return plan;
    }
    if (op.op === 'delete_row')
      return boundDeleteRowsPlan(index, op, target, tableRoute);
    if (op.op === 'delete_table')
      return boundDeleteTablePlan(index, op, target, tableRoute);
  }
  if (target.offsetsUntrusted && !target.boundTag && BOUND_WRITE_OPS.has(op.op))
    throw retryableBoundNeighborRefusal(op, target);
  if (!target.boundTag) return null;
  const runtime =
    maybeRuntime ?? requireBindingRuntime(editor, sfdt, op, target);
  const occurrence = occurrenceForBlock(runtime, target, op);
  if (!occurrence) return null;
  if (occurrence.def.kind === 'formula' && BOUND_WRITE_OPS.has(op.op))
    throw formulaRedirect(op, occurrence);
  if (occurrence.def.kind === 'field' && BOUND_TEXT_WRITE_OPS.has(op.op))
    return boundInputTextPlan(index, op, target, occurrence, runtime);
  if (BOUND_WRITE_OPS.has(op.op))
    throw new OpError(
      'binding_write_unroutable',
      `${op.op} cannot be routed through binding "${occurrence.name}". Change an editable input field with set_cell_text or replace_text instead.`,
      [`binding: ${occurrence.tag}`]
    );
  return null;
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

function reusedUserStatedFigureRefusal(
  first: { where: string; text: string },
  where: string
): OpError {
  return new OpError(
    'user_stated_figure_reused',
    `The user-stated figure ${JSON.stringify(
      first.text
    )} already licenses cell "${
      first.where
    }" and cannot also license cell "${where}" in the same change set. ` +
      `If "${where}" depends on the first cell, derive it with set_cell_formula. Otherwise ask the user which cell the figure belongs in. Nothing was written.`,
    [`first literal cell: ${first.where}`, `reused literal cell: ${where}`],
    'never'
  );
}

/**
 * The same one-cell licence, judged BEFORE the engine transaction runs.
 *
 * The post-hoc pass above can afford to fail an editor result and let rollback
 * reject that group's native revisions. The engine transaction authors and opens
 * its complete grouped SFDT change set atomically, so a post-hoc refusal would
 * still report failure over a write that landed. Engine plans therefore declare
 * their figures up front and are checked here, against each other and against
 * whatever the editor phase already spent, while the transaction can still be
 * skipped entirely.
 */
function findReusedUserStatedFigureInPlans(
  results: Array<EditResult | undefined>,
  enginePlans: EngineMutationPlan[]
): { plan: EngineMutationPlan; error: OpError } | null {
  const firstUse = new Map<string, { where: string; text: string }>();
  const remember = (
    where: string,
    write: LiteralNumberWrite
  ): string | null => {
    if (write.source !== 'user_stated') return null;
    const key = userStatedFigureKey(write);
    if (!key) return null;
    const first = firstUse.get(key);
    if (!first) {
      firstUse.set(key, { where, text: write.rendered?.asSent ?? write.text });
      return null;
    }
    return first.where === where ? null : key;
  };
  for (const result of results) {
    if (!result?.ok || !result.literalNumber) continue;
    remember(result.anchor ?? '(unknown cell)', result.literalNumber);
  }
  for (const plan of enginePlans) {
    for (const { where, write } of plan.literalNumbers ?? []) {
      const logicalWhere = plan.bindingWrite?.identity.global
        ? `global binding ${plan.bindingWrite.identity.id}`
        : where;
      const collided = remember(logicalWhere, write);
      if (!collided) continue;
      return {
        plan,
        error: reusedUserStatedFigureRefusal(
          firstUse.get(collided) as { where: string; text: string },
          logicalWhere
        )
      };
    }
  }
  return null;
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

// Preflight is read-only, but one text op may intentionally make the `expect`
// of a later op true. Model only transformations that preserve this anchor's
// topology; paragraph/table creators keep their existing deferred-anchor path.
// Write-time guards still re-check the real editor after every prior op.
function simulateStableTextOp(
  op: EditOp,
  block: FlatBlock
): string | undefined {
  switch (op.op) {
    case 'replace_text': {
      const replacement = op.replace ?? op.text ?? op.newText;
      if (replacement == null || /[\r\n]/.test(String(replacement)))
        return undefined;
      const find = op.find != null ? String(op.find) : '';
      if (!find) return String(replacement);
      const index = block.text.indexOf(find);
      return index < 0
        ? undefined
        : block.text.slice(0, index) +
            String(replacement) +
            block.text.slice(index + find.length);
    }
    case 'delete_text': {
      const find = String(op.find ?? '');
      const index = find ? block.text.indexOf(find) : -1;
      return index < 0
        ? undefined
        : block.text.slice(0, index) + block.text.slice(index + find.length);
    }
    case 'set_cell_text': {
      const replacement = String(op.text ?? '');
      return /[\r\n]/.test(replacement) ? undefined : replacement;
    }
    case 'change_case':
      return changeCase(block.text, String(op.caseType ?? ''));
    case 'insert_text': {
      const typed = op as TypedEditOp<'insert_text'>;
      const inserted = insertionText(typed);
      if (/[\r\n]/.test(inserted)) return undefined;
      const offset = insertionPoint(typed, block);
      return block.text.slice(0, offset) + inserted + block.text.slice(offset);
    }
    case 'replace_selection': {
      const replacement = String(op.replace ?? op.text ?? op.newText ?? '');
      if (/[\r\n]/.test(replacement)) return undefined;
      const start = offsetParts(offsetString(op.startOffset));
      const end = offsetParts(offsetString(op.endOffset));
      if (
        start.anchor !== block.anchor ||
        end.anchor !== block.anchor ||
        start.offset < 0 ||
        end.offset > block.length ||
        start.offset >= end.offset
      )
        return undefined;
      return (
        block.text.slice(0, start.offset) +
        replacement +
        block.text.slice(end.offset)
      );
    }
    default:
      return undefined;
  }
}

function withSimulatedText(
  blocks: FlatBlock[],
  simulatedTextByAnchor: Map<string, string>
): FlatBlock[] {
  return blocks.map((block) => {
    const text = simulatedTextByAnchor.get(block.anchor);
    return text === undefined || text === block.text
      ? block
      : { ...block, text, length: text.length };
  });
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
  // Ambiguity is a hazard for a WRITE, which must land on one intended block.
  // A format DONOR is read-only, so several candidates that are formatted
  // identically are not a guess at all - every one of them copies the same
  // thing. Insisting on a unique text match refused legitimate work outright:
  // sibling headings in a real document repeat by design ("Drivers" once per
  // programme), and a composed unit that shifts its own donor forward would
  // otherwise be refused for having a well-formed family. Candidates that
  // differ in format are still a genuine choice, and still refused.
  if (preferEquivalentDirect) {
    const look = (block: FlatBlock) =>
      JSON.stringify([
        block.format ?? {},
        block.characterFormat ?? {},
        block.paragraphFormat ?? {}
      ]);
    const baselineLook = look(baseline);
    const identical = matches.filter((block) => look(block) === baselineLook);
    if (identical.length && identical.length === matches.length)
      return identical[0];
  }
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

// ---------------------------------------------------------------------------
// Creation appearance
//
// The ONE answer to "what should this newly created content look like, given
// this document?". Every path that brings content into existence asks this -
// the section composer, insert_table, insert_row, and the insert_text +
// apply_style + insert_table sequence a model hand-rolls when it prefers
// primitives. Before this existed each answered separately, so each could be
// wrong in its own way, and on 2026-08-06 each of them was: a subsection
// dressed as a top-level section, a composed table wearing Word's defaults
// inside a styled document, and a new row coming back as a second header.
//
// Two rules run through everything below, and they are easy to conflate:
//
//   * a FLAG is a document fact and is COPIED. `isHeader` is the example: a
//     document may shade a row to look like a header without ever setting
//     Word's flag, so inferring the flag from appearance invents a property
//     the document never had. Copy it from a row that has it, or answer no.
//   * a BAND, a BANDING CYCLE and a HEADING LEVEL are DERIVED. They are
//     questions about shape - which rows are the header band, what stripe do
//     the data rows cycle through, how deep does this unit sit - and the
//     document answers them by exhibiting them, not by declaring them.
//
// Read that distinction before changing anything here. It has been broken once
// already by deriving `isHeader` from the header band, which looked equivalent
// and quietly flagged unflagged headers on every copy.
// ---------------------------------------------------------------------------

/** How far the search had to widen before the document could answer. */
type CreationScope = 'family' | 'document';

/** What answered, so a caller (and a reader of the result) can see it. */
interface CreationEvidence {
  /** The block whose sibling family answered, when a family did. */
  familyAnchor?: string;
  /** That family's outline level and how many siblings it was derived from. */
  level?: number;
  siblings: number;
  scope: CreationScope;
}

/**
 * Resolved carries a donor; unresolved carries WHY and where it looked.
 *
 * There is deliberately no third state and no default value. A caller cannot
 * accidentally treat "I found nothing" as "I inherited correctly", because the
 * two are different shapes and the compiler makes it say which it has - that
 * confusion is the defect this whole module exists to remove.
 */
type Resolution<T> =
  | { resolved: true; value: T; from: string; evidence: CreationEvidence }
  | { resolved: false; reason: string; searched: string[] };

/** The look a row brought into existence must end up with. */
interface CreatedRowAppearance {
  /** COPIED from the donor row's flag. No donor means not a header. */
  isHeader: boolean;
  /** The table the cell appearance and typography come from. */
  donorTable: string;
  donorAppearance: TableAppearance;
  /** Which row of that table. */
  donorRow: number;
}

interface CreatedTableAppearance {
  anchor: string;
  appearance: TableAppearance;
  /** DERIVED: the stripe the new table's data rows should cycle through. */
  banding: TableBanding | null;
}

interface CreationAppearanceResolver {
  /**
   * The sibling family a unit joining at `at` belongs to, and the donor for
   * one of its roles. `level` selects a subsection depth when the role is a
   * subsection heading.
   */
  role(
    family: SectionFamilyEvidence | undefined,
    role: Exclude<SectionBlockRole, 'table' | 'table_header' | 'table_body'>,
    options: { at: string; level?: number }
  ): Resolution<FlatBlock>;
  /** The table a new table copies, searched family-first then document-wide. */
  table(options: {
    at: string;
    ordinal?: number;
    family?: SectionFamilyEvidence;
    anchorNamesMember?: boolean;
    exclude?: string;
    explicit?: FlatBlock;
  }): Resolution<CreatedTableAppearance>;
  /** What a row created at `targetRow` of `tableAnchor` must look like. */
  row(options: {
    tableAnchor: string;
    source: TableAppearance;
    targetRow: number;
    /**
     * A row's RENDERED text format, resolved through the table style. Supplied
     * by callers holding a live editor; without it the band is derived only
     * from what the SFDT states outright, which is not always enough - see the
     * header-band derivation in `row`.
     */
    rendered?: (tableAnchor: string, row: number) => FormatBag | undefined;
  }): Resolution<CreatedRowAppearance>;
}

const unresolved = (reason: string, searched: string[]): Resolution<never> => ({
  resolved: false,
  reason,
  searched
});

function familyEvidenceReport(
  family: SectionFamilyEvidence | undefined,
  familyAnchor: string | undefined,
  scope: CreationScope
): CreationEvidence {
  return {
    ...(familyAnchor ? { familyAnchor } : {}),
    ...(family ? { level: family.level } : {}),
    siblings: family?.units.length ?? 0,
    scope
  };
}

// ---------------------------------------------------------------------------
// Header-ness: one owner, because the document expresses it three ways
//
// This derivation began inside the creation resolver's `row` query, which is
// where the first caller who needed it happened to be. It does not belong to
// creation: "how many leading rows of THIS EXISTING table are its header band"
// is a question about the document, and other callers need the same answer for
// reasons that have nothing to do with creating content - `split_table` refuses
// to EXTRACT a header row, because a split reproduces the header band in both
// tables rather than moving it.
//
// Lifting it here rather than reading header-ness a second way is the whole
// point: header-ness has already caused two defects on this project by being
// read through one encoding, and a second reader would be a third.
// ---------------------------------------------------------------------------

/** Every table anchor except `exclude`, nearest to `from` first. Pure. */
function tableAnchorsNearest(
  blocks: FlatBlock[],
  from: string,
  exclude?: string
): string[] {
  const at = blocks.findIndex(
    (block) => block.anchor === from || from.startsWith(`${block.anchor};`)
  );
  const seen = new Set<string>();
  const found: Array<{ anchor: string; distance: number }> = [];
  blocks.forEach((block, index) => {
    const anchor = tableAnchorForBlock(block);
    if (!anchor || anchor === exclude || seen.has(anchor)) return;
    seen.add(anchor);
    found.push({ anchor, distance: at < 0 ? index : Math.abs(index - at) });
  });
  return found
    .sort((left, right) => left.distance - right.distance)
    .map((entry) => entry.anchor);
}

/**
 * The nearest row elsewhere in the document that is a data row by STRUCTURE:
 * the last row of a table that has more than one.
 *
 * Deliberately not "the first row below inferHeaderRows". That would derive the
 * baseline with the very inference the baseline exists to check, so a document
 * whose headers are undeclared everywhere - which is this one - hands back
 * another undeclared header and every comparison against it says "no
 * difference". Headers lead a table; the last row of a multi-row table is below
 * any of them, whatever encoding declared them.
 */
function provenDocumentDataRow(
  blocks: FlatBlock[],
  sfdt: any,
  exclude: string
): { anchor: string; appearance: TableAppearance; row: number } | undefined {
  for (const anchor of tableAnchorsNearest(blocks, exclude, exclude)) {
    const appearance = collectTableAppearance(tableBlockAt(sfdt, anchor));
    if (!appearance || appearance.rows.length < 2) continue;
    const row = appearance.rows.length - 1;
    if (row < inferHeaderRows(appearance)) continue;
    return { anchor, appearance, row };
  }
  return undefined;
}

/** A row's rendered character format, resolved through the table style. */
type RenderedRowFormat = (
  tableAnchor: string,
  row: number
) => FormatBag | undefined;

/**
 * The rendered read that makes a style-only header visible at all: it resolves
 * through the table style exactly as the page does, which is the only encoding
 * of header-ness that states nothing on the row or its cells.
 */
function renderedRowFormatReader(
  editor: LiveEditor,
  byAnchor: Map<string, FlatBlock>
): RenderedRowFormat {
  return (tableAnchor, row) => {
    const cell = byAnchor.get(`${tableAnchor};${row};0;0`);
    return cell
      ? readEffectiveSourceFormat(editor, cell).characterFormat
      : undefined;
  };
}

/**
 * How many leading rows of a table are its header band, AS THE PAGE SHOWS IT.
 *
 * HEADER-NESS HAS AT LEAST THREE EXPRESSIONS, and reading only some of them has
 * now caused two separate defects on this project:
 *   1. Word's `isHeader` FLAG - the only one that is a declaration, and so the
 *      only one that may be COPIED onto a row being created;
 *   2. a distinct cell FILL, which `inferHeaderRows` infers by contrast with
 *      the rows below it;
 *   3. the TABLE STYLE's first-row conditional formatting, which states nothing
 *      on the row or its cells at all - the SFDT is empty and the page is navy
 *      and bold.
 *
 * (3) is invisible to the other two, and a table stripped to its header row
 * cannot even use (2), because contrast needs a second row. So the engine read
 * "no header rows", concluded the header WAS a data row, and dressed a newly
 * added row as a second header.
 *
 * The document answers what its own encoding does not: compare the row AS
 * RENDERED against a data row proven elsewhere in the document. A false positive
 * is the safe direction for a creation caller - it widens to that proven data
 * row, which is the right look either way - and for a refusal caller it declines
 * an extraction rather than tearing a header out of a table.
 *
 * `rendered` is injected rather than taken from an editor so this stays usable
 * from the editor-free resolver; without it only what the SFDT states outright
 * is read, which is not always enough.
 */
function effectiveHeaderRows(options: {
  blocks: FlatBlock[];
  sfdt: any;
  tableAnchor: string;
  source: TableAppearance;
  rendered?: RenderedRowFormat;
}): number {
  const stated = inferHeaderRows(options.source);
  if (stated > 0 || !options.rendered || !options.source.rows.length)
    return stated;
  const proven = provenDocumentDataRow(
    options.blocks,
    options.sfdt,
    options.tableAnchor
  );
  if (!proven) return stated;
  const own = options.rendered(options.tableAnchor, 0);
  const baseline = options.rendered(proven.anchor, proven.row);
  return own && baseline && JSON.stringify(own) !== JSON.stringify(baseline)
    ? 1
    : stated;
}

/**
 * Build the resolver for one document snapshot. Every creation path in a change
 * set shares one of these, so they cannot disagree about what the document
 * looks like partway through.
 */
function creationAppearance(
  blocks: FlatBlock[],
  sfdt: any,
  byAnchor: Map<string, FlatBlock>
): CreationAppearanceResolver {
  const firstCellOf = (tableAnchor: string | undefined) =>
    tableAnchor ? byAnchor.get(`${tableAnchor};0;0;0`) : undefined;
  const appearanceOf = (anchor: string) =>
    collectTableAppearance(tableBlockAt(sfdt, anchor)) ?? undefined;

  const tableAnchorsByDistance = (from: string, exclude?: string) =>
    tableAnchorsNearest(blocks, from, exclude);

  /**
   * A stripe proven by another table in the same sibling family. Consulted only
   * when the donor itself is too short to prove one, and only ever the FAMILY's
   * evidence - never a table outside it.
   */
  const familyBandingFor = (
    family: SectionFamilyEvidence | undefined,
    donorAnchor: string
  ): TableBanding | null | undefined => {
    if (!family) return undefined;
    const donor = appearanceOf(donorAnchor);
    if (donor && donor.rows.length - inferHeaderRows(donor) >= 2)
      return undefined;
    for (const unit of family.units)
      for (const anchor of tableAnchorsForUnit(unit)) {
        if (anchor === donorAnchor) continue;
        const appearance = appearanceOf(anchor);
        const banding = appearance ? detectTableBanding(appearance) : null;
        if (banding) return banding;
      }
    return undefined;
  };

  return {
    role(family, role, options) {
      const searched: string[] = [];
      searched.push(`sibling family (${family?.units.length ?? 0} sections)`);
      const donor = composerRoleSource(family, role, options.level);
      if (donor)
        return {
          resolved: true,
          value: donor,
          from: donor.anchor,
          evidence: familyEvidenceReport(family, options.at, 'family')
        };
      // Widen to the document: a family of one that has never carried this
      // role yet still sits in a document that shows it elsewhere.
      searched.push('every heading in the document at that level');
      const level = options.level ?? family?.level;
      const wider = blocks.filter(
        (block) =>
          block.isHeading &&
          !!block.text.replace(/\f/g, '').trim() &&
          (level === undefined || block.level === level)
      );
      const chosen = modal(wider.map(roleFormat));
      const key = chosen ? JSON.stringify(chosen.value) : undefined;
      const widened = key
        ? wider.find((block) => JSON.stringify(roleFormat(block)) === key)
        : undefined;
      if (widened)
        return {
          resolved: true,
          value: widened,
          from: widened.anchor,
          evidence: familyEvidenceReport(family, options.at, 'document')
        };
      return unresolved('the document contains no comparable block', searched);
    },

    table(options) {
      const searched: string[] = [];
      const ordinal = options.ordinal ?? 0;
      const answer = (
        anchor: string,
        scope: CreationScope
      ): Resolution<CreatedTableAppearance> => {
        const appearance = appearanceOf(anchor);
        if (!appearance)
          return unresolved('the donor table could not be read', searched);
        // DERIVED, never copied. In order: the donor's own proven stripe; then
        // the FAMILY's, when the donor is too short to have one; then a uniform
        // body taken as the sibling's statement; then the document's sample.
        //
        // The family step is the one that was missing. A donor with a single
        // data row is trivially "uniform" with itself, which read as a positive
        // statement that this family's tables are unbanded - so a two-row
        // sibling silently outvoted a nineteen-row table in the SAME family
        // that exhibits the stripe unambiguously, and every table composed from
        // it came out with the header fill and no banding. One row is absence
        // of evidence, not evidence of absence. It still outranks an unrelated
        // table elsewhere in the document, which is why that fallback stays
        // below it: a lone white row beside you is better evidence about YOUR
        // look than a striped table you have nothing to do with.
        const banding =
          detectTableBanding(appearance) ??
          familyBandingFor(options.family, anchor) ??
          (uniformDataRowShading(appearance) !== undefined
            ? null
            : documentTableBanding(sfdt, options.exclude ?? anchor));
        return {
          resolved: true,
          value: { anchor, appearance, banding },
          from: anchor,
          evidence: familyEvidenceReport(options.family, options.at, scope)
        };
      };

      if (options.explicit?.kind === 'table_cell') {
        searched.push('the donor the caller named');
        const anchor = tableAnchorFromCellAnchor(options.explicit.anchor);
        if (anchor) return answer(anchor, 'family');
      }
      // A table AT the anchor is the strongest local statement there is.
      searched.push('the table at the anchor');
      const at = options.at.split(';');
      if (at.length >= 5) {
        const anchor = `${at[0]};${at[1]}`;
        if (appearanceOf(anchor)) return answer(anchor, 'family');
      }
      const units = options.family?.units ?? [];
      if (units.length) {
        searched.push(`the sibling family's tables (${units.length} sections)`);
        const nearest =
          nearestUnitIndex(
            blocks,
            units,
            options.at,
            options.anchorNamesMember
          ) ?? 0;
        const ranked = units
          .map((unit, index) => ({ unit, index }))
          .sort(
            (left, right) =>
              Math.abs(left.index - nearest) -
                Math.abs(right.index - nearest) || left.index - right.index
          );
        for (const { unit } of ranked) {
          const anchor = tableAnchorsForUnit(unit)[ordinal];
          if (anchor && anchor !== options.exclude && firstCellOf(anchor))
            return answer(anchor, 'family');
        }
        for (const { unit } of ranked)
          for (const anchor of tableAnchorsForUnit(unit))
            if (anchor !== options.exclude && firstCellOf(anchor))
              return answer(anchor, 'family');
      }
      searched.push('every table in the document, nearest first');
      const nearestTable = tableAnchorsByDistance(
        options.at,
        options.exclude
      )[0];
      if (nearestTable) return answer(nearestTable, 'document');
      return unresolved('the document contains no table to copy', searched);
    },

    row(options) {
      const searched: string[] = [];
      const { source, targetRow } = options;
      // DERIVED: which rows are the header band. Read through the one owner of
      // that question - see effectiveHeaderRows for why reading it a second way
      // here would be the third encoding-specific reader this file has had.
      const headerRows = effectiveHeaderRows({
        blocks,
        sfdt,
        tableAnchor: options.tableAnchor,
        source,
        ...(options.rendered ? { rendered: options.rendered } : {})
      });
      const documentRow = provenDocumentDataRow(
        blocks,
        sfdt,
        options.tableAnchor
      );
      const lastRow = source.rows.length - 1;
      const displaced = Math.min(targetRow, lastRow);
      const inBand = headerBandContains(source, targetRow, headerRows);
      searched.push(`the table's own rows (header band ${headerRows})`);
      const own = inBand
        ? displaced
        : displaced >= headerRows
        ? displaced
        : undefined;
      if (own !== undefined && source.rows[own])
        return {
          resolved: true,
          // COPIED: the flag, from the row this one takes its look from.
          value: {
            isHeader: copiedRowIsHeader(source, own),
            donorTable: options.tableAnchor,
            donorAppearance: source,
            donorRow: own
          },
          from: `${options.tableAnchor};${own}`,
          evidence: { siblings: 0, scope: 'family' }
        };
      // No data row of its own: the table was emptied down to its header. The
      // document still shows what a data row looks like.
      searched.push(
        'every table in the document with a data row, nearest first'
      );
      if (documentRow)
        return {
          resolved: true,
          value: {
            isHeader: copiedRowIsHeader(
              documentRow.appearance,
              documentRow.row
            ),
            donorTable: documentRow.anchor,
            donorAppearance: documentRow.appearance,
            donorRow: documentRow.row
          },
          from: `${documentRow.anchor};${documentRow.row}`,
          evidence: { siblings: 0, scope: 'document' }
        };
      return unresolved('the document contains no data row to copy', searched);
    }
  };
}

/** One block map per plan, so the resolver and the planner see one document. */
function byAnchorOf(blocks: FlatBlock[]): Map<string, FlatBlock> {
  return new Map(blocks.map((block) => [block.anchor, block] as const));
}

/** The record a creation path leaves when the document could not answer. */
function creationGap(
  what: string,
  outcome: { reason: string; searched: string[] }
): CreationGap {
  return { what, reason: outcome.reason, searched: outcome.searched };
}

/**
 * The role the paragraph being styled plays in its family, and the subsection
 * depth to look for when that role is a subsection heading.
 *
 * The composer picks a donor PER ROLE - `insert_section` uses
 * `'section_heading'` for the title, `'subsection_heading'` for a heading and
 * `'intro_paragraph'` / `'subsection_paragraph'` for body text - so a section
 * hand-built out of `insert_text` + `apply_style` only comes out looking
 * composed if the role is derived from the same two facts the composer uses:
 * whether what is being written is a HEADING, and WHERE in the family it sits.
 * Asking for one hardcoded role gave every created paragraph the family's
 * heading donor, so `apply_style { styleName: 'Normal' }` came back as the
 * family's heading banner.
 *
 * Whether the requested style is a heading style is read off the DOCUMENT
 * rather than off a name pattern: it is a heading style here if the paragraphs
 * already wearing it are headings. That is what makes the rule hold for the
 * live document's `headingNoToc` and for any custom name nobody has thought
 * of; a style no paragraph wears yet falls back to the same name test the
 * reference resolver already uses.
 */
function composedParagraphRole(
  blocks: FlatBlock[],
  familyAnchor: string,
  target: FlatBlock,
  styleName: string
): {
  role: Exclude<SectionBlockRole, 'table' | 'table_header' | 'table_body'>;
  level?: number;
} {
  const wearers = blocks.filter(
    (block) =>
      block.anchor !== target.anchor &&
      !tableAnchorForBlock(block) &&
      (block.format?.styleName ?? '').trim() === styleName
  );
  const headingWearers = wearers.filter(isHeadingLikeBlock);
  const isHeading = wearers.length
    ? headingWearers.length * 2 >= wearers.length
    : HEADING_LIKE_STYLE.test(styleName);

  const familyIndex = blocks.findIndex(
    (block) => block.anchor === familyAnchor
  );
  const targetIndex = blocks.findIndex(
    (block) => block.anchor === target.anchor
  );
  if (isHeading) {
    // The family's own first block is its section heading; anything else
    // wearing a heading style inside it is a subsection heading, at whatever
    // depth the document already gives that style.
    if (targetIndex === familyIndex || targetIndex < 0)
      return { role: 'section_heading' };
    const level = headingWearers.find(
      (block) => Number.isFinite(block.level) && block.isHeading
    )?.level;
    return {
      role: 'subsection_heading',
      ...(level !== undefined ? { level } : {})
    };
  }
  // Body text is intro text until a subsection heading has opened inside the
  // family, exactly as roleBlocksForUnit classifies the blocks that are
  // already there.
  const opened =
    familyIndex >= 0 &&
    targetIndex > familyIndex &&
    blocks
      .slice(familyIndex + 1, targetIndex)
      .some(
        (block) => !tableAnchorForBlock(block) && isHeadingLikeBlock(block)
      );
  return { role: opened ? 'subsection_paragraph' : 'intro_paragraph' };
}

/**
 * The donor a paragraph created by this change set should wear, and whether
 * that disagrees with the style the model asked for.
 *
 * The family is resolved from the paragraph's POSITION with no declared
 * subsections to bound it, so the deepest family adjacent to that position
 * wins - the same rule insert_section applies, which is the point: a section
 * hand-built out of insert_text + apply_style must come out looking like a
 * section composed by the single op.
 *
 * `requestedStyleName` is the style THIS OP asked for. Reading the block's
 * current style instead made the disagreement report compare the resolver's
 * answer against the style the paragraph already had, which is the style the
 * resolver is about to replace - so the one mechanism that exists to say "you
 * asked for X and composition gave you Y" agreed with itself and stayed
 * silent on every override it made.
 */
function composedParagraphDonor(
  blocks: FlatBlock[],
  byAnchor: Map<string, FlatBlock>,
  target: FlatBlock,
  requestedStyleName?: string
): { donor?: FlatBlock; disagreement?: ComposedStyleDisagreement } | undefined {
  const familyAnchor =
    joinedSectionFamilyAnchor(blocks, target, 'before', {
      title: '',
      blocks: []
    }) ?? target.anchor;
  const family = deriveSectionFamilyEvidence(blocks, familyAnchor, true);
  // An op that names no style is asking for the one the paragraph already
  // wears, so the role it plays is the same question either way.
  const requested = (
    requestedStyleName ??
    target.format?.styleName ??
    ''
  ).trim();
  const { role, level } = composedParagraphRole(
    blocks,
    familyAnchor,
    target,
    requested
  );
  // `role` reads only the flattened blocks; the SFDT is what the table and
  // row queries need, and serializing one per format op would cost a whole
  // document pass for an answer that does not use it.
  const outcome = creationAppearance(blocks, undefined, byAnchor).role(
    family,
    role,
    { at: familyAnchor, ...(level !== undefined ? { level } : {}) }
  );
  if (!outcome.resolved) return undefined;
  const donor = outcome.value;
  if (donor.anchor === target.anchor) return undefined;
  const resolved = donor.format?.styleName;
  return {
    donor,
    ...(requested && resolved && requested !== resolved
      ? { disagreement: { requested, resolved, from: donor.anchor } }
      : {})
  };
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
  // The family at the insertion point, derived here rather than handed down,
  // so a table inserted by the composer and one inserted by a model driving
  // the primitive reach the same answer - including the family's stripe when
  // the nearest table is too short to show one.
  const family = deriveSectionFamilyEvidence(blocks, String(op.anchor ?? ''));
  const resolved = creationAppearance(blocks, sfdt, byAnchorOf(blocks)).table({
    at: String(op.anchor ?? ''),
    exclude: targetTableAnchor,
    ...(family ? { family } : {}),
    ...(explicitSource ? { explicit: explicitSource } : {})
  });
  // Unresolved means the document contains no table at all, so there is
  // nothing this one could have been made to look like. Reported, not
  // defaulted: see PlannedInsertInheritance.unresolved.
  if (!resolved.resolved)
    return [
      { anchor: targetTableAnchor, unresolved: creationGap('table', resolved) }
    ];
  const sourceTable = resolved.value;
  const rows = positiveCount(op.rows);
  const columns = positiveCount(op.columns);
  const targetRows = Array.from({ length: rows }, (_, index) => index);
  const banding = sourceTable.banding;
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
  const byAnchor = byAnchorOf(blocks);
  const resolver = creationAppearance(blocks, sfdt, byAnchor);
  const rendered = renderedRowFormatReader(editor, byAnchor);
  const resolutions = targetRows.map((targetRow) =>
    resolver.row({ tableAnchor, source, targetRow, rendered })
  );
  const gap = resolutions.find((entry) => !entry.resolved);
  if (gap && !gap.resolved)
    return [{ anchor: tableAnchor, unresolved: creationGap('row', gap) }];
  const resolved = resolutions.flatMap((entry) =>
    entry.resolved ? [entry.value] : []
  );
  const columns = Math.max(...source.rows.map((entry) => entry.cells.length));
  // Rows this table dresses itself, and rows it needed the document for.
  const inTable = targetRows.filter(
    (_row, index) => resolved[index].donorTable === tableAnchor
  );
  const orphaned = targetRows.filter(
    (_row, index) => resolved[index].donorTable !== tableAnchor
  );
  const donor = orphaned.length
    ? resolved.find((entry) => entry.donorTable !== tableAnchor)
    : undefined;
  const formats = [
    ...(inTable.length
      ? planTableCellFormats(
          editor,
          blocks,
          tableAnchor,
          source,
          tableAnchor,
          inTable,
          columns,
          {
            sourceRows: resolved
              .filter((entry) => entry.donorTable === tableAnchor)
              .map((entry) => entry.donorRow),
            headerRows: inferHeaderRows(source)
          }
        )
      : []),
    ...(donor
      ? planTableCellFormats(
          editor,
          blocks,
          donor.donorTable,
          donor.donorAppearance,
          tableAnchor,
          orphaned,
          columns,
          { sourceRows: orphaned.map(() => donor.donorRow) }
        )
      : [])
  ];
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
  const fallbackShadings = banding
    ? undefined
    : targetRows.flatMap((targetRow, index) => {
        const entry = resolved[index];
        const shading = rowShadings(entry.donorAppearance)[entry.donorRow];
        return shading === undefined ? [] : [{ row: targetRow, shading }];
      });
  // Header-ness travels with the row the insert takes its appearance from -
  // the same `sourceRows` mapping, so there is one answer per inserted row and
  // never two rules about what a header row is. Anchoring the insert on the
  // header therefore adds a DATA row below it, which is the only structurally
  // sound reading of "add one more row here".
  // COPIED from the donor row's flag by the resolver, never inferred here.
  const rowHeaders = targetRows.map((targetRow, index) => ({
    row: targetRow,
    isHeader: resolved[index].isHeader
  }));
  return [
    {
      anchor: tableAnchor,
      tableAppearance: {
        sourceTableAnchor: tableAnchor,
        targetTableAnchor: tableAnchor,
        source,
        targetRows,
        rowHeaders,
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

// Replacing a whole paragraph with text containing paragraph marks is also a
// paragraph-creation operation. Syncfusion's selected-range insert correctly
// owns the tracked structure, but it gives every inserted run/mark the document
// default instead of the selected paragraph's resolved formatting. Reuse the
// same pre-write format snapshot and guarded post-write apply path as
// insert_text; do not introduce a second formatting owner for selection ops.
function planSelectionSplitInheritance(
  editor: LiveEditor,
  op: EditOp,
  target: FlatBlock
): PlannedInsertInheritance[] | undefined {
  if (op.op !== 'replace_selection') return undefined;
  const replacement = op.replace ?? op.text ?? op.newText;
  if (replacement == null) return undefined;
  const segments = String(replacement).split(/\r\n|\r|\n/);
  if (segments.length < 2) return undefined;

  const start = offsetParts(
    offsetString(op.startOffset) || `${target.anchor};0`
  );
  const end = offsetParts(
    offsetString(op.endOffset) || `${target.anchor};${target.length}`
  );
  // Formatting whole result paragraphs is safe only when the selected source
  // was itself one whole paragraph. A partial/multi-paragraph rewrite may keep
  // unselected text in its edge paragraphs, whose own run format must win.
  if (
    start.anchor !== target.anchor ||
    end.anchor !== target.anchor ||
    start.offset !== 0 ||
    end.offset < target.length
  )
    return undefined;

  const anchorParts = target.anchor.split(';');
  const blockIndexBase = Number(anchorParts.pop());
  if (!Number.isInteger(blockIndexBase)) return undefined;
  const inherited = readEffectiveSourceFormat(editor, target);
  return segments.map((segment, index) => ({
    anchor: [...anchorParts, blockIndexBase + index].join(';'),
    expectedText: segment.replace(/\t/g, ''),
    source: target,
    inherited
  }));
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
      // Carries no donor by construction; it exists to be REPORTED, and the
      // write it describes happens with the editor's defaults.
      if (paragraph.unresolved) continue;
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
        // Before the fills: banding and the fallback shading both read the live
        // table, and a row still flagged as a header is not the row they are
        // meant to stripe.
        if (appearance.rowHeaders?.length) {
          const headers = applyPlannedRowHeaders(
            editor,
            appearance.targetTableAnchor,
            liveTableAppearance(editor, appearance.targetTableAnchor),
            appearance.rowHeaders
          );
          if (headers.report.rowsWritten) {
            appearanceOutcomes.push(headers);
            headers.restores.forEach(record);
          }
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
        // A merged table is the known cause: the insert lands inside a span, the
        // grid the formatting pass expects does not exist, and the generic
        // message left the caller with nowhere to go.
        const mergeNote = (() => {
          try {
            const tableAnchor = String(paragraph.anchor)
              .split(';')
              .slice(0, 2)
              .join(';');
            return describeTableMerges(
              tableBlockAt(serializeSfdt(editor), tableAnchor)
            );
          } catch {
            return null;
          }
        })();
        throw new OpError(
          'inherited_paragraph_not_found',
          mergeNote
            ? `The paragraph the insert created at "${paragraph.anchor}" did not resolve for formatting, because this table has merged cells: ${mergeNote}. A row cannot be inserted inside a merged span. Anchor a row outside the merged band, or use set_cell_text to write into the rows that already exist.`
            : `The paragraph the insert created at "${paragraph.anchor}" did not resolve for formatting. Re-read the table with table_facts and anchor a current data row.`,
          [
            `expected: ${JSON.stringify(paragraph.expectedText)}`,
            `actual: ${JSON.stringify(target?.text)}`,
            ...(mergeNote ? [`merged cells: ${mergeNote}`] : [])
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

const RELOCATION_OPS: ReadonlySet<string> = new Set([
  'move_section',
  'swap_sections',
  'copy_section'
]);

/**
 * What the engine - reading the ops, never the model's claim - says this change
 * set does.
 *
 * Cell writes are the usual answer, but a relocation writes no cell values at
 * all, so answering "writes no table-cell values" for one is true and useless:
 * beside a card that moved a whole section it reads as "nothing happened".
 */
function describeChangeSet(edits: EditOp[], touches: ColumnTouch[]): string {
  const quoted = (value: unknown) => JSON.stringify(String(value ?? ''));
  const relocations = edits
    .filter((op) => op?.op && RELOCATION_OPS.has(op.op))
    .map((op) => {
      if (op.op === 'swap_sections')
        return `swaps the sections at ${quoted(op.anchor)} and ${quoted(
          op.otherAnchor
        )}`;
      const where = `${op.position === 'after' ? 'after' : 'before'} ${quoted(
        op.targetAnchor
      )}`;
      return op.op === 'copy_section'
        ? `copies the section at ${quoted(
            op.anchor
          )} ${where}, leaving the original in place`
        : `moves the section at ${quoted(op.anchor)} ${where}`;
    });
  if (!relocations.length) return describeChangeSetTouches(touches);
  const relocation =
    `This change set ${relocations.join(', and ')}. ` +
    'The engine moves the existing blocks with their tables, formatting and subsections; no text or figure is authored.';
  return touches.length
    ? `${relocation} It also writes ${describeChangeSetTouches(touches)}`
    : relocation;
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
 * Two splits in one change set, refused with the shape that works instead.
 *
 * A split PASTES, so every anchor after it in the same batch is stale. The
 * executor's anchor relocation can usually re-find a moved block by content, but
 * a schedule's header row reads the same in every table in the family - the
 * captain's own document has "Coverage | Limit" on all of them - so it finds
 * several candidates and correctly refuses a non-deterministic write. That
 * refusal then rolls the whole group back, and the model sees
 * `anchor_relocation_ambiguous` about a table it never touched.
 *
 * Refusing up front is not a limitation being papered over: one split per change
 * set is the shape that SHOULD be asked for, because it gives each table its own
 * reviewable card. "Split all the Coverages and Limits tables" is several splits,
 * and a reviewer wants to accept the Property one and reconsider the Liability
 * one - which a single card covering both cannot offer.
 */
function detectBatchedSplits(edits: EditOp[]): BatchRefusal | null {
  const indices = edits.reduce<number[]>(
    (found, op, index) =>
      op?.op === 'split_table' ? [...found, index] : found,
    []
  );
  if (indices.length < 2) return null;
  return {
    code: 'split_table_one_per_change_set',
    message: `This change set asks for ${indices.length} table splits at once. Send one split_table per change set: a split inserts a table, so every later anchor in the same batch has moved, and in a document whose tables share their column names those anchors cannot be re-found unambiguously. Nothing was written.`,
    details: [
      `split_table at edit ${indices.join(', ')}`,
      'Split one table, then re-read the document and split the next. Each split is then its own reviewable card, which is what lets a reviewer accept one table and reconsider another.'
    ],
    indices
  };
}

function detectBatchedDuplicateTables(edits: EditOp[]): BatchRefusal | null {
  const indices = edits.reduce<number[]>(
    (found, op, index) =>
      op?.op === 'duplicate_table' ? [...found, index] : found,
    []
  );
  if (!indices.length) return null;
  if (indices.length > 1) {
    return {
      code: 'duplicate_table_one_per_change_set',
      message: `This change set asks for ${indices.length} table duplicates at once. Send one duplicate_table per change set: duplicating a table inserts a table, so later anchors move and repeated table text can no longer be resolved deterministically. Nothing was written.`,
      details: [
        `duplicate_table at edit ${indices.join(', ')}`,
        'Duplicate one table, then re-read the document before targeting the next table.'
      ],
      indices
    };
  }
  const firstDuplicate = indices[0];
  const laterAnchored = edits
    .map((op, index) => ({ op, index }))
    .filter(
      ({ op, index }) =>
        index > firstDuplicate &&
        op?.op &&
        !ANCHORLESS_OPS.has(op.op) &&
        op.op !== 'replace_all'
    )
    .map(({ index }) => index);
  if (!laterAnchored.length) return null;
  return {
    code: 'duplicate_table_must_end_change_set',
    message:
      'duplicate_table must be the last anchored edit in its change set. It inserts a table, so every later anchor may have shifted and can collide with the cloned table. Nothing was written.',
    details: [
      `duplicate_table at edit ${firstDuplicate}`,
      `later anchored edits: ${laterAnchored.join(', ')}`,
      'Duplicate the table, re-read structure/table_facts, then send follow-up edits against the fresh anchors.'
    ],
    indices: [firstDuplicate, ...laterAnchored]
  };
}

/**
 * `split_table` and `copy_section` both INSERT blocks, so every anchor after them
 * has moved. `duplicate_table` already refuses a change set that keeps writing
 * after it; these two did not, and a write aimed at a shifted anchor gets far
 * enough to change the document before the set fails - leaving the copied
 * section behind, or silently stripping a binding tag off a cell so its value
 * stops recomputing. Neither survives the rollback. Refuse in preflight, before
 * any anchor is resolved, exactly as the duplicate guard does.
 */
function detectAnchorShiftingNotLast(edits: EditOp[]): BatchRefusal | null {
  const shifting = new Set(['split_table', 'copy_section']);
  const firstShift = edits.findIndex((op) => !!op?.op && shifting.has(op.op));
  if (firstShift < 0) return null;
  const laterAnchored = edits
    .map((op, index) => ({ op, index }))
    .filter(
      ({ op, index }) =>
        index > firstShift &&
        op?.op &&
        !ANCHORLESS_OPS.has(op.op) &&
        op.op !== 'replace_all'
    )
    .map(({ index }) => index);
  if (!laterAnchored.length) return null;
  const name = edits[firstShift]?.op ?? 'This op';
  return {
    code: 'anchor_shifting_op_must_end_change_set',
    message: `${name} must be the last anchored edit in its change set. It inserts blocks, so every later anchor may have shifted and a write against a moved anchor can alter the document before the set fails. Nothing was written.`,
    details: [
      `${name} at edit ${firstShift}`,
      `later anchored edits: ${laterAnchored.join(', ')}`,
      'Send this edit alone, re-read structure, then send follow-up edits against the fresh anchors.'
    ],
    indices: [firstShift, ...laterAnchored]
  };
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
 * THE NUMBER-PROVENANCE GATE ON AN AUTHORED MATRIX.
 *
 * `insert_table` writes its whole `initialCells` matrix inside ONE op, so the
 * per-cell gate in applyAnchoredOp - which reads one op's text against the one
 * cell it targets - never saw those figures, and `compileSectionComposer` routes
 * every composed table through that op. That made the matrix the only cell-write
 * path in the vocabulary with no provenance requirement at all.
 *
 * This is the same rule, applied to the matrix the op carries. "A column of
 * formatted amounts" is `resolveQuantityCellFormat` - the engine's single
 * definition, so an id column (`0093`) and prose containing digits are excluded
 * here exactly as they are for `set_cell_text`. A figure in such a column may be
 * written only when one of these holds:
 *
 *   - it appears in the excerpt the table cites (`sourcedFrom`), compared by
 *     VALUE through the same `quotedExcerptContains` a per-cell citation uses;
 *   - the engine can derive it from the matrix exactly - a cell that IS the sum
 *     of the other amounts in its own column is arithmetic the engine can check
 *     for itself, and checking beats citing.
 *
 * Anything else is a figure nothing in the request supports, so it is refused
 * before any of the batch is written. The engine cannot verify that an excerpt
 * came from the named attachment - that is the service's half, and it holds the
 * evidence - but neither side depends on the other having run.
 */
function authoredMatrixBlocks(matrix: string[][]): FlatBlock[] {
  const blocks: FlatBlock[] = [];
  matrix.forEach((row, rowIndex) =>
    row.forEach((cell, column) => {
      const text = String(cell ?? '');
      blocks.push({
        anchor: `0;0;${rowIndex};${column};0`,
        kind: 'table_cell',
        text,
        isHeading: false,
        level: -1,
        length: text.length
      });
    })
  );
  return blocks;
}

/** Exact sum, or null when the scales cannot be aligned without precision loss. */
function sumFiguresExact(values: NumericValue[]): NumericValue | null {
  const scale = values.reduce(
    (widest, value) => Math.max(widest, value.scale),
    0
  );
  let units = 0;
  for (const value of values) {
    const scaled = rescaleExact(value, scale);
    if (!scaled) return null;
    units += scaled.units;
  }
  return Number.isSafeInteger(units) ? { units, scale } : null;
}

/**
 * Is this cell the exact total of the other amounts in its own column? Then the
 * engine has verified the arithmetic itself and no citation can add to that.
 * Same-unit amounts only - a mixed-unit column has no meaningful sum, which is
 * the refusal `collectNumericCells` already applies to arithmetic.
 */
function isExactColumnAggregate(blocks: FlatBlock[], cell: FlatBlock): boolean {
  const target = parseNumericCell(cell.text.trim());
  if (!target) return false;
  const column = Number(cell.anchor.split(';')[3]);
  const siblings: NumericValue[] = [];
  for (const candidate of blocks) {
    if (candidate === cell) continue;
    if (Number(candidate.anchor.split(';')[3]) !== column) continue;
    const text = candidate.text.trim();
    if (!text || !isQuantityText(text)) continue;
    const parsed = parseNumericCell(text);
    if (!parsed || parsed.unit !== target.unit) return false;
    siblings.push(parsed.value);
  }
  if (siblings.length < 2) return false;
  const total = sumFiguresExact(siblings);
  if (!total) return false;
  const scale = Math.max(total.scale, target.value.scale);
  const left = rescaleExact(total, scale);
  const right = rescaleExact(target.value, scale);
  return !!left && !!right && left.units === right.units;
}

/** Every well-formed `initialCells` matrix in the batch, with its op's index. */
function authoredMatrices(
  edits: EditOp[]
): Array<{ index: number; op: EditOp; matrix: string[][] }> {
  const found: Array<{ index: number; op: EditOp; matrix: string[][] }> = [];
  edits.forEach((op, index) => {
    if (op?.op !== 'insert_table' || !Array.isArray(op.initialCells)) return;
    const matrix = op.initialCells as unknown[];
    // Shape validity is detectEmptyInsertedTables' refusal, not these.
    if (
      !matrix.every(
        (row) =>
          Array.isArray(row) && row.every((cell) => typeof cell === 'string')
      )
    )
      return;
    found.push({ index, op, matrix: matrix as string[][] });
  });
  return found;
}

/**
 * A cell is one paragraph, for the reason AUTHORS_MULTIPLE_PARAGRAPHS states.
 * Cells were type-checked and nothing more while the spec's own titles and
 * paragraphs were held to that rule, so a newline in a cell passed validation
 * and then split the cell into two anchors at write time.
 */
function detectMultilineAuthoredCells(edits: EditOp[]): BatchRefusal | null {
  for (const { index, op, matrix } of authoredMatrices(edits)) {
    for (let row = 0; row < matrix.length; row++) {
      for (let column = 0; column < matrix[row].length; column++) {
        if (!AUTHORS_MULTIPLE_PARAGRAPHS.test(matrix[row][column])) continue;
        return {
          code: 'multiline_authored_cell',
          message:
            `Row ${row}, column ${column} of the table this ${op.op} would create contains a line break, so SyncFusion would split that cell into two cell paragraphs. ` +
            'The second one gets neither the inherited format nor the post-write verification, because both address the first - the same reason a title or a paragraph must describe exactly one paragraph. ' +
            'Write the cell as one line, or make the second part its own row. Nothing was written.',
          details: [
            `cell: row ${row}, column ${column}`,
            `cell text: ${JSON.stringify(matrix[row][column])}`
          ],
          indices: [index]
        };
      }
    }
  }
  return null;
}

function detectUnsourcedAuthoredFigures(edits: EditOp[]): BatchRefusal | null {
  for (const { index, op, matrix } of authoredMatrices(edits)) {
    // Body cells only. The first row is the column headers - labels the model
    // composed, not figures - and the service's half exempts them for the same
    // reason, so both sides read the same cells as data.
    const blocks = authoredMatrixBlocks(matrix).filter(
      (cell) => Number(cell.anchor.split(';')[2]) > 0
    );
    const citation = op.sourcedFrom;
    const excerpt =
      typeof citation?.quotedText === 'string' ? citation.quotedText : '';
    const attachment =
      typeof citation?.quotedFrom === 'string'
        ? citation.quotedFrom.trim()
        : '';
    for (const cell of blocks) {
      const figure = cell.text.trim();
      if (!figure || !isQuantityText(figure)) continue;
      // The live cell is empty until this op writes it, so the column's own
      // authored amounts are what make it a quantity column - the same reading
      // the cell-by-cell path arrives at by the time it writes the third one.
      if (!resolveQuantityCellFormat(blocks, { ...cell, text: '', length: 0 }))
        continue;
      if (excerpt && attachment && quotedExcerptContains(excerpt, figure))
        continue;
      if (isExactColumnAggregate(blocks, cell)) continue;
      const [, , row, column] = cell.anchor.split(';');
      const tableAnchor = resultingInsertedTableAnchor(op) ?? String(op.anchor);
      return {
        code: 'unsourced_authored_figure',
        message:
          `Refusing to write the figure ${JSON.stringify(
            figure
          )} into row ${row}, column ${column} of the table this ${
            op.op
          } would create at "${tableAnchor}": nothing in this request supports it. ` +
          'A figure in a column of formatted amounts must either be quoted from a source - `sourcedFrom` with `quotedFrom` (the attachment it was read out of) and `quotedText` (the verbatim excerpt containing it), which the engine checks every figure in the matrix against - or be exactly derivable from the other amounts in its own column, which the engine checks itself. ' +
          (excerpt && attachment
            ? 'The excerpt this table cites does not contain this figure, so the citation does not support it. '
            : excerpt || attachment
            ? '`sourcedFrom` needs BOTH `quotedFrom` and `quotedText`. '
            : 'This table cites no source at all. ') +
          'A figure the USER stated goes in one at a time through set_cell_text with `literal: true`, and a value derived from cells that already exist goes through set_cell_formula. Nothing was written.',
        details: [
          `figure: ${JSON.stringify(figure)}`,
          `cell: ${tableAnchor};${row};${column};0`,
          `cited attachment: ${attachment || '(none)'}`,
          `cited excerpt: ${excerpt ? JSON.stringify(excerpt) : '(none)'}`
        ],
        indices: [index]
      };
    }
  }
  return null;
}

/**
 * Placeholder-looking text, matched by SHAPE and never by a known token.
 *
 * The live failure: asked to swap two subsections, the model expressed it as a
 * three-way text shuffle and wrote `__TMP_SWAP_HEADING_1__` and
 * `__TMP_SWAP_PARA_1__` into the captain's client proposal as intermediate
 * values. That change set happened to roll back, so the tokens never survived -
 * but "one op away from a placeholder in a client document" is not a property to
 * rely on, and it is not something prompt guidance can prevent. Matching the
 * literal tokens that were seen would only refuse the one shuffle we already
 * know about; matching the shape refuses the class.
 */
const SENTINEL_SHAPES: Array<{ shape: RegExp; description: string }> = [
  {
    // `__TMP_SWAP_PARA_1__` - a delimited, shouted, underscore-wrapped token.
    shape: /(?:^|[^A-Za-z0-9])(__[A-Z0-9_]{3,}__)(?![A-Za-z0-9])/,
    description: 'a __DELIMITED_TOKEN__ placeholder'
  },
  { shape: /(\{\{[^{}]*\}\})/, description: 'a {{template}} marker' },
  { shape: /(<<[^<>]*>>)/, description: 'a <<template>> marker' },
  { shape: /(%%[^%]*%%)/, description: 'a %%template%% marker' },
  {
    shape: /(\$\{[^{}]*\})/,
    description: 'a shell-style dollar-brace template marker'
  },
  {
    shape:
      /(?:^|[^A-Za-z0-9_])(PLACEHOLDER|TODO|TBD|LOREM IPSUM|XXX)(?![A-Za-z0-9_])/,
    description: 'a standalone placeholder word'
  }
];

/**
 * The model-authored WRITE fields of the vocabulary. Deliberately not `find` or
 * `expect`: those are reads, and refusing to search for a placeholder would
 * block the one edit that cleans one up.
 */
export const MODEL_AUTHORED_TEXT_FIELDS = [
  'text',
  'replace',
  'newText',
  'displayText',
  'screenTip',
  'name',
  'label'
];

/**
 * `op.field` pairs that only LOOK like write fields. `delete_bookmark` names a
 * bookmark that already exists, so its `name` is a selector in exactly the way
 * `find` is, and refusing it would block the one op that removes a placeholder
 * bookmark an earlier run left behind. Exported so the registry-exhaustive spec
 * reads the same list instead of keeping its own copy of the exception.
 */
export const SENTINEL_SELECTOR_FIELDS = new Set(['delete_bookmark.name']);

function sentinelToken(
  value: unknown
): { token: string; description: string } | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  for (const { shape, description } of SENTINEL_SHAPES) {
    const match = shape.exec(value);
    if (match) return { token: match[1] ?? match[0], description };
  }
  return undefined;
}

/** Every string one op would WRITE, with a human-readable location for each. */
function authoredStrings(op: EditOp): Array<{ where: string; value: string }> {
  const out: Array<{ where: string; value: string }> = [];
  for (const field of MODEL_AUTHORED_TEXT_FIELDS)
    if (
      typeof op[field] === 'string' &&
      !SENTINEL_SELECTOR_FIELDS.has(`${op.op}.${field}`)
    )
      out.push({ where: field, value: op[field] });
  const matrix = op.initialCells;
  if (Array.isArray(matrix))
    matrix.forEach((row: unknown, rowIndex: number) => {
      if (!Array.isArray(row)) return;
      row.forEach((value: unknown, column: number) => {
        if (typeof value === 'string')
          out.push({
            where: `initialCells row ${rowIndex}, column ${column}`,
            value
          });
      });
    });
  if (op.op === 'duplicate_table' && Array.isArray(op.rows)) {
    op.rows.forEach((row: unknown, rowIndex: number) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return;
      for (const [field, value] of Object.entries(row)) {
        if (typeof value === 'string')
          out.push({
            where: `rows[${rowIndex}].${field}`,
            value
          });
      }
    });
  }
  // A section spec still attached after expansion (the refusal backstop keeps
  // it) is composed content too, and its table cells are exactly the write path
  // that bypasses the per-op checks.
  const spec = op.sectionSpec;
  if (spec && typeof spec === 'object') {
    if (typeof spec.title === 'string')
      out.push({ where: 'sectionSpec.title', value: spec.title });
    if (Array.isArray(spec.blocks))
      spec.blocks.forEach((specBlock: any, index: number) => {
        if (!specBlock || typeof specBlock !== 'object') return;
        if (typeof specBlock.text === 'string')
          out.push({
            where: `sectionSpec.blocks[${index}].text`,
            value: specBlock.text
          });
        const table = specBlock.table;
        if (!table || typeof table !== 'object') return;
        if (Array.isArray(table.columnHeaders))
          table.columnHeaders.forEach((header: unknown, column: number) => {
            if (typeof header === 'string')
              out.push({
                where: `sectionSpec.blocks[${index}].table.columnHeaders[${column}]`,
                value: header
              });
          });
        if (Array.isArray(table.rows))
          table.rows.forEach((row: unknown, rowIndex: number) => {
            if (!Array.isArray(row)) return;
            row.forEach((value: unknown, column: number) => {
              if (typeof value === 'string')
                out.push({
                  where: `sectionSpec.blocks[${index}].table.rows[${rowIndex}][${column}]`,
                  value
                });
            });
          });
      });
  }
  return out;
}

/**
 * No write may put placeholder text into a document, from ANY op.
 *
 * One pass over the post-expansion `edits` array, which is the only place where
 * every model-authored string in the change set - composed section-table cells
 * included - is visible before a single write. A guard wired into one handler
 * protects one handler; this is the boundary every op passes through, and the
 * registry-enumerating spec fails if an op added later can bypass it.
 */
function detectSentinelContent(edits: EditOp[]): BatchRefusal | null {
  for (let index = 0; index < edits.length; index++) {
    const op = edits[index];
    if (!op?.op) continue;
    for (const { where, value } of authoredStrings(op)) {
      const found = sentinelToken(value);
      if (!found) continue;
      return {
        code: 'sentinel_content_refused',
        message:
          `Refusing to write ${JSON.stringify(
            found.token
          )} into the document: ` +
          `edit ${index + 1} (${op.op}) carries ${
            found.description
          } in \`${where}\`. ` +
          'Placeholder text is never an intermediate step - a change set that half-applies would leave it in the document for the client to read. ' +
          'To REORDER existing content use move_section or swap_sections: they take only anchors and a position, and the engine relocates the real content with its formatting as one tracked group, so no temporary value is needed. ' +
          'To write real content, send the final text. Nothing was written.',
        details: [
          `op: ${op.op}`,
          `field: ${where}`,
          `value: ${JSON.stringify(value.slice(0, 200))}`
        ],
        indices: [index]
      };
    }
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
  inheritance?: ComposedSectionInheritance;
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

/**
 * ONE PARAGRAPH PER AUTHORED UNIT. This is an engine property, not a
 * preference, and it is the same property for a title, a paragraph and a table
 * cell - which is why it is defined once here and enforced everywhere text is
 * authored (`sectionText` below for the spec's own strings,
 * `detectMultilineAuthoredCells` for the cell matrices any insert_table
 * carries).
 *
 * Text: the composer joins its text items with newlines into one insert_text and
 * plans each resulting paragraph's final anchor, so an embedded newline shifts
 * every later anchor and its formatting by one.
 *
 * Cells: SyncFusion splits a cell at a newline into two cell paragraphs, so the
 * cell gains a SECOND anchor - and the format inheritance and the post-write
 * verification both address the first, leaving the rest of the cell unstyled and
 * unchecked.
 *
 * Note the tool schema does not carry this rule (`ai-services` types section
 * text as `z.string().min(1)` and cells as plain strings), so the engine is the
 * only place it can hold.
 */
const AUTHORS_MULTIPLE_PARAGRAPHS = /\r|\n/;

function sectionText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim())
    sectionSpecError('invalid_section_text', label, 'needs non-empty text.');
  if (AUTHORS_MULTIPLE_PARAGRAPHS.test(value))
    sectionSpecError(
      'invalid_section_text',
      label,
      'must describe one paragraph. Split multi-paragraph content into separate semantic blocks.'
    );
  return value;
}

/**
 * A citation is worth nothing unless both halves are there: the attachment the
 * figures were read out of, and the excerpt they appear in. Half a citation is a
 * malformed request, not an unsourced table, so it is named as one here rather
 * than falling through to the figure gate's generic refusal.
 */
function validatedFigureSource(
  value: unknown,
  label: string
): FigureSourceCitation {
  const candidate = value as FigureSourceCitation;
  const quotedFrom =
    typeof candidate?.quotedFrom === 'string'
      ? candidate.quotedFrom.trim()
      : '';
  const quotedText =
    typeof candidate?.quotedText === 'string'
      ? candidate.quotedText.trim()
      : '';
  if (!quotedFrom || !quotedText)
    sectionSpecError(
      'invalid_section_table_source',
      label,
      'has a `sourcedFrom` missing `quotedFrom` (the attachment the figures were read out of) or `quotedText` (the verbatim excerpt containing them).'
    );
  return { quotedFrom, quotedText };
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
        ...(table.columnRoles ? { columnRoles: [...table.columnRoles] } : {}),
        ...(table.sourcedFrom
          ? {
              sourcedFrom: validatedFigureSource(table.sourcedFrom, tableLabel)
            }
          : {})
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

function missingSectionPrefix(
  desired: SectionBoundaryElement[],
  existing: SectionBoundaryElement[]
): SectionBoundaryElement[] {
  let shared = 0;
  while (
    shared < desired.length &&
    shared < existing.length &&
    desired[shared] === existing[shared]
  )
    shared++;
  return desired.slice(shared);
}

function missingSectionSuffix(
  desired: SectionBoundaryElement[],
  existing: SectionBoundaryElement[]
): SectionBoundaryElement[] {
  let shared = 0;
  while (
    shared < desired.length &&
    shared < existing.length &&
    desired[desired.length - 1 - shared] ===
      existing[existing.length - 1 - shared]
  )
    shared++;
  return desired.slice(0, desired.length - shared);
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
  /**
   * Set ONLY when the anchor NAMED a section (`before:`/`after:<heading>`).
   * Naming a section states the family explicitly - "a peer of that one" - and
   * that statement outranks whatever the resolved insertion point sits inside.
   * A live block anchor states a POSITION instead, and the family is then
   * derived from the position; see `joinedSectionFamilyAnchor`.
   */
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
  const section = Number(entry.heading.anchor.split(';')[0]);
  const represented = blocks
    .slice(entry.start, entry.end)
    .filter((block) => Number(block.anchor.split(';')[0]) === section);
  const finalContentBlock = represented.reduce<number | undefined>(
    (latest, block) => {
      if (boundaryElement(block)) return latest;
      const number = bodyBlockNumber(block);
      return number === undefined || (latest !== undefined && latest > number)
        ? latest
        : number;
    },
    undefined
  );
  if (finalContentBlock !== undefined) {
    const paragraph = represented.find(
      (block) =>
        block.anchor.split(';').length === 2 &&
        bodyBlockNumber(block) === finalContentBlock &&
        !boundaryElement(block)
    );
    if (paragraph) return { target: paragraph, position: 'after' };
  }

  // A table has no public top-level anchor. When it is the last content block,
  // compose before the next real heading; never promote an empty paragraph or
  // page-break decoration into a content identity merely because it is nearby.
  const nextHeading = blocks[entry.end];
  if (nextHeading?.isHeading && nextHeading.text.replace(/\f/g, '').trim())
    return { target: nextHeading, position: 'before' };
  return undefined;
}

function boundaryForComposerSection(
  blocks: FlatBlock[],
  entry: ComposerSectionMapEntry,
  position: 'before' | 'after'
): ComposerInsertionBoundary | undefined {
  return position === 'before'
    ? { target: entry.heading, position: 'before' }
    : boundaryAfterComposerSection(blocks, entry);
}

/**
 * The sibling family a composed section JOINS, for an anchor that states a
 * POSITION rather than naming a section.
 *
 * A section map entry is a candidate when the insertion point falls anywhere in
 * `[start, end]` - which is one predicate covering the three ways a section can
 * be adjacent to that point, at any depth:
 *   - it ENDS there: the insertion appends after that section, so it is the
 *     preceding sibling of the unit being composed;
 *   - it STARTS there: the insertion prepends before it, so it is the following
 *     sibling (the first-child case);
 *   - it spans the point: the insertion lands inside it, so it is the parent
 *     and its own family is the one being joined.
 * The DEEPEST candidate wins, because a deeper family is by definition nested
 * inside the shallower ones and is therefore the closest fit; equal depths
 * prefer the sibling that precedes the insertion point.
 *
 * The block the insertion DISPLACES is not, on its own, evidence. Appending a
 * subsection at the end of a parent section puts the next parent-level heading
 * immediately after it, and that heading opens a SHALLOWER family - it loses to
 * the subsection that ends at the same point, which is what stops a subsection
 * being dressed as a top-level section.
 *
 * The spec's own structure bounds the answer: a section declaring subsections
 * at level L cannot itself be at level L or deeper, so candidates that could
 * not contain the spec's own headings are excluded. That is what keeps a full
 * section (title + subsections) composed at a section boundary a section, while
 * a bare title + table composed at the same boundary joins the subsections.
 *
 * Undefined when the insertion point is adjacent to no section at all; the
 * caller then keeps the resolved target as the reference, as it always was.
 */
function joinedSectionFamilyAnchor(
  blocks: FlatBlock[],
  target: FlatBlock,
  position: 'before' | 'after',
  spec: SectionComposerSpec
): string | undefined {
  const targetIndex = blocks.findIndex(
    (block) => block.anchor === target.anchor
  );
  if (targetIndex < 0) return undefined;
  const insertion = position === 'after' ? targetIndex + 1 : targetIndex;
  const declaredLevels = spec.blocks
    .filter(
      (block): block is SectionComposerBlock & { role: 'heading' } =>
        block.role === 'heading'
    )
    .map((block) => block.level)
    .filter((level): level is number => typeof level === 'number');
  const shallowestDeclared = declaredLevels.length
    ? Math.min(...declaredLevels)
    : Number.POSITIVE_INFINITY;
  const candidates = composerSectionMap(blocks).filter(
    (entry) =>
      entry.start <= insertion &&
      entry.end >= insertion &&
      entry.heading.level < shallowestDeclared
  );
  const selected = candidates.reduce<ComposerSectionMapEntry | undefined>(
    (best, entry) => {
      if (!best || entry.heading.level > best.heading.level) return entry;
      if (entry.heading.level < best.heading.level) return best;
      // Same depth: the sibling that ends at the insertion point precedes it.
      return best.end === insertion ? best : entry;
    },
    undefined
  );
  return selected?.heading.anchor;
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
    .filter(
      (candidate) =>
        Number.isInteger(candidate.block) && !boundaryElement(candidate.target)
    );
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
    // Naming the section states the family; see ComposerInsertionBoundary.
    return { ...resolved, familyAnchor: matches[0].heading.anchor };
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
    .filter(
      (candidate) =>
        Number.isInteger(candidate.block) && !boundaryElement(candidate.target)
    );
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

/** The composer's table donor: the resolver's answer, as a first-cell block. */
function composerTableDonor(
  resolver: CreationAppearanceResolver,
  evidence: SectionFamilyEvidence | undefined,
  familyAnchor: string,
  ordinal: number,
  anchorNamesMember: boolean,
  byAnchor: Map<string, FlatBlock>,
  label: string,
  gaps: CreationGap[]
): FlatBlock | undefined {
  const outcome = resolver.table({
    at: familyAnchor,
    ordinal,
    anchorNamesMember,
    ...(evidence ? { family: evidence } : {})
  });
  if (!outcome.resolved) {
    gaps.push(creationGap(label, outcome));
    return undefined;
  }
  const firstCell = byAnchor.get(`${outcome.value.anchor};0;0;0`);
  if (firstCell) return firstCell;
  gaps.push(
    creationGap(label, {
      reason: 'the donor table exposed no addressable first cell',
      searched: [outcome.value.anchor]
    })
  );
  return undefined;
}

function compileSectionComposer(
  op: EditOp,
  originalIndex: number,
  blocks: FlatBlock[],
  byAnchor: Map<string, FlatBlock>,
  sfdt: any
): {
  children: CompiledSectionEdit[];
  contentBlocks: number;
  tables: number;
  inheritance: ComposedSectionInheritance;
} {
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
  // A NAMED section states a boundary to compose beside; a derived one names
  // the family MEMBER being joined. The two select different authoring
  // examples, so the composer says which it has rather than leaving the unit
  // selection to guess. See nearestUnitIndex.
  const joinedFamilyAnchor = boundary.familyAnchor
    ? undefined
    : joinedSectionFamilyAnchor(
        blocks,
        resolvedTarget,
        boundary.position,
        spec
      );
  const familyAnchorNamesMember = !!joinedFamilyAnchor;
  const familyAnchor =
    boundary.familyAnchor ?? joinedFamilyAnchor ?? resolvedTarget.anchor;
  const evidence = deriveSectionFamilyEvidence(
    blocks,
    familyAnchor,
    familyAnchorNamesMember
  );
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
  // Separators are decorations around the insertion point, never mutation
  // anchors. Mirror only the missing part of the sibling convention on each
  // side; an existing page boundary may be longer than that convention.
  const leadingBoundary = missingSectionSuffix(desiredBoundary, beforeExisting);
  let trailingBoundary = missingSectionPrefix(desiredBoundary, afterExisting);
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
  const resolver = creationAppearance(blocks, sfdt, byAnchor);
  const gaps: CreationGap[] = [];
  const donorFor = (
    role: Exclude<SectionBlockRole, 'table' | 'table_header' | 'table_body'>,
    label: string,
    level?: number
  ): FlatBlock | undefined => {
    const outcome = resolver.role(evidence, role, {
      at: familyAnchor,
      ...(level !== undefined ? { level } : {})
    });
    if (outcome.resolved) return outcome.value;
    gaps.push(creationGap(label, outcome));
    return undefined;
  };
  textItems.push({
    text: spec.title,
    label: 'title',
    source: donorFor('section_heading', 'title')
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
        source: donorFor('subsection_heading', label, block.level)
      });
      return;
    }
    if (block.role === 'paragraph') {
      textItems.push({
        text: block.text,
        label,
        source: donorFor(
          seenSubsection ? 'subsection_paragraph' : 'intro_paragraph',
          label
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
      source: composerTableDonor(
        resolver,
        evidence,
        familyAnchor,
        tableOrdinal,
        familyAnchorNamesMember,
        byAnchor,
        label,
        gaps
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
          // The table's citation rides on the op that writes the cells, so the
          // matrix and the source it was transcribed from reach the provenance
          // gate together.
          ...(unit.table.table.sourcedFrom
            ? { sourcedFrom: unit.table.table.sourcedFrom }
            : {}),
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
  const donors: ComposedSectionInheritance['donors'] = [];
  for (const unit of finalUnits) {
    if (unit.kind === 'text')
      unit.items.forEach(
        (item) =>
          item.source &&
          donors.push({ unit: item.label, from: item.source.anchor })
      );
    else if (unit.kind === 'table' && unit.source)
      donors.push({ unit: unit.label, from: unit.source.anchor });
  }
  return {
    children: [...structural, ...formatting],
    contentBlocks: spec.blocks.length + 1,
    tables: tableOrdinal,
    inheritance: {
      familyAnchor,
      ...(evidence ? { level: evidence.level } : {}),
      siblings: evidence?.units.length ?? 0,
      donors,
      ...(gaps.length ? { withoutDonor: gaps } : {})
    }
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
          inheritance?: ComposedSectionInheritance;
        }
      | undefined;
    try {
      compiled = compileSectionComposer(
        original,
        originalIndex,
        blocks,
        byAnchor,
        sfdt
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
        inheritance: undefined,
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
      tables: compiled.tables,
      ...(compiled.inheritance ? { inheritance: compiled.inheritance } : {})
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

/** Codes that say "a sibling failed", never why this op did. */
const GENERIC_GROUP_FAILURES = new Set([
  'change_set_failed',
  'change_set_preflight_failed'
]);

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
    // A batch-level refusal names ONE child and every sibling carries a generic
    // group code, so the child that failed for a reason is the one to report -
    // otherwise a composed section is refused as `change_set_preflight_failed`
    // with no reason attached, and the refusal cannot be acted on.
    const failedIndex = children.findIndex(
      (child) => !child.ok && !GENERIC_GROUP_FAILURES.has(String(child.error))
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
      ...(appearance ? { appearance } : {}),
      ...(entry.inheritance ? { inherited: entry.inheritance } : {})
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

// Every op moves `editor.selection`, firing the same selectionChange a real
// user click would; the rail reads this flag to tell the two apart.
const ASSISTANT_WRITING_KEY = '__featheryAssistantWriting';
// Guards the gaps BETWEEN tool calls in one editing turn: set by the docx
// bridge on the first write of a turn, cleared by AssistantChat at turn end.
const ASSISTANT_SESSION_KEY = '__featheryAssistantSession';

/** True while `applyDocumentEdits` is mid-batch, or the editing turn driving
 *  it is still in flight. */
export function isAssistantWriting(
  editor: LiveEditor | null | undefined
): boolean {
  const ed = editor as any;
  return !!ed?.[ASSISTANT_WRITING_KEY] || !!ed?.[ASSISTANT_SESSION_KEY];
}

/** Mark the assistant editing turn driving this editor as in flight. The docx
 *  bridge sets it on the first document write of a turn; AssistantChat clears
 *  it when the turn settles. */
export function setAssistantSessionActive(
  editor: LiveEditor | null | undefined,
  active: boolean
): void {
  if (!editor) return;
  (editor as any)[ASSISTANT_SESSION_KEY] = active;
}

// Applies a logical change set in deterministic phases. We preflight only the
// relevant anchors, re-resolve them after structural writes, and verify only
// each affected source/target pair; a large document never needs a full result
// inventory to prove inherited formatting succeeded.
export function applyDocumentEdits(
  editor: LiveEditor,
  input: { edits: EditOp[]; changeSetId?: string; plan?: string }
): ApplyEditsResult {
  const ed = editor as any;
  ed[ASSISTANT_WRITING_KEY] = true;
  const serializationTiming: SerializationTiming = { count: 0, totalMs: 0 };
  try {
    return withSilentEditSelections(editor, () =>
      withSerializationTiming(editor, serializationTiming, () => {
        const expansion = expandSectionComposerEdits(editor, input);
        const result = applyDocumentEditsMeasured(
          editor,
          { ...input, edits: expansion.edits },
          serializationTiming
        );
        return collapseSectionComposerResult(result, expansion);
      })
    );
  } finally {
    // Synchronous clear: the session flag owns the gaps between calls.
    ed[ASSISTANT_WRITING_KEY] = false;
  }
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
  const announcement = describeChangeSet(edits, columnTouches);
  // Rollback undoes a write by REJECTING the revisions it created, and ownership
  // is recorded as an object-identity diff. That is not durable: when a tracked
  // write lands inside a range that already carries a pending revision,
  // SyncFusion re-authors that revision, and the diff then counts somebody
  // else's edit as ours. Measured: a refused change_case rejected the user's own
  // pending Deletion, resurrecting deleted text as ordinary content.
  //
  // A revision that existed BEFORE this change set is not ours to reject, however
  // the bucket came to contain it. Persisted ids are the stable identity here -
  // the same reason `groupNewRevisions` diffs by `revisionID` after a reload.
  const preExistingRevisionIds = new Set(
    snapshotRevisions(editor)
      // Only somebody ELSE's pending work is off limits. The assistant's own
      // revisions from an earlier change set are ordinary iterative editing -
      // "now also tweak that paragraph" before the last card is accepted - and
      // re-authoring our own revision loses nothing the user decided.
      .filter(
        (revision) =>
          !!revision.author && revision.author !== ASSISTANT_DOCUMENT_AUTHOR
      )
      .map((revision) => revision.revisionID)
      .filter((id): id is string => typeof id === 'string' && !!id)
  );
  (editor as any)[PRE_EXISTING_REVISIONS_KEY] = preExistingRevisionIds;
  const priorCurrentUser = editor.currentUser;
  // enableTrackChanges flips to true only inside the protected try below
  // (which forces it off in `finally` so later user typing is never tracked).
  // Preflight here is read-only, and a serialization failure before that
  // point must leave tracking exactly as found.
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
  const enginePlans: EngineMutationPlan[] = [];
  const createdBoundRows = new Map<string, CreatedBoundRowTarget>();
  const routeByIndex = new Map<number, DocxEditRoute>();
  const routeForIndex = (index: number): DocxEditRoute =>
    routeByIndex.get(index) ?? 'editor';
  const setRoute = (index: number, route: DocxEditRoute) => {
    if (!routeByIndex.has(index)) routeByIndex.set(index, route);
  };
  const failedGroups = new Set<string>();
  // Exact revision object membership makes per-group rollback work even in
  // editors/test doubles which do not expose revisionSettings.customData.
  const revisionsByAppliedGroup = new Map<string, Set<LiveRevision>>();
  const nonBlockingStoryWriteFailures = new Set<number>();
  const resolvedFormatTargets = new Map<number, FlatBlock>();
  const composedDisagreements = new Map<number, ComposedStyleDisagreement>();
  // Every still-applied appearance snapshot, in write order. A failed group's
  // entries are replayed and removed without touching successful siblings.
  const appearanceRestores: AppearanceRestore[] = [];
  /**
   * The paragraph style of every block a paragraph-creating op writes NEXT TO,
   * per accept group.
   *
   * Rejecting an inserted paragraph mark merges two paragraphs and the survivor
   * keeps the removed paragraph's format, which SyncFusion tracks as no revision
   * at all - so a rejected card can leave a paragraph wearing a style it never
   * had. Captured here, at the one boundary every op crosses, rather than in any
   * single op: `insert_section` has the defect today and relocation only made it
   * easy to see. An op added later is covered by construction.
   */
  const paragraphStylesByGroup = new Map<string, ParagraphStyleRestore[]>();
  const recordParagraphStyles = (op: EditOp, anchors: unknown[]) => {
    // Only ops that can create or remove a paragraph can trigger the merge.
    if (!mayShiftAnchors(op)) return;
    const id = opGroupId(op, changeSetId);
    const bucket = paragraphStylesByGroup.get(id) ?? [];
    // Each named paragraph, and the two that can end up merged with it: the one
    // straight after it (an insert lands between them) and the one after its
    // whole section unit (which is what a relocation's accepted delete merges
    // into). Same `sectionUnitEnd` rule the reads and the ranges use.
    const named = anchors.flatMap((raw) => {
      const anchor = typeof raw === 'string' ? raw.trim() : '';
      if (!anchor) return [];
      const index = blocks.findIndex(
        (candidate) => candidate.anchor === anchor
      );
      if (index < 0) return [anchor];
      return [
        anchor,
        blocks[index + 1]?.anchor,
        blocks[sectionUnitEnd(blocks, index)]?.anchor
      ];
    });
    for (const raw of named) {
      const anchor = typeof raw === 'string' ? raw.trim() : '';
      if (!anchor || !/^\d+;\d+$/.test(anchor)) continue;
      const block = byAnchor.get(anchor);
      const styleName = block?.format?.styleName;
      if (!block || block.kind === 'table_cell' || !styleName) continue;
      if (bucket.some((entry) => entry.anchor === anchor)) continue;
      bucket.push({
        anchor,
        styleName,
        text: paragraphIdentityText(block.text)
      });
    }
    if (bucket.length) paragraphStylesByGroup.set(id, bucket);
  };
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
    // Write order across the WHOLE change set, not within this group: it is
    // what lets a rejected card hand its snapshot down to the sibling card that
    // overwrote the same cell after it, instead of the two racing.
    restores.forEach((restore, index) => {
      restore.seq = appearanceRestores.length + index;
    });
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
      route: routeForIndex(index),
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
      ...(isOpError(err) && err.retry ? { retry: err.retry } : {}),
      ...(isOpError(err) && err.ambiguity ? { ambiguity: err.ambiguity } : {})
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
        route: routeForIndex(index),
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
      attempt(() => rollbackAppearanceWrites(editor, restores));
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
      // `currentUser` is pinned to the assistant for the whole batch, so a
      // revision authored by anyone else can never be ours to reject - however
      // it reached this bucket. An edit landing inside a user's pending
      // Insertion splits it into a fresh-id replacement that KEEPS their
      // author, and rejecting that would delete text the user wrote.
      // Explicitly ours, or not ours to reject. An author-less revision is
      // KEPT: guessing wrong in that direction deletes somebody's text.
      (revision) =>
        live.has(revision) && revision.author === ASSISTANT_DOCUMENT_AUTHOR
    );
    if (revisions.length) attempt(() => rejectRevisions(revisions));
    revisionsByAppliedGroup.delete(groupId);
    attempt(() => refresh());
    if (rollbackErrors.length)
      warnings.push(
        `group_rollback_failed: ${groupId}; ${rollbackErrors.join('; ')}`
      );
  };
  const rollbackAppliedEditorResultsForBindingAbort = (
    reason: string
  ): string[] => {
    const rolledGroups = new Set<string>();
    for (const plan of plans) {
      const result = results[plan.index];
      if (!result?.ok) continue;
      const groupId = opGroupId(plan.op, changeSetId);
      if (!rolledGroups.has(groupId)) {
        rollbackGroup(groupId);
        failedGroups.add(groupId);
        rolledGroups.add(groupId);
      }
      results[plan.index] = {
        ...result,
        ok: false,
        route: 'editor',
        error: 'change_set_failed',
        details: [
          reason,
          `Rolled back editor-routed edit ${plan.index + 1} (${
            plan.op.op
          }) because the mixed binding/editor batch did not apply atomically.`
        ]
      };
    }
    return [...rolledGroups];
  };
  const markUnresolvedEnginePlansFailed = (
    error: string,
    message: string,
    details: string[]
  ) => {
    for (const plan of enginePlans) {
      if (results[plan.index]) continue;
      results[plan.index] = {
        ok: false,
        op: plan.op?.op ?? '',
        route: 'engine',
        ...(plan.anchor ?? plan.op?.anchor
          ? { anchor: plan.anchor ?? plan.op.anchor }
          : {}),
        error,
        message,
        details
      };
    }
  };

  // Phase 0: what only the whole batch can show. Both of these refuse BEFORE
  // any anchor is resolved, so a refused change set costs nothing at all.
  const batchRefusal =
    detectSentinelContent(edits) ??
    detectInconsistentAggregateRanges(edits) ??
    detectBatchedSplits(edits) ??
    detectBatchedDuplicateTables(edits) ??
    detectAnchorShiftingNotLast(edits) ??
    detectEmptyInsertedTables(edits) ??
    detectMultilineAuthoredCells(edits) ??
    detectUnsourcedAuthoredFigures(edits) ??
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
  const simulatedTextByAnchor = new Map(
    blocks.map((block) => [block.anchor, block.text] as const)
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
    const simulatedBlocks = withSimulatedText(blocks, simulatedTextByAnchor);
    const simulatedByAnchor = new Map(
      simulatedBlocks.map((block) => [block.anchor, block] as const)
    );
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
      const runs = selectionTextRuns(simulatedBlocks);
      const declaredText = declaredSelectionText(op, simulatedByAnchor, runs);
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
        const attempt = attemptSelectionRelocation(simulatedBlocks, op);
        if ('range' in attempt) {
          target =
            byAnchor.get(attempt.range.target.anchor) ?? attempt.range.target;
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
    //
    // Never for a composed section's own formatting: that op formats a
    // paragraph THIS change set creates, and the composer already planned where
    // it lands (`__sectionFinalAnchor`). Reading its `expect` as anchor drift
    // binds it to a pre-existing paragraph that merely repeats the text - which
    // is how a second "Your Client Services Team" was left as plain body text
    // while the original heading two pages up was restyled instead. Phase 3
    // resolves these from the planned topology; a text match cannot.
    if (
      !target &&
      formatExpectMismatch &&
      hasStructuralEdits &&
      op.__sectionCreatorId === undefined
    ) {
      const attempt = attemptAnchorRelocation(blocks, op);
      if ('target' in attempt) {
        target = byAnchor.get(attempt.target.anchor) ?? attempt.target;
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
      const attempt = attemptAnchorRelocation(simulatedBlocks, op);
      if ('target' in attempt) {
        target = byAnchor.get(attempt.target.anchor) ?? attempt.target;
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
    let simulatedTargetText =
      target && !isLiveStoryTarget(target)
        ? simulatedTextByAnchor.get(target.anchor) ?? target.text
        : undefined;
    if (
      target &&
      !isLiveStoryTarget(target) &&
      // See applyAnchoredOp: replace_selection's `expect` describes the selected
      // range, not the start block, so it is checked by assertSelectionGuard.
      name !== 'replace_selection' &&
      expectGuardRefuses(op.expect, simulatedTargetText ?? target.text)
    ) {
      const staleTarget = target;
      const simulatedStaleTarget = {
        ...staleTarget,
        text: simulatedTargetText ?? staleTarget.text,
        length: (simulatedTargetText ?? staleTarget.text).length
      };
      const attempt = attemptAnchorRelocation(
        simulatedBlocks,
        op,
        simulatedStaleTarget
      );
      if ('target' in attempt) {
        target = byAnchor.get(attempt.target.anchor) ?? attempt.target;
        simulatedTargetText =
          simulatedTextByAnchor.get(target.anchor) ?? target.text;
        relocated = attempt.relocated;
        op = retargetOpToBlock(op, target);
      } else {
        results[index] = {
          ok: false,
          op: name,
          anchor: op.anchor,
          error: 'expect_mismatch',
          details: [
            ...staleAnchorDetails(op.expect, simulatedStaleTarget.text),
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
      !(simulatedTargetText ?? target.text).includes(String(op.find))
    ) {
      // This preflight short-circuits before the handler, so it has to carry the
      // handler's guidance itself - otherwise the caller gets a bare code with
      // no message and no route forward.
      results[index] = {
        ok: false,
        op: name,
        anchor: op.anchor,
        error: 'text_not_found',
        message: `${JSON.stringify(String(op.find))} is not present at "${
          op.anchor
        }", so there is nothing to ${
          name === 'delete_text' ? 'delete' : 'replace'
        }. Nothing was written.`,
        details: [
          `live text at ${op.anchor}: ${JSON.stringify(
            simulatedTargetText ?? target.text
          )}`,
          "Copy `find` from the block's CURRENT text - re-read it with getDocumentInventory if this anchor was already edited in this change set."
        ]
      };
      return;
    }
    try {
      const routed = planBindingRoutedOp(
        editor,
        liveSfdt,
        index,
        op,
        target,
        createdBoundRows
      );
      if (routed) {
        setRoute(index, routed.route);
        const globalWrite = routed.bindingWrite?.identity.global
          ? routed.bindingWrite
          : undefined;
        const priorGlobalWrite = globalWrite
          ? enginePlans.find(
              (plan) =>
                plan.bindingWrite?.identity.global &&
                plan.bindingWrite.identity.id === globalWrite.identity.id
            )?.bindingWrite
          : undefined;
        if (
          globalWrite &&
          priorGlobalWrite &&
          priorGlobalWrite.canonical !== globalWrite.canonical
        )
          throw new OpError(
            'global_binding_conflicting_writes',
            `This change set writes global binding "${globalWrite.identity.id}" to two different values. Nothing was written; send one value for that identity.`
          );
        enginePlans.push(routed);
        observeMutationGuardBoundary(
          op,
          op.op === 'replace_selection' ? 'selection_content' : 'block_expect'
        );
        return;
      }
    } catch (err) {
      setRoute(index, 'engine');
      fail(index, op, err);
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
      if (target && !isLiveStoryTarget(target)) {
        const simulatedTarget = simulatedByAnchor.get(target.anchor) ?? target;
        const nextText = simulateStableTextOp(op, simulatedTarget);
        if (nextText !== undefined)
          simulatedTextByAnchor.set(target.anchor, nextText);
      }
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
  const hasEngineRoute = Array.from(routeByIndex.values()).includes('engine');
  const engineBatchPreflightFailure =
    !batchRefusal && hasEngineRoute && preflightFailures.length > 0;
  if (engineBatchPreflightFailure) {
    edits.forEach((op, index) => {
      if (results[index]) return;
      results[index] = {
        ok: false,
        op: op?.op ?? '',
        route: routeForIndex(index),
        ...(op?.anchor ? { anchor: op.anchor } : {}),
        error: 'change_set_preflight_failed',
        details: [
          `This mixed editor/binding change set was rejected before writes because edit ${
            preflightFailures[0] + 1
          } failed preflight; engine-routed batches are all-or-nothing across routes.`
        ]
      };
    });
  } else if (!batchRefusal) {
    for (const index of preflightFailures) {
      const groupId = opGroupId(edits[index], changeSetId);
      if (!failedGroups.has(groupId))
        markGroupFailed(groupId, index, 'refused');
    }
  }
  const preflightFailed =
    !!batchRefusal ||
    engineBatchPreflightFailure ||
    preflightFailures.length > 0;
  // Batch layout is required for large change sets, but assigning the public
  // enableLayout property queues onPropertyChanged. SyncFusion later handles
  // that queue with refreshLayout(), which unconditionally Control-Homes the
  // selection before repagination. Muted setProperties changes the same layout
  // gate without queuing navigation; one explicit layoutWholeDocument below
  // pays the deferred pagination cost while the silent edit boundary is active.
  const suspendLayout =
    !batchRefusal &&
    !engineBatchPreflightFailure &&
    editor.enableLayout === true;
  const setLayoutWithoutPropertyChange = (enabled: boolean) => {
    const liveEditor = editor as any;
    if (typeof liveEditor.setProperties === 'function')
      liveEditor.setProperties({ enableLayout: enabled }, true);
    else editor.enableLayout = enabled;
  };
  try {
    if (suspendLayout) setLayoutWithoutPropertyChange(false);
    editor.enableTrackChanges = true;
    editor.currentUser = ASSISTANT_DOCUMENT_AUTHOR;
    if (batchRefusal || engineBatchPreflightFailure) {
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
              // A structural op needs BOTH baselines, because for it they are
              // the proof that a withdrawal (which authors no revision) is
              // still a tracked write rather than an untracked one. Both are
              // already computed by the last refresh, so this costs no extra
              // serialize.
              if (TRACKED_STRUCTURAL_OPS.has(op.op)) {
                priorRejectStream = rejectStream;
                priorAcceptStream = acceptStream;
              }
              // Decide the inserted paragraphs' formatting BEFORE the write,
              // while the reference blocks and their formats are readable in
              // their pre-insert positions. An explicit inheritFormatFrom on
              // the op replaces the computed reference (its source and format
              // snapshot were captured at preflight).
              if (op.op === 'replace_selection' && !insertInheritance) {
                insertInheritance = planSelectionSplitInheritance(
                  editor,
                  writtenOp,
                  target
                );
                if (insertInheritance)
                  plan.insertInheritance = insertInheritance;
              }
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
              // Both anchors, because the paragraph at risk is the one the write
              // lands NEXT TO: for insert_section that is the op's own anchor,
              // for a relocation it is the destination.
              recordParagraphStyles(op, [
                target.anchor,
                op.targetAnchor,
                op.otherAnchor
              ]);
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
                // The verifier snapshot was captured before the inherited
                // section-boundary padding was materialized. Do not refresh
                // from that now-stale topology.
                opExtras = undefined;
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
            trackedMutationTargetText,
            priorAcceptStream
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
              : {}),
            // A creation the document could not dress says so on its own
            // result. Never omitted: a silent default is indistinguishable
            // from a successful inheritance, which is the confusion this
            // whole resolver exists to remove.
            ...(insertInheritance?.some((entry) => entry.unresolved)
              ? {
                  withoutDonor: insertInheritance.flatMap((entry) =>
                    entry.unresolved ? [entry.unresolved] : []
                  )
                }
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
            !TABLE_SCOPED_OPS.has(op.op) &&
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
              anchorsMayHaveShifted && !TABLE_SCOPED_OPS.has(op.op)
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
          // Styling a paragraph THIS change set created is composition, not
          // judgment: the model is hand-building a section out of primitives,
          // which is the same act insert_section performs, and it must reach
          // the same result. So the resolver wins there. A paragraph that
          // PRE-EXISTED is the user asking for something ("make this Heading
          // 2") and the model's choice wins - the engine must not override it.
          // The distinguishing fact is `createdTarget`, not a preference.
          const composedStyle =
            op.op === 'apply_style' && !!createdTarget && !source
              ? composedParagraphDonor(
                  blocks,
                  byAnchor,
                  target,
                  typeof op.styleName === 'string' ? op.styleName : undefined
                )
              : undefined;
          if (composedStyle?.disagreement)
            composedDisagreements.set(index, composedStyle.disagreement);
          const extras = applyAnchoredOp(
            editor,
            {
              ...op,
              anchor: target.anchor,
              ...(source ? { inheritFormatFrom: source.anchor } : {}),
              // The donor supplies the style NAME too. Leaving the model's
              // styleName on the op would win over it inside
              // applyInheritedFormat, so the paragraph would take the family's
              // colour and size while keeping the style the model guessed -
              // inheriting everything except the thing a reader checks.
              ...(composedStyle?.donor
                ? {
                    inheritFormatFrom: composedStyle.donor.anchor,
                    styleName: undefined
                  }
                : {}),
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
            ),
            ...(composedDisagreements.has(index)
              ? {
                  styleResolved: composedDisagreements.get(
                    index
                  ) as ComposedStyleDisagreement
                }
              : {})
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

      if (enginePlans.length) {
        // Judged here, not in the post-write pass: a licence violation must stop
        // the all-or-nothing transaction rather than be reported over a write
        // that already landed.
        const reusedFigure = findReusedUserStatedFigureInPlans(
          results,
          enginePlans
        );
        if (reusedFigure)
          fail(
            reusedFigure.plan.index,
            reusedFigure.plan.op,
            reusedFigure.error
          );
        const abortReason = reusedFigure
          ? 'a user-stated figure would license two cells in one change set'
          : results.some((result) => result && !result.ok)
          ? 'an editor-routed edit failed before the engine transaction'
          : '';
        if (abortReason) {
          const rolledGroups = rollbackAppliedEditorResultsForBindingAbort(
            `No binding-engine writes were attempted because ${abortReason}.`
          );
          markUnresolvedEnginePlansFailed(
            'change_set_failed',
            'The mixed editor/binding change set did not apply atomically, so binding-engine writes were skipped.',
            [
              'No binding-engine writes were attempted.',
              rolledGroups.length
                ? `rolled back editor groups: ${rolledGroups.join(', ')}`
                : 'no editor groups needed rollback'
            ]
          );
          warnings.push(
            `binding_engine_transaction_skipped: ${abortReason}; rolled_back_editor_groups=${
              rolledGroups.join(', ') || '(none)'
            }`
          );
        } else {
          const outcomes = new Map<number, EngineMutationOutcome>();
          let applyingPlan: EngineMutationPlan | undefined;
          try {
            // Provenance makes the command layer author the review records in
            // SFDT. Native tracking must be off before that SFDT is opened;
            // the outer finally also leaves it off for subsequent user input.
            disableUserTrackChanges(
              editor,
              wrappingDocumentEditorContainer(editor)
            );
            const surface = bindingCommandSurfaceFor(editor);
            if (!surface)
              throw new OpError(
                'binding_engine_unavailable',
                'The binding command bridge detached before the engine transaction could run. Nothing was kept.'
              );
            const beforeCommands = liveSfdt;
            let state: EngineMutationState = {
              sfdt: beforeCommands,
              index: scanBindings(beforeCommands)
            };
            const appliedGlobalBindings = new Set<string>();
            for (const plan of enginePlans) {
              applyingPlan = plan;
              const globalId = plan.bindingWrite?.identity.global
                ? plan.bindingWrite.identity.id
                : undefined;
              if (globalId && appliedGlobalBindings.has(globalId)) {
                outcomes.set(plan.index, {
                  sfdt: state.sfdt,
                  anchor: plan.anchor,
                  details: [
                    `global identity "${globalId}" was resolved once for this change set`
                  ]
                });
                continue;
              }
              const outcome = plan.execute(state);
              outcomes.set(plan.index, outcome);
              state = {
                sfdt: outcome.sfdt,
                index: scanBindings(outcome.sfdt)
              };
              if (globalId) appliedGlobalBindings.add(globalId);
            }
            applyingPlan = undefined;
            const engineResult = surface.runCommands(
              diffBindingCommands(beforeCommands, state.sfdt),
              {
                provenance: {
                  author: ASSISTANT_DOCUMENT_AUTHOR,
                  changeSetId,
                  group: opGroupId(enginePlans[0].op, changeSetId)
                }
              }
            );
            refresh(engineResult.sfdt);
            // Reconciliation reopens the SFDT and can leave Syncfusion's caret
            // inside the content control that was just updated. Keep the next
            // assistant operation on a public body position even though every
            // structural handler also resolves and selects its own anchor.
            leaveEngineAtAddressableBodySelection(editor, blocks);
            if (engineResult.diagnostics.length) {
              warnings.push(
                `binding_engine_diagnostics: ${engineResult.diagnostics
                  .map(
                    (diagnostic) =>
                      `${diagnostic.severity}:${diagnostic.code}:${diagnostic.message}`
                  )
                  .slice(0, 20)
                  .join('; ')}`
              );
            }
            for (const plan of enginePlans) {
              const outcome = outcomes.get(plan.index);
              results[plan.index] = {
                ok: true,
                op: plan.op.op,
                route: 'engine',
                ...(outcome?.anchor ?? plan.anchor ?? plan.op.anchor
                  ? { anchor: outcome?.anchor ?? plan.anchor ?? plan.op.anchor }
                  : {}),
                ...(outcome?.details ? { details: outcome.details } : {})
              };
            }
          } catch (err) {
            const failingPlan = applyingPlan ?? enginePlans[0];
            if (failingPlan) fail(failingPlan.index, failingPlan.op, err);
            const rolledGroups = rollbackAppliedEditorResultsForBindingAbort(
              'The binding-engine transaction failed after editor-routed edits landed; editor-routed edits were rolled back before reporting failure.'
            );
            markUnresolvedEnginePlansFailed(
              'change_set_failed',
              'The binding-engine transaction failed, so the mixed editor/binding change set was rolled back.',
              [
                failingPlan
                  ? `engine failure at edit ${failingPlan.index + 1} (${
                      failingPlan.op.op
                    })`
                  : 'engine failure before the first planned mutation',
                rolledGroups.length
                  ? `rolled back editor groups: ${rolledGroups.join(', ')}`
                  : 'no editor groups needed rollback'
              ]
            );
            warnings.push(
              `binding_engine_transaction_failed: ${describeUnexpectedError(
                err
              )}; rolled_back_editor_groups=${
                rolledGroups.join(', ') || '(none)'
              }`
            );
            refresh();
          }
        }
      }
    }
  } finally {
    // Every assistant batch leaves both SyncFusion owners in user-editing mode.
    // The outer container can otherwise push its stale true flag back into the
    // editor on documentChange after this finally block has run.
    disableUserTrackChanges(editor, wrappingDocumentEditorContainer(editor));
    editor.currentUser = priorCurrentUser;
    if (revisionSettings) revisionSettings.customData = priorRevisionCustomData;
    if (suspendLayout) {
      setLayoutWithoutPropertyChange(true);
      (editor as any).documentHelper?.layout?.layoutWholeDocument?.();
    }
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
    appearanceRestoresByGroup,
    paragraphStylesByGroup,
    enginePlans.length > 0
  );
  const revisionCount = grouping.revisionCount;
  const materializedResults = Array.from(
    { length: edits.length },
    (_, index) => {
      const base =
        results[index] ??
        ({
          ok: false,
          op: edits[index]?.op ?? '',
          error: preflightFailed ? 'change_set_preflight_failed' : 'op_failed'
        } as EditResult);
      return {
        ...base,
        route: base.route ?? routeForIndex(index)
      };
    }
  );
  const hasFailure = materializedResults.some((result) => !result.ok);
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
    results: materializedResults,
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
