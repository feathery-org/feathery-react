import internalState from '../../internalState';
import { fillFields } from '../fillFields';
import * as formActionUtils from '../utils';

// The real first-interaction release needs a configured client, covered in utils.spec
let markInteraction: jest.SpyInstance;
beforeEach(() => {
  markInteraction = jest
    .spyOn(formActionUtils, 'markInteraction')
    .mockImplementation(() => {});
});

afterEach(() => {
  markInteraction.mockRestore();
});

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

  it('counts a fill as the person interacting with the form', async () => {
    makeState(jest.fn());

    await fillFields(formUuid, [{ key: 'name', value: 'Ada' }]);

    expect(markInteraction).toHaveBeenCalled();
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

  it('checks a phone fill against the form as it is once the phone library loads', async () => {
    const state = makeState(jest.fn());
    state.currentStep.servar_fields[0].servar = {
      key: 'name',
      type: 'phone_number'
    };

    const pending = fillFields(formUuid, [
      { key: 'name', value: '904-209-2333' }
    ]);
    state.visiblePositions = { '0': [false] };
    const result: any = await pending;

    expect(state.formActions.changeValue).not.toHaveBeenCalled();
    expect(result.rejected).toEqual([
      expect.objectContaining({ key: 'name', reason: 'hidden' })
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

  it('masks a sensitive value and the one it replaced in the result', async () => {
    makeState([{ key: 'ssn', type: 'ssn', metadata: {} }], {
      ssn: '111223333'
    });

    const result: any = await fillFields(formUuid, [
      { key: 'ssn', value: '123456789' }
    ]);

    expect(result.applied).toEqual([
      { key: 'ssn', value: '••••6789', priorValue: '••••3333' }
    ]);
  });

  it('refuses a masked value so a sensitive field is never overwritten with its mask', async () => {
    makeState(
      [
        { key: 'ssn', type: 'ssn', metadata: {} },
        { key: 'confirm_ssn', type: 'text_field', metadata: {} }
      ],
      { ssn: '123456789', confirm_ssn: '' }
    );

    const result: any = await fillFields(formUuid, [
      { key: 'ssn', value: '••••3333' },
      { key: 'confirm_ssn', value: '••••6789' }
    ]);

    expect(result.applied).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ key: 'ssn', reason: 'invalid_value' }),
      expect.objectContaining({ key: 'confirm_ssn', reason: 'invalid_value' })
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

describe('fillFields unique repeat options', () => {
  const formUuid = 'form-fill-unique-test';

  const makeState = (metadata: Record<string, unknown>, value: unknown[]) => {
    const state: any = {
      currentStep: {
        key: 'step-1',
        subgrids: [{ id: 'sg', position: [0], repeated: true }],
        servar_fields: [
          {
            id: 'el-plan',
            position: [0, 0],
            servar: {
              key: 'plan',
              type: 'dropdown',
              repeated: true,
              metadata: { options: ['basic', 'pro', 'max'], ...metadata }
            }
          }
        ]
      },
      visiblePositions: { '0': [true, true, true], '0,0': [true, true, true] },
      formSettings: {},
      fields: { plan: { value } },
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

  it('refuses an option another row already picked', async () => {
    makeState({ unique_repeat_options: true }, ['pro', '', '']);

    const result: any = await fillFields(formUuid, [
      { key: 'plan', value: 'pro', repeatIndex: 1 }
    ]);

    expect(result.applied).toEqual([]);
    expect(result.rejected).toEqual([
      {
        key: 'plan',
        repeatIndex: 1,
        reason: 'invalid_value',
        message: "'pro' is already chosen in another row. Still open: basic, max."
      }
    ]);
  });

  it("keeps a row's own pick allowed", async () => {
    makeState({ unique_repeat_options: true }, ['pro', '', '']);

    const result: any = await fillFields(formUuid, [
      { key: 'plan', value: 'pro', repeatIndex: 0 }
    ]);

    expect(result.rejected).toEqual([]);
  });

  it('refuses the second row when one call writes the same option twice', async () => {
    makeState({ unique_repeat_options: true }, ['', '', '']);

    const result: any = await fillFields(formUuid, [
      { key: 'plan', value: 'basic', repeatIndex: 0 },
      { key: 'plan', value: 'basic', repeatIndex: 2 }
    ]);

    expect(result.applied).toEqual([
      expect.objectContaining({ key: 'plan', repeatIndex: 0, value: 'basic' })
    ]);
    expect(result.rejected).toEqual([
      expect.objectContaining({
        key: 'plan',
        repeatIndex: 2,
        reason: 'invalid_value'
      })
    ]);
  });

  it('refuses any pick once other rows hold every option, and still clears', async () => {
    makeState({ unique_repeat_options: true, options: ['basic', 'pro'] }, [
      'basic',
      'pro',
      ''
    ]);

    const result: any = await fillFields(formUuid, [
      { key: 'plan', value: 'basic', repeatIndex: 2 },
      { key: 'plan', value: 'enterprise', repeatIndex: 2 },
      { key: 'plan', value: '', repeatIndex: 2 }
    ]);

    expect(result.rejected).toEqual([
      expect.objectContaining({
        repeatIndex: 2,
        message: "'basic' is already chosen in another row. Still open: none."
      }),
      expect.objectContaining({
        repeatIndex: 2,
        message: expect.stringContaining('Value not in allowed options')
      })
    ]);
    expect(result.applied).toEqual([
      expect.objectContaining({ repeatIndex: 2, value: '' })
    ]);
  });

  it("accepts another row's pick from a row that has its own options", async () => {
    makeState(
      {
        unique_repeat_options: true,
        repeat_options: [null, ['pro', 'enterprise']]
      },
      ['pro', '', '']
    );

    const result: any = await fillFields(formUuid, [
      { key: 'plan', value: 'pro', repeatIndex: 1 }
    ]);

    expect(result.rejected).toEqual([]);
  });

  it('lets rows repeat an option when the field does not ask for unique ones', async () => {
    makeState({}, ['pro', '', '']);

    const result: any = await fillFields(formUuid, [
      { key: 'plan', value: 'pro', repeatIndex: 1 }
    ]);

    expect(result.rejected).toEqual([]);
  });
});

describe('fillFields file uploads', () => {
  const formUuid = 'form-fill-files-test';
  const pdf = (name = 'id.pdf') =>
    new File(['%PDF'], name, { type: 'application/pdf' });

  const makeState = (servar: Record<string, any>, repeated = false) => {
    const state: any = {
      currentStep: {
        key: 'step-1',
        subgrids: repeated ? [{ id: 'sg', position: [0], repeated: true }] : [],
        servar_fields: [
          {
            id: 'el-docs',
            position: repeated ? [0, 0] : [0],
            servar: {
              key: 'docs',
              type: 'file_upload',
              repeated,
              metadata: { file_types: [] },
              ...servar
            }
          }
        ]
      },
      visiblePositions: repeated
        ? { '0': [true, true], '0,0': [true, true] }
        : { '0': [true] },
      formSettings: {},
      fields: { docs: { value: repeated ? [null, null] : [] } },
      inlineErrors: {},
      formActions: {
        changeValue: jest.fn((value: unknown) => {
          state.fields.docs.value = value;
          return true;
        }),
        runFieldChangeLogic: jest.fn(),
        submitFiles: jest.fn(async () => {})
      }
    };
    (internalState as any)[formUuid] = state;
    return state;
  };

  afterEach(() => {
    delete (internalState as any)[formUuid];
  });

  it('enters the files and saves them, reporting only their names and types', async () => {
    const state = makeState({ metadata: { file_types: [], multiple: true } });
    const files = [pdf('a.pdf'), pdf('b.pdf')];

    const result: any = await fillFields(formUuid, [
      { key: 'docs', value: files }
    ]);

    const written = state.formActions.changeValue.mock.calls[0][0];
    await expect(Promise.all(written)).resolves.toEqual(files);
    expect(state.formActions.submitFiles).toHaveBeenCalledWith([
      {
        servar: { key: 'docs', file_upload: written, repeated: false },
        stepKey: 'step-1'
      }
    ]);
    expect(result.applied).toEqual([
      expect.objectContaining({
        key: 'docs',
        value: [
          { name: 'a.pdf', mimeType: 'application/pdf' },
          { name: 'b.pdf', mimeType: 'application/pdf' }
        ]
      })
    ]);
  });

  it('tells change rules which file changed, as an upload does', async () => {
    const state = makeState({});

    await fillFields(formUuid, [{ key: 'docs', value: [pdf()] }]);

    expect(state.formActions.runFieldChangeLogic).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'el-docs' }),
      null,
      0
    );
  });

  it('saves the files to the step they were filled on when a rule navigates', async () => {
    const state = makeState({});
    state.formActions.runFieldChangeLogic.mockImplementation(async () => {
      state.currentStep = { ...state.currentStep, key: 'step-2' };
    });

    await fillFields(formUuid, [{ key: 'docs', value: [pdf()] }]);

    expect(state.formActions.submitFiles).toHaveBeenCalledWith([
      expect.objectContaining({ stepKey: 'step-1' })
    ]);
  });

  it.each([
    ['a value that is not files', 'id.pdf'],
    ['a type the field does not accept', [pdf()]],
    ['more files than a single-file field holds', [pdf(), pdf()]]
  ])('refuses %s without writing', async (_label, value) => {
    const state = makeState({ metadata: { file_types: ['image/*'] } });

    const result: any = await fillFields(formUuid, [{ key: 'docs', value }]);

    expect(state.formActions.changeValue).not.toHaveBeenCalled();
    expect(state.formActions.submitFiles).not.toHaveBeenCalled();
    expect(result.rejected).toEqual([
      expect.objectContaining({ key: 'docs', reason: 'invalid_value' })
    ]);
  });

  it('enters one file per row of a repeated field and saves the field once', async () => {
    const state = makeState({}, true);

    const result: any = await fillFields(formUuid, [
      { key: 'docs', value: [pdf('a.pdf')], repeatIndex: 0 },
      { key: 'docs', value: [pdf('b.pdf')], repeatIndex: 1 },
      { key: 'docs', value: [pdf(), pdf()], repeatIndex: 1 }
    ]);

    expect(
      state.formActions.changeValue.mock.calls.map((c: any) => c[2])
    ).toEqual([0, 1]);
    expect(state.formActions.submitFiles).toHaveBeenCalledTimes(1);
    expect(result.applied.map((f: any) => f.repeatIndex)).toEqual([0, 1]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ repeatIndex: 1, reason: 'invalid_value' })
    ]);
  });

  it('reports a file that could not be saved as not entered', async () => {
    const state = makeState({});
    state.formActions.submitFiles.mockRejectedValue(new Error('S3 down'));

    const result: any = await fillFields(formUuid, [
      { key: 'docs', value: [pdf()] }
    ]);

    expect(result.applied).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({
        key: 'docs',
        reason: 'write_failed',
        message: expect.stringContaining('S3 down')
      })
    ]);
  });
});
