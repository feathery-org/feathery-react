import { getFieldValue } from '../../../../utils/fieldHelperFunctions';
import { getInlineError, handleCheckboxGroupSelectAllChange } from './utils';

jest.mock('../../../../utils/fieldHelperFunctions', () => ({
  getFieldValue: jest.fn()
}));

const mockGetFieldValue = getFieldValue as jest.Mock;

describe('getInlineError', () => {
  const repeatField = (repeat?: number) => ({ servar: { key: 'f' }, repeat });

  it('returns a non-repeat error from the field-wide message', () => {
    const errors = { f: { message: 'oops' } };
    expect(getInlineError({ servar: { key: 'f' } }, errors)).toBe('oops');
  });

  it('scopes a repeated error to its own row and not others', () => {
    const errors = { f: { byIndex: { 1: { message: 'bad row' } } } };
    // The invalid row shows the error...
    expect(getInlineError(repeatField(1), errors)).toBe('bad row');
    // ...but a sibling row (e.g. a freshly added one) does not.
    expect(getInlineError(repeatField(2), errors)).toBeUndefined();
    expect(getInlineError(repeatField(0), errors)).toBeUndefined();
  });

  it('lights up every invalid row when multiple rows have errors', () => {
    const errors = {
      f: { byIndex: { 0: { message: 'row 0' }, 2: { message: 'row 2' } } }
    };
    expect(getInlineError(repeatField(0), errors)).toBe('row 0');
    expect(getInlineError(repeatField(1), errors)).toBeUndefined();
    expect(getInlineError(repeatField(2), errors)).toBe('row 2');
  });

  it('falls back to a field-wide error across all rows', () => {
    const errors = { f: { message: 'field-wide' } };
    expect(getInlineError(repeatField(0), errors)).toBe('field-wide');
    expect(getInlineError(repeatField(3), errors)).toBe('field-wide');
  });

  it('returns undefined when there is no matching error', () => {
    expect(getInlineError(repeatField(0), {})).toBeUndefined();
  });

  it('does not collide a literal field key with a repeated row key', () => {
    // A repeated field `f` with a row-0 error AND a separate plain field
    // literally named `f-0` must not clobber each other.
    const errors = {
      f: { byIndex: { 0: { message: 'repeat row 0' } } },
      'f-0': { message: 'plain f-0 field' }
    };
    // Repeated field `f`, row 0 → its own byIndex entry.
    expect(getInlineError(repeatField(0), errors)).toBe('repeat row 0');
    // Plain field `f-0` (no repeat) → its own field-wide message.
    expect(getInlineError({ servar: { key: 'f-0' } }, errors)).toBe(
      'plain f-0 field'
    );
  });
});

describe('handleCheckboxGroupSelectAllChange', () => {
  const field = { servar: { key: 'checkbox_group' } };

  it('only toggles defined options and preserves other values', () => {
    const updateFieldValues = jest.fn();

    mockGetFieldValue.mockReturnValue({ value: ['Other value'] });
    handleCheckboxGroupSelectAllChange(
      ['Option 1', 'Option 2'],
      true,
      field,
      updateFieldValues
    );

    expect(updateFieldValues).toHaveBeenCalledWith({
      checkbox_group: ['Other value', 'Option 1', 'Option 2']
    });

    updateFieldValues.mockClear();
    mockGetFieldValue.mockReturnValue({
      value: ['Option 1', 'Option 2', 'Other value']
    });
    handleCheckboxGroupSelectAllChange(
      ['Option 1', 'Option 2'],
      false,
      field,
      updateFieldValues
    );

    expect(updateFieldValues).toHaveBeenCalledWith({
      checkbox_group: ['Other value']
    });
  });
});
