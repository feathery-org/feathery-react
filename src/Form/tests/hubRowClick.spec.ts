import { hasRowClick, resolveTableRowClick } from '../hubRowClick';

const STEPS = {
  list: { id: 'step-list', key: 'list' },
  details: { id: 'step-details', key: 'details' }
};

const table = (properties: Record<string, any> = {}) => ({ properties });

describe('resolveTableRowClick', () => {
  test('stores the entry id and resolves the step key', () => {
    expect(
      resolveTableRowClick(
        table({
          row_click_entry_field_key: 'selected_entry',
          row_click_step: 'step-details'
        }),
        { rowIndex: 0, entryId: 'e1' } as any,
        STEPS
      )
    ).toEqual({
      entryFieldKey: 'selected_entry',
      entryId: 'e1',
      nextStepKey: 'details'
    });
  });

  test('each half is independent and an unsaved row stores nothing', () => {
    expect(
      resolveTableRowClick(
        table({ row_click_step: 'step-details' }),
        { entryId: 'e1' },
        STEPS
      )
    ).toEqual({ nextStepKey: 'details' });
    expect(
      resolveTableRowClick(
        table({ row_click_entry_field_key: 'selected_entry' }),
        {},
        STEPS
      )
    ).toEqual({});
    // A step that no longer exists does not navigate.
    expect(
      resolveTableRowClick(table({ row_click_step: 'gone' }), {}, STEPS)
    ).toEqual({});
  });

  test('row action buttons are not row clicks', () => {
    expect(
      resolveTableRowClick(
        table({
          row_click_entry_field_key: 'selected_entry',
          row_click_step: 'step-details'
        }),
        { entryId: 'e1', action: 'Delete' },
        STEPS
      )
    ).toEqual({});
  });

  test('hasRowClick reads either setting', () => {
    expect(hasRowClick(table())).toBe(false);
    expect(hasRowClick(table({ row_click_step: 's' }))).toBe(true);
    expect(hasRowClick(table({ row_click_entry_field_key: 'k' }))).toBe(true);
  });
});
