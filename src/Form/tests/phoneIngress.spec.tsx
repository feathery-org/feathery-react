import { GridMod } from './testMocks';
import { act, cleanup, render, screen } from '@testing-library/react';
import { JSForm } from '..';
import { fieldValues } from '../../utils/init';

const validation = jest.requireMock('../../utils/validation');
validation.phoneLib = jest.requireActual('libphonenumber-js/min');

beforeEach(() => {
  Object.keys(fieldValues).forEach((key) => delete fieldValues[key]);
  jest.requireMock(
    '../../utils/featheryClient'
  )._spies.schemaState.servarFields = [
    {
      id: 'phone',
      properties: {},
      servar: {
        key: 'phone',
        type: 'phone_number',
        metadata: { default_country: 'US' }
      }
    }
  ];
});
afterEach(() => {
  cleanup();
  jest.requireMock(
    '../../utils/featheryClient'
  )._spies.schemaState.servarFields = [];
});

it.each([
  ['(415) 555-2671', '14155552671'],
  ['+44 (20) 7946-0018', '442079460018'],
  ['6612345678', '16612345678'],
  [
    ['(415) 555-2671', ''],
    ['14155552671', '']
  ]
])('normalizes live Form integration updates: %j', async (input, expected) => {
  render(<JSForm formId='phone-form' _internalId='phone-ingress' />);
  await screen.findByTestId('btn');
  act(() => GridMod._spies.form.updateFieldValues({ phone: input }));
  expect(fieldValues.phone).toEqual(expected);
});

it('preserves canonical numbers returned by PhoneField and session polling', async () => {
  render(<JSForm formId='phone-form' _internalId='phone-ingress-canonical' />);
  await screen.findByTestId('btn');
  act(() =>
    GridMod._spies.form.updateFieldValues(
      { phone: '6612345678' },
      { preserveCanonicalPhones: true }
    )
  );
  expect(fieldValues.phone).toBe('6612345678');
});

it('normalizes hidden-row defaults without reinterpreting visible canonical rows', async () => {
  const repeat = jest.requireMock('../../utils/repeat');
  const visibility = jest.requireMock('../../utils/hideAndRepeats');
  const formHelpers = jest.requireMock('../../utils/formHelperFunctions');
  const originals = [
    repeat.getRepeatedContainer,
    visibility.getVisiblePositions,
    formHelpers.mapFormSettingsResponse
  ];
  repeat.getRepeatedContainer = () => ({});
  visibility.getVisiblePositions = () => ({ k: [true, false] });
  formHelpers.mapFormSettingsResponse = () => ({ clearHideIfFields: true });
  const schemaState = jest.requireMock('../../utils/featheryClient')._spies
    .schemaState;
  schemaState.servarFields[0].servar.metadata.default_value = '6612345678';
  const helpers = jest.requireMock('../../utils/fieldHelperFunctions');
  const originalDefault = helpers.getDefaultFieldValue;
  helpers.getDefaultFieldValue = () => '6612345678';
  fieldValues.phone = ['6612345678', '14155552671'];
  try {
    render(<JSForm formId='phone-form' _internalId='phone-hidden-reset' />);
    await screen.findByTestId('btn');
    expect(fieldValues.phone).toEqual(['6612345678', '16612345678']);
  } finally {
    [
      repeat.getRepeatedContainer,
      visibility.getVisiblePositions,
      formHelpers.mapFormSettingsResponse
    ] = originals;
    helpers.getDefaultFieldValue = originalDefault;
  }
});
