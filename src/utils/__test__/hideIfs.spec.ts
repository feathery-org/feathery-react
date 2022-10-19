import { shouldElementHide } from '../hideIfs';
import { fieldValues } from '../init';

describe('shouldElementHide', () => {
  const fieldKey = 'text-field-1';
  const fieldKeyRight = 'text-field-2';
  const testValue = 'test';
  const testRightSideField = {
    field_type: 'servar',
    field_id: 'dont care',
    field_key: fieldKeyRight
  };
  const element = (...fieldValues) => ({
    hide_ifs: [
      {
        field_type: 'servar',
        comparison: 'equal',
        index: 0,
        field_id: 'blaa',
        servar: 'blaa',
        field_key: fieldKey,
        values: fieldValues
      }
    ]
  });
  const newFieldValues = (...values) => ({
    [fieldKey]: values.length > 1 ? [...values] : values[0]
  });
  const fieldValuesLR = (valuesLeft, valuesRight) => ({
    [fieldKey]: valuesLeft.length > 1 ? [...valuesLeft] : valuesLeft[0],
    [fieldKeyRight]: valuesRight.length > 1 ? [...valuesRight] : valuesRight[0]
  });

  it('test various element hide rules', () => {
    Object.assign(fieldValues, newFieldValues(testValue));

    expect(
      shouldElementHide({
        element: element(testValue)
      })
    ).toBeTruthy();
    expect(
      shouldElementHide({
        element: element(testValue, 'blaa') // more than one value - only need to match one
      })
    ).toBeTruthy();

    Object.assign(fieldValues, newFieldValues('non-matching value'));

    expect(
      shouldElementHide({
        element: element(testValue)
      })
    ).toBeFalsy();
  });
  it('test various element field-field hide rules', () => {
    Object.assign(fieldValues, fieldValuesLR([testValue], [testValue]));
    expect(
      shouldElementHide({
        element: element(testRightSideField)
      })
    ).toBeTruthy();

    Object.assign(
      fieldValues,
      fieldValuesLR([testValue], ['non-matching value'])
    );
    expect(
      shouldElementHide({
        element: element(testRightSideField)
      })
    ).toBeFalsy();
  });
});
