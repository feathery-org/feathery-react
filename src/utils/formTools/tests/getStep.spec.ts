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
        error: '',
        repeated: false,
        repeatContainerId: null,
        rowCount: null,
        errorRows: null
      }
    ]);
    expect(result.buttons).toHaveLength(1);
    expect(result.buttons[0]).toMatchObject({ id: 'btn-1', saves: true });
    expect(result.repeatGroups).toEqual([]);
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

  it('masks a repeated ssn field row by row, not the serialized whole array', () => {
    const currentStep = {
      id: 'step-1',
      key: 'secure',
      servar_fields: [
        {
          id: 'ssn-el',
          position: [0, 0],
          properties: {},
          servar: {
            id: 'ssn-sv',
            key: 'ssn',
            type: 'ssn',
            name: 'SSN',
            repeated: true,
            metadata: {}
          }
        }
      ],
      subgrids: [{ id: 'grp-1', position: [0], repeated: true }],
      buttons: [],
      ...emptyStepArrays
    };
    seed(currentStep, { ssn: { value: ['123456789', '987654321'] } });

    const result = getStepTool(FORM);

    expect(result.fields[0].value).toEqual(['••••6789', '••••4321']);
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

  it('reports a repeated field as repeated with its container, rowCount and errorRows', () => {
    const currentStep = {
      id: 'step-1',
      key: 'autos',
      servar_fields: [
        {
          id: 'vin-el',
          position: [0, 0],
          properties: {},
          servar: {
            id: 'vin-sv',
            key: 'vehicle_vin',
            type: 'text_field',
            name: 'VIN',
            repeated: true,
            metadata: {}
          }
        }
      ],
      subgrids: [{ id: 'grp-1', position: [0], repeated: true }],
      buttons: [
        {
          id: 'add-btn',
          position: [],
          properties: {
            actions: [
              {
                type: 'add_repeated_row',
                repeat_container: 'grp-1',
                max_repeats: 3
              }
            ]
          }
        }
      ],
      ...Object.fromEntries(
        [
          'texts',
          'images',
          'tables',
          'tabs',
          'progress_bars',
          'next_conditions'
        ].map((k) => [k, []])
      )
    };
    (internalState as any)[FORM] = {
      currentStep,
      steps: { autos: currentStep },
      fields: { vehicle_vin: { value: ['1FA', '2FB'] } },
      visiblePositions: { '0': [true, true], '0,0': [true, true] },
      inlineErrors: {
        vehicle_vin: { byIndex: { 1: { message: 'Invalid VIN' } } }
      },
      logicRules: []
    };

    const result = getStepTool(FORM);
    const field = result.fields.find((f) => f.key === 'vehicle_vin')!;

    expect(field.repeated).toBe(true);
    expect(field.repeatContainerId).toBe('grp-1');
    expect(field.rowCount).toBe(2);
    expect(field.errorRows).toEqual({ '1': 'Invalid VIN' });
    expect(result.repeatGroups).toEqual([
      {
        containerId: 'grp-1',
        fieldKeys: ['vehicle_vin'],
        rowCount: 2,
        canAddRow: true,
        maxRows: 3
      }
    ]);
  });

  it('reports canAddRow false and maxRows null when the step has no add_repeated_row button', () => {
    const currentStep = {
      id: 'step-1',
      key: 'autos',
      servar_fields: [
        {
          id: 'vin-el',
          position: [0, 0],
          properties: {},
          servar: {
            id: 'vin-sv',
            key: 'vehicle_vin',
            type: 'text_field',
            name: 'VIN',
            repeated: true,
            metadata: {}
          }
        }
      ],
      subgrids: [{ id: 'grp-1', position: [0], repeated: true }],
      buttons: [],
      ...Object.fromEntries(
        [
          'texts',
          'images',
          'tables',
          'tabs',
          'progress_bars',
          'next_conditions'
        ].map((k) => [k, []])
      )
    };
    (internalState as any)[FORM] = {
      currentStep,
      steps: { autos: currentStep },
      fields: { vehicle_vin: { value: ['1FA'] } },
      visiblePositions: { '0': [true], '0,0': [true] },
      inlineErrors: {},
      logicRules: []
    };

    const result = getStepTool(FORM);

    expect(result.repeatGroups).toEqual([
      {
        containerId: 'grp-1',
        fieldKeys: ['vehicle_vin'],
        rowCount: 1,
        canAddRow: false,
        maxRows: null
      }
    ]);
  });
});
