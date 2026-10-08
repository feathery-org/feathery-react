// Apply the editable subset of the active-slide JSON back to the XML-backed model.
// Validate the entire draft first, so malformed or unsupported edits make no changes.
import {
  deckToJSON,
  type SlideJSON,
  type ShapeJSON,
  type TableJSON,
  type RunJSON
} from './json';
import {
  addTableColumn,
  addTableRow,
  removeTableColumn,
  removeTableRow,
  setParagraphAlignAt,
  setShapeFillColor,
  setShapeGeometry,
  setSlideBackground,
  setPictureCrop,
  setTableCellPlainText,
  setTableCellRangeAlign,
  setTableCellRangeStyle,
  setTableColumnWidth,
  setTableRowHeight,
  setTextRunValue,
  tableCellIsPlainEditable,
  type PictureCrop,
  type TextStyle
} from './edit';
import { tableCell, tableCellText, tableColumns, tableRows } from './table';
import { getAttr } from '../opc/xml';
import type { Deck, Slide, Shape, Xfrm } from './types';
import { effectiveSlideSize, setSlideSize } from './slideSize';

export interface JSONApplyResult {
  shapeIds: string[];
  background: boolean;
  slideSize?: true;
}

type Obj = Record<string, unknown>;
const editableRunKeys = [
  'text',
  'bold',
  'italic',
  'underline',
  'strike',
  'sizePt',
  'color',
  'highlight',
  'baselinePct',
  'font'
] as const;

function obj(value: unknown, path: string): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${path} must be an object`);
  return value as Obj;
}
function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => same(v, b[i]))
    );
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const aa = a as Obj;
    const bb = b as Obj;
    const keys = Object.keys(aa);
    const other = Object.keys(bb);
    return (
      keys.length === other.length &&
      keys.every((key) => key in bb && same(aa[key], bb[key]))
    );
  }
  return false;
}
function mask(proposed: Obj, base: Obj, editable: readonly string[]): Obj {
  const copy = { ...proposed };
  for (const key of editable) {
    if (key in base) copy[key] = base[key];
    else delete copy[key];
  }
  return copy;
}
function immutable(
  proposed: Obj,
  base: Obj,
  editable: readonly string[],
  path: string
): void {
  if (!same(mask(proposed, base, editable), base))
    throw new Error(`${path} contains an unsupported edit`);
}
function finite(value: unknown, path: string, min = -Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min)
    throw new Error(
      `${path} must be a finite number${min > -Infinity ? ` ≥ ${min}` : ''}`
    );
  return value;
}
function emu(value: unknown, path: string, min = -Infinity): number {
  const number = finite(value, path, min);
  if (!Number.isInteger(number))
    throw new Error(`${path} must be an integer EMU value`);
  return number;
}
function color(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value))
    throw new Error(`${path} must be a #RRGGBB color`);
  return value.slice(1).toUpperCase();
}

interface RunEdit {
  paragraph: number;
  run: number;
  text?: string;
  style: TextStyle;
}
interface ParagraphEdit {
  paragraph: number;
  align: 'l' | 'ctr' | 'r' | 'just';
}
interface ShapeEdit {
  shape: Shape;
  frame: Partial<Xfrm>;
  /** New solid fill; null clears the explicit fill back to inherited. */
  fill?: string | null;
  picture?: PictureCrop;
  table?: TableJSON;
  runs: RunEdit[];
  paragraphs: ParagraphEdit[];
}

function validatePicture(
  base: NonNullable<ShapeJSON['picture']>,
  proposed: unknown,
  path: string
): PictureCrop | undefined {
  const picture = obj(proposed, `${path}.picture`);
  immutable(
    picture,
    base as unknown as Obj,
    ['clipGeometry', 'cropPct'],
    `${path}.picture`
  );
  if (!['rect', 'ellipse'].includes(String(picture.clipGeometry)))
    throw new Error(`${path}.picture.clipGeometry must be rect or ellipse`);
  const crop = obj(picture.cropPct, `${path}.picture.cropPct`);
  if (!same(Object.keys(crop).sort(), ['bottom', 'left', 'right', 'top']))
    throw new Error(
      `${path}.picture.cropPct must contain left, top, right, and bottom`
    );
  const values = Object.fromEntries(
    ['left', 'top', 'right', 'bottom'].map((edge) => [
      edge,
      finite(crop[edge], `${path}.picture.cropPct.${edge}`, 0)
    ])
  ) as PictureCrop['cropPct'];
  for (const [edge, value] of Object.entries(values))
    if (value >= 100)
      throw new Error(`${path}.picture.cropPct.${edge} must be less than 100`);
  if (values.left + values.right >= 100 || values.top + values.bottom >= 100)
    throw new Error(`${path}.picture.cropPct must leave visible image content`);
  if (same(picture, base)) return undefined;
  return {
    clipGeometry: picture.clipGeometry as PictureCrop['clipGeometry'],
    cropPct: values
  };
}

function validateFrame(
  base: ShapeJSON,
  proposed: Obj,
  path: string
): Partial<Xfrm> {
  const current = base.frameEMU;
  if (!current) {
    if (!same(proposed.frameEMU, null))
      throw new Error(`${path}.frameEMU cannot be edited`);
    return {};
  }
  const next = obj(proposed.frameEMU, `${path}.frameEMU`);
  if (!same(Object.keys(next).sort(), Object.keys(current).sort()))
    throw new Error(`${path}.frameEMU has unsupported keys`);
  const patch: Partial<Xfrm> = {};
  for (const key of ['x', 'y', 'cx', 'cy', 'rot'] as const) {
    const value = emu(
      next[key],
      `${path}.frameEMU.${key}`,
      key === 'cx' || key === 'cy' ? 1 : -Infinity
    );
    if (value !== current[key]) patch[key] = value;
  }
  for (const key of ['flipH', 'flipV'] as const) {
    if (typeof next[key] !== 'boolean')
      throw new Error(`${path}.frameEMU.${key} must be true or false`);
    if (next[key] !== current[key]) patch[key] = next[key] as boolean;
  }
  return patch;
}

function validateTable(
  base: TableJSON,
  proposed: unknown,
  shape: Shape,
  path: string
): TableJSON | undefined {
  const table = obj(proposed, `${path}.table`);
  immutable(
    table,
    base as unknown as Obj,
    ['columns', 'rows'],
    `${path}.table`
  );
  const columns = list(table.columns, `${path}.table.columns`);
  const rows = list(table.rows, `${path}.table.rows`);
  if (!columns.length || !rows.length)
    throw new Error(`${path}.table needs at least one row and column`);
  const changedStructure =
    columns.length !== base.columns.length || rows.length !== base.rows.length;
  if (
    changedStructure &&
    base.rows.some((row) => row.cells.length !== base.columns.length)
  )
    throw new Error(
      `${path}.table has merged/irregular cells; JSON cannot change its grid size`
    );
  columns.forEach((entry, ci) => {
    const column = obj(entry, `${path}.table.columns[${ci}]`);
    if (!same(Object.keys(column), ['widthEMU']))
      throw new Error(`${path}.table.columns[${ci}] has unsupported keys`);
    emu(column.widthEMU, `${path}.table.columns[${ci}].widthEMU`, 90000);
  });
  rows.forEach((entry, ri) => {
    const row = obj(entry, `${path}.table.rows[${ri}]`);
    if (!same(Object.keys(row).sort(), ['cells', 'heightEMU']))
      throw new Error(`${path}.table.rows[${ri}] has unsupported keys`);
    emu(row.heightEMU, `${path}.table.rows[${ri}].heightEMU`, 90000);
    const cells = list(row.cells, `${path}.table.rows[${ri}].cells`);
    const expected =
      ri < base.rows.length && !changedStructure
        ? base.rows[ri].cells.length
        : columns.length;
    if (cells.length !== expected)
      throw new Error(`${path}.table.rows[${ri}] needs ${expected} cells`);
    cells.forEach((entry, ci) => {
      const cell = obj(entry, `${path}.table.rows[${ri}].cells[${ci}]`);
      const baseCell =
        base.rows[Math.min(ri, base.rows.length - 1)]?.cells[
          Math.min(ci, base.rows[0]?.cells.length - 1)
        ];
      if (
        baseCell &&
        !changedStructure &&
        !same(Object.keys(cell).sort(), Object.keys(baseCell).sort())
      )
        throw new Error(
          `${path}.table.rows[${ri}].cells[${ci}] has unsupported keys`
        );
      if (baseCell && !changedStructure)
        immutable(
          cell,
          baseCell as unknown as Obj,
          ['text', 'align', 'verticalAlign', 'fill'],
          `${path}.table.rows[${ri}].cells[${ci}]`
        );
      if (
        changedStructure &&
        !Object.keys(cell).every((key) =>
          [
            'columnIndex',
            'text',
            'align',
            'verticalAlign',
            'fill',
            'gridSpan',
            'rowSpan',
            'mergeContinuation',
            'borders',
            'paragraphs'
          ].includes(key)
        )
      )
        throw new Error(
          `${path}.table.rows[${ri}].cells[${ci}] has unsupported keys`
        );
      if (cell.columnIndex !== ci)
        throw new Error(
          `${path}.table.rows[${ri}].cells[${ci}].columnIndex must remain ${ci}`
        );
      if (typeof cell.text !== 'string')
        throw new Error(
          `${path}.table.rows[${ri}].cells[${ci}].text must be a string`
        );
      if (
        cell.align !== undefined &&
        !['l', 'ctr', 'r', 'just'].includes(String(cell.align))
      )
        throw new Error(
          `${path}.table.rows[${ri}].cells[${ci}].align is invalid`
        );
      if (
        cell.verticalAlign !== undefined &&
        !['t', 'ctr', 'b'].includes(String(cell.verticalAlign))
      )
        throw new Error(
          `${path}.table.rows[${ri}].cells[${ci}].verticalAlign is invalid`
        );
      if (cell.fill !== undefined)
        color(cell.fill, `${path}.table.rows[${ri}].cells[${ci}].fill`);
      if (
        ri < base.rows.length &&
        ci < base.rows[ri].cells.length &&
        cell.text !== base.rows[ri].cells[ci].text &&
        !tableCellIsPlainEditable(shape, ri, ci)
      ) {
        throw new Error(
          `${path}.table.rows[${ri}].cells[${ci}] has rich text; edit its runs on the slide`
        );
      }
    });
  });
  return same(table, base) ? undefined : (table as unknown as TableJSON);
}

function validateRun(
  base: RunJSON,
  proposed: unknown,
  path: string
): { text?: string; style: TextStyle } | undefined {
  const run = obj(proposed, path);
  immutable(run, base as unknown as Obj, editableRunKeys, path);
  if (same(run, base)) return undefined;
  if (base.node !== 'run')
    throw new Error(
      `${path} is a field or break; its JSON values are read-only`
    );
  if (
    !same(run.text, base.text) &&
    (typeof run.text !== 'string' || run.text.includes('\n'))
  )
    throw new Error(`${path}.text must be a single-line string`);
  const style: TextStyle = {};
  for (const key of ['bold', 'italic', 'underline', 'strike'] as const) {
    if (run[key] !== undefined && typeof run[key] !== 'boolean')
      throw new Error(`${path}.${key} must be true or false`);
    if (!same(run[key], base[key])) style[key] = run[key] === true;
  }
  if (!same(run.sizePt, base.sizePt)) {
    style.sizePt = finite(run.sizePt, `${path}.sizePt`, 1);
  }
  if (!same(run.color, base.color))
    style.color = color(run.color, `${path}.color`);
  if (!same(run.highlight, base.highlight))
    style.highlight =
      run.highlight == null ? null : color(run.highlight, `${path}.highlight`);
  if (!same(run.baselinePct, base.baselinePct))
    style.baselinePct =
      run.baselinePct == null
        ? 0
        : finite(run.baselinePct, `${path}.baselinePct`);
  if (!same(run.font, base.font)) {
    if (typeof run.font !== 'string' || !run.font.trim())
      throw new Error(`${path}.font must be a nonempty string`);
    style.font = run.font;
  }
  return {
    text: run.text !== base.text ? (run.text as string) : undefined,
    style
  };
}

function validateText(
  base: NonNullable<ShapeJSON['text']>,
  proposed: unknown,
  path: string
): { runs: RunEdit[]; paragraphs: ParagraphEdit[] } {
  const text = obj(proposed, `${path}.text`);
  immutable(text, base as unknown as Obj, ['paragraphs'], `${path}.text`);
  const paras = list(text.paragraphs, `${path}.text.paragraphs`);
  if (paras.length !== base.paragraphs.length)
    throw new Error(
      `${path}.text.paragraphs cannot add or remove paragraphs from JSON`
    );
  const runs: RunEdit[] = [];
  const paragraphs: ParagraphEdit[] = [];
  paras.forEach((entry, pi) => {
    const para = obj(entry, `${path}.text.paragraphs[${pi}]`);
    const source = base.paragraphs[pi];
    immutable(
      para,
      source as unknown as Obj,
      ['align', 'runs'],
      `${path}.text.paragraphs[${pi}]`
    );
    if (!same(para.align, source.align)) {
      const align = para.align ?? 'l';
      if (!['l', 'ctr', 'r', 'just'].includes(String(align)))
        throw new Error(`${path}.text.paragraphs[${pi}].align is invalid`);
      paragraphs.push({
        paragraph: pi,
        align: align as ParagraphEdit['align']
      });
    }
    const nextRuns = list(para.runs, `${path}.text.paragraphs[${pi}].runs`);
    if (nextRuns.length !== source.runs.length)
      throw new Error(
        `${path}.text.paragraphs[${pi}].runs cannot add or remove runs from JSON`
      );
    nextRuns.forEach((entry, ri) => {
      const change = validateRun(
        source.runs[ri],
        entry,
        `${path}.text.paragraphs[${pi}].runs[${ri}]`
      );
      if (change) runs.push({ paragraph: pi, run: ri, ...change });
    });
  });
  return { runs, paragraphs };
}

/** Applies an edited active-slide projection. Unsupported fields fail visibly. */
export function applySlideJSON(
  deck: Deck,
  slide: Slide,
  proposed: unknown
): JSONApplyResult {
  const slideIndex = deck.slides.indexOf(slide);
  if (slideIndex < 0) throw new Error('The slide is no longer in the deck');
  const base = JSON.parse(
    JSON.stringify(deckToJSON(deck).slides[slideIndex])
  ) as SlideJSON;
  const draft = obj(proposed, 'slide');
  immutable(
    draft,
    base as unknown as Obj,
    ['sizeEMU', 'background', 'shapes'],
    'slide'
  );
  const currentSize = effectiveSlideSize(deck, slide);
  const proposedSize = obj(draft.sizeEMU, 'slide.sizeEMU');
  if (!same(Object.keys(proposedSize).sort(), ['cx', 'cy']))
    throw new Error('slide.sizeEMU must contain cx and cy');
  const nextSize = {
    cx: emu(proposedSize.cx, 'slide.sizeEMU.cx', 914400),
    cy: emu(proposedSize.cy, 'slide.sizeEMU.cy', 914400)
  };
  const sizeChanged =
    nextSize.cx !== currentSize.cx || nextSize.cy !== currentSize.cy;
  const nextShapes = list(draft.shapes, 'slide.shapes');
  if (nextShapes.length !== base.shapes.length)
    throw new Error('JSON cannot add or remove slide shapes; use the toolbar');

  let nextBackground: string | undefined;
  if (!same(draft.background, base.background)) {
    const background = obj(draft.background, 'slide.background');
    if (base.background.type !== 'solid' || background.type !== 'solid')
      throw new Error('Only solid background colors can be edited from JSON');
    immutable(
      background,
      base.background as unknown as Obj,
      ['color'],
      'slide.background'
    );
    nextBackground = color(background.color, 'slide.background.color');
  }

  const edits: ShapeEdit[] = [];
  nextShapes.forEach((entry, si) => {
    const next = obj(entry, `slide.shapes[${si}]`);
    const source = base.shapes[si];
    if (next.id !== source.id || next.type !== source.type)
      throw new Error('JSON shape order, IDs, and types must remain unchanged');
    immutable(
      next,
      source as unknown as Obj,
      ['frameEMU', 'fill', 'picture', 'table', 'text'],
      `slide.shapes[${si}]`
    );
    const shape = slide.shapes[si];
    const frame = validateFrame(source, next, `slide.shapes[${si}]`);
    // undefined = untouched; null = clear the explicit fill (inherit again)
    let fill: string | null | undefined;
    if (!same(next.fill, source.fill)) {
      if (shape.type !== 'shape' && shape.type !== 'text')
        throw new Error(`slide.shapes[${si}].fill cannot be edited`);
      fill =
        next.fill === undefined
          ? null
          : color(next.fill, `slide.shapes[${si}].fill`);
    }
    let table: TableJSON | undefined;
    let picture: PictureCrop | undefined;
    if (source.picture)
      picture = validatePicture(
        source.picture,
        next.picture,
        `slide.shapes[${si}]`
      );
    else if (next.picture !== undefined)
      throw new Error(`slide.shapes[${si}].picture cannot be added`);
    if (source.table) {
      table = validateTable(
        source.table,
        next.table,
        shape,
        `slide.shapes[${si}]`
      );
      if (table && (frame.cx !== undefined || frame.cy !== undefined))
        throw new Error(
          `slide.shapes[${si}]: edit table widths/heights or frame size, not both`
        );
    } else if (next.table !== undefined)
      throw new Error(`slide.shapes[${si}].table cannot be added`);
    const text = source.text
      ? validateText(source.text, next.text, `slide.shapes[${si}]`)
      : { runs: [], paragraphs: [] };
    if (!source.text && next.text !== undefined)
      throw new Error(`slide.shapes[${si}].text cannot be added`);
    if (
      Object.keys(frame).length ||
      fill !== undefined ||
      picture ||
      table ||
      text.runs.length ||
      text.paragraphs.length
    )
      edits.push({ shape, frame, fill, picture, table, ...text });
  });

  // Every proposed change is valid before any XML node is touched.
  if (nextBackground)
    setSlideBackground(deck, slide, { type: 'solid', color: nextBackground });
  if (sizeChanged) setSlideSize(deck, slide, nextSize.cx, nextSize.cy);
  for (const edit of edits) {
    const frame = edit.table
      ? (Object.fromEntries(
          Object.entries(edit.frame).filter(
            ([key]) => key !== 'cx' && key !== 'cy'
          )
        ) as Partial<Xfrm>)
      : edit.frame;
    if (Object.keys(frame).length)
      setShapeGeometry(deck, slide, edit.shape, frame);
    if (edit.fill !== undefined)
      setShapeFillColor(deck, slide, edit.shape, edit.fill);
    if (edit.picture) setPictureCrop(deck, slide, edit.shape, edit.picture);
    if (edit.table) {
      while (tableColumns(edit.shape).length < edit.table.columns.length)
        addTableColumn(deck, slide, edit.shape);
      while (tableColumns(edit.shape).length > edit.table.columns.length)
        removeTableColumn(deck, slide, edit.shape);
      while (tableRows(edit.shape).length < edit.table.rows.length)
        addTableRow(deck, slide, edit.shape);
      while (tableRows(edit.shape).length > edit.table.rows.length)
        removeTableRow(deck, slide, edit.shape);
      edit.table.columns.forEach((column, ci) => {
        if (
          Number(getAttr(tableColumns(edit.shape)[ci], 'w')) !== column.widthEMU
        )
          setTableColumnWidth(deck, slide, edit.shape, ci, column.widthEMU);
      });
      edit.table.rows.forEach((row, ri) => {
        if (Number(getAttr(tableRows(edit.shape)[ri], 'h')) !== row.heightEMU)
          setTableRowHeight(deck, slide, edit.shape, ri, row.heightEMU);
        row.cells.forEach((cell, ci) => {
          if (tableCellText(tableCell(edit.shape, ri, ci)) !== cell.text)
            setTableCellPlainText(deck, slide, edit.shape, ri, ci, cell.text);
          setTableCellRangeAlign(
            deck,
            slide,
            edit.shape,
            { startRow: ri, endRow: ri, startCol: ci, endCol: ci },
            cell.align as 'l' | 'ctr' | 'r' | 'just',
            cell.verticalAlign as 't' | 'ctr' | 'b'
          );
          if (cell.fill)
            setTableCellRangeStyle(
              deck,
              slide,
              edit.shape,
              { startRow: ri, endRow: ri, startCol: ci, endCol: ci },
              { fill: cell.fill.replace('#', '') }
            );
        });
      });
    }
    for (const paragraph of edit.paragraphs)
      setParagraphAlignAt(
        deck,
        slide,
        edit.shape,
        paragraph.paragraph,
        paragraph.align
      );
    for (const run of edit.runs)
      setTextRunValue(
        deck,
        slide,
        edit.shape,
        run.paragraph,
        run.run,
        run.text,
        run.style
      );
  }
  return {
    shapeIds: edits.map((edit) => edit.shape.id),
    background: !!nextBackground,
    ...(sizeChanged ? { slideSize: true as const } : {})
  };
}
