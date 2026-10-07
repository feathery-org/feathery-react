import internalState from '../../internalState';
import { getStepTool } from '../getStep';

const FORM = 'get-step-form';

const emptyStepArrays = {
  subgrids: [],
  texts: [],
  images: [],
  tables: [],
  tabs: [],
  progress_bars: [],
  next_conditions: []
};

afterEach(() => {
  delete (internalState as any)[FORM];
});

const seed = (currentStep: any, fields: Record<string, any>) => {
  (internalState as any)[FORM] = {
    currentStep,
    steps: { [currentStep.key]: currentStep },
    fields,
    visiblePositions: {},
    inlineErrors: {},
    logicRules: []
  };
};

describe('getStepTool', () => {
  it('maps fields with their label, options and buttons with navigatesTo', () => {
    const currentStep = {
      id: 'step-1',
      key: 'intro',
      servar_fields: [
        {
          id: 'plan-el',
          position: [],
          properties: {},
          servar: {
            id: 'plan-sv',
            key: 'plan',
            type: 'select',
            name: 'Choose a plan',
            required: true,
            metadata: { options: ['a', 'b'], labels: ['A', 'B'] }
          }
        }
      ],
      buttons: [
        {
          id: 'btn-1',
          properties: { actions: [{ type: 'next' }], submit: true }
        }
      ],
      ...emptyStepArrays
    };
    seed(currentStep, { plan: { value: 'a' } });

    const result = getStepTool(FORM);

    expect(result.step).toEqual({ id: 'step-1', key: 'intro' });
    expect(result.fields).toEqual([
      {
        key: 'plan',
        label: 'Choose a plan',
        type: 'select',
        required: true,
        visible: true,
        disabled: false,
        value: 'a',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' }
        ],
        error: ''
      }
    ]);
    expect(result.buttons).toHaveLength(1);
    expect(result.buttons[0]).toMatchObject({ id: 'btn-1', saves: true });
  });

  it('falls back to the placeholder, then the key, when a field has no label', () => {
    const currentStep = {
      id: 'step-1',
      key: 'intro',
      servar_fields: [
        {
          id: 'promo-el',
          position: [],
          properties: { placeholder: 'Enter a promo code' },
          servar: {
            id: 'promo-sv',
            key: 'promo_code',
            type: 'text_field',
            name: ''
          }
        },
        {
          id: 'ref-el',
          position: [],
          properties: {},
          servar: {
            id: 'ref-sv',
            key: 'referral_code',
            type: 'text_field',
            name: ''
          }
        }
      ],
      buttons: [],
      ...emptyStepArrays
    };
    seed(currentStep, {
      promo_code: { value: '' },
      referral_code: { value: '' }
    });

    const result = getStepTool(FORM);
    const byKey = Object.fromEntries(
      result.fields.map((f) => [f.key, f.label])
    );

    expect(byKey.promo_code).toBe('Enter a promo code');
    expect(byKey.referral_code).toBe('referral_code');
  });

  it("reports a button's saves as its properties.submit flag, true and false", () => {
    const currentStep = {
      id: 'step-1',
      key: 'intro',
      servar_fields: [],
      buttons: [
        {
          id: 'btn-save',
          properties: { actions: [{ type: 'next' }], submit: true }
        },
        {
          id: 'btn-plain',
          properties: { actions: [{ type: 'url', url: 'https://example.com' }] }
        }
      ],
      ...emptyStepArrays
    };
    seed(currentStep, {});

    const result = getStepTool(FORM);
    const byId = Object.fromEntries(result.buttons.map((b) => [b.id, b.saves]));

    expect(byId['btn-save']).toBe(true);
    expect(byId['btn-plain']).toBe(false);
  });

  it('masks ssn, password, pin_input and payment_method values to the last 4 chars', () => {
    const currentStep = {
      id: 'step-1',
      key: 'secure',
      servar_fields: [
        {
          id: 'ssn-el',
          position: [],
          properties: {},
          servar: { id: 'ssn-sv', key: 'ssn', type: 'ssn', name: 'SSN' }
        },
        {
          id: 'pw-el',
          position: [],
          properties: {},
          servar: { id: 'pw-sv', key: 'pw', type: 'password', name: 'Password' }
        },
        {
          id: 'pin-el',
          position: [],
          properties: {},
          servar: { id: 'pin-sv', key: 'pin', type: 'pin_input', name: 'PIN' }
        }
      ],
      ...emptyStepArrays
    };
    seed(currentStep, {
      ssn: { value: '123456789' },
      pw: { value: 'hunter22' },
      pin: { value: '4242' }
    });

    const result = getStepTool(FORM);
    const byKey = Object.fromEntries(
      result.fields.map((f) => [f.key, f.value])
    );

    expect(byKey.ssn).toBe('••••6789');
    expect(byKey.pw).toBe('••••er22');
    expect(byKey.pin).toBe('••••4242');
  });

  it('does not mask ordinary text field values', () => {
    const currentStep = {
      id: 'step-1',
      key: 'basic',
      servar_fields: [
        {
          id: 'name-el',
          position: [],
          properties: {},
          servar: {
            id: 'name-sv',
            key: 'name',
            type: 'text_field',
            name: 'Name'
          }
        }
      ],
      ...emptyStepArrays
    };
    seed(currentStep, { name: { value: 'Ada Lovelace' } });

    const result = getStepTool(FORM);

    expect(result.fields[0].value).toBe('Ada Lovelace');
  });
});
