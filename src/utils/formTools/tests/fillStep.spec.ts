jest.mock('../../validation', () => ({
  phoneLib: {
    parsePhoneNumber: jest.fn((input: string, country?: string) => ({
      isValid: () => /\d{10,}/.test(input.replace(/\D/g, '')),
      number: input.startsWith('+') ? input : `+1${input.replace(/\D/g, '')}`,
      country: country || 'US'
    }))
  },
  phoneLibPromise: Promise.resolve(),
  loadPhoneValidator: jest.fn()
}));

import internalState from '../../internalState';
import { fillStepTool } from '../fillStep';
import { getStepTool } from '../getStep';

const FORM = 'fill-step-form';

const emptyStepArrays = {
  subgrids: [],
  texts: [],
  images: [],
  buttons: [],
  tables: [],
  tabs: [],
  progress_bars: [],
  next_conditions: []
};

const field = (overrides: Record<string, any>) => {
  const key = overrides.servar?.key ?? 'f';
  return {
    id: `${key}-element-id`,
    position: [],
    properties: {},
    ...overrides,
    servar: {
      id: `${key}-servar-id`,
      metadata: {},
      ...overrides.servar
    }
  };
};

let getNextStepKeyMock: jest.Mock;
let changeValueMock: jest.Mock;
let fieldOnChangeInner: jest.Mock;
let fieldOnChangeMock: jest.Mock;
let awaitChangeRulesMock: jest.Mock;
let callOrder: string[];

const seed = (fields: any[], fieldValues: Record<string, any> = {}) => {
  const currentStep = {
    id: 'step-1',
    key: 'step-1',
    servar_fields: fields,
    ...emptyStepArrays
  };
  callOrder = [];
  getNextStepKeyMock = jest.fn(() => undefined);
  changeValueMock = jest.fn((value: any, f: any) => {
    callOrder.push('changeValue');
    (internalState as any)[FORM].fields[f.servar.key] = { value };
  });
  fieldOnChangeInner = jest.fn();
  fieldOnChangeMock = jest.fn((args: any) => {
    callOrder.push('fieldOnChange');
    return (opts: any) => fieldOnChangeInner(args, opts);
  });
  // Simulates <Form/>'s useLayoutEffect, which bumps this once per real
  // commit: without it, waitForNextCommit (fillStep.ts) would poll forever
  // in these tests, since nothing here ever mounts a real <Form/>.
  const bumpRenderTick = () => {
    (internalState as any)[FORM].formToolsRenderTick =
      ((internalState as any)[FORM].formToolsRenderTick ?? 0) + 1;
  };
  awaitChangeRulesMock = jest.fn(async () => {
    callOrder.push('awaitChangeRules');
    bumpRenderTick();
  });

  (internalState as any)[FORM] = {
    currentStep,
    steps: { 'step-1': currentStep },
    fields: Object.fromEntries(
      Object.entries(fieldValues).map(([k, v]) => [k, { value: v }])
    ),
    visiblePositions: {},
    inlineErrors: {},
    logicRules: [],
    formToolsRenderTick: 0,
    formToolsCallbacks: {
      changeValue: changeValueMock,
      fieldOnChange: fieldOnChangeMock,
      getNextStepKey: getNextStepKeyMock,
      awaitChangeRules: awaitChangeRulesMock
    }
  };
};

afterEach(() => {
  delete (internalState as any)[FORM];
  jest.clearAllMocks();
});

describe('fillStepTool', () => {
  it('writes changeValue then the undebounced fieldOnChange, in order, then awaits change rules', async () => {
    seed([field({ servar: { key: 'first_name', type: 'text_field' } })]);

    await fillStepTool(FORM, { values: { first_name: 'Ada' } });

    expect(callOrder).toEqual([
      'changeValue',
      'fieldOnChange',
      'awaitChangeRules'
    ]);
    expect(changeValueMock).toHaveBeenCalledWith(
      'Ada',
      expect.objectContaining({
        servar: expect.objectContaining({ key: 'first_name' })
      }),
      null
    );
    expect(fieldOnChangeMock).toHaveBeenCalledWith({
      fieldID: 'first_name-element-id',
      fieldKey: 'first_name',
      servarId: 'first_name-servar-id',
      elementRepeatIndex: 0
    });
    expect(fieldOnChangeInner).toHaveBeenCalledWith(expect.anything(), {});
  });

  it('marks a field not on the current step as not_shown and does not write it', async () => {
    seed([field({ servar: { key: 'first_name', type: 'text_field' } })]);

    const result = await fillStepTool(FORM, {
      values: { nonexistent: 'x' }
    });

    expect(result.fields.nonexistent).toEqual({ status: 'not_shown' });
    expect(changeValueMock).not.toHaveBeenCalled();
  });

  it('marks a hidden (on-step but not visible) field as not_shown', async () => {
    seed([
      field({
        position: [9],
        servar: { key: 'promo_code', type: 'text_field' }
      })
    ]);
    (internalState as any)[FORM].visiblePositions = { '9': [false] };

    const result = await fillStepTool(FORM, { values: { promo_code: 'X' } });

    expect(result.fields.promo_code).toEqual({ status: 'not_shown' });
    expect(changeValueMock).not.toHaveBeenCalled();
  });

  it('marks a disabled field as disabled, with a message, and does not write it', async () => {
    seed([
      field({
        properties: { disabled: true },
        servar: { key: 'agree', type: 'checkbox' }
      })
    ]);

    const result = await fillStepTool(FORM, { values: { agree: true } });

    expect(result.fields.agree).toEqual({
      status: 'disabled',
      message: 'Field is disabled and was left unfilled.'
    });
    expect(changeValueMock).not.toHaveBeenCalled();
  });

  it('marks an unsupported field type as unsupported', async () => {
    seed([field({ servar: { key: 'sig', type: 'signature' } })]);

    const result = await fillStepTool(FORM, { values: { sig: 'x' } });

    expect(result.fields.sig).toEqual({ status: 'unsupported' });
    expect(changeValueMock).not.toHaveBeenCalled();
  });

  it('leaves a field whose change would navigate the form for the user, and rolls back the write', async () => {
    seed([field({ servar: { key: 'nav_field', type: 'text_field' } })]);
    getNextStepKeyMock.mockReturnValue('step-2');

    const result = await fillStepTool(FORM, { values: { nav_field: 'Ada' } });

    expect(result.fields.nav_field.status).toBe('left_for_user');
    expect(result.fields.nav_field.message).toBeTruthy();
    // fieldOnChange (which would itself re-check and actually navigate) must
    // never be invoked, and the real write must be rolled back.
    expect(fieldOnChangeMock).not.toHaveBeenCalled();
    expect(awaitChangeRulesMock).not.toHaveBeenCalled();
    expect((internalState as any)[FORM].fields.nav_field).toEqual({
      value: undefined
    });
  });

  it('evaluates the navigation guard against the value being written, not the stale pre-write value', async () => {
    // Regression test: a branching "next step" condition that keys off the
    // NEW value must be caught before fieldOnChange is invoked, even though
    // fieldValues only reflects the new value once changeValue has run.
    seed([field({ servar: { key: 'plan_type', type: 'dropdown' } })], {
      plan_type: 'starter'
    });
    getNextStepKeyMock.mockImplementation(() =>
      (internalState as any)[FORM].fields.plan_type?.value === 'enterprise'
        ? 'contact_sales'
        : undefined
    );

    const result = await fillStepTool(FORM, {
      values: { plan_type: 'enterprise' }
    });

    expect(result.fields.plan_type.status).toBe('left_for_user');
    expect(fieldOnChangeMock).not.toHaveBeenCalled();
    // Rolled back to the pre-fill value rather than left holding 'enterprise'.
    expect((internalState as any)[FORM].fields.plan_type).toEqual({
      value: 'starter'
    });
  });

  it('marks a repeated field as unsupported and does not write it', async () => {
    seed([
      field({
        servar: { key: 'dependent_name', type: 'text_field', repeated: true }
      })
    ]);

    const result = await fillStepTool(FORM, {
      values: { dependent_name: 'Jane' }
    });

    expect(result.fields.dependent_name).toEqual({
      status: 'unsupported',
      message: expect.any(String)
    });
    expect(changeValueMock).not.toHaveBeenCalled();
  });

  it('reports one field as rejected (without aborting the rest) when its change rules reject', async () => {
    seed([
      field({ servar: { key: 'first_name', type: 'text_field' } }),
      field({ servar: { key: 'last_name', type: 'text_field' } })
    ]);
    awaitChangeRulesMock
      .mockImplementationOnce(async () => {
        callOrder.push('awaitChangeRules');
        throw new Error('a change-rule callback threw');
      })
      .mockImplementationOnce(async () => {
        callOrder.push('awaitChangeRules');
        (internalState as any)[FORM].formToolsRenderTick += 1;
      });

    const result = await fillStepTool(FORM, {
      values: { first_name: 'Ada', last_name: 'Lovelace' }
    });

    expect(result.fields.first_name).toEqual({
      status: 'rejected',
      message: 'a change-rule callback threw'
    });
    expect(result.fields.last_name).toEqual({
      status: 'filled',
      value: 'Lovelace'
    });
  });

  it('leaves an auto-submit field for the user even with no field-level next condition', async () => {
    seed([
      field({
        properties: { submit_trigger: 'auto' },
        servar: { key: 'auto_field', type: 'text_field' }
      })
    ]);

    const result = await fillStepTool(FORM, { values: { auto_field: 'Ada' } });

    expect(result.fields.auto_field.status).toBe('left_for_user');
    expect(changeValueMock).not.toHaveBeenCalled();
  });

  it('classifies as filled when the form holds exactly the written value', async () => {
    seed([field({ servar: { key: 'first_name', type: 'text_field' } })]);

    const result = await fillStepTool(FORM, { values: { first_name: 'Ada' } });

    expect(result.fields.first_name).toEqual({
      status: 'filled',
      value: 'Ada'
    });
  });

  it('classifies as changed, with a message, when a rule rewrites the value after writing', async () => {
    seed([field({ servar: { key: 'first_name', type: 'text_field' } })]);
    awaitChangeRulesMock.mockImplementation(async () => {
      callOrder.push('awaitChangeRules');
      // Simulate a change rule rewriting the field after the queued callback runs
      (internalState as any)[FORM].fields.first_name = { value: 'Rewritten' };
      (internalState as any)[FORM].formToolsRenderTick += 1;
    });

    const result = await fillStepTool(FORM, { values: { first_name: 'Ada' } });

    expect(result.fields.first_name).toEqual({
      status: 'changed',
      value: 'Rewritten',
      message:
        'A rule changed this field to a different value after it was filled.'
    });
  });

  it('masks a changed masked-type value (e.g. ssn) the same way get_step does', async () => {
    seed([field({ servar: { key: 'ssn', type: 'ssn' } })]);
    awaitChangeRulesMock.mockImplementation(async () => {
      callOrder.push('awaitChangeRules');
      (internalState as any)[FORM].fields.ssn = { value: '987654321' };
      (internalState as any)[FORM].formToolsRenderTick += 1;
    });

    const result = await fillStepTool(FORM, { values: { ssn: '123456789' } });

    expect(result.fields.ssn).toEqual({
      status: 'changed',
      value: '••••4321',
      message:
        'A rule changed this field to a different value after it was filled.'
    });
  });

  it('masks a filled masked-type value (e.g. password)', async () => {
    seed([field({ servar: { key: 'pw', type: 'password' } })]);

    const result = await fillStepTool(FORM, { values: { pw: 'hunter22' } });

    expect(result.fields.pw).toEqual({ status: 'filled', value: '••••er22' });
  });

  it('classifies an intentionally empty value as filled, not rejected', async () => {
    seed([field({ servar: { key: 'middle_name', type: 'text_field' } })]);

    const result = await fillStepTool(FORM, { values: { middle_name: '' } });

    expect(result.fields.middle_name).toEqual({
      status: 'filled',
      value: ''
    });
  });

  it('classifies an intentionally cleared multiselect ([]) as filled, not rejected', async () => {
    seed([
      field({
        servar: {
          key: 'interests',
          type: 'multiselect',
          metadata: { options: ['a', 'b'] }
        }
      })
    ]);

    const result = await fillStepTool(FORM, { values: { interests: [] } });

    expect(result.fields.interests).toEqual({ status: 'filled', value: [] });
  });

  it('classifies as rejected when an inline error appears after writing', async () => {
    seed([field({ servar: { key: 'first_name', type: 'text_field' } })]);
    awaitChangeRulesMock.mockImplementation(async () => {
      callOrder.push('awaitChangeRules');
      (internalState as any)[FORM].inlineErrors.first_name = {
        message: 'Not allowed'
      };
      (internalState as any)[FORM].formToolsRenderTick += 1;
    });

    const result = await fillStepTool(FORM, { values: { first_name: 'Ada' } });

    expect(result.fields.first_name).toEqual({
      status: 'rejected',
      message: 'Not allowed'
    });
  });

  it('classifies as rejected when the value fails validation before any write', async () => {
    seed([
      field({
        servar: {
          key: 'short_code',
          type: 'text_field',
          max_length: 3
        }
      })
    ]);

    const result = await fillStepTool(FORM, {
      values: { short_code: 'too long' }
    });

    expect(result.fields.short_code.status).toBe('rejected');
    expect(changeValueMock).not.toHaveBeenCalled();
  });

  it('normalizes a phone number to E.164 without the leading +', async () => {
    seed([field({ servar: { key: 'phone', type: 'phone_number' } })]);

    const result = await fillStepTool(FORM, {
      values: { phone: '+14155550123' }
    });

    expect(result.fields.phone).toEqual({
      status: 'filled',
      value: '14155550123'
    });
  });

  it('normalizes a plain date_selector value through formatDateString', async () => {
    seed([field({ servar: { key: 'start_date', type: 'date_selector' } })]);

    const result = await fillStepTool(FORM, {
      values: { start_date: '2026-03-05' }
    });

    expect(result.fields.start_date).toEqual({
      status: 'filled',
      value: '2026-03-05'
    });
  });

  it('normalizes a date_selector-with-time value to the UTC Z-suffixed stored shape', async () => {
    seed([
      field({
        servar: {
          key: 'meeting_time',
          type: 'date_selector',
          metadata: { choose_time: true }
        }
      })
    ]);

    const result = await fillStepTool(FORM, {
      values: { meeting_time: '2026-03-05T14:30' }
    });

    expect(result.fields.meeting_time).toEqual({
      status: 'filled',
      value: '2026-03-05T14:30:00Z'
    });
  });

  it('normalizes a recognized state name to its stored abbreviation', async () => {
    seed([
      field({
        servar: {
          key: 'state',
          type: 'gmap_state',
          metadata: { store_abbreviation: true }
        }
      })
    ]);

    const result = await fillStepTool(FORM, {
      values: { state: 'California' }
    });

    expect(result.fields.state).toEqual({ status: 'filled', value: 'CA' });
  });

  it('reports newlyShown fields that became visible only after filling', async () => {
    seed([
      field({ servar: { key: 'first_name', type: 'text_field' } }),
      field({
        position: [9],
        servar: { key: 'reveal_field', type: 'text_field' }
      })
    ]);
    (internalState as any)[FORM].visiblePositions = { '9': [false] };
    changeValueMock.mockImplementation((value: any, f: any) => {
      callOrder.push('changeValue');
      (internalState as any)[FORM].fields[f.servar.key] = { value };
      // Simulate a show_if rule reacting to the write
      (internalState as any)[FORM].visiblePositions = { '9': [true] };
    });

    const result = await fillStepTool(FORM, {
      values: { first_name: 'Ada' }
    });

    expect(result.newlyShown).toEqual(['reveal_field']);
  });

  it("returns a post-fill snapshot matching get_step's own labels and masking", async () => {
    seed([
      field({
        servar: { key: 'ssn', type: 'ssn', name: 'Social Security Number' }
      })
    ]);

    const result = await fillStepTool(FORM, { values: { ssn: '123456789' } });

    expect(result.snapshot).toEqual(getStepTool(FORM));
    expect(result.snapshot.fields).toEqual([
      expect.objectContaining({
        key: 'ssn',
        label: 'Social Security Number',
        value: '••••6789'
      })
    ]);
  });
});
