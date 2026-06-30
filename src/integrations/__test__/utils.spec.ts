import { filterTrackedFields } from '../utils';

describe('filterTrackedFields', () => {
  const fields = {
    email: 'ada@example.com',
    first_name: 'Ada',
    last_name: 'Lovelace'
  };

  it('returns all fields when no selection is provided', () => {
    expect(filterTrackedFields(fields, undefined)).toEqual(fields);
  });

  it('returns all fields when the selection is empty', () => {
    expect(filterTrackedFields(fields, [])).toEqual(fields);
  });

  it('returns only the selected fields', () => {
    expect(filterTrackedFields(fields, ['email', 'first_name'])).toEqual({
      email: 'ada@example.com',
      first_name: 'Ada'
    });
  });

  it('silently skips selected keys that no longer exist on the form', () => {
    expect(filterTrackedFields(fields, ['email', 'removed_field'])).toEqual({
      email: 'ada@example.com'
    });
  });

  it('does not mutate the input object', () => {
    const input = { ...fields };
    filterTrackedFields(input, ['email']);
    expect(input).toEqual(fields);
  });
});
