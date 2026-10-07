jest.mock('../../validation', () => ({
  phoneLib: { parsePhoneNumber: jest.fn() },
  phoneLibPromise: Promise.resolve(),
  loadPhoneValidator: jest.fn()
}));

import internalState from '../../internalState';
import { fillStepTool } from '../fillStep';

const FORM = 'fill-step-repeats-form';

const emptyStepArrays = {
  texts: [],
  images: [],
  tables: [],
  tabs: [],
  progress_bars: [],
  next_conditions: []
};

const CONTAINER = { id: 'grp-1', position: [0], repeated: true };

const repeatedField = (key: string, type = 'text_field') => ({
  id: `${key}-el`,
  position: [0, 0],
  properties: {},
  servar: { id: `${key}-sv`, key, type, repeated: true, metadata: {} }
});

let changeValueMock: jest.Mock;
let fieldOnChangeInner: jest.Mock;
let fieldOnChangeMock: jest.Mock;
let awaitChangeRulesMock: jest.Mock;
let addRepeatedRowMock: jest.Mock;

const bumpTick = () => {
  (internalState as any)[FORM].formToolsRenderTick =
    ((internalState as any)[FORM].formToolsRenderTick ?? 0) + 1;
};

// One field ('vehicle_vin'), one repeat container, `rowCount` existing rows.
// addRepeatedRow mirrors Form/index.tsx's own semantics: appends a row
// (respecting maxRepeats) by writing the array directly, same as the real
// addRepeatedRow's synchronous fieldValues write.
const seed = (
  values: unknown[],
  opts: { maxRepeats?: number; visible?: boolean[] } = {}
) => {
  const field = repeatedField('vehicle_vin');
  const currentStep = {
    id: 'step-1',
    key: 'step-1',
    servar_fields: [field],
    subgrids: [CONTAINER],
    buttons:
      opts.maxRepeats === undefined
        ? []
        : [
            {
              id: 'add-btn',
              position: [],
              properties: {
                actions: [
                  {
                    type: 'add_repeated_row',
                    repeat_container: 'grp-1',
                    max_repeats: opts.maxRepeats
                  }
                ]
              }
            }
          ],
    ...emptyStepArrays
  };

  changeValueMock = jest.fn((value: any, f: any, index: number) => {
    const key = f.servar.key;
    const arr = [...((internalState as any)[FORM].fields[key]?.value ?? [])];
    arr[index] = value;
    (internalState as any)[FORM].fields[key] = { value: arr };
  });
  fieldOnChangeInner = jest.fn();
  fieldOnChangeMock = jest.fn(
    (args: any) => (opts2: any) => fieldOnChangeInner(args, opts2)
  );
  awaitChangeRulesMock = jest.fn(async () => bumpTick());
  addRepeatedRowMock = jest.fn((_container: any, limit: number | null) => {
    const arr = (internalState as any)[FORM].fields.vehicle_vin?.value ?? [];
    if (limit != null && arr.length >= limit) return; // mirrors the real no-op at max_repeats
    (internalState as any)[FORM].fields.vehicle_vin = {
      value: [...arr, '']
    };
    const vp = (internalState as any)[FORM].visiblePositions;
    vp['0'] = [...vp['0'], true];
    vp['0,0'] = [...vp['0,0'], true];
    bumpTick();
  });

  const rowCount = values.length;
  (internalState as any)[FORM] = {
    currentStep,
    steps: { 'step-1': currentStep },
    fields: { vehicle_vin: { value: values } },
    visiblePositions: {
      '0': Array(rowCount).fill(true),
      '0,0': opts.visible ?? Array(rowCount).fill(true)
    },
    inlineErrors: {},
    logicRules: [],
    formToolsRenderTick: 0,
    formToolsCallbacks: {
      changeValue: changeValueMock,
      fieldOnChange: fieldOnChangeMock,
      getNextStepKey: jest.fn(() => undefined),
      awaitChangeRules: awaitChangeRulesMock,
      addRepeatedRow: addRepeatedRowMock,
      submitFiles: jest.fn(async () => undefined)
    }
  };
};

afterEach(() => {
  delete (internalState as any)[FORM];
  jest.clearAllMocks();
});

describe('fillStepTool: repeated fields', () => {
  it('leaves a null row as it is and adds no rows for trailing nulls', async () => {
    seed(['KEEP']);

    const result = await fillStepTool(FORM, {
      values: { vehicle_vin: [null, 'VIN2', null] }
    });

    expect(addRepeatedRowMock).toHaveBeenCalledTimes(1);
    expect(result.fields.vehicle_vin).toEqual({
      status: 'repeated',
      rows: [
        { status: 'skipped' },
        { status: 'filled', value: 'VIN2' },
        { status: 'skipped' }
      ]
    });
    expect((internalState as any)[FORM].fields.vehicle_vin.value).toEqual([
      'KEEP',
      'VIN2'
    ]);
  });

  it('adds rows past the current row count and writes every requested row', async () => {
    seed(['existing']);

    const result = await fillStepTool(FORM, {
      values: { vehicle_vin: ['VIN1', 'VIN2', 'VIN3'] }
    });

    expect(addRepeatedRowMock).toHaveBeenCalledTimes(2);
    expect(result.fields.vehicle_vin).toEqual({
      status: 'repeated',
      rows: [
        { status: 'filled', value: 'VIN1' },
        { status: 'filled', value: 'VIN2' },
        { status: 'filled', value: 'VIN3' }
      ]
    });
    expect((internalState as any)[FORM].fields.vehicle_vin.value).toEqual([
      'VIN1',
      'VIN2',
      'VIN3'
    ]);
  });

  it('stops adding at max_repeats and reports the excess rows max_repeats_exceeded', async () => {
    seed(['existing'], { maxRepeats: 2 });

    const result = await fillStepTool(FORM, {
      values: { vehicle_vin: ['VIN1', 'VIN2', 'VIN3', 'VIN4'] }
    });

    expect((result.fields.vehicle_vin as any).rows).toEqual([
      { status: 'filled', value: 'VIN1' },
      { status: 'filled', value: 'VIN2' },
      { status: 'max_repeats_exceeded', message: expect.any(String) },
      { status: 'max_repeats_exceeded', message: expect.any(String) }
    ]);
  });

  it('leaves trailing existing rows untouched when fewer values are given than rows exist', async () => {
    seed(['row0', 'row1', 'row2']);

    const result = await fillStepTool(FORM, {
      values: { vehicle_vin: ['NEW0'] }
    });

    expect((result.fields.vehicle_vin as any).rows).toEqual([
      { status: 'filled', value: 'NEW0' }
    ]);
    expect((internalState as any)[FORM].fields.vehicle_vin.value).toEqual([
      'NEW0',
      'row1',
      'row2'
    ]);
    expect(addRepeatedRowMock).not.toHaveBeenCalled();
  });

  it('rejects a row hidden by its own hide-if, without affecting its siblings', async () => {
    seed(['row0', 'row1'], { visible: [true, false] });

    const result = await fillStepTool(FORM, {
      values: { vehicle_vin: ['NEW0', 'NEW1'] }
    });

    expect((result.fields.vehicle_vin as any).rows).toEqual([
      { status: 'filled', value: 'NEW0' },
      { status: 'hidden' }
    ]);
    expect((internalState as any)[FORM].fields.vehicle_vin.value).toEqual([
      'NEW0',
      'row1'
    ]);
  });

  it("reclassifies a row as 'changed' when a later row's change rule rewrites it", async () => {
    seed(['row0', 'row1']);
    // Row 1's own change rule rewrites row 0's value once settled - same
    // sibling-rewrite shape the scalar reclassification test covers.
    let calls = 0;
    awaitChangeRulesMock.mockImplementation(async () => {
      calls += 1;
      if (calls === 2) {
        const arr = [...(internalState as any)[FORM].fields.vehicle_vin.value];
        arr[0] = 'REWRITTEN';
        (internalState as any)[FORM].fields.vehicle_vin = { value: arr };
      }
      bumpTick();
    });

    const result = await fillStepTool(FORM, {
      values: { vehicle_vin: ['NEW0', 'NEW1'] }
    });

    expect((result.fields.vehicle_vin as any).rows).toEqual([
      { status: 'changed', value: 'REWRITTEN' },
      { status: 'filled', value: 'NEW1' }
    ]);
  });

  it('rejects the whole field when given a non-array value', async () => {
    seed(['row0']);

    const result = await fillStepTool(FORM, {
      values: { vehicle_vin: 'not-an-array' }
    });

    expect(result.fields.vehicle_vin).toEqual({
      status: 'rejected',
      message: expect.any(String)
    });
    expect(changeValueMock).not.toHaveBeenCalled();
  });
});
