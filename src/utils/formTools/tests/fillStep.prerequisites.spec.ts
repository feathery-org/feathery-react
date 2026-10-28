jest.mock('../../validation', () => ({
  ...jest.requireActual('../../validation'),
  phoneLib: { parsePhoneNumber: jest.fn() },
  phoneLibPromise: Promise.resolve(),
  loadPhoneValidator: jest.fn()
}));

import internalState from '../../internalState';
import { fieldValues } from '../../init';
import { isButtonDisabled } from '../../button';
import { fillStepTool } from '../fillStep';
import { field, seedForm } from './helpers';

const FORM = 'fill-step-prerequisites';
const CONTAINER = {
  id: 'vehicles',
  position: [0],
  repeated: true,
  properties: {}
};
const vinField = (overrides = {}) =>
  field({
    position: [0, 0],
    servar: { key: 'vin', type: 'text_field', repeated: true, ...overrides }
  });
const nameField = () =>
  field({
    position: [2],
    servar: { key: 'name', type: 'text_field', required: true }
  });
const addButton = () => ({
  id: 'add-vehicle',
  position: [1],
  properties: {
    disable_if_fields_incomplete: true,
    actions: [{ type: 'add_repeated_row', repeat_container: CONTAINER.id }]
  }
});

let seededKeys: string[] = [];
const seed = (
  fields = [vinField(), nameField()],
  values: Record<string, any> = { vin: [''], name: '' },
  buttons = [addButton()]
) => {
  seededKeys = Object.keys(values);
  Object.assign(fieldValues, values);
  const rowCount = Math.max(
    0,
    ...fields
      .filter((f) => f.servar.repeated)
      .map((f) => values[f.servar.key].length)
  );
  const canClickWhenAdded: boolean[] = [];
  const addRepeatedRow = jest.fn((_container: any, limit: number | null) => {
    const state = internalState[FORM];
    canClickWhenAdded.push(
      buttons.some(
        (button) =>
          !isButtonDisabled(
            button,
            state.currentStep,
            state.visiblePositions,
            false
          )
      )
    );
    for (const f of fields.filter((f) => f.servar.repeated)) {
      const key = f.servar.key;
      if (limit && fieldValues[key].length >= limit) return;
      const value = [
        ...fieldValues[key],
        f.servar.type === 'file_upload' ? null : ''
      ];
      fieldValues[key] = value;
      state.fields[key] = { value } as any;
      state.visiblePositions[f.position.join(',')].push(true);
    }
    state.visiblePositions['0'].push(true);
    state.formToolsRenderTick! += 1;
  });
  const seeded = seedForm(FORM, {
    fields,
    fieldValues: values,
    step: { subgrids: [CONTAINER], buttons },
    visiblePositions: Object.fromEntries([
      ['0', Array(rowCount).fill(true)],
      ...fields.map((f) => [
        f.position.join(','),
        Array(f.servar.repeated ? rowCount : 1).fill(true)
      ]),
      ...buttons.map((button) => [button.position.join(','), [true]])
    ]),
    changeValue: (value, f, index) => {
      const key = f.servar.key;
      const next = index === null ? value : [...fieldValues[key]];
      if (index !== null)
        next[index] = f.servar.type === 'file_upload' ? value[0] : value;
      fieldValues[key] = next;
      internalState[FORM].fields[key] = { value: next } as any;
      return true;
    },
    callbacks: { addRepeatedRow, submitFiles: jest.fn(async () => undefined) }
  });
  return { ...seeded, addRepeatedRow, canClickWhenAdded };
};

afterEach(() => {
  delete internalState[FORM];
  seededKeys.forEach((key) => delete fieldValues[key]);
  jest.clearAllMocks();
});

it('fills existing rows but leaves extra rows uncreated when Add needs missing information', async () => {
  const { addRepeatedRow } = seed();

  const result = await fillStepTool(FORM, {
    values: { vin: ['VIN1', 'VIN2'] }
  });

  expect(fieldValues.vin).toEqual(['VIN1']);
  expect(fieldValues.name).toBe('');
  expect(addRepeatedRow).not.toHaveBeenCalled();
  expect(result.fields.vin).toMatchObject({
    rows: [
      { status: 'filled', value: 'VIN1' },
      { status: 'rejected', message: expect.stringContaining('disabled') }
    ]
  });
});

it('retries extra rows after a supplied prerequisite later on the step is filled', async () => {
  const { addRepeatedRow, changeValue, canClickWhenAdded } = seed();

  const result = await fillStepTool(FORM, {
    values: { vin: ['VIN1', 'VIN2'], name: 'Jane' }
  });

  expect(fieldValues.vin).toEqual(['VIN1', 'VIN2']);
  expect(addRepeatedRow).toHaveBeenCalledTimes(1);
  expect(canClickWhenAdded).toEqual([true]);
  expect(result.fields.vin).toMatchObject({
    rows: [{ status: 'filled' }, { status: 'filled' }]
  });
  expect(
    changeValue.mock.calls.filter(([, f]) => f.servar.key === 'vin')
  ).toHaveLength(2);
});

const makeField = () =>
  field({
    position: [0, 1],
    servar: { key: 'make', type: 'text_field', repeated: true, required: true }
  });

it('fills required fields in each new row before adding the next row', async () => {
  const { addRepeatedRow, canClickWhenAdded } = seed(
    [vinField({ required: true }), makeField()],
    { vin: [''], make: [''] }
  );

  await fillStepTool(FORM, {
    values: { vin: ['VIN1', 'VIN2', 'VIN3'], make: ['Ford', 'Toyota', 'Honda'] }
  });

  expect(fieldValues.vin).toEqual(['VIN1', 'VIN2', 'VIN3']);
  expect(fieldValues.make).toEqual(['Ford', 'Toyota', 'Honda']);
  expect(addRepeatedRow).toHaveBeenCalledTimes(2);
  expect(canClickWhenAdded).toEqual([true, true]);
});

it('stops growth when a newly added row still needs an unknown required value', async () => {
  const { addRepeatedRow, canClickWhenAdded } = seed(
    [vinField({ required: true }), makeField()],
    { vin: ['VIN1'], make: ['Ford'] }
  );

  const result = await fillStepTool(FORM, {
    values: { vin: ['VIN1', 'VIN2', 'VIN3'] }
  });

  expect(fieldValues.vin).toEqual(['VIN1', 'VIN2']);
  expect(fieldValues.make).toEqual(['Ford', '']);
  expect(addRepeatedRow).toHaveBeenCalledTimes(1);
  expect(canClickWhenAdded).toEqual([true]);
  expect(result.fields.vin).toMatchObject({
    rows: [
      { status: 'filled' },
      { status: 'filled' },
      { status: 'rejected', message: expect.stringContaining('disabled') }
    ]
  });
});

it('preserves automatic row creation independently of a disabled Add button', async () => {
  const { addRepeatedRow } = seed([
    vinField({ repeat_trigger: 'set_value' }),
    nameField()
  ]);

  const result = await fillStepTool(FORM, {
    values: { vin: ['VIN1', 'VIN2'] }
  });

  expect(addRepeatedRow).toHaveBeenCalledTimes(1);
  expect(fieldValues.vin).toEqual(['VIN1', 'VIN2']);
  expect(result.fields.vin).toMatchObject({
    rows: [{ status: 'filled' }, { status: 'filled' }]
  });
});

it('rechecks Add visibility after the preceding row runs its change rules', async () => {
  const { addRepeatedRow, awaitChangeRules, bumpRenderTick } = seed(
    [vinField()],
    { vin: [''] }
  );
  awaitChangeRules.mockImplementation(async () => {
    internalState[FORM].visiblePositions['1'] = [false];
    bumpRenderTick();
  });

  const result = await fillStepTool(FORM, {
    values: { vin: ['VIN1', 'VIN2'] }
  });

  expect(addRepeatedRow).not.toHaveBeenCalled();
  expect(fieldValues.vin).toEqual(['VIN1']);
  expect(result.fields.vin).toMatchObject({
    rows: [{ status: 'filled' }, { status: 'max_repeats_exceeded' }]
  });
});

it('uploads a repeated file field once after prerequisite writes unblock its remaining rows', async () => {
  const doc = field({
    position: [0, 0],
    servar: {
      key: 'doc',
      type: 'file_upload',
      repeated: true,
      metadata: { file_types: [] }
    }
  });
  seed([doc, nameField()], { doc: [null], name: '' });
  const files = ['first.txt', 'second.txt'].map((name) => ({
    name,
    mimeType: 'text/plain',
    dataBase64: 'aGVsbG8='
  }));

  const result = await fillStepTool(FORM, {
    values: { doc: files, name: 'Jane' }
  });

  expect(result.fields.doc).toEqual({
    status: 'repeated',
    rows: files.map(({ name, mimeType }) => ({
      status: 'filled',
      value: { name, mimeType }
    }))
  });
  expect(
    internalState[FORM].formToolsCallbacks!.submitFiles
  ).toHaveBeenCalledTimes(1);
});
