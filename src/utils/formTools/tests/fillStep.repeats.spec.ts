jest.mock('../../validation', () => ({
  phoneLib: {
    parsePhoneNumber: jest.fn((input: string) => ({
      isValid: () => true,
      number: input
    }))
  },
  phoneLibPromise: Promise.resolve(),
  loadPhoneValidator: jest.fn()
}));

import internalState from '../../internalState';
import { fillStepTool } from '../fillStep';
import { seedForm } from './helpers';

const FORM = 'fill-step-repeats-form';

const CONTAINER = { id: 'grp-1', position: [0], repeated: true };

const repeatedField = (key: string, type = 'text_field', metadata = {}) => ({
  id: `${key}-el`,
  position: [0, 0],
  properties: {},
  servar: { id: `${key}-sv`, key, type, repeated: true, metadata }
});

let changeValueMock: jest.Mock;
let fieldOnChangeInner: jest.Mock;
let fieldOnChangeMock: jest.Mock;
let awaitChangeRulesMock: jest.Mock;
let addRepeatedRowMock: jest.Mock;
let getNextStepKeyMock: jest.Mock;
let bumpTick: () => void;

// One field ('vehicle_vin'), one repeat container, one existing row per value.
// addRepeatedRow mirrors Form/index.tsx's own semantics: appends a row
// (respecting maxRepeats) by writing the array directly, same as the real
// addRepeatedRow's synchronous fieldValues write.
const seed = (
  values: unknown[],
  opts: {
    maxRepeats?: number;
    // false leaves the container with no add-row button
    addRowButton?: boolean;
    repeatTrigger?: string;
    visible?: boolean[];
    type?: string;
    metadata?: Record<string, unknown>;
    // Fields after the repeat container, written after vehicle_vin
    after?: any[];
  } = {}
) => {
  const rowCount = values.length;
  ({
    bumpRenderTick: bumpTick,
    changeValue: changeValueMock,
    fieldOnChange: fieldOnChangeMock,
    fieldOnChangeInner,
    awaitChangeRules: awaitChangeRulesMock,
    getNextStepKey: getNextStepKeyMock
  } = seedForm(FORM, {
    fields: [
      {
        ...repeatedField('vehicle_vin', opts.type, opts.metadata),
        servar: {
          ...repeatedField('vehicle_vin', opts.type, opts.metadata).servar,
          ...(opts.repeatTrigger ? { repeat_trigger: opts.repeatTrigger } : {})
        }
      },
      ...(opts.after ?? [])
    ],
    step: {
      subgrids: [CONTAINER],
      buttons:
        opts.addRowButton === false
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
                      max_repeats: opts.maxRepeats ?? null
                    }
                  ]
                }
              }
            ]
    },
    fieldValues: { vehicle_vin: values },
    visiblePositions: {
      '0': Array(rowCount).fill(true),
      '0,0': opts.visible ?? Array(rowCount).fill(true)
    },
    // index === null mirrors the real changeValue: replace the field's whole
    // value outright (how fillStep.ts's row-level rollback restores it), rather
    // than writing into one row.
    changeValue: (value, f, index) => {
      const key = f.servar.key;
      const state = (internalState as any)[FORM];
      if (index === null) {
        state.fields[key] = { value };
        return true;
      }
      const arr = [...(state.fields[key]?.value ?? [])];
      arr[index] = value;
      state.fields[key] = { value: arr };
      return true;
    },
    callbacks: {
      addRepeatedRow: (addRepeatedRowMock = jest.fn(
        (_container: any, limit: number | null) => {
          const state = (internalState as any)[FORM];
          const arr = state.fields.vehicle_vin?.value ?? [];
          if (limit != null && arr.length >= limit) return; // mirrors the real no-op at max_repeats
          state.fields.vehicle_vin = { value: [...arr, ''] };
          state.visiblePositions['0'] = [...state.visiblePositions['0'], true];
          state.visiblePositions['0,0'] = [
            ...state.visiblePositions['0,0'],
            true
          ];
          state.formToolsRenderTick += 1;
        }
      )),
      submitFiles: jest.fn(async () => undefined)
    }
  }));
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

  it('reports a row that already holds its value as filled without writing it', async () => {
    seed(['row0', 'row1']);

    const result = await fillStepTool(FORM, {
      values: { vehicle_vin: ['row0', 'NEW1'] }
    });

    expect((result.fields.vehicle_vin as any).rows).toEqual([
      { status: 'filled', value: 'row0' },
      { status: 'filled', value: 'NEW1' }
    ]);
    expect(changeValueMock).toHaveBeenCalledTimes(1);
    expect(changeValueMock).toHaveBeenCalledWith('NEW1', expect.anything(), 1);
  });

  it('normalizes a phone row the same way as a non-repeated phone field', async () => {
    seed(['', ''], { type: 'phone_number' });

    const result = await fillStepTool(FORM, {
      values: { vehicle_vin: ['+14155550123', null] }
    });

    expect((result.fields.vehicle_vin as any).rows[0]).toEqual({
      status: 'filled',
      value: '14155550123'
    });
    expect(changeValueMock).toHaveBeenCalledWith(
      '14155550123',
      expect.anything(),
      0
    );
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

  it("reclassifies a row as 'changed' when a later field's change rule rewrites it", async () => {
    seed(['row0'], {
      type: 'ssn',
      after: [
        {
          id: 'owner-el',
          position: [1],
          properties: {},
          servar: { id: 'owner-sv', key: 'owner', type: 'text_field' }
        }
      ]
    });
    // The owner write's change rule rewrites the SSN row written before it
    awaitChangeRulesMock.mockImplementation(async () => {
      const state = (internalState as any)[FORM];
      if (state.fields.owner?.value === 'Ada')
        state.fields.vehicle_vin = { value: ['987654321'] };
      bumpTick();
    });

    const result = await fillStepTool(FORM, {
      values: { vehicle_vin: ['123456789'], owner: 'Ada' }
    });

    expect((result.fields.vehicle_vin as any).rows).toEqual([
      { status: 'changed', value: '••••4321' }
    ]);
  });

  it("checks each dropdown row against that row's own options", async () => {
    seed(['', ''], {
      type: 'dropdown',
      metadata: {
        options: ['Ford', 'Toyota'],
        repeat_options: [
          ['Ford', 'Toyota'],
          ['Volvo', 'Kenworth']
        ]
      }
    });

    const result = await fillStepTool(FORM, {
      values: { vehicle_vin: ['Volvo', 'Volvo'] }
    });

    expect((result.fields.vehicle_vin as any).rows).toEqual([
      {
        status: 'rejected',
        message: 'Value not in allowed options. Allowed: Ford, Toyota.'
      },
      { status: 'filled', value: 'Volvo' }
    ]);
  });

  it('adds no rows when the container has no add-row button, as a person could not', async () => {
    seed(['existing'], { addRowButton: false });

    const result = await fillStepTool(FORM, {
      values: { vehicle_vin: ['VIN1', 'VIN2'] }
    });

    expect(addRepeatedRowMock).not.toHaveBeenCalled();
    expect((result.fields.vehicle_vin as any).rows).toEqual([
      { status: 'filled', value: 'VIN1' },
      {
        status: 'max_repeats_exceeded',
        message:
          'Row 1 needs a new row, and this container has no way to add one.'
      }
    ]);
  });

  it('adds rows for a field that adds one when its last row is filled', async () => {
    seed(['existing'], { addRowButton: false, repeatTrigger: 'set_value' });

    const result = await fillStepTool(FORM, {
      values: { vehicle_vin: ['VIN1', 'VIN2'] }
    });

    expect(addRepeatedRowMock).toHaveBeenCalledTimes(1);
    expect((result.fields.vehicle_vin as any).rows).toEqual([
      { status: 'filled', value: 'VIN1' },
      { status: 'filled', value: 'VIN2' }
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

  it('reports an earlier written row as filled and rolls back only the row whose write would navigate', async () => {
    seed(['row0', 'row1']);
    getNextStepKeyMock
      .mockReturnValueOnce(undefined) // row 0's write doesn't navigate
      .mockReturnValueOnce('step-2'); // row 1's write would

    const result = await fillStepTool(FORM, {
      values: { vehicle_vin: ['NEW0', 'NEW1'] }
    });

    expect(result.fields.vehicle_vin).toEqual({
      status: 'repeated',
      rows: [
        { status: 'filled', value: 'NEW0' },
        {
          status: 'left_for_user',
          message:
            'Filling this field would submit or navigate the form; left for the user to do themselves.'
        }
      ]
    });
    expect((internalState as any)[FORM].fields.vehicle_vin.value).toEqual([
      'NEW0',
      'row1'
    ]);
    expect(fieldOnChangeInner).toHaveBeenCalledTimes(1); // only row 0's write committed
  });
});
