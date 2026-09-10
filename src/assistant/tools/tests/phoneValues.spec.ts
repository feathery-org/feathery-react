import { dispatchSetFieldValue } from '../setFieldValue';
import internalState from '../../../utils/internalState';

jest.mock('../../../utils/init', () => ({ initState: {} }));
jest.mock('../../../utils/validation', () => {
  const phoneLib = jest.requireActual('libphonenumber-js/min');
  return {
    phoneLib,
    phoneLibPromise: Promise.resolve(phoneLib),
    loadPhoneValidator: jest.fn()
  };
});
jest.mock('../../../utils/repeat', () => ({
  getRepeatedContainer: (_step: any, field: any) =>
    field.servar.repeated ? {} : undefined
}));
jest.mock('../../../utils/hideAndRepeats', () => ({
  getPositionKey: () => 'root'
}));

const formId = 'assistant-phone';
function setup(country = 'US', existing: any = '', repeated = false) {
  const changeValue = jest.fn();
  internalState[formId] = {
    currentStep: {
      servar_fields: [
        {
          servar: {
            key: 'phone',
            type: 'phone_number',
            repeated,
            metadata: { default_country: country }
          }
        }
      ]
    },
    assistantClient: { changeValue },
    fields: { phone: { value: existing } },
    visiblePositions: { root: [true, true] }
  } as any;
  return changeValue;
}
afterEach(() => {
  delete internalState[formId];
  jest.restoreAllMocks();
});
it.each([
  ['US', '(415) 555-2671', '14155552671'],
  ['US', '44 20 7946 0018', '442079460018'],
  ['US', '6612345678', '16612345678'],
  ['GB', '020 7946 0018', '442079460018'],
  ['US', 4155552671, '14155552671'],
  ['US', '(415) 555-2671 ext 12', '(415) 555-2671 ext 12'],
  ['US', 'Call +1 415 555 2671', 'Call +1 415 555 2671']
])('normalizes assistant %s phone %j', async (country, input, expected) => {
  const changeValue = setup(country as string);
  const { results } = await dispatchSetFieldValue(formId, [
    { fieldKey: 'phone', value: input }
  ]);
  expect(results[0]).toMatchObject({ ok: true, value: expected });
  expect(changeValue).toHaveBeenCalledWith(expected, expect.anything(), null);
});
it.each([
  4155552671.9,
  -4155552671,
  Number.MAX_SAFE_INTEGER + 1,
  Infinity,
  NaN
])('rejects unsupported numeric value %j without truncating', async (value) => {
  const changeValue = setup();
  const { results } = await dispatchSetFieldValue(formId, [
    { fieldKey: 'phone', value }
  ]);
  expect(results[0]).toMatchObject({ ok: false, errorType: 'shape_mismatch' });
  expect(changeValue).not.toHaveBeenCalled();
});
it('infers the auto country from timezone', async () => {
  jest
    .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
    .mockReturnValue({ timeZone: 'Europe/London' } as any);
  setup('auto');
  const { results } = await dispatchSetFieldValue(formId, [
    { fieldKey: 'phone', value: '020 7946 0018' }
  ]);
  expect(results[0]).toMatchObject({ value: '442079460018' });
});
it('uses current row country for repeated phones', async () => {
  setup('US', ['14155552671', '442079460018'], true);
  const { results } = await dispatchSetFieldValue(formId, [
    { fieldKey: 'phone', value: '020 7946 0018', repeatIndex: 1 }
  ]);
  expect(results[0]).toMatchObject({
    ok: true,
    value: '442079460018',
    repeatIndex: 1
  });
});
it('rejects a whole array where the assistant contract requires an individual row', async () => {
  const changeValue = setup('US', [''], true);
  const { results } = await dispatchSetFieldValue(formId, [
    { fieldKey: 'phone', value: ['4155552671'], repeatIndex: 0 }
  ]);
  expect(results[0]).toMatchObject({ ok: false, errorType: 'shape_mismatch' });
  expect(changeValue).not.toHaveBeenCalled();
});
