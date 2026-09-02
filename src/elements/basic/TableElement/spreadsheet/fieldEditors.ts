import { CellValue, formatCellValue, parseInputValue } from './model';
import { CellRule } from './validation';

/**
 * How one column is edited and displayed.
 *
 * The grid is one control reused for every column, so the column's own rule
 * decides what that control actually is — a fixed option list is picked, a date
 * gets a picker, a tax ID is masked until you edit it.
 */
export type EditorKind =
  | 'select'
  | 'number'
  | 'date'
  | 'datetime'
  | 'email'
  | 'url'
  | 'text'
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
      return 'text';
  }
}

/** The choices a `select` column offers, in the order they are shown. */
export function choicesFor(rule?: CellRule): string[] | null {
  if (rule?.options?.length) return rule.options;
  if (rule?.type === 'boolean') return ['true', 'false'];
  return null;
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
    case 'readonly':
      return 'ignore';
    case 'date':
    case 'datetime':
      // A picker takes a whole date, not a character, so open it on the stored
      // value rather than seeding a fragment it would only discard.
      return 'open';
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

/** `yyyy-MM-ddTHH:mm` in the browser's zone — what `datetime-local` shows. */
function toLocalPickerValue(instant: Date): string {
  return (
    `${instant.getFullYear()}-${pad2(instant.getMonth() + 1)}-` +
    `${pad2(instant.getDate())}T${pad2(instant.getHours())}:` +
    `${pad2(instant.getMinutes())}`
  );
}

/**
 * The stored value in the shape the native picker wants: `yyyy-MM-dd` for a
 * date, `yyyy-MM-ddTHH:mm` in LOCAL time for a datetime — a `datetime-local`
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
    const guessed = parseInputValue(text);
    return typeof guessed === type ? guessed : text;
  }
  return text;
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

  return formatCellValue(value);
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
