// How a table LOOKS, as data - the half of a table the document vocabulary
// could not see.
//
// Everything here is pure: it reads SyncFusion's serialized SFDT and computes
// over it. The engine's restripe finalizer (`finalizers/appearance.ts`)
// consumes these facts.
//
// What SyncFusion 34.1.31 actually stores, established by probing a real
// DocumentEditor:
//
//   * cell appearance lives on the cell's `cellFormat` (optimized key `tcpr`):
//     `shading`/`sd` -> `{ backgroundColor|bgc, foregroundColor|fgc, texture|t }`,
//     `borders`/`bdrs` -> eight sides, `verticalAlignment`/`va`;
//   * "no fill" is spelled TWO ways and they mean the same thing: the shading
//     object is absent/empty, or its background colour is the literal string
//     `"empty"`. SyncFusion returns `"empty"` from `selection.cellFormat
//     .background` for an unfilled cell and writes `"empty"` back when asked to
//     clear one, so the read must treat both as "no shading" or a copy is not
//     idempotent;
//   * `verticalAlignment` serializes as a NUMBER in optimized SFDT
//     (Top 0 / Center 1 / Bottom 2) and a string in full SFDT;
//   * a border's `lineStyle`/`ls` is likewise numeric in optimized SFDT, where
//     0 is `Single` and 1 is `None` - so 1 means NO border, not "a border";
//   * a colour is stored verbatim, with no normalisation. The read therefore
//     upper-cases it so that reading a `#d9e2f3` source and writing it into a
//     target produces a target that reads back equal to the source.
import type { TableLayoutFacts } from '../../../../utils/documentEditorPrimitives';

const OPTIMIZED_LINE_STYLES = [
  'Single',
  'None',
  'Dot',
  'DashSmallGap',
  'DashLargeGap',
  'DashDot',
  'DashDotDot',
  'Double',
  'Triple',
  'ThinThickSmallGap',
  'ThickThinSmallGap',
  'ThinThickThinSmallGap',
  'ThinThickMediumGap',
  'ThickThinMediumGap',
  'ThinThickThinMediumGap',
  'ThinThickLargeGap',
  'ThickThinLargeGap',
  'ThinThickThinLargeGap',
  'SingleWavy',
  'DoubleWavy',
  'DashDotStroked',
  'Emboss3D',
  'Engrave3D',
  'Outset',
  'Inset',
  'Thick',
  // 26. SyncFusion writes THIS, not `None`, when asked to remove a border - it is
  // what `applyBorders({ type: 'NoBorder', borderStyle: 'None' })` leaves behind.
  // Reading it as a real border made a cleared side look like a `"26"`-styled one
  // and `copy_table_format` never converged.
  'Cleared'
];

/** Line styles that are the ABSENCE of a border, however SyncFusion spells it. */
const NO_BORDER_STYLES = new Set(['None', 'Cleared']);

const VERTICAL_ALIGNMENTS = ['Top', 'Center', 'Bottom'] as const;
const WIDTH_TYPES = ['Auto', 'Percent', 'Point'] as const;
const TABLE_ALIGNMENTS = ['Left', 'Center', 'Right'] as const;

type CellVerticalAlignment = typeof VERTICAL_ALIGNMENTS[number];

/** The four sides `copy_table_format` and `set_cell_format` address. */
export const BORDER_SIDES = ['top', 'left', 'right', 'bottom'] as const;
export type BorderSide = typeof BORDER_SIDES[number];

/** One visible border. Never emitted for a `None`/absent side. */
export interface BorderFacts {
  style: string;
  /** Line width in points, when stated. */
  width?: number;
  /** `#RRGGBB` upper-cased, when stated. */
  color?: string;
}

interface BorderFactsBySide {
  /** Present INSTEAD of the four sides when all four are identical. */
  all?: BorderFacts;
  top?: BorderFacts;
  left?: BorderFacts;
  right?: BorderFacts;
  bottom?: BorderFacts;
}

/**
 * How one cell, row or table looks. Every field is absent when unset, so an
 * unstyled cell contributes NO appearance object at all and the read of a plain
 * table stays the size it is today.
 */
export interface AppearanceFacts {
  /** Background fill, `#RRGGBB` upper-cased. Absent means no fill. */
  shading?: string;
  /** Absent means SyncFusion's default (Top). */
  verticalAlignment?: CellVerticalAlignment;
  /** Absent means no visible border on any of the four sides. */
  borders?: BorderFactsBySide;
}

/** One row's appearance, plus the row-level flag Word calls "header row". */
interface RowAppearanceFacts {
  isHeader?: true;
  /** The appearance every present cell of the row SHARES, when they agree. */
  appearance?: AppearanceFacts;
}

/**
 * One table's appearance, cell by cell. `rows[r].appearance` describes the row
 * once when its cells agree (the banded case), and `rows[r].cells[c]` carries a
 * per-cell entry only where a cell differs from its row.
 */
export interface TableAppearance {
  /** The Word table style, when the table has one. Read-only: see writeTableStyleName. */
  styleName?: string;
  /** Table-level fill/borders, when set. */
  appearance?: AppearanceFacts;
  /** Width, placement, and column proportions, when the source states them. */
  layout?: TableLayoutFacts;
  rows: Array<
    RowAppearanceFacts & {
      /** Every cell, in column order. An unstyled cell is `undefined`. */
      cells: Array<AppearanceFacts | undefined>;
    }
  >;
}

/** `undefined` marks a row whose cells disagree: it can match no cycle entry. */
type RowShading = string | null | undefined;

export interface TableBanding {
  /** Rows above the stripe, left untouched by a restripe. */
  headerRows: number;
  period: number;
  /** The repeating fills, from the first banded row. `null` is "no fill". */
  cycle: Array<string | null>;
  /**
   * Whether the table's LAST body row sits in the stripe, i.e. carries the fill
   * the cycle predicts for its position. In a schedule that row is the totals
   * row: a template that shades it as the next band wants the band to run
   * through the total, while one that leaves it plain wants the
   * totals row styled by role. Read off the source, it travels with the banding
   * to every fragment a split produces, so a copy whose totals row was cloned
   * from a longer table is restriped for its own length.
   */
  tailInBand?: boolean;
}

// ---------------------------------------------------------------------------
// SFDT reading
// ---------------------------------------------------------------------------

// Reads a key under either its optimized or full SFDT spelling
function sfdtValue(obj: any, ...keys: string[]): any {
  if (!obj) return undefined;
  for (const key of keys) if (obj[key] !== undefined) return obj[key];
  return undefined;
}

function sfdtRows(tableBlock: any): any[] | undefined {
  const rows = sfdtValue(tableBlock, 'rows', 'r', 'rw');
  return Array.isArray(rows) ? rows : undefined;
}

function sfdtCells(row: any): any[] {
  const cells = sfdtValue(row, 'cells', 'c');
  return Array.isArray(cells) ? cells : [];
}

function sfdtCellFormat(cell: any): any {
  return sfdtValue(cell, 'cellFormat', 'tcpr', 'cf') ?? {};
}

function sfdtRowFormat(row: any): any {
  return sfdtValue(row, 'rowFormat', 'trpr', 'rf') ?? {};
}

function sfdtTableFormat(tableBlock: any): any {
  return sfdtValue(tableBlock, 'tableFormat', 'tblpr', 'tf') ?? {};
}

/** SyncFusion's two spellings of "no colour" plus the absent case. */
function readColor(raw: any): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (!value || value.toLowerCase() === 'empty') return undefined;
  return value.toUpperCase();
}

function readLineStyle(raw: any): string | undefined {
  if (typeof raw === 'number')
    return OPTIMIZED_LINE_STYLES[raw] ?? `LineStyle${raw}`;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return undefined;
}

function readBorder(raw: any): BorderFacts | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if (sfdtValue(raw, 'hasNoneStyle', 'hns')) return undefined;
  const style = readLineStyle(sfdtValue(raw, 'lineStyle', 'ls'));
  // No style, or one of SyncFusion's two spellings of "removed", is not a border.
  if (!style || NO_BORDER_STYLES.has(style)) return undefined;
  const width = Number(sfdtValue(raw, 'lineWidth', 'lw'));
  const color = readColor(sfdtValue(raw, 'color', 'c'));
  return {
    style,
    ...(Number.isFinite(width) && width > 0 ? { width } : {}),
    ...(color ? { color } : {})
  };
}

// An unstated border colour is not "no colour" - it renders black, which is
// exactly what an explicit #000000 renders as. Whether a given document happens
// to spell the default out is a serialization detail, so the two must compare
// equal or an appearance that landed correctly reads as a mismatch. Normalized
// here rather than in readColor, because that reader also supplies the values
// written back, and writing the default out explicitly would state something
// the document never carried.
const AUTO_BORDER_COLOR = '#000000';
const borderColorOf = (border: BorderFacts): string =>
  border.color ?? AUTO_BORDER_COLOR;

function sameBorder(a?: BorderFacts, b?: BorderFacts): boolean {
  if (!a || !b) return !a && !b;
  return (
    a.style === b.style &&
    a.width === b.width &&
    borderColorOf(a) === borderColorOf(b)
  );
}

function readBorders(
  format: any,
  requireInsideForAll = false
): BorderFactsBySide | undefined {
  const raw = sfdtValue(format, 'borders', 'bdrs');
  if (!raw) return undefined;
  const sides: Record<BorderSide, BorderFacts | undefined> = {
    top: readBorder(sfdtValue(raw, 'top', 'tp')),
    left: readBorder(sfdtValue(raw, 'left', 'lt')),
    right: readBorder(sfdtValue(raw, 'right', 'rg')),
    bottom: readBorder(sfdtValue(raw, 'bottom', 'bt'))
  };
  const present = BORDER_SIDES.filter((side) => sides[side]);
  if (!present.length) return undefined;
  if (
    present.length === BORDER_SIDES.length &&
    BORDER_SIDES.every((side) => sameBorder(sides[side], sides.top)) &&
    (!requireInsideForAll ||
      (sameBorder(readBorder(sfdtValue(raw, 'horizontal', 'h')), sides.top) &&
        sameBorder(readBorder(sfdtValue(raw, 'vertical', 'v')), sides.top)))
  )
    return { all: sides.top };
  const out: BorderFactsBySide = {};
  for (const side of BORDER_SIDES) if (sides[side]) out[side] = sides[side];
  return out;
}

/**
 * `Top` is reported as ABSENT, deliberately. It is SyncFusion's default, so a
 * cell that never had a vertical alignment and a cell explicitly set to Top look
 * identical - and clearing an alignment can only be spelled as "set it to Top".
 * Distinguishing them would make `copy_table_format` non-idempotent: the copy
 * writes Top into every cell whose source has no alignment, and a second copy
 * would then see a difference that is not one.
 */
function readVerticalAlignment(raw: any): CellVerticalAlignment | undefined {
  const value =
    typeof raw === 'number'
      ? VERTICAL_ALIGNMENTS[raw]
      : typeof raw === 'string'
      ? VERTICAL_ALIGNMENTS.find(
          (member) => member.toLowerCase() === raw.trim().toLowerCase()
        )
      : undefined;
  return value === 'Top' ? undefined : value;
}

function readEnum<T extends readonly string[]>(
  raw: any,
  values: T
): T[number] | undefined {
  if (typeof raw === 'number') return values[raw];
  if (typeof raw !== 'string') return undefined;
  return values.find(
    (member) => member.toLowerCase() === raw.trim().toLowerCase()
  );
}

function readColumnLayout(
  rawRows: any[]
): Pick<TableLayoutFacts, 'columnWidths' | 'columnWidthType'> | undefined {
  const candidates = rawRows
    .map((row) => sfdtCells(row))
    .filter((cells) => cells.length > 0)
    .sort((left, right) => right.length - left.length);
  for (const cells of candidates) {
    if (
      cells.some(
        (cell) =>
          Number(sfdtValue(sfdtCellFormat(cell), 'columnSpan', 'colsp')) > 1
      )
    )
      continue;
    const formats = cells.map(sfdtCellFormat);
    const preferred = formats.map((format) =>
      Number(sfdtValue(format, 'preferredWidth', 'pw'))
    );
    const widthTypes = formats.map(
      (format) =>
        readEnum(sfdtValue(format, 'preferredWidthType', 'pwt'), WIDTH_TYPES) ??
        'Auto'
    );
    if (
      preferred.every((width) => Number.isFinite(width) && width > 0) &&
      widthTypes.every((type) => type === widthTypes[0])
    )
      return { columnWidths: preferred, columnWidthType: widthTypes[0] };
    const rendered = formats.map((format) =>
      Number(sfdtValue(format, 'cellWidth', 'cw'))
    );
    if (rendered.every((width) => Number.isFinite(width) && width > 0))
      return { columnWidths: rendered, columnWidthType: 'Point' };
  }
  return undefined;
}

/**
 * What a table layout means when the SFDT states none of it. SyncFusion's own
 * widget always reports a concrete value (and materializes rendered column
 * widths after layout), so this is the only honest reading of "the document said
 * nothing" - and it is what a restore has to put back, or a reject would leave
 * an explicit `allowAutoFit: false` and a point-width grid the document never
 * had. `readTableLayout` builds every stated layout from it too, so absence has
 * exactly one meaning.
 */
export const UNSTATED_TABLE_LAYOUT: TableLayoutFacts = {
  preferredWidth: 0,
  preferredWidthType: 'Auto',
  leftIndent: 0,
  tableAlignment: 'Left',
  allowAutoFit: true
};

function readTableLayout(
  tableFormat: any,
  rawRows: any[]
): TableLayoutFacts | undefined {
  const columnLayout = readColumnLayout(rawRows);
  const rawPreferredWidth = sfdtValue(tableFormat, 'preferredWidth', 'pw');
  const rawPreferredWidthType = sfdtValue(
    tableFormat,
    'preferredWidthType',
    'pwt'
  );
  const rawLeftIndent = sfdtValue(tableFormat, 'leftIndent', 'lin');
  const rawAlignment = sfdtValue(tableFormat, 'tableAlignment', 'ta');
  const rawAllowAutoFit = sfdtValue(tableFormat, 'allowAutoFit', 'auft');
  const hasTableLayout =
    rawPreferredWidth !== undefined ||
    rawPreferredWidthType !== undefined ||
    rawLeftIndent !== undefined ||
    rawAlignment !== undefined ||
    rawAllowAutoFit !== undefined;
  if (!hasTableLayout && !columnLayout) return undefined;
  const preferredWidth = Number(rawPreferredWidth);
  const leftIndent = Number(rawLeftIndent);
  return {
    ...UNSTATED_TABLE_LAYOUT,
    ...(Number.isFinite(preferredWidth) ? { preferredWidth } : {}),
    ...(readEnum(rawPreferredWidthType, WIDTH_TYPES)
      ? { preferredWidthType: readEnum(rawPreferredWidthType, WIDTH_TYPES) }
      : {}),
    ...(Number.isFinite(leftIndent) ? { leftIndent } : {}),
    ...(readEnum(rawAlignment, TABLE_ALIGNMENTS)
      ? { tableAlignment: readEnum(rawAlignment, TABLE_ALIGNMENTS) }
      : {}),
    ...(rawAllowAutoFit === undefined
      ? {}
      : { allowAutoFit: Boolean(rawAllowAutoFit) }),
    ...columnLayout
  };
}

function readAppearanceFrom(
  format: any,
  withAlignment: boolean,
  tableLevel = false
) {
  const shading = readColor(
    sfdtValue(
      sfdtValue(format, 'shading', 'sd') ?? {},
      'backgroundColor',
      'bgc'
    )
  );
  const borders = readBorders(format, tableLevel);
  const verticalAlignment = withAlignment
    ? readVerticalAlignment(sfdtValue(format, 'verticalAlignment', 'va'))
    : undefined;
  const facts: AppearanceFacts = {
    ...(shading ? { shading } : {}),
    ...(verticalAlignment ? { verticalAlignment } : {}),
    ...(borders ? { borders } : {})
  };
  return Object.keys(facts).length ? facts : undefined;
}

function readCellAppearance(cell: any): AppearanceFacts | undefined {
  return readAppearanceFrom(sfdtCellFormat(cell), true);
}

/**
 * The four sides a border set actually draws, with `all` expanded.
 *
 * `{ all: X }` and `{ top: X, left: X, right: X, bottom: X }` are the same
 * border in two spellings - `readBorders` emits the first when all four agree
 * and the second otherwise, so which one a given read produces depends on
 * incidental facts about the cell. Every comparison goes through here, so no
 * caller can accidentally compare the spelling instead of the border.
 */
function borderSides(
  borders?: BorderFactsBySide
): Record<BorderSide, BorderFacts | undefined> {
  const all = borders?.all;
  return {
    top: borders?.top ?? all,
    left: borders?.left ?? all,
    right: borders?.right ?? all,
    bottom: borders?.bottom ?? all
  };
}

export function appearanceEquals(
  a?: AppearanceFacts,
  b?: AppearanceFacts
): boolean {
  if (!a || !b) return !a && !b;
  if (a.shading !== b.shading) return false;
  if (a.verticalAlignment !== b.verticalAlignment) return false;
  const ab = a.borders;
  const bb = b.borders;
  if (!ab || !bb) return !ab && !bb;
  const as = borderSides(ab);
  const bs = borderSides(bb);
  return BORDER_SIDES.every((side) => sameBorder(as[side], bs[side]));
}

/**
 * One table's appearance. `tableBlock` is the raw SFDT block; returns null when
 * it is not a table.
 */
export function collectTableAppearance(
  tableBlock: any
): TableAppearance | null {
  const rawRows = sfdtRows(tableBlock);
  if (!rawRows) return null;
  const tableFormat = sfdtTableFormat(tableBlock);
  const styleName = sfdtValue(tableFormat, 'styleName', 'stn');
  const rows: TableAppearance['rows'] = rawRows.map((rawRow: any) => {
    const cells = sfdtCells(rawRow).map((cell) => readCellAppearance(cell));
    const shared =
      cells.length > 0 &&
      cells.every((entry) => appearanceEquals(entry, cells[0]))
        ? cells[0]
        : undefined;
    return {
      ...(sfdtValue(sfdtRowFormat(rawRow), 'isHeader', 'hdr')
        ? { isHeader: true as const }
        : {}),
      // The row describes itself once when its cells agree; per-cell entries
      // then repeat nothing. This is what keeps a 12x5 banded table's
      // appearance a handful of keys instead of sixty.
      ...(shared ? { appearance: shared } : {}),
      cells: shared ? cells.map(() => undefined) : cells
    };
  });
  const tableLevel = readAppearanceFrom(tableFormat, false, true);
  const layout = readTableLayout(tableFormat, rawRows);
  return {
    ...(typeof styleName === 'string' && styleName.trim()
      ? { styleName: styleName.trim() }
      : {}),
    ...(tableLevel ? { appearance: tableLevel } : {}),
    ...(layout ? { layout } : {}),
    rows
  };
}

// ---------------------------------------------------------------------------
// Banding
//
// A banded table's stripe is a repeating cycle of row fills below some number
// of header rows. Both are INFERRED - even/odd is not assumed, and neither is
// "row 0 is a header": plenty of real tables start banding at row 0, and
// plenty put a differently-coloured banner row above it.
// ---------------------------------------------------------------------------

/** Longest cycle a stripe may have. Beyond this it is not a stripe. */
const MAX_BAND_PERIOD = 4;

/**
 * How much of the body a candidate cycle must explain to be accepted. A
 * mid-table insert flips the parity of every row below it, so a real stripe is
 * routinely only ~60% self-consistent by the time anyone asks to repair it -
 * demanding more would refuse exactly the tables this exists to fix.
 */
const BAND_FIT_THRESHOLD = 0.6;

/** Each row reduced to the one fill its cells share (see RowShading). */
export function rowShadings(appearance: TableAppearance): RowShading[] {
  return appearance.rows.map((row) => {
    if (!row.cells.length) return null;
    const explicit = row.cells.filter((cell) => cell !== undefined);
    if (row.appearance && !explicit.length)
      return row.appearance.shading ?? null;
    if (!explicit.length) return null;
    // Cells disagree: the row has no single fill.
    if (explicit.length !== row.cells.length) return undefined;
    const first = explicit[0]?.shading ?? null;
    return explicit.every((cell) => (cell?.shading ?? null) === first)
      ? first
      : undefined;
  });
}

/**
 * How many leading rows sit above the stripe.
 *
 * Word's own `isHeader` flag decides it when the table carries one. Otherwise a
 * first row whose fill NO other row repeats is a banner, not a band - and a
 * first row whose fill recurs below is the start of the stripe itself.
 */
export function inferHeaderRows(appearance: TableAppearance): number {
  let flagged = 0;
  while (flagged < appearance.rows.length && appearance.rows[flagged].isHeader)
    flagged++;
  // Reported as-is, even when EVERY row is flagged. Clamping this to leave one
  // body row was meant to protect the stripe maths, but those callers already
  // handle an empty body - and the clamp made a table stripped to its header
  // row answer "0 header rows", i.e. claim its header was a data row. Every
  // rule built on that answer then treated the header as the data-row example,
  // which is how a newly inserted row came back navy and bold.
  if (flagged > 0) return flagged;
  const shadings = rowShadings(appearance);
  // A banner needs at least one row below it to be a banner OVER.
  if (shadings.length < 2) return 0;
  const first = shadings[0];
  if (first === undefined) return 0;
  const recurs = shadings.slice(1).some((value) => value === first);
  return recurs ? 0 : 1;
}

/**
 * The table's own stripe, or null when it has none.
 *
 * The cycle is SEEDED FROM THE FIRST BODY ROWS, not fitted globally, because a
 * repair has to know which end of the table is right. Damage propagates
 * DOWNWARD - insert a row and every row below it flips - so the top of the
 * stripe is the evidence and the bottom is the symptom.
 *
 * Guards that keep it from inventing a pattern:
 *   * the seed must not be constant - one highlighted row is not a stripe;
 *   * the body must be at least two full cycles long;
 *   * for a cycle of three or more, every fill in it must occur at least TWICE in
 *     the body, so a single odd row cannot become a period-4 "pattern".
 *
 * A body using exactly TWO fills with an alternating seed is accepted as a
 * 2-cycle without a fit test: two alternating colours ARE two bands, and the fit
 * ratio there measures how badly the stripe was damaged rather than whether it
 * exists - one mid-table insert already drops it to 0.4. Longer cycles still have
 * to explain BAND_FIT_THRESHOLD of the body.
 *
 * `strict` raises that last concession for the AUTOMATIC caller. `insert_row`
 * restripes without being asked, so it must not read a stripe into a table that
 * merely has one highlighted row: under `strict` both fills of a 2-cycle have to
 * occur at least twice. An explicit `restripe_table` was asked for and takes the
 * liberal reading, which is what lets it repair a table down to its last
 * surviving band.
 *
 * Known limit, stated rather than papered over: when the DAMAGE is in the seed
 * rows themselves the seed is wrong, and this declines (`noBandingDetected`)
 * instead of guessing. `insert_row` never depends on that case - it captures the
 * stripe before the edit, while it is still unambiguous.
 */
export function detectTableBanding(
  appearance: TableAppearance,
  options: { strict?: boolean } = {}
): TableBanding | null {
  const headerRows = inferHeaderRows(appearance);
  const body = rowShadings(appearance).slice(headerRows);
  if (body.length < 3) return null;
  const distinct = new Set(body.filter((value) => value !== undefined));
  if (distinct.size < 2) return null;
  const corroborated = (cycle: RowShading[]) =>
    cycle.every((value) => body.filter((entry) => entry === value).length >= 2);
  // Smallest qualifying period wins.
  for (let period = 2; period <= MAX_BAND_PERIOD; period++) {
    if (body.length < period * 2) break;
    const cycle = body.slice(0, period);
    if (cycle.some((value) => value === undefined)) continue;
    if (cycle.every((value) => value === cycle[0])) continue;
    const twoColourStripe = period === 2 && distinct.size === 2;
    if ((!twoColourStripe || options.strict) && !corroborated(cycle)) continue;
    const tailInBand =
      body[body.length - 1] === cycle[(body.length - 1) % period];
    if (twoColourStripe)
      return {
        headerRows,
        period,
        cycle: cycle as Array<string | null>,
        tailInBand
      };
    let matches = 0;
    for (let index = 0; index < body.length; index++)
      if (body[index] === cycle[index % period]) matches++;
    if (matches / body.length >= BAND_FIT_THRESHOLD)
      return {
        headerRows,
        period,
        cycle: cycle as Array<string | null>,
        tailInBand
      };
  }
  return null;
}

/** The fill row `row` should carry under `banding`, or undefined for a header. */
export function bandedShadingForRow(
  banding: TableBanding,
  row: number
): string | null | undefined {
  if (row < banding.headerRows) return undefined;
  return banding.cycle[(row - banding.headerRows) % banding.period];
}
