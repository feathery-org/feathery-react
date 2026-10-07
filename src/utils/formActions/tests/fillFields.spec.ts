import internalState from '../../internalState';
import { fillFields } from '../fillFields';

// A fill runs the form's change rules like a person's edit and returns once they settle
describe('fillFields', () => {
  const formUuid = 'form-fill-test';

  const makeState = (runFieldChangeLogic: jest.Mock, changed = true) => {
    const state: any = {
      currentStep: {
        key: 'step-1',
        servar_fields: [
          {
            id: 'el-name',
            position: [0],
            servar: { key: 'name', type: 'text_field' }
          }
        ]
      },
      visiblePositions: { '0': [true] },
      formSettings: {},
      fields: { name: { value: '' } },
      inlineErrors: {},
      formActions: {
        changeValue: jest.fn(() => changed),
        runFieldChangeLogic
      }
    };
    (internalState as any)[formUuid] = state;
    return state;
  };

  afterEach(() => {
    delete (internalState as any)[formUuid];
  });

  it('reports a form that has not loaded as a failed call', async () => {
    await expect(
      fillFields(formUuid, [{ key: 'name', value: 'Ada' }])
    ).resolves.toEqual({
      ok: false,
      reason: 'not_loaded',
      message: expect.any(String)
    });
  });

  it('runs change logic for each written field and waits for it', async () => {
    let settled = false;
    const runFieldChangeLogic = jest.fn(
      () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            settled = true;
            resolve();
          }, 10)
        )
    );
    const state = makeState(runFieldChangeLogic);

    const result: any = await fillFields(formUuid, [
      { key: 'name', value: 'Ada' },
      { key: 'missing', value: 'x' }
    ]);

    expect(result.applied.map((f: any) => f.key)).toEqual(['name']);
    expect(result.rejected).toEqual([
      { key: 'missing', reason: 'not_on_step', message: expect.any(String) }
    ]);
    expect(state.formActions.changeValue).toHaveBeenCalledTimes(1);
    expect(runFieldChangeLogic.mock.calls[0][0].servar.key).toBe('name');
    expect(settled).toBe(true);
  });

  it('skips change logic when the value did not change', async () => {
    const runFieldChangeLogic = jest.fn();
    makeState(runFieldChangeLogic, false);

    const result: any = await fillFields(formUuid, [
      { key: 'name', value: '' }
    ]);

    expect(result.applied).toHaveLength(1);
    expect(runFieldChangeLogic).not.toHaveBeenCalled();
  });

  it('reports field errors a change rule raised', async () => {
    const state = makeState(
      jest.fn(async () => {
        state.inlineErrors = { email: { message: 'Email already registered' } };
      })
    );

    const result: any = await fillFields(formUuid, [
      { key: 'name', value: 'Ada' }
    ]);

    expect(result.fieldErrors).toEqual([
      { key: 'email', message: 'Email already registered' }
    ]);
  });

  it('keeps the written value when a change rule fails', async () => {
    makeState(jest.fn(() => Promise.reject(new Error('rule failed'))));

    const result = await fillFields(formUuid, [{ key: 'name', value: 'Ada' }]);

    expect(result).toEqual({
      ok: true,
      applied: [
        { key: 'name', repeatIndex: undefined, value: 'Ada', priorValue: '' }
      ],
      rejected: []
    });
  });

  it('does not write to a step the person has left', async () => {
    const state = makeState(jest.fn());

    const pending = fillFields(formUuid, [{ key: 'name', value: 'Ada' }]);
    state.currentStep = { key: 'step-2', servar_fields: [] };
    const result: any = await pending;

    expect(state.formActions.changeValue).not.toHaveBeenCalled();
    expect(result.rejected).toEqual([
      expect.objectContaining({ key: 'name', reason: 'not_on_step' })
    ]);
  });

  it('rejects a write the form throws on without dropping the rest', async () => {
    const state = makeState(jest.fn());
    state.formActions.changeValue.mockImplementation(() => {
      throw new Error('write blew up');
    });

    const result: any = await fillFields(formUuid, [
      { key: 'name', value: 'Ada' }
    ]);

    expect(result.applied).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ key: 'name', reason: 'write_failed' })
    ]);
  });
});

describe('fillFields value checks', () => {
  const formUuid = 'form-fill-checks-test';

  const makeState = (servars: any[], values: Record<string, unknown>) => {
    const state: any = {
      currentStep: {
        key: 'step-1',
        servar_fields: servars.map((servar, i) => ({
          id: `el-${servar.key}`,
          position: [i],
          servar
        }))
      },
      visiblePositions: Object.fromEntries(
        servars.map((_, i) => [String(i), [true]])
      ),
      formSettings: {},
      fields: Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, { value }])
      ),
      inlineErrors: {},
      formActions: {
        changeValue: jest.fn(() => true),
        runFieldChangeLogic: jest.fn()
      }
    };
    (internalState as any)[formUuid] = state;
    return state;
  };

  afterEach(() => {
    delete (internalState as any)[formUuid];
  });

  it('holds radio buttons to their options', async () => {
    makeState(
      [{ key: 'agree', type: 'select', metadata: { options: ['yes', 'no'] } }],
      { agree: null }
    );

    const result: any = await fillFields(formUuid, [
      { key: 'agree', value: 'Maybe' }
    ]);

    expect(result.applied).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ key: 'agree', reason: 'invalid_value' })
    ]);
  });

  it('refuses field types it has no check for', async () => {
    makeState([{ key: 'grid', type: 'matrix', metadata: {} }], { grid: {} });

    const result: any = await fillFields(formUuid, [
      { key: 'grid', value: 'hello' }
    ]);

    expect(result.rejected).toEqual([
      expect.objectContaining({ key: 'grid', reason: 'unwritable_type' })
    ]);
  });

  it('clears a field with an empty value so an entry can be undone', async () => {
    makeState(
      [
        { key: 'agree', type: 'select', metadata: { options: ['yes', 'no'] } },
        {
          key: 'plan',
          type: 'dropdown',
          metadata: { options: ['Basic', 'Pro'] }
        },
        { key: 'age', type: 'integer_field', metadata: {} }
      ],
      { agree: 'yes', plan: 'Pro', age: 30 }
    );

    const result: any = await fillFields(formUuid, [
      { key: 'agree', value: null },
      { key: 'plan', value: '' },
      { key: 'age', value: '' }
    ]);

    expect(result.rejected).toEqual([]);
    expect(result.applied.map((f: any) => f.priorValue)).toEqual([
      'yes',
      'Pro',
      30
    ]);
  });

  it("writes each field's own empty value when cleared with null", async () => {
    const state = makeState(
      [
        {
          key: 'perks',
          type: 'multiselect',
          metadata: { options: ['gym', 'lunch'] }
        },
        { key: 'age', type: 'integer_field', metadata: {} }
      ],
      { perks: ['gym'], age: 30 }
    );

    const result: any = await fillFields(formUuid, [
      { key: 'perks', value: null },
      { key: 'age', value: null }
    ]);

    expect(state.formActions.changeValue.mock.calls.map((c: any) => c[0])).toEqual([
      [],
      ''
    ]);
    expect(result.applied.map((f: any) => f.value)).toEqual([[], '']);
  });

  it('keeps an always checked checkbox checked', async () => {
    makeState(
      [{ key: 'terms', type: 'checkbox', metadata: { always_checked: true } }],
      { terms: true }
    );

    const result: any = await fillFields(formUuid, [
      { key: 'terms', value: false },
      { key: 'terms', value: null }
    ]);

    expect(result.rejected).toEqual([
      expect.objectContaining({ key: 'terms', reason: 'invalid_value' })
    ]);
    expect(result.applied.map((f: any) => f.value)).toEqual([true]);
  });

  it('requires a time for a date with a time', async () => {
    makeState(
      [{ key: 'meeting', type: 'date_selector', metadata: { choose_time: true } }],
      { meeting: '' }
    );

    const result: any = await fillFields(formUuid, [
      { key: 'meeting', value: '2026-10-06' }
    ]);

    expect(result.rejected).toEqual([
      expect.objectContaining({ key: 'meeting', reason: 'invalid_value' })
    ]);
  });

  it('stores a date with a time in the form date-time format', async () => {
    const state = makeState(
      [{ key: 'meeting', type: 'date_selector', metadata: { choose_time: true } }],
      { meeting: '' }
    );

    const result: any = await fillFields(formUuid, [
      { key: 'meeting', value: '2026-10-06T14:30:00.000Z' }
    ]);

    expect(result.applied[0].value).toBe('2026-10-06T14:30:00Z');
    expect(state.formActions.changeValue.mock.calls[0][0]).toBe(
      '2026-10-06T14:30:00Z'
    );
  });
});
