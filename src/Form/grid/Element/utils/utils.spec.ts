import { getFieldValue } from '../../../../utils/fieldHelperFunctions';
import {
  fileFieldShouldSubmit,
  handleCheckboxGroupSelectAllChange
} from './utils';

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

describe('fileFieldShouldSubmit', () => {
  const single = { metadata: { multiple: false } };
  const multi = { metadata: { multiple: true } };
  const file = { name: 'a.pdf' };

  it('submits once a single-file field holds a file', () => {
    expect(fileFieldShouldSubmit(single, [file], 0)).toBe(true);
  });

  it('never submits a multi-file field, even on the first file', () => {
    expect(fileFieldShouldSubmit(multi, [file], 0)).toBe(false);
    expect(fileFieldShouldSubmit(multi, [file, file, file], 2)).toBe(false);
  });

  it('does not submit when a file was removed', () => {
    // -1 is how the field reports a removal rather than a fill
    expect(fileFieldShouldSubmit(single, [file, file], -1)).toBe(false);
    expect(fileFieldShouldSubmit(multi, [file, file], -1)).toBe(false);
  });

  it('does not submit an emptied field', () => {
    expect(fileFieldShouldSubmit(single, [], 0)).toBe(false);
    expect(fileFieldShouldSubmit(single, [], -1)).toBe(false);
  });
});
