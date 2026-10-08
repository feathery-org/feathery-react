/**
 * The property schema (architecture 5.1a): every property a node kind has, typed from the SDK's
 * own definitions (`@syncfusion/ej2-documenteditor` 34.1.31, `CharacterFormatProperties`,
 * `ParagraphFormatProperties`, `SectionFormatProperties` and the enums in `base/types.d.ts`), plus
 * the keys the format objects carry in the corpus. Three classes: content (written by replace and
 * insert, not here), properties (written by `set`), derived (reported, never written).
 *
 * A property's name is the native format key it lives in, so a format entry read from the
 * document and a `set` speak the same names. Where it lives on a node:
 *
 *   run          characterFormat (the run's `style`)
 *   paragraph    paragraphFormat (`style`); character properties go to the paragraph mark
 *                (`markStyle`) and every run in the paragraph
 *   table, row, cell, section   their own format (`style`)
 */
import type {
  DocumentView,
  EffectiveProperty,
  FormatTable,
  PropertySpec
} from '../../pack';
import type { FormatEntry, NfNode } from '../../tree';
import { KIND } from './adapter/keys';
import { arr } from './util';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

// ------------------------------------------------------------------ enums (types.d.ts 34.1.31)

export const ENUMS = {
  Underline: [
    'None',
    'Single',
    'Words',
    'Double',
    'Dotted',
    'Thick',
    'Dash',
    'DashLong',
    'DotDash',
    'DotDotDash',
    'Wavy',
    'DottedHeavy',
    'DashHeavy',
    'DashLongHeavy',
    'DotDashHeavy',
    'DotDotDashHeavy',
    'WavyHeavy',
    'WavyDouble'
  ],
  Strikethrough: ['None', 'SingleStrike', 'DoubleStrike'],
  BaselineAlignment: ['Normal', 'Superscript', 'Subscript'],
  HighlightColor: [
    'NoColor',
    'Yellow',
    'BrightGreen',
    'Turquoise',
    'Pink',
    'Blue',
    'Red',
    'DarkBlue',
    'Teal',
    'Green',
    'Violet',
    'DarkRed',
    'DarkYellow',
    'Gray50',
    'Gray25',
    'Black'
  ],
  LineSpacingType: ['AtLeast', 'Exactly', 'Multiple', 'Single', 'Double'],
  TextAlignment: ['Center', 'Left', 'Right', 'Justify'],
  OutlineLevel: [
    'Level1',
    'Level2',
    'Level3',
    'Level4',
    'Level5',
    'Level6',
    'Level7',
    'Level8',
    'Level9',
    'BodyText'
  ],
  TableAlignment: ['Left', 'Center', 'Right'],
  WidthType: ['Auto', 'Percent', 'Point'],
  CellVerticalAlignment: ['Top', 'Center', 'Bottom'],
  HeightType: ['Auto', 'AtLeast', 'Exactly'],
  LineStyle: [
    'None',
    'Single',
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
    'Cleared'
  ]
} as const;

// ------------------------------------------------------------------ value types

/** A colour as the document stores it: `#RRGGBB` or `#RRGGBBAA`; names are refused. */
export const COLOUR = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;

type Check = (v: unknown) => string | null;
const bool: Check = (v) =>
  typeof v === 'boolean' ? null : 'must be true or false';
const num =
  (min: number, max: number): Check =>
  (v) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
      ? null
      : `must be a number from ${min} to ${max}`;
const int =
  (min: number, max: number): Check =>
  (v) =>
    Number.isInteger(v) && (v as number) >= min && (v as number) <= max
      ? null
      : `must be a whole number from ${min} to ${max}`;
const oneOf =
  (values: readonly string[]): Check =>
  (v) =>
    typeof v === 'string' && values.includes(v)
      ? null
      : `must be one of ${values.join(', ')}`;
const text =
  (max = 200): Check =>
  (v) =>
    typeof v === 'string' && v.length <= max
      ? null
      : `must be text of at most ${max} characters`;
const colour: Check = (v) =>
  typeof v === 'string' && COLOUR.test(v)
    ? null
    : 'must be a colour #RRGGBB or #RRGGBBAA (colour names are not accepted)';
const anyOf =
  (kind: 'object' | 'array'): Check =>
  (v) =>
    kind === 'array'
      ? Array.isArray(v)
        ? null
        : 'must be an array'
      : isObject(v)
      ? null
      : 'must be an object';

const border: Check = (v) => {
  if (!isObject(v)) return 'must be an object';
  for (const [k, x] of Object.entries(v)) {
    if (x === null) continue; // a null member removes it (object values merge)
    const why =
      k === 'lineStyle'
        ? oneOf(ENUMS.LineStyle)(x)
        : k === 'color'
        ? colour(x)
        : k === 'lineWidth' || k === 'space'
        ? num(0, 100)(x)
        : k === 'shadow' || k === 'hasNoneStyle'
        ? bool(x)
        : `unknown border key ${k}`;
    if (why) return `${k} ${why}`;
  }
  return null;
};
const BORDER_SIDES = [
  'top',
  'left',
  'right',
  'bottom',
  'horizontal',
  'vertical',
  'diagonalDown',
  'diagonalUp'
];
const borders: Check = (v) => {
  if (!isObject(v)) return 'must be an object of sides';
  for (const [side, b] of Object.entries(v)) {
    if (!BORDER_SIDES.includes(side))
      return `unknown side ${side}; sides are ${BORDER_SIDES.join(', ')}`;
    if (b === null) continue;
    const why = border(b);
    if (why) return `${side}: ${why}`;
  }
  return null;
};
const shading: Check = (v) => {
  if (!isObject(v)) return 'must be an object';
  for (const [k, x] of Object.entries(v)) {
    if (x === null) continue;
    const why =
      k === 'backgroundColor' || k === 'foregroundColor'
        ? x === 'empty'
          ? null
          : colour(x)
        : k === 'texture' || k === 'textureStyle'
        ? typeof x === 'string'
          ? null
          : 'must be a texture name'
        : `unknown shading key ${k}`;
    if (why) return `${k} ${why}`;
  }
  return null;
};

const prop = (name: string, type: string, validate: Check): PropertySpec => ({
  name,
  type,
  validate,
  class: 'property'
});
const derived = (name: string, type: string): PropertySpec => ({
  name,
  type,
  class: 'derived',
  validate: () => 'derived: computed by the engine'
});

// ------------------------------------------------------------------ the property groups

export const CHARACTER: readonly PropertySpec[] = [
  prop('bold', 'boolean', bool),
  prop('italic', 'boolean', bool),
  prop('fontSize', 'points 1 to 1638', num(1, 1638)),
  prop('fontFamily', 'font name', text(64)),
  prop('fontColor', 'colour #RRGGBB', colour),
  prop('underline', 'underline style', oneOf(ENUMS.Underline)),
  prop('underlineColor', 'colour #RRGGBB', colour),
  prop('strikethrough', 'strikethrough style', oneOf(ENUMS.Strikethrough)),
  prop(
    'baselineAlignment',
    'Normal, Superscript or Subscript',
    oneOf(ENUMS.BaselineAlignment)
  ),
  prop('highlightColor', 'highlight name', oneOf(ENUMS.HighlightColor)),
  prop('allCaps', 'boolean', bool),
  prop('hidden', 'boolean', bool),
  prop('bidi', 'boolean', bool),
  prop('boldBidi', 'boolean', bool),
  prop('italicBidi', 'boolean', bool),
  prop('fontSizeBidi', 'points', num(1, 1638)),
  prop('fontFamilyBidi', 'font name', text(64)),
  prop('fontFamilyAscii', 'font name', text(64)),
  prop('fontFamilyNonFarEast', 'font name', text(64)),
  prop('fontFamilyFarEast', 'font name', text(64)),
  prop('fontHintType', 'font hint', text(32)),
  prop('localeId', 'locale id', int(0, 65535)),
  prop('localeIdBidi', 'locale id', int(0, 65535)),
  prop('localeIdFarEast', 'locale id', int(0, 65535)),
  prop('ligature', 'ligature mode', text(32)),
  prop('scaling', 'percent', num(1, 600)),
  prop('styleName', 'character style name', text(120))
];

export const PARAGRAPH: readonly PropertySpec[] = [
  prop(
    'textAlignment',
    'Left, Center, Right or Justify',
    oneOf(ENUMS.TextAlignment)
  ),
  prop('leftIndent', 'points', num(-1584, 1584)),
  prop('rightIndent', 'points', num(-1584, 1584)),
  prop('firstLineIndent', 'points', num(-1584, 1584)),
  prop('beforeSpacing', 'points', num(0, 1584)),
  prop('afterSpacing', 'points', num(0, 1584)),
  prop('lineSpacing', 'points or lines', num(0, 1584)),
  prop('lineSpacingType', 'line spacing rule', oneOf(ENUMS.LineSpacingType)),
  prop('outlineLevel', 'outline level', oneOf(ENUMS.OutlineLevel)),
  prop('keepWithNext', 'boolean', bool),
  prop('keepLinesTogether', 'boolean', bool),
  prop('widowControl', 'boolean', bool),
  prop('contextualSpacing', 'boolean', bool),
  prop('spaceBeforeAuto', 'boolean', bool),
  prop('spaceAfterAuto', 'boolean', bool),
  prop('bidi', 'boolean', bool),
  prop(
    'styleName',
    'paragraph style name (a named style of the document, e.g. Heading 1)',
    text(120)
  ),
  prop('borders', 'paragraph borders by side', borders),
  prop('listFormat', 'list format {listId, listLevelNumber}', anyOf('object')),
  prop('tabs', 'tab stops', anyOf('array'))
];

export const CELL: readonly PropertySpec[] = [
  prop('preferredWidth', 'points or percent', num(0, 1584)),
  prop('preferredWidthType', 'Auto, Percent or Point', oneOf(ENUMS.WidthType)),
  prop(
    'verticalAlignment',
    'Top, Center or Bottom',
    oneOf(ENUMS.CellVerticalAlignment)
  ),
  prop('columnSpan', 'grid columns', int(1, 63)),
  prop('rowSpan', 'rows', int(1, 4096)),
  prop(
    'shading',
    'shading {backgroundColor, foregroundColor, texture}',
    shading
  ),
  prop('borders', 'cell borders by side', borders),
  prop('leftMargin', 'points', num(0, 1584)),
  prop('rightMargin', 'points', num(0, 1584)),
  prop('topMargin', 'points', num(0, 1584)),
  prop('bottomMargin', 'points', num(0, 1584)),
  derived('cellWidth', 'laid-out width'),
  derived('columnIndex', 'grid column')
];

export const ROW: readonly PropertySpec[] = [
  prop('height', 'points', num(0, 1584)),
  prop('heightType', 'Auto, AtLeast or Exactly', oneOf(ENUMS.HeightType)),
  prop('isHeader', 'boolean (repeats as the header row)', bool),
  prop('allowBreakAcrossPages', 'boolean', bool),
  prop('borders', 'row borders by side', borders),
  prop('gridBefore', 'grid columns', int(0, 63)),
  prop('gridAfter', 'grid columns', int(0, 63)),
  prop('leftIndent', 'points', num(-1584, 1584)),
  prop('leftMargin', 'points', num(0, 1584)),
  prop('rightMargin', 'points', num(0, 1584)),
  prop('topMargin', 'points', num(0, 1584)),
  prop('bottomMargin', 'points', num(0, 1584))
];

export const TABLE: readonly PropertySpec[] = [
  prop('preferredWidth', 'points or percent', num(0, 1584)),
  prop('preferredWidthType', 'Auto, Percent or Point', oneOf(ENUMS.WidthType)),
  prop('tableAlignment', 'Left, Center or Right', oneOf(ENUMS.TableAlignment)),
  prop('leftIndent', 'points', num(-1584, 1584)),
  prop('cellSpacing', 'points', num(0, 264)),
  prop('leftMargin', 'points', num(0, 1584)),
  prop('rightMargin', 'points', num(0, 1584)),
  prop('topMargin', 'points', num(0, 1584)),
  prop('bottomMargin', 'points', num(0, 1584)),
  prop('allowAutoFit', 'boolean', bool),
  prop('bidi', 'boolean', bool),
  prop(
    'shading',
    'shading {backgroundColor, foregroundColor, texture}',
    shading
  ),
  prop('borders', 'table borders by side', borders),
  prop('styleName', 'table style name', text(120)),
  derived('grid', 'grid column widths'),
  derived('columnCount', 'grid columns')
];

export const SECTION: readonly PropertySpec[] = [
  prop('pageWidth', 'points', num(72, 1584)),
  prop('pageHeight', 'points', num(72, 1584)),
  prop('leftMargin', 'points', num(0, 1584)),
  prop('rightMargin', 'points', num(0, 1584)),
  prop('topMargin', 'points', num(0, 1584)),
  prop('bottomMargin', 'points', num(0, 1584)),
  prop('headerDistance', 'points', num(0, 1584)),
  prop('footerDistance', 'points', num(0, 1584)),
  prop('differentFirstPage', 'boolean', bool),
  prop('differentOddAndEvenPages', 'boolean', bool),
  prop('bidi', 'boolean', bool),
  prop('breakCode', 'section break', text(32)),
  prop('numberOfColumns', 'columns', int(1, 45)),
  prop('equalWidth', 'boolean', bool),
  prop('lineBetweenColumns', 'boolean', bool),
  prop('columns', 'column definitions', anyOf('array')),
  prop('restartPageNumbering', 'boolean', bool),
  prop('pageStartingNumber', 'page number', int(0, 32767)),
  prop('pageNumberStyle', 'page number style', text(32)),
  prop('endnoteNumberFormat', 'number format', text(32)),
  prop('footNoteNumberFormat', 'number format', text(32)),
  prop('restartIndexForFootnotes', 'restart rule', text(32)),
  prop('restartIndexForEndnotes', 'restart rule', text(32)),
  prop('initialFootNoteNumber', 'number', int(0, 32767)),
  prop('initialEndNoteNumber', 'number', int(0, 32767))
];

/** Where each group lives: the native format key and the normal-form key that references it. */
const GROUP_FORMAT = new Map<
  readonly PropertySpec[],
  { native: string; nfKey: (kind: string) => string }
>([
  [
    CHARACTER,
    {
      native: 'characterFormat',
      nfKey: (kind) => (kind === KIND.paragraph ? 'markStyle' : 'style')
    }
  ],
  [PARAGRAPH, { native: 'paragraphFormat', nfKey: () => 'style' }],
  [CELL, { native: 'cellFormat', nfKey: () => 'style' }],
  [ROW, { native: 'rowFormat', nfKey: () => 'style' }],
  [TABLE, { native: 'tableFormat', nfKey: () => 'style' }],
  [SECTION, { native: 'sectionFormat', nfKey: () => 'style' }]
]);

const GROUPS_BY_KIND: Record<string, Array<readonly PropertySpec[]>> = {
  [KIND.run]: [CHARACTER],
  [KIND.paragraph]: [PARAGRAPH, CHARACTER],
  [KIND.cell]: [CELL],
  [KIND.row]: [ROW],
  [KIND.table]: [TABLE],
  [KIND.section]: [SECTION]
};

/** Every property a node of `kind` has; null when the kind has none. */
export function schemaFor(kind: string): readonly PropertySpec[] | null {
  const groups = GROUPS_BY_KIND[kind];
  if (!groups) return null;
  const seen = new Set<string>();
  const out: PropertySpec[] = [];
  for (const group of groups)
    for (const spec of group)
      if (!seen.has(spec.name)) {
        seen.add(spec.name);
        out.push(spec);
      }
  return out;
}

/** Every key a format entry may hold: the union of the groups, writable properties only. */
export const FORMAT_SCHEMA: readonly PropertySpec[] = (() => {
  const byName = new Map<string, PropertySpec>();
  for (const group of [CHARACTER, PARAGRAPH, CELL, ROW, TABLE, SECTION])
    for (const spec of group)
      if (spec.class === 'property' && !byName.has(spec.name))
        byName.set(spec.name, spec);
  return [...byName.values()];
})();

/** The group (and so the native format) a property of `kind` belongs to; the first match wins. */
function groupOf(
  kind: string,
  name: string
): readonly PropertySpec[] | undefined {
  return (GROUPS_BY_KIND[kind] ?? []).find((g) =>
    g.some((s) => s.name === name)
  );
}

// ------------------------------------------------------------------ writing overrides

/** Copy-on-write: the node's entry under `nfKey` with `name` set (or cleared by null). */
/**
 * A property's new value over its current one: an object value (borders, shading) merges into the
 * current object member by member, recursively, and a null member removes that member; anything
 * else replaces. So `shading: {backgroundColor}` changes the colour and keeps the texture.
 */
export function mergedValue(current: unknown, value: unknown): unknown {
  if (!isObject(value) || !isObject(current)) return value;
  const out: Obj = { ...current };
  for (const [k, v] of Object.entries(value)) {
    if (v === null) delete out[k];
    else out[k] = mergedValue(current[k], v);
  }
  return out;
}

function rewrite(
  node: NfNode,
  nfKey: string,
  name: string,
  value: unknown,
  formats: FormatTable
): void {
  const current =
    typeof node[nfKey] === 'string'
      ? formats.get(String(node[nfKey]))
      : undefined;
  const entry: FormatEntry = { ...(current ?? {}) };
  if (value === null) delete entry[name];
  else entry[name] = mergedValue(entry[name], value);
  if (!Object.keys(entry).length) delete node[nfKey];
  else node[nfKey] = formats.intern(entry);
}

const runsOf = (node: NfNode): NfNode[] => {
  const out: NfNode[] = [];
  const rec = (n: NfNode) => {
    for (const inline of arr<NfNode>(n.inlines)) {
      if (inline.kind === KIND.run) out.push(inline);
      if (Array.isArray(inline.inlines)) rec(inline);
    }
  };
  rec(node);
  return out;
};

/** Write a validated override on a node (contract 6.3): the node's own format, copy-on-write. */
export function setOverride(
  node: NfNode,
  name: string,
  value: unknown,
  formats: FormatTable
): void {
  const group = groupOf(node.kind, name);
  const placement = group ? GROUP_FORMAT.get(group) : undefined;
  if (!placement) throw new Error(`${node.kind} has no property ${name}`);
  rewrite(node, placement.nfKey(node.kind), name, value, formats);
  // a character property on a paragraph also reaches every run in it
  if (node.kind === KIND.paragraph && group === CHARACTER)
    for (const run of runsOf(node)) rewrite(run, 'style', name, value, formats);
}

export function setOnFormat(
  entry: FormatEntry,
  name: string,
  value: unknown
): void {
  if (value === null) delete entry[name];
  else entry[name] = mergedValue(entry[name], value);
}

// ------------------------------------------------------------------ effective values

const referrerCounts = new WeakMap<DocumentView, Map<string, number>>();
function referrers(view: DocumentView, formatId: string): number {
  let counts = referrerCounts.get(view);
  if (!counts) {
    counts = new Map();
    for (const n of view.nodes())
      for (const key of ['style', 'markStyle'])
        if (typeof n[key] === 'string')
          counts.set(String(n[key]), (counts.get(String(n[key])) ?? 0) + 1);
    referrerCounts.set(view, counts);
  }
  return counts.get(formatId) ?? 0;
}

/** The named style a node's paragraph uses, from the document's `styles`. */
function namedStyle(view: DocumentView, node: NfNode): Obj | null {
  let p: NfNode | null | undefined = node;
  while (p && p.kind !== KIND.paragraph) p = view.placement(p.id)?.parent;
  if (!p || typeof p.style !== 'string') return null;
  const name = view.nf.formats[p.style]?.styleName;
  const styles = view.nf.root.styles;
  if (typeof name !== 'string' || !Array.isArray(styles)) return null;
  return (styles as Obj[]).find((s) => s.name === name) ?? null;
}

/**
 * Effective values with their source, in resolution order: the node's own format (`override`
 * when no other node shares the entry, `format` when it is shared), the paragraph's named style
 * (`container`), then `default` (the value is null: the editor's own default applies).
 */
export function effective(
  node: NfNode,
  view: DocumentView
): Record<string, EffectiveProperty> {
  const out: Record<string, EffectiveProperty> = {};
  for (const group of arr<readonly PropertySpec[]>(GROUPS_BY_KIND[node.kind])) {
    const placement = GROUP_FORMAT.get(group);
    if (!placement) continue;
    const ref = node[placement.nfKey(node.kind)];
    const entry = typeof ref === 'string' ? view.nf.formats[ref] : undefined;
    const shared = typeof ref === 'string' && referrers(view, ref) > 1;
    const style = namedStyle(view, node);
    const styleFormat = style?.[placement.native];
    for (const spec of group) {
      if (spec.class !== 'property' || spec.name in out) continue;
      if (entry && spec.name in entry)
        out[spec.name] = {
          value: entry[spec.name],
          source: shared ? 'format' : 'override'
        };
      else if (
        typeof styleFormat === 'string' &&
        view.nf.formats[styleFormat]?.[spec.name] !== undefined
      )
        out[spec.name] = {
          value: view.nf.formats[styleFormat][spec.name],
          source: 'container'
        };
      else out[spec.name] = { value: null, source: 'default' };
    }
  }
  return out;
}

// ------------------------------------------------------------------ spans

/**
 * Character properties on a span of a paragraph's text (contract 6.3 match target): the runs the
 * span crosses are split at its edges, each piece keeping the original run's look, and the pieces
 * inside take the properties. The first piece of a split run keeps its id; the others are new.
 * Returns why the span cannot carry them, or null.
 */
export function setOnSpan(
  node: NfNode,
  span: { start: number; end: number },
  _text: string,
  props: Record<string, unknown>,
  formats: FormatTable
): string | null {
  if (node.kind !== KIND.paragraph)
    return 'a span is set on a paragraph: copy the id and span from a find hit on it';
  const characterNames = new Set(CHARACTER.map((s) => s.name));
  const other = Object.keys(props).filter((k) => !characterNames.has(k));
  if (other.length)
    return `only character properties apply to a span (not ${other.join(
      ', '
    )}); set those on the paragraph`;
  const inlines = arr<NfNode>(node.inlines);
  const textLength = (n: NfNode): number =>
    n.kind === KIND.run
      ? String(n.text ?? '').length
      : arr<NfNode>(n.inlines).reduce((s, c) => s + textLength(c), 0);
  const out: NfNode[] = [];
  let at = 0;
  for (const inline of inlines) {
    const length = textLength(inline);
    const start = at;
    const end = at + length;
    at = end;
    const overlap = Math.min(end, span.end) - Math.max(start, span.start);
    if (overlap <= 0 || !length) {
      out.push(inline);
      continue;
    }
    if (inline.kind !== KIND.run) {
      if (
        span.start <= start &&
        span.end >= end &&
        inline.kind === KIND.control
      ) {
        // a control wholly inside the span: its runs take the properties
        const rec = (n: NfNode) => {
          for (const c of arr<NfNode>(n.inlines)) {
            if (c.kind === KIND.run)
              for (const [k, v] of Object.entries(props))
                setOverride(c, k, v, formats);
            rec(c);
          }
        };
        rec(inline);
        out.push(inline);
        continue;
      }
      return `the span crosses part of ${inline.kind} ${inline.id}; set the properties on its runs by id instead`;
    }
    if (inline.pending !== undefined)
      return `run ${inline.id} carries a tracked change; leave it or accept it first`;
    const text = String(inline.text ?? '');
    const cuts = [
      0,
      Math.max(0, span.start - start),
      Math.min(length, span.end - start),
      length
    ];
    const pieces: NfNode[] = [];
    for (let i = 0; i < 3; i += 1) {
      if (cuts[i + 1] <= cuts[i]) continue;
      const piece = {
        ...inline,
        text: text.slice(cuts[i], cuts[i + 1])
      } as NfNode;
      if (pieces.length) delete (piece as Partial<NfNode>).id;
      if (i === 1)
        for (const [k, v] of Object.entries(props))
          setOverride(piece, k, v, formats);
      pieces.push(piece);
    }
    out.push(...pieces);
  }
  node.inlines = out;
  return null;
}
