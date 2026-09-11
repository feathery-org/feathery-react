import {
  CELL_HORIZONTAL_PADDING,
  FONT_SIZE,
  GRID_FONT_FAMILY,
  HEADER_FONT_SIZE,
  HEADER_FONT_WEIGHT,
  HEADER_HEIGHT,
  ROW_HEIGHT
} from './styles';

export type SpreadsheetFont = {
  size: number;
  weight: number | string;
  family?: string;
};

export type SpreadsheetGeometry = {
  rowHeight: number;
  headerHeight: number;
  horizontalPadding: number;
  cellFont: SpreadsheetFont;
  headerFont: SpreadsheetFont;
};

export const DEFAULT_SPREADSHEET_GEOMETRY: SpreadsheetGeometry = {
  rowHeight: ROW_HEIGHT,
  headerHeight: HEADER_HEIGHT,
  horizontalPadding: CELL_HORIZONTAL_PADDING / 2,
  cellFont: { size: FONT_SIZE, weight: 400, family: GRID_FONT_FAMILY },
  headerFont: {
    size: HEADER_FONT_SIZE,
    weight: HEADER_FONT_WEIGHT,
    family: GRID_FONT_FAMILY
  }
};

/** The style compiler emits sanitized pixel lengths for these variables. */
export function readSpreadsheetGeometry(
  styles: Pick<CSSStyleDeclaration, 'getPropertyValue'>
): SpreadsheetGeometry {
  const value = (name: string) =>
    styles.getPropertyValue(`--feathery-table-${name}`).trim();
  const length = (name: string, fallback: number, allowZero = false) => {
    const raw = value(name);
    const parsed = Number(raw.replace(/px$/, ''));
    return raw &&
      Number.isFinite(parsed) &&
      (allowZero ? parsed >= 0 : parsed > 0)
      ? parsed
      : fallback;
  };
  const cellFont = {
    size: length('font-size', FONT_SIZE),
    weight: value('font-weight') || 400,
    family: value('font-family') || GRID_FONT_FAMILY
  };
  const headerFont = {
    size: length('header-font-size', HEADER_FONT_SIZE),
    weight: value('header-font-weight') || HEADER_FONT_WEIGHT,
    family: cellFont.family
  };
  const verticalPadding = length('cell-padding-vertical', 0, true);
  return {
    // Leave room for a normal text line, padding and the grid border. All
    // virtual offsets and rendered cells use these same effective heights.
    rowHeight: Math.max(
      length('row-height', ROW_HEIGHT),
      Math.ceil(cellFont.size * 1.2 + verticalPadding * 2 + 2)
    ),
    headerHeight: Math.max(
      length('header-height', HEADER_HEIGHT),
      Math.ceil(headerFont.size * 1.2 + verticalPadding * 2 + 2)
    ),
    horizontalPadding: length(
      'cell-padding-horizontal',
      CELL_HORIZONTAL_PADDING / 2,
      true
    ),
    cellFont,
    headerFont
  };
}
