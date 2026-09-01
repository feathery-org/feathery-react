import { CellValue, formatCellValue } from './model';
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
const ISO_DATETIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/;

/**
 * The stored value in the shape the native picker wants: `yyyy-MM-dd` for a
 * date, `yyyy-MM-ddTHH:mm` for a datetime. Anything unparseable comes back
 * empty rather than wedging the picker with a value it will silently reject.
 */
export function toEditorValue(draft: string, kind: EditorKind): string {
  if (kind === 'date') {
    const match = ISO_DATE.exec(draft.trim());
    return match ? match[1] : '';
  }
  if (kind === 'datetime') {
    const match = ISO_DATETIME.exec(draft.trim());
    if (match) return `${match[1]}T${match[2]}`;
    const dateOnly = ISO_DATE.exec(draft.trim());
    return dateOnly ? `${dateOnly[1]}T00:00` : '';
  }
  return draft;
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
