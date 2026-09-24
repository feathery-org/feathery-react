/**
 * Column filters for the spreadsheet, the way a sheet's header filter works:
 * each column may keep only some of its values and/or only values containing
 * a piece of text. Both are matched against the cell's DISPLAYED text, so a
 * date column filters on "Jul 19, 1982", not on the stored ISO string.
 *
 * Pure. State and rendering live in `useColumnFilters` and `FilterMenu`.
 */

export type ColumnFilter = {
  /** Displayed values the column keeps; `null` keeps every value. */
  values: ReadonlySet<string> | null;
  /** Text (case-insensitive) the displayed value must contain. */
  search: string;
};

/** Active filters keyed by the column's field key. */
export type ColumnFilters = Readonly<Record<string, ColumnFilter>>;

export const EMPTY_FILTER: ColumnFilter = { values: null, search: '' };

/** How an empty cell is listed among a column's values. */
export const BLANK_LABEL = '(Blanks)';

/**
 * The most values the popover lists. A wide Data Hub column can hold
 * thousands of distinct values; past this the user narrows with the search.
 */
export const MAX_LISTED_VALUES = 500;

export type CellTextOf<R> = (row: R, fieldKey: string) => string;

export function isFilterActive(filter?: ColumnFilter): boolean {
  if (!filter) return false;
  return filter.values !== null || filter.search.trim() !== '';
}

export function matchesFilter(text: string, filter: ColumnFilter): boolean {
  const needle = filter.search.trim().toLowerCase();
  if (needle && !text.toLowerCase().includes(needle)) return false;
  return filter.values === null || filter.values.has(text);
}

/**
 * The rows every active filter lets through. `except` leaves one column's
 * filter out, which is how that column's own value list is built.
 */
export function filterRows<R>(
  rows: R[],
  filters: ColumnFilters,
  textOf: CellTextOf<R>,
  except?: string
): R[] {
  const active = Object.entries(filters).filter(
    ([fieldKey, filter]) => fieldKey !== except && isFilterActive(filter)
  );
  if (!active.length) return rows;
  return rows.filter((row) =>
    active.every(([fieldKey, filter]) =>
      matchesFilter(textOf(row, fieldKey), filter)
    )
  );
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
});

/** Blanks first, then a natural sort ("2" before "10"). */
export function compareValues(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '') return -1;
  if (b === '') return 1;
  return collator.compare(a, b) || a.localeCompare(b);
}

/**
 * The distinct displayed values one column offers to pick from: those of the
 * rows every OTHER column's filter lets through. Its own filter is ignored —
 * an unchecked value must stay listed to be checked again, and the popover
 * narrows the list by the search text only for display, so unchecking under
 * a search never drops the values the search happened to hide.
 */
export function candidateValues<R>(
  rows: R[],
  fieldKey: string,
  filters: ColumnFilters,
  textOf: CellTextOf<R>
): string[] {
  const seen = new Set<string>();
  filterRows(rows, filters, textOf, fieldKey).forEach((row) =>
    seen.add(textOf(row, fieldKey))
  );
  return [...seen].sort(compareValues);
}

/** The candidates the popover lists under the filter's search text. */
export function searchedValues(
  candidates: string[],
  filter: ColumnFilter
): string[] {
  const searchOnly: ColumnFilter = { values: null, search: filter.search };
  return candidates.filter((value) => matchesFilter(value, searchOnly));
}

/**
 * Some values checked or unchecked — one row of the list, or every listed
 * value at once. Unchecking from "every value" pins the remaining candidates;
 * once every candidate is checked again the restriction is lifted, so the
 * filter reads as inactive rather than as an explicit list.
 */
export function setValuesChecked(
  filter: ColumnFilter,
  candidates: string[],
  values: string[],
  checked: boolean
): ColumnFilter {
  const next = new Set(filter.values ?? candidates);
  values.forEach((value) => (checked ? next.add(value) : next.delete(value)));
  const everyCandidate = candidates.every((candidate) => next.has(candidate));
  return { ...filter, values: everyCandidate ? null : next };
}
