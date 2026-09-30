import {
  formatNumberValue,
  getFormatAffixes
} from '../../../fields/TextField/mask';
import { CellValue, formatCellValue, parseInputValue } from './model';
import { CellRule } from './validation';

/**
 * How one column is edited and displayed.
 *
 * The grid is one control reused for every column, so the column's own rule
 * decides what that control actually is — a fixed option list is picked, a date
 * gets a picker, a tax ID is masked until you edit it.
 */
type EditorKind =
  | 'select'
  | 'number'
  | 'date'
  | 'datetime'
  | 'email'
  | 'url'
  | 'text'
  // A US ZIP: text, but only digits, `-` and a space can be typed.
  | 'zip'
  // Held in the grid but not editable there: a hub file field stores upload
  // references (`[{url, path}]`), which no amount of typing can produce.
  | 'readonly';

export function editorKindFor(rule?: CellRule): EditorKind {
  if (!rule) return 'text';
  if (rule.options?.length || rule.type === 'boolean') return 'select';
  switch (rule.type) {
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime';
    case 'email':
      return 'email';
    case 'url':
      return 'url';
    case 'file':
      return 'readonly';
    default:
      return rule.format === 'us_zip' ? 'zip' : 'text';
  }
}

/** The choices a `select` column offers, in the order they are shown. */
export function choicesFor(rule?: CellRule): string[] | null {
  if (rule?.options?.length) return rule.options;
  if (rule?.type === 'boolean') return ['true', 'false'];
  return null;
}

/**
 * Display names for a `select` column's choices, index for index, when it has
 * them (`us_state` / `country`). The value stored is always the choice itself.
 */
export function choiceLabelsFor(rule?: CellRule): string[] | null {
  return rule?.options?.length && rule.optionLabels?.length
    ? rule.optionLabels
    : null;
}

/**
 * The choice typed text points at: a code typed whole (`ca`), then the first
 * code it starts, then the first name it starts (`cali` -> `CA`). Case-blind.
 */
export function matchChoice(
  choices: string[],
  labels: string[] | null | undefined,
  typed: string
): string | undefined {
  const query = typed.trim().toLowerCase();
  if (!query) return undefined;
  const exact = choices.find((choice) => choice.toLowerCase() === query);
  if (exact !== undefined) return exact;
  const byChoice = choices.find((choice) =>
    choice.toLowerCase().startsWith(query)
  );
  if (byChoice !== undefined) return byChoice;
  const at = labels?.findIndex((label) =>
    label.toLowerCase().startsWith(query)
  );
  return at != null && at >= 0 ? choices[at] : undefined;
}

/**
 * What typing a printable character on a selected cell should do.
 *
 * The character is chosen before any editor exists, so the editor's own input
 * filtering cannot see it — a letter typed at a number column would open the
 * editor already holding the letter. The decision has to be made here.
 */
export type SeedAction =
  /** Open the editor holding the character. */
  | 'seed'
  /** Open the editor on the stored value, discarding the character. */
  | 'open'
  /** Do nothing at all. */
  | 'ignore';

export function seedActionFor(
  rule: CellRule | undefined,
  char: string
): SeedAction {
  switch (editorKindFor(rule)) {
    case 'number':
      // Only what could still become a number gets through.
      return acceptsNumericInput(char) ? 'seed' : 'ignore';
    case 'zip':
      return acceptsZipInput(char) ? 'seed' : 'ignore';
    case 'readonly':
      return 'ignore';
    case 'date':
    case 'datetime':
      // A picker takes a whole date, not a character, so open it on the stored
      // value rather than seeding a fragment it would only discard.
      return 'open';
    case 'select':
      // Space opens the menu the way it does on a focused native select. A
      // letter still opens it, jumping to the first matching choice.
      return char === ' ' ? 'open' : 'seed';
    default:
      return 'seed';
  }
}

// A partially typed number: an optional sign, digits, at most one point. Kept
// deliberately permissive so "-", "1." and "" are all typeable on the way to a
// real number — the column's rule is what finally judges the value.
const PARTIAL_NUMBER = /^-?\d*\.?\d*$/;

/** Whether a keystroke may land in a `number` column's editor at all. */
export function acceptsNumericInput(draft: string): boolean {
  return PARTIAL_NUMBER.test(draft);
}

// Digits plus the separators of `12345-6789` / `12345 6789`. The shape itself
// is judged by the rule, so a half-typed ZIP stays typeable.
const PARTIAL_ZIP = /^[\d -]*$/;

/** Whether a keystroke may land in a ZIP column's editor. */
export function acceptsZipInput(draft: string): boolean {
  return PARTIAL_ZIP.test(draft);
}

/**
 * A ZIP as the hub stores it. Spreadsheets drop leading zeros, so 3-4 digits
 * are padded back to 5 (`2134` -> `02134`) and 8 to 9 before the ZIP+4 dash;
 * `12345 6789` gets its dash. Anything else is left for validation to flag.
 */
export function normalizeZip(text: string): string {
  const trimmed = text.trim();
  // Mirrors the hub's _coerce_zip: whitespace anywhere is dropped first.
  const compact = trimmed.replace(/\s+/g, '');
  if (!/^\d+$/.test(compact)) {
    return /^\d{5}-\d{4}$/.test(compact) ? compact : trimmed;
  }
  if (compact.length >= 3 && compact.length <= 5) {
    return compact.padStart(5, '0');
  }
  if (compact.length === 8 || compact.length === 9) {
    const digits = compact.padStart(9, '0');
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }
  return trimmed;
}

/**
 * A state or country as its code: a code in any case, or a full name
 * (`california` -> `CA`). Unknown text is kept, to fail validation visibly.
 */
function normalizeChoiceCode(text: string, rule: CellRule): string {
  const trimmed = text.trim();
  const options = rule.options ?? [];
  const upper = trimmed.toUpperCase();
  if (options.includes(upper)) return upper;
  const lower = trimmed.toLowerCase();
  const at = rule.optionLabels?.findIndex(
    (label) => label.toLowerCase() === lower
  );
  return at != null && at >= 0 ? options[at] : trimmed;
}

/**
 * A formatted number as typed or pasted (`$1,234.50`, `12%`) with the
 * column's own affixes and grouping taken off, the way the hub reads it.
 */
function stripNumberFormat(text: string, rule: CellRule): string {
  const { prefix, suffix } = getFormatAffixes(numberServar(rule));
  let stripped = text.trim().replace(/,/g, '');
  const sign = stripped.startsWith('-') ? '-' : '';
  if (sign) stripped = stripped.slice(1);
  const affix = prefix.trim();
  if (affix && stripped.startsWith(affix)) {
    stripped = stripped.slice(affix.length);
  }
  if (suffix && stripped.endsWith(suffix)) {
    stripped = stripped.slice(0, -suffix.length);
  }
  return `${sign}${stripped.trim()}`;
}

const ISO_DATE = /^(\d{4}-\d{2}-\d{2})/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * A stored datetime as an instant. The hub writes datetimes as UTC (`...Z`)
 * and reads a value with no zone as UTC too (`parse_iso_datetime`), so a naive
 * string is pinned to UTC here rather than left to `Date`, which would read it
 * as local time and shift it by the viewer's offset.
 */
function parseStoredDatetime(text: string): Date | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const iso = DATE_ONLY.test(trimmed)
    ? `${trimmed}T00:00:00`
    : trimmed.replace(' ', 'T');
  const parsed = new Date(HAS_ZONE.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const pad2 = (value: number) => (value < 10 ? `0${value}` : String(value));
const pad3 = (value: number) =>
  value < 100 ? `0${pad2(value)}` : String(value);

/**
 * `yyyy-MM-ddTHH:mm[:ss[.SSS]]` in the browser's zone — what `datetime-local`
 * shows. Seconds and milliseconds are written only when the instant has them:
 * the picker offers a seconds field exactly when its value carries one, so a
 * value handed over as `12:00` would have the user turn `12:00:30` into
 * `12:00:00` by merely changing the date.
 */
function toLocalPickerValue(instant: Date): string {
  const seconds = instant.getSeconds();
  const millis = instant.getMilliseconds();
  const time =
    `${pad2(instant.getHours())}:${pad2(instant.getMinutes())}` +
    (seconds || millis ? `:${pad2(seconds)}` : '') +
    (millis ? `.${pad3(millis)}` : '');
  return (
    `${instant.getFullYear()}-${pad2(instant.getMonth() + 1)}-` +
    `${pad2(instant.getDate())}T${time}`
  );
}

/**
 * The stored value in the shape the native picker wants: `yyyy-MM-dd` for a
 * date, `yyyy-MM-ddTHH:mm[:ss]` in LOCAL time for a datetime — a `datetime-local`
 * input is wall-clock time in the viewer's zone, so the UTC instant the hub
 * stores has to be converted or the picker shows the wrong hour. Anything
 * unparseable comes back empty rather than wedging the picker with a value it
 * will silently reject.
 */
export function toEditorValue(draft: string, kind: EditorKind): string {
  if (kind === 'date') {
    const match = ISO_DATE.exec(draft.trim());
    return match ? match[1] : '';
  }
  if (kind === 'datetime') {
    const instant = parseStoredDatetime(draft);
    return instant ? toLocalPickerValue(instant) : '';
  }
  return draft;
}

/**
 * The inverse of `toEditorValue`: what the picker reports, in the shape the
 * cell stores. A `datetime-local` value is local wall-clock time with no zone,
 * so it becomes the UTC instant the hub keeps (`standard_hub_date` writes
 * `yyyy-MM-ddTHH:mm:ss.SSSZ`, which `toISOString` matches exactly). A date
 * has no instant and stays the calendar day as picked.
 */
export function fromEditorValue(input: string, kind: EditorKind): string {
  if (kind !== 'datetime' || !input) return input;
  // No zone, so `Date` reads it as local — which is exactly what it is.
  const local = new Date(input);
  return Number.isNaN(local.getTime()) ? input : local.toISOString();
}

/**
 * Text from an editor or the clipboard, as the value the cell stores.
 *
 * The column decides the type. A number column keeps numbers as numbers and a
 * boolean column keeps booleans as booleans, because form field values and Hub
 * entries hold both as themselves. Every other column stores text exactly as
 * typed: `012345678` in a tax ID column is nine digits, not the number
 * 12345678, and `true` in a notes column is a word. Shape-based guessing
 * (`parseInputValue`) is only a fallback for a column with no rule, and even
 * then only when the cell already held a number or boolean.
 */
export function parseCellInput(
  text: string,
  rule: CellRule | undefined,
  before: CellValue = null
): CellValue {
  if (!text.trim()) return null;
  const type =
    rule?.type ??
    (typeof before === 'number' || typeof before === 'boolean'
      ? typeof before
      : undefined);
  if (type === 'number' || type === 'boolean') {
    const source =
      type === 'number' && rule && isNumberFormat(rule)
        ? stripNumberFormat(text, rule)
        : text;
    const guessed = parseInputValue(source);
    return typeof guessed === type ? guessed : text;
  }
  if (rule?.format === 'us_zip') return normalizeZip(text);
  if (
    (rule?.format === 'us_state' || rule?.format === 'country') &&
    rule.options?.length
  ) {
    return normalizeChoiceCode(text, rule);
  }
  return text;
}

const isNumberFormat = (rule: CellRule) =>
  rule.type === 'number' &&
  (rule.format === 'currency' || rule.format === 'percentage');

// Precision `formatNumberValue` honours; hub fields may ask for more.
const MAX_MASK_DECIMALS = 2;
const CURRENCY_DECIMALS = 2;

/**
 * The rule as the number-field servar `mask.ts` formats, so a hub cell reads
 * exactly like a form field with the same format. Currency pads to its
 * decimals (`$1,234.50`); a percentage shows only the digits it has unless
 * the field fixes its decimals.
 */
function numberServar(rule: CellRule) {
  const fixed = rule.decimalDigits != null;
  return {
    type: 'integer_field',
    format: rule.format,
    metadata: {
      currency: rule.currency || 'USD',
      decimal_places: fixed
        ? rule.decimalDigits
        : rule.format === 'currency'
        ? CURRENCY_DECIMALS
        : undefined,
      pad_decimals: rule.format === 'currency' || fixed
    }
  };
}

/**
 * Wider than `formatNumberValue` goes: the same shape through Intl directly.
 * With no decimal_digits set, every stored digit is shown, as the dashboard does.
 */
function formatWideNumber(value: number, rule: CellRule): string {
  const digits = rule.decimalDigits;
  const options: Intl.NumberFormatOptions =
    digits == null
      ? { minimumFractionDigits: 0, maximumFractionDigits: 20 }
      : { minimumFractionDigits: digits, maximumFractionDigits: digits };
  try {
    if (rule.format === 'currency') {
      return new Intl.NumberFormat('en-US', {
        ...options,
        style: 'currency',
        currency: rule.currency || 'USD'
      }).format(value);
    }
  } catch {
    // A malformed currency code; fall through to the plain number.
  }
  const body = new Intl.NumberFormat('en-US', options).format(value);
  return rule.format === 'percentage' ? `${body}%` : body;
}

function formatNumberCell(value: CellValue, rule: CellRule): string {
  const num = typeof value === 'number' ? value : Number(String(value));
  if (typeof value === 'boolean' || Number.isNaN(num)) {
    return formatCellValue(value);
  }
  const unboundedPercent =
    rule.format === 'percentage' && rule.decimalDigits == null;
  if (unboundedPercent || (rule.decimalDigits ?? 0) > MAX_MASK_DECIMALS) {
    return formatWideNumber(num, rule);
  }
  return formatNumberValue(numberServar(rule), num);
}

/**
 * What a formatted number's editor shows around the raw value — `$` before a
 * currency, `%` after a percentage. The draft itself stays the bare number.
 */
export function numberAdornments(rule?: CellRule): {
  prefix: string;
  suffix: string;
} {
  if (!rule || !isNumberFormat(rule)) return { prefix: '', suffix: '' };
  const { prefix, suffix } = getFormatAffixes(numberServar(rule));
  return { prefix: prefix.trim(), suffix };
}

// Mask everything but the last four, the way an SSN is shown on a statement.
const TAX_ID_VISIBLE = 4;

/**
 * What the cell shows when it is NOT being edited.
 *
 * A tax ID is masked here rather than at rest: the value stored and submitted
 * is always the real one, and editing the cell reveals it.
 */
export function formatCellDisplay(value: CellValue, rule?: CellRule): string {
  if (value === null || value === undefined || value === '') return '';

  if (rule?.type === 'tax_id') {
    const digits = String(value);
    if (digits.length <= TAX_ID_VISIBLE) return digits;
    const tail = digits.slice(-TAX_ID_VISIBLE);
    return `${'•'.repeat(digits.length - TAX_ID_VISIBLE)}${tail}`;
  }

  if (rule?.type === 'file') return formatFileValue(value);

  if (rule?.type === 'date' || rule?.type === 'datetime') {
    return formatDateValue(String(value), rule.type);
  }

  if (rule && isNumberFormat(rule)) return formatNumberCell(value, rule);

  return formatCellValue(value);
}

// The viewer's locale, so "Jul 19, 1982" or "19 Jul 1982" as they would expect.
// A date is a calendar day with no zone, so it is read AND shown in UTC — the
// viewer's zone must not shift it to the day before. A datetime is an instant,
// shown in the viewer's zone like the `datetime-local` editor shows it.
const DATE_DISPLAY = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC'
});
const DATETIME_DISPLAY = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
});

/**
 * A stored ISO date or datetime, readably. Display only — the cell still holds
 * (and copies) the stored string, and the editor still opens on it. Anything
 * unparseable shows as typed, so the user can see what needs fixing.
 */
function formatDateValue(text: string, kind: 'date' | 'datetime'): string {
  const instant = parseStoredDatetime(text);
  if (!instant) return text;
  return kind === 'date'
    ? DATE_DISPLAY.format(instant)
    : DATETIME_DISPLAY.format(instant);
}

/** File references render as their names; the cell cannot edit them. */
function formatFileValue(value: CellValue): string {
  const files = parseFileValue(value);
  if (!files) return formatCellValue(value);
  return files
    .map((file) => file.path?.split('/').pop() || file.url || '')
    .filter(Boolean)
    .join(', ');
}

function parseFileValue(
  value: CellValue
): Array<{ url?: string; path?: string }> | null {
  const raw = typeof value === 'string' ? safeParse(value) : value;
  return Array.isArray(raw) ? raw : null;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
