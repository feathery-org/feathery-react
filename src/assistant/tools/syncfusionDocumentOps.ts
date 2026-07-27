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
  computeColumn,
  ComputeOperation,
  COMPUTE_OPERATIONS,
  SkippedCell
} from './numericCells';

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

// One table in the document skeleton: where it is and its shape, no cell text
// beyond the header row (enough to recognise "the Location Schedule table").
export interface StructureTable {
  anchor: string;
  rows: number;
  columns: number;
  headerCells: string[];
  headerCellsTruncated?: boolean;
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

export type InventoryResult =
  | { sections: OutlineSection[]; truncation?: InventoryTruncation }
  | { structure: DocumentStructure; truncation?: InventoryTruncation }
  | { inventory: InventoryEntry[]; truncation?: InventoryTruncation }
  | { column: TableColumnRead; truncation?: InventoryTruncation }
  | InventoryRefusal;

export interface EditOp {
  op: string;
  anchor?: string;
  expect?: string;
  [field: string]: any;
}

// The auditable record of one engine-computed cell write. `receipt` is the
// one-line summary the assistant relays to the user; the structured fields
// are the same facts as data. The trust signal is `rowsRead` of `rowCount` -
// coverage of the read - plus the NAMED skipped cells, never a wall of the
// values themselves (available via a table_column read on request).
export interface ComputedCellReport {
  operation: ComputeOperation;
  tableAnchor: string;
  column: number;
  /** The column's header cell text (row 0), when it has one. */
  header: string | null;
  /** The exact bytes written to the target cell. */
  renderedValue: string;
  /** Cells whose values entered the arithmetic. */
  counted: number;
  /** Column rows actually read by the engine - always all of them. */
  rowsRead: number;
  /** The table's true row count. */
  rowCount: number;
  /** The computed range (inclusive), after defaults. */
  startRow: number;
  endRow: number;
  /** The anchored (target) row, excluded from the range when it fell inside. */
  excludedTargetRow: number | null;
  /** Every considered cell excluded from the arithmetic, named. */
  skipped: SkippedCell[];
  /** Where the render format came from. */
  formatSource: 'target_cell' | 'column_majority';
  /** True when `average` rounding changed the exact quotient. */
  rounded: boolean;
  /** The post-write re-read reproduced the same value and bytes. */
  verifiedByReRead: true;
  receipt: string;
}

export interface EditResult {
  ok: boolean;
  anchor?: string;
  op: string;
  error?: string;
  // Formatting inheritance is resolved by SyncFusion after styles are applied.
  // Keep any mismatch evidence on the affected op so a caller can retry the
  // precise anchor without having to re-inventory the whole document.
  details?: string[];
  // 'never' marks a failure no retry can fix (the op is not in the vocabulary),
  // so the assistant stops resending it instead of looping.
  retry?: 'never';
  // Present on a successful `set_cell_computed`: what was computed, from what,
  // and the receipt line to relay.
  computed?: ComputedCellReport;
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
  };
}

export interface SelectionContext {
  anchor: string;
  text: string;
  isCollapsed: boolean;
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
    const headerCells: string[] = [];
    for (let ci = 0; ci < cellCount; ci++) {
      const text = (t.headerByCell.get(ci) ?? []).join(' ');
      headerCells.push(
        text.length > STRUCTURE_HEADER_CELL_CHARS
          ? `${text.slice(0, STRUCTURE_HEADER_CELL_CHARS)}...`
          : text
      );
    }
    const table: StructureTable = {
      anchor: t.anchor,
      rows: t.rows,
      columns: t.columns,
      headerCells
    };
    // Never truncate silently: a capped header row must say it is capped.
    if (t.columns > STRUCTURE_MAX_HEADER_CELLS)
      table.headerCellsTruncated = true;
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
 * `table_column` inventory scope and the `set_cell_computed` engine
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
  }
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
          'scope "table_column" requires `column`, the 0-based column index (match it against the table\'s headerCells from a structure read).',
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
        message: `The table at "${tableAnchor}" has ${collected.columns} columns (0-${
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
  const blocks = flattenSfdt(parseSfdt(editor.serialize()));
  return buildInventoryFromBlocks(blocks, input);
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
// 500 characters of selected text, and whether the selection is collapsed.
export function readSelection(editor: LiveEditor): SelectionContext | null {
  const sel = editor?.selection;
  if (!sel || typeof sel.startOffset !== 'string') return null;
  const anchor = anchorFromOffset(sel.startOffset);
  if (!anchor) return null;
  const text = typeof sel.text === 'string' ? sel.text : '';
  const isCollapsed =
    sel.isEmpty != null ? !!sel.isEmpty : sel.startOffset === sel.endOffset;
  return { anchor, text: text.slice(0, SELECTION_TEXT_LIMIT), isCollapsed };
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

// A stale_anchor refusal must name what actually mismatched, or the model
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
function rejectProjectionStream(sfdt: any): string {
  const dropIds = insertedRevisionIds(sfdt);
  const allDropped = (rids: unknown): boolean =>
    Array.isArray(rids) &&
    rids.length > 0 &&
    rids.every((id) => dropIds.has(String(id)));
  const out: string[] = [];
  const pushParagraph = (block: any) => {
    out.push(inlineText(getInlines(block), dropIds));
    const markRevisionIds = pick(
      pick(block, 'characterFormat', 'cf'),
      'revisionIds',
      'rids'
    );
    // Rejecting an inserted paragraph mark joins this paragraph with the next
    // one, so an inserted mark contributes no separator to the projection.
    if (!allDropped(markRevisionIds)) out.push('\n');
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
      )
      .filter(
        (range: any) =>
          (typeof op.start !== 'number' || range.start.offset === op.start) &&
          (typeof op.end !== 'number' || range.end.offset === op.end)
      );
    if (matches.length !== 1)
      throw new OpError(
        matches.length ? 'story_range_ambiguous' : 'stale_anchor',
        matches.length
          ? `Story anchor "${anchor}" has ${matches.length} matching public search ranges.`
          : `The searched range at story anchor "${anchor}" changed since it was read.`
      );
    const match = matches[0];
    editor.selection.select(match.startOffset, match.endOffset);
    const text = String(editor.selection.text ?? '');
    if (text !== find)
      throw new OpError(
        'exact_match_range_mismatch',
        `SyncFusion selected ${JSON.stringify(
          text
        )} instead of ${JSON.stringify(find)} at "${anchor}".`
      );
    if (op.expect != null && text !== String(op.expect))
      throw new OpError(
        'stale_anchor',
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
  if (op.op !== 'replace_text' && op.op !== 'delete_text')
    throw new OpError(
      'unsupported_story_op',
      `${op.op} is not supported for a live story range.`
    );
  const find = String(op.find ?? '');
  if (!find) throw new OpError('missing_find', `${op.op} needs find.`);

  // Select the search range that preflight read. This is the public
  // Selection API counterpart of the exact range, not an SFDT-derived range.
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
    const hasExactPublicRange =
      typeof op.start === 'number' && typeof op.end === 'number';
    const match = (
      search.searchResults.getTextSearchResultsOffset() ?? []
    ).find((result: any) => {
      const start = offsetParts(String(result?.startOffset ?? ''));
      const end = offsetParts(String(result?.endOffset ?? ''));
      return (
        start.anchor === block.anchor &&
        end.anchor === block.anchor &&
        (hasExactPublicRange
          ? start.offset === op.start && end.offset === op.end
          : start.offset === index)
      );
    });
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
  computed?: ComputedCellReport;
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
// Engine-computed cell writes (set_cell_computed)
//
// The model chooses which table, which column and which target cell; the
// ENGINE reads the column, does the arithmetic (numericCells: exact
// scaled-integer, format-preserving) and writes the result rendered in the
// target cell's own format. After the write it re-reads the column and
// recomputes - a write that landed in the wrong cell fails here and rolls the
// change set back instead of reporting success.
// ---------------------------------------------------------------------------

const COMPUTED_SKIP_NAME_LIMIT = 8;

function describeSkippedCells(skipped: SkippedCell[]): string {
  if (!skipped.length) return '';
  const named = skipped.slice(0, COMPUTED_SKIP_NAME_LIMIT).map((s) => {
    if (s.reason === 'missing_cell') return `row ${s.row} (no cell)`;
    if (s.reason === 'blank') return `row ${s.row} (blank)`;
    return `row ${s.row} (${JSON.stringify(s.text)})`;
  });
  const more = skipped.length - named.length;
  return `; skipped ${skipped.length} non-numeric cell${
    skipped.length === 1 ? '' : 's'
  }: ${named.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

function buildComputedReceipt(report: Omit<ComputedCellReport, 'receipt'>): string {
  const headerName = report.header?.trim();
  const columnName = headerName
    ? `the "${headerName}" column`
    : `column ${report.column}`;
  const action =
    report.operation === 'sum'
      ? `Re-totalled ${columnName}`
      : `Computed the ${report.operation} of ${columnName}`;
  const roundedClause = report.rounded
    ? '; average rounded to the target format'
    : '';
  return (
    `${action}: ${report.renderedValue} from ${report.counted} line items ` +
    `(${report.rowsRead} of ${report.rowCount} column rows read` +
    describeSkippedCells(report.skipped) +
    `${roundedClause}). Post-write re-read reproduced this exact value.`
  );
}

function runComputedCellWrite(
  editor: LiveEditor,
  op: TypedEditOp<'set_cell_computed'>,
  block: FlatBlock,
  byAnchor: Map<string, FlatBlock>
): OpSuccessExtras {
  const parts = block.anchor.split(';');
  if (block.kind !== 'table_cell' || parts.length !== 5) {
    throw new OpError(
      'not_a_table_cell',
      'set_cell_computed must anchor the target table cell (section;block;row;cell;paragraph).'
    );
  }
  const tableAnchor = `${parts[0]};${parts[1]}`;
  const targetRow = Number(parts[2]);
  const targetColumn = Number(parts[3]);
  const operation = (op.operation ?? 'sum') as ComputeOperation;
  if (!COMPUTE_OPERATIONS.includes(operation)) {
    throw new OpError(
      'unsupported_operation',
      `Unsupported operation "${String(
        op.operation
      )}". Supported: ${COMPUTE_OPERATIONS.join(', ')}.`
    );
  }
  const column =
    op.column != null && Number.isInteger(op.column) && op.column >= 0
      ? op.column
      : targetColumn;

  // The same collection the table_column read serves: what the model read and
  // what the engine computes are the same cells by construction.
  const blocks = Array.from(byAnchor.values());
  const collected = collectTableColumnCells(blocks, tableAnchor, column);
  if (!collected) {
    throw new OpError(
      'table_not_found',
      `No table found at anchor "${tableAnchor}".`
    );
  }
  if (column >= collected.columns) {
    throw new OpError(
      'column_out_of_range',
      `The table at "${tableAnchor}" has ${collected.columns} columns (0-${
        collected.columns - 1
      }); column ${column} does not exist.`
    );
  }

  const lastRow = collected.rowCount - 1;
  const startRow = op.startRow != null ? op.startRow : Math.min(1, lastRow);
  const endRow = op.endRow != null ? op.endRow : lastRow;
  if (
    !Number.isInteger(startRow) ||
    !Number.isInteger(endRow) ||
    startRow < 0 ||
    endRow > lastRow ||
    startRow > endRow
  ) {
    throw new OpError(
      'row_range_invalid',
      `Rows must satisfy 0 <= startRow <= endRow <= ${lastRow}; got ${startRow}..${endRow}.`
    );
  }
  // The target row never feeds its own computation: a totals row's other
  // cells are labels, not data.
  const inRange = (row: number) =>
    row >= startRow && row <= endRow && row !== targetRow;
  const range = collected.cells.filter((cellEntry) => inRange(cellEntry.row));
  if (!range.length) {
    throw new OpError(
      'row_range_invalid',
      'The requested row range contains no rows besides the target row; there is nothing to compute.'
    );
  }

  const computation = computeColumn(range, operation, block.text);
  if (!computation.ok) {
    throw new OpError(computation.error, computation.message, computation.details);
  }

  selectBlock(editor, block);
  replaceSelectedText(editor, computation.renderedValue);
  verifyWrittenText(editor, block.anchor, computation.renderedValue);

  // Self-verification: re-read the column from the post-write document and
  // recompute. This proves the input cells are untouched AND the written cell
  // parses back to the exact computed value - a write that landed in the
  // wrong cell fails one of the two.
  const freshBlocks = flattenSfdt(parseSfdt(editor.serialize()));
  const freshCollected = collectTableColumnCells(freshBlocks, tableAnchor, column);
  const recheck =
    freshCollected && freshCollected.rowCount === collected.rowCount
      ? computeColumn(
          freshCollected.cells.filter((cellEntry) => inRange(cellEntry.row)),
          operation,
          computation.renderedValue
        )
      : null;
  if (
    !recheck ||
    !recheck.ok ||
    recheck.value.units !== computation.value.units ||
    recheck.value.scale !== computation.value.scale ||
    recheck.renderedValue !== computation.renderedValue
  ) {
    throw new OpError(
      'post_write_verification_failed',
      'Re-reading the column after the write did not reproduce the computed value; the write may have landed in the wrong cell. Nothing is reported as success.',
      [
        `computed: ${JSON.stringify(computation.renderedValue)}`,
        `re-read: ${
          !recheck
            ? 'the column shape changed during the write'
            : recheck.ok
            ? JSON.stringify(recheck.renderedValue)
            : recheck.message
        }`
      ]
    );
  }

  const headerCell = collected.cells.find((cellEntry) => cellEntry.row === 0);
  const withoutReceipt: Omit<ComputedCellReport, 'receipt'> = {
    operation,
    tableAnchor,
    column,
    header: headerCell?.text ?? null,
    renderedValue: computation.renderedValue,
    counted: computation.counted,
    // The engine enumerates every row index of the column; a row with no cell
    // at this column is still accounted for (skipped: missing_cell).
    rowsRead: collected.cells.length,
    rowCount: collected.rowCount,
    startRow,
    endRow,
    excludedTargetRow:
      targetRow >= startRow && targetRow <= endRow ? targetRow : null,
    skipped: computation.skipped,
    formatSource: computation.formatSource,
    rounded: computation.rounded,
    verifiedByReRead: true
  };
  const report: ComputedCellReport = {
    ...withoutReceipt,
    receipt: buildComputedReceipt(withoutReceipt)
  };
  return { computed: report };
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
  set_cell_computed: ({ editor, op, block, byAnchor }) =>
    runComputedCellWrite(editor, op, block, byAnchor),
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

// Applies one anchored op. `block` is the freshly-resolved block. Throws OpError
// on a recoverable failure (surfaced as {ok:false, error}).
function applyAnchoredOp(
  editor: LiveEditor,
  op: EditOp,
  block: FlatBlock,
  byAnchor: Map<string, FlatBlock>
): OpSuccessExtras | void {
  const liveText = selectBlock(editor, block);

  // Compare-and-swap guard: `expect` is the whole-block text the model believes
  // is still present. On mismatch we write nothing.
  if (
    op.expect != null &&
    liveText !== op.expect &&
    block.text !== String(op.expect)
  ) {
    throw new OpError(
      'stale_anchor',
      'The live text at this anchor does not match `expect`.',
      staleAnchorDetails(op.expect, liveText)
    );
  }

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
  return (
    handler as unknown as (ctx: {
      editor: LiveEditor;
      op: EditOp;
      block: FlatBlock;
      byAnchor: Map<string, FlatBlock>;
      liveText: string;
    }) => OpSuccessExtras | void
  )({ editor, op, block, byAnchor, liveText });
}

function applyAnchorlessOp(editor: LiveEditor, op: EditOp): void {
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
  op: TypedEditOp<'replace_all'>
): number {
  const find = String(op.find ?? '');
  if (!find) throw new OpError('missing_find', 'replace_all needs `find`.');
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
  'delete_text',
  'insert_text',
  'set_cell_text',
  'set_cell_computed',
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

// Applies a logical change set in deterministic phases. We preflight only the
// relevant anchors, re-resolve them after structural writes, and verify only
// each affected source/target pair; a large document never needs a full result
// inventory to prove inherited formatting succeeded.
export function applyDocumentEdits(
  editor: LiveEditor,
  input: { edits: EditOp[]; changeSetId?: string }
): ApplyEditsResult {
  const edits = Array.isArray(input?.edits) ? input.edits : [];
  const results: Array<EditResult | undefined> = new Array(edits.length);
  const warnings: string[] = [];
  const changeSetId =
    typeof input?.changeSetId === 'string' && input.changeSetId.trim()
      ? input.changeSetId.trim()
      : 'document-edit-change-set';
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
      ...(isOpError(err)
        ? err.details
          ? { details: err.details }
          : {}
        : { details: [describeUnexpectedError(err)] }),
      ...(isOpError(err) && err.retry ? { retry: err.retry } : {})
    };
  };

  // Phase 1: capture every pre-existing target/source before any write. Format
  // targets may be created by an earlier structural operation; sources may not.
  const hasStructuralEdits = edits.some(
    (op) => op?.op && !FORMAT_OPS.has(op.op) && !ANCHORLESS_OPS.has(op.op)
  );
  edits.forEach((op, index) => {
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
      indexedTarget.text !== String(op.expect);
    if (formatExpectMismatch && !hasStructuralEdits) {
      if (String(op.expect) === '') {
        // Schema-shaped tool calls carry every field on every op, so an EMPTY
        // expect aimed at real content in a shift-free set is an artifact of
        // the op schema, not an expectation; drop it rather than refuse the
        // block the anchor plainly names.
        delete (op as { expect?: unknown }).expect;
      } else {
        results[index] = {
          ok: false,
          op: name,
          anchor: op.anchor,
          error: 'stale_anchor',
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
      (name === 'set_cell_text' || name === 'set_cell_computed') &&
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
      op.expect != null &&
      target.text !== String(op.expect)
    ) {
      results[index] = {
        ok: false,
        op: name,
        anchor: op.anchor,
        error: 'stale_anchor',
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
              op as TypedEditOp<'replace_all'>
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
            if (mayShiftAnchors(op)) anchorsMayHaveShifted = true;
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
      uiGrouping: 'requires_cross_layer_group_card'
    }
  };
  if (inventory) response.inventory = inventory;
  return response;
}
