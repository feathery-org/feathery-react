import { getFieldValue } from '../../../../utils/fieldHelperFunctions';
import { handleCheckboxGroupSelectAllChange } from './utils';

jest.mock('../../../../utils/fieldHelperFunctions', () => ({
  getFieldValue: jest.fn()
}));

const mockGetFieldValue = getFieldValue as jest.Mock;

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
