import { getFieldValue } from '../../../../utils/fieldHelperFunctions';
import { getInlineError, handleCheckboxGroupSelectAllChange } from './utils';

jest.mock('../../../../utils/fieldHelperFunctions', () => ({
  getFieldValue: jest.fn()
}));

const mockGetFieldValue = getFieldValue as jest.Mock;

describe('getInlineError', () => {
  const repeatField = (repeat?: number) => ({ servar: { key: 'f' }, repeat });

  it('returns a non-repeat error keyed by the plain key', () => {
    const errors = { f: { message: 'oops', index: null } };
    expect(getInlineError({ servar: { key: 'f' } }, errors)).toBe('oops');
  });

  it('scopes a repeated error to its own row and not others', () => {
    const errors = { 'f-1': { message: 'bad row', index: 1 } };
    // The invalid row shows the error...
    expect(getInlineError(repeatField(1), errors)).toBe('bad row');
    // ...but a sibling row (e.g. a freshly added one) does not.
    expect(getInlineError(repeatField(2), errors)).toBeUndefined();
    expect(getInlineError(repeatField(0), errors)).toBeUndefined();
  });

  it('lights up every invalid row when multiple rows have errors', () => {
    const errors = {
      'f-0': { message: 'row 0', index: 0 },
      'f-2': { message: 'row 2', index: 2 }
    };
    expect(getInlineError(repeatField(0), errors)).toBe('row 0');
    expect(getInlineError(repeatField(1), errors)).toBeUndefined();
    expect(getInlineError(repeatField(2), errors)).toBe('row 2');
  });

  it('falls back to a field-wide error (no index) across all rows', () => {
    const errors = { f: { message: 'field-wide', index: null } };
    expect(getInlineError(repeatField(0), errors)).toBe('field-wide');
    expect(getInlineError(repeatField(3), errors)).toBe('field-wide');
  });

  it('returns undefined when there is no matching error', () => {
    expect(getInlineError(repeatField(0), {})).toBeUndefined();
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
