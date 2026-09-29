import {
  BLANK_LABEL,
  candidateValues,
  ColumnFilter,
  ColumnFilters,
  EMPTY_FILTER,
  filterRows,
  isFilterActive,
  isValueChecked,
  matchesFilter,
  searchedValues,
  setValuesChecked
} from '../spreadsheet/columnFilters';

type Row = { id: string; cells: Record<string, string> };
const rows: Row[] = [
  { id: 'a', cells: { city: 'Austin', team: 'Red' } },
  { id: 'b', cells: { city: 'Boston', team: 'Blue' } },
  { id: 'c', cells: { city: 'austin', team: '' } },
  { id: 'd', cells: { city: 'Chicago', team: 'Red' } }
];
const textOf = (row: Row, key: string) => row.cells[key] ?? '';
const ids = (list: Row[]) => list.map((row) => row.id);

const hiding = (...values: string[]): ColumnFilter => ({
  hidden: new Set(values),
  search: ''
});

describe('column filter model', () => {
  test('a filter with nothing hidden and no search is inactive', () => {
    expect(isFilterActive(undefined)).toBe(false);
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
    expect(isFilterActive({ ...EMPTY_FILTER, search: '  ' })).toBe(false);
    expect(isFilterActive(hiding('red'))).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTER, search: 'x' })).toBe(true);
  });

  test('search and hidden values both match displayed text ignoring case', () => {
    expect(matchesFilter('Austin', { ...EMPTY_FILTER, search: 'AUS' })).toBe(
      true
    );
    expect(matchesFilter('Boston', { ...EMPTY_FILTER, search: 'aus' })).toBe(
      false
    );
    expect(matchesFilter('Austin', hiding('austin'))).toBe(false);
    expect(matchesFilter('Boston', hiding('austin'))).toBe(true);
    expect(matchesFilter('Boston', { hidden: new Set(), search: 'ost' })).toBe(
      true
    );
  });

  test('filterRows ANDs every active column filter and skips inactive ones', () => {
    const filters: ColumnFilters = {
      team: hiding('blue', ''),
      city: { ...EMPTY_FILTER, search: 'c' }
    };
    expect(ids(filterRows(rows, filters, textOf))).toEqual(['d']);
    expect(ids(filterRows(rows, {}, textOf))).toEqual(['a', 'b', 'c', 'd']);
  });

  test('candidate values come from rows passing the OTHER columns, one per spelling-insensitive value, blanks first, sorted', () => {
    const filters: ColumnFilters = { city: hiding('boston') };
    expect(candidateValues(rows, 'team', filters, textOf)).toEqual(['', 'Red']);
    // This column's own filter never hides values from its own list, and
    // "Austin" / "austin" are listed once, as the first row spells it.
    expect(candidateValues(rows, 'city', filters, textOf)).toEqual([
      'Austin',
      'Boston',
      'Chicago'
    ]);
    const searched: ColumnFilter = { ...EMPTY_FILTER, search: 'ton' };
    expect(
      searchedValues(candidateValues(rows, 'city', {}, textOf), searched)
    ).toEqual(['Boston']);
  });

  test('unchecking hides that value; checking it again lifts the filter', () => {
    const off = setValuesChecked(EMPTY_FILTER, ['Blue'], false);
    expect([...off.hidden]).toEqual(['blue']);
    expect(isValueChecked(off, 'Blue')).toBe(false);
    expect(isValueChecked(off, 'Red')).toBe(true);
    const back = setValuesChecked(off, ['Blue'], true);
    expect(isFilterActive(back)).toBe(false);
  });

  test('unchecking under a search leaves the values the search hid alone', () => {
    const candidates = ['Active', 'Archived', 'Inactive', 'Pending'];
    const searching: ColumnFilter = { ...EMPTY_FILTER, search: 'a' };
    const shown = searchedValues(candidates, searching);
    expect(shown).toEqual(['Active', 'Archived', 'Inactive']);
    const off = setValuesChecked(searching, ['Archived'], false);
    expect([...off.hidden]).toEqual(['archived']);
    // Deselecting every listed value hides only the listed ones.
    const none = setValuesChecked(searching, shown, false);
    expect(isValueChecked(none, 'Pending')).toBe(true);
  });

  test('a value the list never offered stays visible', () => {
    // Team is unchecked while City hides Boston, so Blue (Boston's only team)
    // was never listed. Lifting the City filter brings Boston back with it.
    const teamList = candidateValues(
      rows,
      'team',
      { city: hiding('boston') },
      textOf
    );
    expect(teamList).not.toContain('Blue');
    const team = setValuesChecked(EMPTY_FILTER, [''], false);
    expect(ids(filterRows(rows, { team }, textOf))).toEqual(['a', 'b', 'd']);
    // Likewise a cell edited to a brand-new value is not hidden by the filter.
    expect(matchesFilter('Green', team)).toBe(true);
  });

  test('a blank cell is listed under its own label', () => {
    expect(BLANK_LABEL).toBe('(Blanks)');
  });
});
