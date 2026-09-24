import {
  BLANK_LABEL,
  candidateValues,
  ColumnFilter,
  ColumnFilters,
  EMPTY_FILTER,
  filterRows,
  isFilterActive,
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

describe('column filter model', () => {
  test('a filter with no values and no search is inactive', () => {
    expect(isFilterActive(undefined)).toBe(false);
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
    expect(isFilterActive({ values: null, search: '  ' })).toBe(false);
    expect(isFilterActive({ values: new Set(), search: '' })).toBe(true);
    expect(isFilterActive({ values: null, search: 'x' })).toBe(true);
  });

  test('search matches case-insensitively on displayed text; values match exactly', () => {
    expect(matchesFilter('Austin', { values: null, search: 'aus' })).toBe(true);
    expect(matchesFilter('Boston', { values: null, search: 'aus' })).toBe(
      false
    );
    expect(
      matchesFilter('Austin', { values: new Set(['austin']), search: '' })
    ).toBe(false);
    expect(
      matchesFilter('Austin', { values: new Set(['Austin']), search: 'ost' })
    ).toBe(false);
  });

  test('filterRows ANDs every active column filter and skips inactive ones', () => {
    const filters: ColumnFilters = {
      team: { values: new Set(['Red']), search: '' },
      city: { values: null, search: 'c' }
    };
    expect(ids(filterRows(rows, filters, textOf))).toEqual(['d']);
    expect(ids(filterRows(rows, {}, textOf))).toEqual(['a', 'b', 'c', 'd']);
  });

  test('candidate values come from rows passing the OTHER columns, blanks first, sorted; the search only narrows the listing', () => {
    const filters: ColumnFilters = {
      city: { values: new Set(['Austin', 'austin', 'Chicago']), search: '' }
    };
    expect(candidateValues(rows, 'team', filters, textOf)).toEqual(['', 'Red']);
    // This column's own filter never hides values from its own list.
    expect(candidateValues(rows, 'city', filters, textOf)).toEqual([
      'austin',
      'Austin',
      'Boston',
      'Chicago'
    ]);
    const searched: ColumnFilter = { values: null, search: 'ton' };
    expect(
      searchedValues(candidateValues(rows, 'city', {}, textOf), searched)
    ).toEqual(['Boston']);
  });

  test('unchecking from every value keeps the rest; re-checking every candidate lifts the restriction', () => {
    const candidates = ['Blue', 'Red'];
    const off = setValuesChecked(EMPTY_FILTER, candidates, ['Blue'], false);
    expect(off.values && [...off.values]).toEqual(['Red']);
    const back = setValuesChecked(off, candidates, ['Blue'], true);
    expect(back.values).toBeNull();
  });

  test('unchecking under a search keeps the values the search hid', () => {
    const candidates = ['Active', 'Archived', 'Inactive', 'Pending'];
    const searching: ColumnFilter = { values: null, search: 'a' };
    const shown = searchedValues(candidates, searching);
    expect(shown).toEqual(['Active', 'Archived', 'Inactive']);
    const off = setValuesChecked(searching, candidates, ['Archived'], false);
    expect(off.values && [...off.values].sort()).toEqual([
      'Active',
      'Inactive',
      'Pending'
    ]);
    // Deselecting every listed value drops only the listed ones.
    const none = setValuesChecked(searching, candidates, shown, false);
    expect(none.values && [...none.values]).toEqual(['Pending']);
  });

  test('a blank cell is listed under its own label', () => {
    expect(BLANK_LABEL).toBe('(Blanks)');
  });
});
