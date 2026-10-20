/**
 * Column filters for the spreadsheet, the way a sheet's header filter works:
 * each column may hide some of its values and/or keep only values containing
 * a piece of text. Values are listed and hidden by the cell's DISPLAYED text,
 * so a date column lists "Jul 19, 1982", not the stored ISO string. The text
 * search also matches a cell's optional search text (stored value, labels), so
 * "1234" finds "$1,234.50". Both ignore case, so "Austin" and "austin" are one
 * value.
 *
 * Pure. State and rendering live in `useColumnFilters` and `FilterMenu`.
 */

export type ColumnFilter = {
  /**
   * The values the user unchecked, by `valueKey`. Stored as what is hidden
   * rather than what is kept, so a value the list never offered — one only
   * other columns' filters were hiding, a row a refresh brings in, a cell
   * edited to something new — shows rather than vanishing unasked.
   */
  hidden: ReadonlySet<string>;
  /** Text the displayed value must contain. */
  search: string;
};

/** Active filters keyed by the column's field key. */
export type ColumnFilters = Readonly<Record<string, ColumnFilter>>;

export const EMPTY_FILTER: ColumnFilter = { hidden: new Set(), search: '' };

/** How an empty cell is listed among a column's values. */
export const BLANK_LABEL = '(Blanks)';

/**
 * The most values the popover lists. A wide Data Hub column can hold
 * thousands of distinct values; past this the user narrows with the search.
 */
export const MAX_LISTED_VALUES = 500;

export type CellTextOf<R> = (row: R, fieldKey: string) => string;

/** What a displayed value is compared by: its text, ignoring case. */
function valueKey(text: string): string {
  return text.toLowerCase();
}

export function isFilterActive(filter?: ColumnFilter): boolean {
  if (!filter) return false;
  return filter.hidden.size > 0 || filter.search.trim() !== '';
}

export function matchesFilter(
  text: string,
  filter: ColumnFilter,
  searchText: string = text
): boolean {
  const needle = valueKey(filter.search.trim());
  if (needle && !valueKey(searchText).includes(needle)) return false;
  return !filter.hidden.has(valueKey(text));
}

/**
 * The rows every active filter lets through. `except` leaves one column's
 * filter out, which is how that column's own value list is built.
 */
export function filterRows<R>(
  rows: R[],
  filters: ColumnFilters,
  textOf: CellTextOf<R>,
  except?: string,
  searchTextOf?: CellTextOf<R>
): R[] {
  const active = Object.entries(filters).filter(
    ([fieldKey, filter]) => fieldKey !== except && isFilterActive(filter)
  );
  if (!active.length) return rows;
  return rows.filter((row) =>
    active.every(([fieldKey, filter]) =>
      matchesFilter(
        textOf(row, fieldKey),
        filter,
        searchTextOf?.(row, fieldKey)
      )
    )
  );
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
});

/** Blanks first, then a natural sort ("2" before "10"). */
function compareValues(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '') return -1;
  if (b === '') return 1;
  return collator.compare(a, b) || a.localeCompare(b);
}

/**
 * The distinct displayed values one column offers to pick from: those of the
 * rows every OTHER column's filter lets through, one per `valueKey` (spelled
 * as the first row has it). Its own filter is ignored — an unchecked value
 * must stay listed to be checked again.
 */
export function candidateValues<R>(
  rows: R[],
  fieldKey: string,
  filters: ColumnFilters,
  textOf: CellTextOf<R>,
  searchTextOf?: CellTextOf<R>
): string[] {
  const seen = new Map<string, string>();
  filterRows(rows, filters, textOf, fieldKey, searchTextOf).forEach((row) => {
    const text = textOf(row, fieldKey);
    const key = valueKey(text);
    if (!seen.has(key)) seen.set(key, text);
  });
  return [...seen.values()].sort(compareValues);
}

/**
 * Each displayed value's search text: every search text its cells have, so a
 * listed value is found by any of their stored forms.
 */
export function valueSearchTexts<R>(
  rows: R[],
  fieldKey: string,
  textOf: CellTextOf<R>,
  searchTextOf: CellTextOf<R>
): Map<string, string> {
  const texts = new Map<string, Set<string>>();
  rows.forEach((row) => {
    const key = valueKey(textOf(row, fieldKey));
    const set = texts.get(key) ?? new Set<string>();
    set.add(searchTextOf(row, fieldKey));
    texts.set(key, set);
  });
  return new Map([...texts].map(([key, set]) => [key, [...set].join('\n')]));
}

/** The candidates the popover lists under the filter's search text. */
export function searchedValues(
  candidates: string[],
  filter: ColumnFilter,
  searchTexts?: Map<string, string>
): string[] {
  const searchOnly: ColumnFilter = { ...EMPTY_FILTER, search: filter.search };
  return candidates.filter((value) =>
    matchesFilter(value, searchOnly, searchTexts?.get(valueKey(value)))
  );
}

export function isValueChecked(filter: ColumnFilter, value: string): boolean {
  return !filter.hidden.has(valueKey(value));
}

/**
 * Some values checked or unchecked — one row of the list, or every listed
 * value at once. Only those values change, so unchecking under a search
 * leaves the values the search hid as they were.
 */
export function setValuesChecked(
  filter: ColumnFilter,
  values: string[],
  checked: boolean
): ColumnFilter {
  const hidden = new Set(filter.hidden);
  values.forEach((value) =>
    checked ? hidden.delete(valueKey(value)) : hidden.add(valueKey(value))
  );
  return { ...filter, hidden };
}
