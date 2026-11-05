jest.mock('../../validation', () => ({
  phoneLib: {
    parsePhoneNumber: jest.fn((input: string, country?: string) => ({
      isValid: () => /\d{10,}/.test(input.replace(/\D/g, '')),
      number: input.startsWith('+') ? input : `+1${input.replace(/\D/g, '')}`,
      country: country || 'US'
    }))
  },
  phoneLibPromise: Promise.resolve(),
  loadPhoneValidator: jest.fn(),
  validators: { url: jest.requireActual('../../validation').validators.url }
}));

import internalState from '../../internalState';
import { fillStepTool } from '../fillStep';
import { getStepTool } from '../getStep';
import { emptyStepArrays, field, seedForm } from './helpers';

const FORM = 'fill-step-form';

let getNextStepKeyMock: jest.Mock;
let changeValueMock: jest.Mock;
let fieldOnChangeInner: jest.Mock;
let fieldOnChangeMock: jest.Mock;
let awaitChangeRulesMock: jest.Mock;
let callOrder: string[];

const seed = (fields: any[], fieldValues: Record<string, any> = {}) => {
  ({
    callOrder,
    changeValue: changeValueMock,
    fieldOnChange: fieldOnChangeMock,
    fieldOnChangeInner,
    awaitChangeRules: awaitChangeRulesMock,
    getNextStepKey: getNextStepKeyMock
  } = seedForm(FORM, { fields, fieldValues }));
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

  it("reports the stored value as filled, without waiting for a commit, when the form's own handling turns the write into a no-op", async () => {
    seed([field({ servar: { key: 'first_name', type: 'text_field' } })], {
      first_name: 'Jose'
    });
    // ascii-only normalizes 'José' back to the stored 'Jose': nothing changes
    // and nothing re-renders
    changeValueMock.mockImplementation(() => {
      callOrder.push('changeValue');
      return false;
    });

    const result = await fillStepTool(FORM, { values: { first_name: 'José' } });

    expect(result.fields.first_name).toEqual({
      status: 'filled',
      value: 'Jose'
    });
    expect(callOrder).toEqual(['changeValue']);
    expect(fieldOnChangeMock).not.toHaveBeenCalled();
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

  it('marks a nested-repeat field as unsupported and does not write it', async () => {
    const currentStep = {
      id: 'step-1',
      key: 'step-1',
      servar_fields: [
        field({
          position: [0, 0, 0],
          servar: { key: 'part_name', type: 'text_field', repeated: true }
        })
      ],
      ...emptyStepArrays,
      subgrids: [
        { id: 'outer', position: [0], repeated: true },
        { id: 'inner', position: [0, 0], repeated: true }
      ]
    };
    seed(currentStep.servar_fields);
    (internalState as any)[FORM].currentStep = currentStep;
    (internalState as any)[FORM].steps = { 'step-1': currentStep };

    const result = await fillStepTool(FORM, {
      values: { part_name: ['Widget'] }
    });

    expect(result.fields.part_name).toEqual({
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
        (internalState as any)[FORM].formToolsRenderTick += 1;
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

  it('reports a value the field already holds as filled without writing it or waiting for a render', async () => {
    seed([field({ servar: { key: 'first_name', type: 'text_field' } })], {
      first_name: 'Ada'
    });
    // An unchanged write renders nothing, so no commit would ever bump the tick
    awaitChangeRulesMock.mockImplementation(async () => undefined);

    const result = await fillStepTool(FORM, { values: { first_name: 'Ada' } });

    expect(result.fields.first_name).toEqual({
      status: 'filled',
      value: 'Ada'
    });
    expect(changeValueMock).not.toHaveBeenCalled();
    expect(fieldOnChangeMock).not.toHaveBeenCalled();
    expect(awaitChangeRulesMock).not.toHaveBeenCalled();
  });

  it('treats a reordered multiselect resend as unchanged', async () => {
    seed(
      [
        field({
          servar: {
            key: 'interests',
            type: 'multiselect',
            metadata: { options: ['a', 'b'] }
          }
        })
      ],
      { interests: ['a', 'b'] }
    );

    const result = await fillStepTool(FORM, {
      values: { interests: ['b', 'a'] }
    });

    // Skipped as unchanged, so the field keeps its original (stored) order.
    expect(result.fields.interests).toEqual({
      status: 'filled',
      value: ['a', 'b']
    });
    expect(changeValueMock).not.toHaveBeenCalled();
    expect(fieldOnChangeMock).not.toHaveBeenCalled();
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

  it("reclassifies a field an earlier call on the step wrote when a later call's rule rewrites it", async () => {
    seed([
      field({ servar: { key: 'ssn', type: 'ssn' } }),
      field({ servar: { key: 'id_scan', type: 'text_field' } })
    ]);
    const first = await fillStepTool(FORM, { values: { ssn: '123456789' } });
    expect(first.fields.ssn).toEqual({ status: 'filled', value: '••••6789' });

    // The second call's change rule rewrites the SSN the first call wrote
    awaitChangeRulesMock.mockImplementation(async () => {
      (internalState as any)[FORM].fields.ssn = { value: '987654321' };
      (internalState as any)[FORM].formToolsRenderTick += 1;
    });
    const second = await fillStepTool(FORM, { values: { id_scan: 'scan' } });

    expect(second.fields.ssn).toEqual({
      status: 'changed',
      value: '••••4321',
      message:
        'A rule changed this field to a different value after it was filled.'
    });
  });

  it('masks a filled masked-type value (e.g. password)', async () => {
    seed([field({ servar: { key: 'pw', type: 'password' } })]);

    const result = await fillStepTool(FORM, { values: { pw: 'hunter22' } });

    expect(result.fields.pw).toEqual({ status: 'filled', value: '••••' });
  });

  it('rejects a masked value instead of writing it', async () => {
    seed([field({ servar: { key: 'pw', type: 'password' } })]);

    const result = await fillStepTool(FORM, { values: { pw: '••••' } });

    expect(result.fields.pw).toEqual({
      status: 'rejected',
      message: expect.stringContaining('masked value')
    });
    expect(changeValueMock).not.toHaveBeenCalled();
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

  it('lists each allowed option with its label when a choice is rejected', async () => {
    seed([
      field({
        servar: {
          key: 'region',
          type: 'dropdown',
          metadata: {
            options: ['us-east', 'eu-west', 'Other'],
            option_labels: ['US East (Virginia)', 'EU West (Ireland)', '']
          }
        }
      })
    ]);

    const result = await fillStepTool(FORM, { values: { region: 'Ireland' } });

    expect(result.fields.region).toEqual({
      status: 'rejected',
      message:
        'Value not in allowed options. Allowed: us-east ("US East (Virginia)"), eu-west ("EU West (Ireland)"), Other.'
    });
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

  it.each([
    // A bare time is local, as the picker reads it, so it reads back as 14:30 local
    ['2026-03-05T14:30', new Date(2026, 2, 5, 14, 30).toISOString()],
    // A zoned time is that exact instant
    ['2026-03-05T14:30-05:00', '2026-03-05T19:30:00.000Z']
  ])(
    'stores the date-time %s as the instant it means',
    async (input, instant) => {
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
        values: { meeting_time: input }
      });

      expect(result.fields.meeting_time.status).toBe('filled');
      const stored = (result.fields.meeting_time as { value: string }).value;
      expect(new Date(stored).toISOString()).toBe(instant);
    }
  );

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

const select = (key: string, metadata: Record<string, any>) => ({
  key,
  type: 'button_group',
  metadata
});

describe('fillStepTool: typed fields', () => {
  it.each([
    [
      'single-select button_group',
      select('tier', { options: ['gold', 'silver'] }),
      ['gold']
    ],
    [
      'multi-select button_group',
      select('tier', { multiple: true, options: ['wifi', 'parking', 'gym'] }),
      ['wifi', 'gym']
    ],
    [
      'dropdown_multi',
      {
        key: 'tier',
        type: 'dropdown_multi',
        metadata: { options: ['en', 'fr', 'es'] }
      },
      ['en', 'es']
    ],
    [
      'rating',
      { key: 'tier', type: 'rating', min_length: 1, max_length: 5 },
      4
    ],
    [
      'slider',
      { key: 'tier', type: 'slider', min_length: 0, max_length: 100 },
      60
    ],
    ['checkbox', { key: 'tier', type: 'checkbox' }, true],
    [
      'matrix',
      {
        key: 'tier',
        type: 'matrix',
        metadata: {
          questions: [
            { id: 'q1', label: 'Service' },
            { id: 'q2', label: 'Price' }
          ],
          options: ['Good', 'Bad']
        }
      },
      { q1: ['Good'], q2: ['Bad'] }
    ],
    ['url', { key: 'tier', type: 'url' }, 'https://example.com'],
    ['integer_field', { key: 'tier', type: 'integer_field' }, 42]
  ])('fills %s', async (_name, servar, value) => {
    seed([field({ servar })]);

    const result = await fillStepTool(FORM, { values: { tier: value } });

    expect(result.fields.tier).toEqual({ status: 'filled', value });
  });

  it.each([
    [
      'button_group value not in the options',
      select('tier', { options: ['gold', 'silver'] }),
      ['platinum'],
      'Values not in allowed options: platinum.'
    ],
    [
      'dropdown_multi value not in the options',
      {
        key: 'tier',
        type: 'dropdown_multi',
        metadata: { options: ['en', 'fr'] }
      },
      ['de'],
      'Values not in allowed options: de.'
    ],
    [
      'rating above the max',
      { key: 'tier', type: 'rating', min_length: 1, max_length: 5 },
      9,
      'Value above maximum (5).'
    ],
    [
      'slider below the min',
      { key: 'tier', type: 'slider', min_length: 0, max_length: 100 },
      -5,
      'Value below minimum (0).'
    ],
    [
      'non-boolean checkbox',
      { key: 'tier', type: 'checkbox' },
      'yes',
      "Field 'tier' (checkbox) expects a boolean."
    ],
    [
      'matrix shaped as a string',
      {
        key: 'tier',
        type: 'matrix',
        metadata: {
          questions: [{ id: 'q1', label: 'Service' }],
          options: ['A']
        }
      },
      'Good',
      'expects an object of questionId'
    ],
    [
      'matrix answer outside the columns',
      {
        key: 'tier',
        type: 'matrix',
        metadata: {
          questions: [{ id: 'q1', label: 'Service' }],
          options: ['Good', 'Bad']
        }
      },
      { q1: ['Great'] },
      "Values not in allowed options for question 'q1': Great"
    ],
    [
      'two answers to a single-answer matrix question',
      {
        key: 'tier',
        type: 'matrix',
        metadata: {
          questions: [{ id: 'q1', label: 'Service' }],
          options: ['Good', 'Bad']
        }
      },
      { q1: ['Good', 'Bad'] },
      'allows one answer per question'
    ],
    [
      'non-string url',
      { key: 'tier', type: 'url' },
      12345,
      "Field 'tier' (url) expects a string."
    ],
    [
      'malformed url',
      { key: 'tier', type: 'url' },
      'not a url at all',
      'is not a well-formed url'
    ],
    [
      'numeric string for integer_field',
      { key: 'tier', type: 'integer_field' },
      '42',
      "Field 'tier' (integer_field) expects a number."
    ]
  ])('rejects %s', async (_name, servar, value, message) => {
    seed([field({ servar })]);

    const result = await fillStepTool(FORM, { values: { tier: value } });

    expect(result.fields.tier.status).toBe('rejected');
    expect(result.fields.tier.message).toContain(message);
    expect(changeValueMock).not.toHaveBeenCalled();
  });

  it('rejects a single-select button_group given more than one option', async () => {
    seed([field({ servar: select('tier', { options: ['gold', 'silver'] }) })]);

    const result = await fillStepTool(FORM, {
      values: { tier: ['gold', 'silver'] }
    });

    expect(result.fields.tier.status).toBe('rejected');
    expect(result.fields.tier.message).toContain('single-select');
    expect(changeValueMock).not.toHaveBeenCalled();
  });

  it('fills a checkbox with false, distinct from the field being left empty', async () => {
    seed([field({ servar: { key: 'agree', type: 'checkbox' } })], {
      agree: true
    });

    const result = await fillStepTool(FORM, { values: { agree: false } });

    expect(result.fields.agree).toEqual({ status: 'filled', value: false });
  });

  it('rejects a matrix answer for a question id that does not exist', async () => {
    seed([
      field({
        servar: {
          key: 'satisfaction_matrix',
          type: 'matrix',
          metadata: {
            questions: [{ id: 'q1', label: 'Service' }],
            options: ['Good', 'Bad']
          }
        }
      })
    ]);

    const result = await fillStepTool(FORM, {
      values: { satisfaction_matrix: { bogus: ['Good'] } }
    });

    expect(result.fields.satisfaction_matrix.status).toBe('rejected');
    expect(result.fields.satisfaction_matrix.message).toContain('bogus');
    expect(changeValueMock).not.toHaveBeenCalled();
  });
});

describe('fillStepTool: date_selector (choose_time)', () => {
  it('rejects a date-only value when the field requires a time component', async () => {
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
      values: { meeting_time: '2026-03-05' }
    });

    expect(result.fields.meeting_time).toEqual({
      status: 'rejected',
      message:
        "Field 'meeting_time' expects 'YYYY-MM-DDTHH:mm' in local time, or an ISO date-time with a timezone."
    });
    expect(changeValueMock).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range time instead of silently rolling over to a different date', async () => {
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
      values: { meeting_time: '2026-03-05T25:70' }
    });

    expect(result.fields.meeting_time.status).toBe('rejected');
  });

  // Blocker 5: a change rule a fill triggers can carry its own outside
  // effect (an email, an HTTP call, ...) onto the client's request queues;
  // the result must not resolve while that request is still pending.
  it("does not resolve until a change rule's queued request settles", async () => {
    seed([field({ servar: { key: 'first_name', type: 'text_field' } })]);
    let resolveEvent: (() => void) | undefined;
    const pendingEvent = new Promise<void>((resolve) => {
      resolveEvent = resolve;
    });
    awaitChangeRulesMock.mockImplementation(async () => {
      (internalState as any)[FORM].client.eventQueue = pendingEvent;
      (internalState as any)[FORM].formToolsRenderTick =
        ((internalState as any)[FORM].formToolsRenderTick ?? 0) + 1;
    });

    let resolved = false;
    const resultPromise = fillStepTool(FORM, {
      values: { first_name: 'Ada' }
    }).then((result) => {
      resolved = true;
      return result;
    });

    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(resolved).toBe(false);

    resolveEvent?.();
    const result = await resultPromise;

    expect(resolved).toBe(true);
    expect(result.fields.first_name.status).toBe('filled');
  });
});
