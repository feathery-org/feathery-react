import { isButtonDisabled } from '../button';
import { getVisiblePositions } from '../hideAndRepeats';
import { fieldValues } from '../init';

jest.mock('../init', () => ({
  fieldValues: {}
}));

const elementBase = (position: number[]) => ({
  position,
  hide_ifs: [],
  show_logic: true,
  styles: {},
  mobile_styles: {}
});

describe('isButtonDisabled', () => {
  it.each([
    [false, false],
    [0, false],
    ['', true],
    [null, true],
    [undefined, true],
    ['answered', false]
  ])(
    'checks stored answer %p without discarding false or zero',
    (value, disabled) => {
      const button = {
        ...elementBase([0]),
        id: 'continue',
        properties: { disable_if_fields_incomplete: true }
      };
      const store = {
        ...elementBase([1]),
        id: 'choice',
        properties: {
          actions: [
            { type: 'store_field_value', custom_store_field_key: 'choice' }
          ]
        }
      };
      const step = {
        buttons: [button, store],
        subgrids: [],
        servar_fields: []
      };
      fieldValues.choice = value;
      expect(
        isButtonDisabled(button, step, { '0': [true], '1': [true] }, false)
      ).toBe(disabled);
    }
  );

  const runHiddenContainerScenario = (showOnTrue: boolean) => {
    const hiddenContainer = {
      ...elementBase([1]),
      id: 'hidden-container',
      repeated: false,
      properties: {},
      hide_ifs: [
        {
          field_type: 'hidden',
          field_id: 'show-hidden-container',
          field_key: 'show-hidden-container',
          comparison: 'is_true',
          index: 0,
          values: []
        }
      ],
      show_logic: showOnTrue
    };

    const visibleField = {
      ...elementBase([0]),
      id: 'visible-required-field',
      properties: {},
      servar: {
        key: 'visible-required-field',
        metadata: {},
        repeated: false,
        required: true,
        type: 'text_field'
      }
    };

    const hiddenRequiredField = {
      ...elementBase([1, 0]),
      id: 'hidden-required-field',
      properties: {},
      servar: {
        key: 'hidden-required-field',
        metadata: {},
        repeated: false,
        required: true,
        type: 'text_field'
      }
    };

    const continueButton = {
      ...elementBase([2]),
      id: 'continue',
      properties: {
        actions: [{ type: 'next' }],
        disable_if_fields_incomplete: true,
        submit: true
      }
    };

    const step = {
      subgrids: [
        {
          ...elementBase([]),
          id: 'root',
          repeated: false,
          properties: {}
        },
        hiddenContainer
      ],
      servar_fields: [visibleField, hiddenRequiredField],
      buttons: [continueButton],
      texts: [],
      progress_bars: [],
      images: [],
      videos: [],
      tables: [],
      tabs: []
    };

    const isDisabled = (containerVisibleFlag: boolean) => {
      Object.assign(fieldValues, {
        'visible-required-field': 'done',
        'hidden-required-field': 'hidden',
        'show-hidden-container': containerVisibleFlag
      });
      return isButtonDisabled(
        continueButton,
        step,
        getVisiblePositions(step, 'test-form'),
        false
      );
    };

    // Container hidden, required field should be ignored by disable check
    expect(isDisabled(false)).toBe(false);

    // Container visible, required field becomes required for blocking behavior
    expect(isDisabled(true)).toBe(false);
  };

  it('does not block on required fields in containers hidden by show_if=true logic', () => {
    runHiddenContainerScenario(true);
  });

  it('does not block on required fields in containers hidden by show_if=false logic', () => {
    runHiddenContainerScenario(false);
  });

  it('allows progressing when repeatable visible-required container is removed via store action', () => {
    const showButton = {
      ...elementBase([2]),
      id: 'show-repeat',
      properties: {
        actions: [
          {
            type: 'store_field_value',
            custom_store_field_key: 'show-repeat-container',
            custom_store_value: true
          }
        ]
      }
    };

    const removeButton = {
      ...elementBase([1, 1]),
      id: 'remove-repeat',
      properties: {
        actions: [
          {
            type: 'store_field_value',
            custom_store_field_key: 'show-repeat-container',
            custom_store_value: false
          }
        ]
      }
    };

    const repeatableContainer = {
      ...elementBase([1]),
      id: 'driver-container',
      repeated: true,
      properties: {},
      hide_ifs: [
        {
          field_type: 'hidden',
          field_id: 'show-repeat-container',
          field_key: 'show-repeat-container',
          comparison: 'is_true',
          index: 0,
          values: []
        }
      ]
    };

    const continueButton = {
      ...elementBase([3]),
      id: 'continue',
      properties: {
        actions: [{ type: 'next' }],
        disable_if_fields_incomplete: true,
        submit: true
      }
    };

    const step = {
      subgrids: [
        {
          ...elementBase([]),
          id: 'root',
          repeated: false,
          properties: {}
        },
        repeatableContainer
      ],
      servar_fields: [
        {
          ...elementBase([0]),
          id: 'required-visible',
          properties: {},
          servar: {
            key: 'required-visible',
            metadata: {},
            repeated: false,
            required: true,
            type: 'text_field'
          }
        },
        {
          ...elementBase([1, 0]),
          id: 'required-repeatable',
          properties: {},
          servar: {
            key: 'required-repeatable',
            metadata: {},
            repeated: true,
            required: true,
            type: 'text_field'
          }
        }
      ],
      buttons: [showButton, removeButton, continueButton],
      texts: [],
      progress_bars: [],
      images: [],
      videos: [],
      tables: [],
      tabs: []
    };

    const isDisabled = () =>
      isButtonDisabled(
        continueButton,
        step,
        getVisiblePositions(step, 'test-form'),
        false
      );

    Object.assign(fieldValues, {
      'required-visible': 'done',
      'required-repeatable': [''],
      'show-repeat-container': false
    });
    expect(isDisabled()).toBe(false);

    fieldValues['show-repeat-container'] = true;
    expect(isDisabled()).toBe(true);

    fieldValues['required-repeatable'] = ['additional-done'];
    expect(isDisabled()).toBe(false);

    fieldValues['show-repeat-container'] = false;
    expect(isDisabled()).toBe(false);
  });

  it('ignores incomplete required fields in hidden containers', () => {
    const hiddenContainer = {
      ...elementBase([1]),
      id: 'hidden-container',
      repeated: false,
      properties: {},
      hide_ifs: [
        {
          field_type: 'hidden',
          field_id: 'show-hidden-container',
          field_key: 'show-hidden-container',
          comparison: 'is_true',
          index: 0,
          values: []
        }
      ]
    };

    const visibleField = {
      ...elementBase([0]),
      id: 'visible-required-field',
      properties: {},
      servar: {
        key: 'visible-required-field',
        metadata: {},
        repeated: false,
        required: true,
        type: 'text_field'
      }
    };

    const hiddenRequiredField = {
      ...elementBase([1, 0]),
      id: 'hidden-required-field',
      properties: {},
      servar: {
        key: 'hidden-required-field',
        metadata: {},
        repeated: false,
        required: true,
        type: 'text_field'
      }
    };

    const continueButton = {
      ...elementBase([2]),
      id: 'continue',
      properties: {
        actions: [{ type: 'next' }],
        disable_if_fields_incomplete: true,
        submit: true
      }
    };

    const step = {
      subgrids: [
        {
          ...elementBase([]),
          id: 'root',
          repeated: false,
          properties: {}
        },
        hiddenContainer
      ],
      servar_fields: [visibleField, hiddenRequiredField],
      buttons: [continueButton],
      texts: [],
      progress_bars: [],
      images: [],
      videos: [],
      tables: [],
      tabs: []
    };

    const isDisabled = () =>
      isButtonDisabled(
        continueButton,
        step,
        getVisiblePositions(step, 'test-form'),
        false
      );

    Object.assign(fieldValues, {
      'visible-required-field': '',
      'hidden-required-field': '',
      'show-hidden-container': false
    });
    expect(isDisabled()).toBe(true);

    Object.assign(fieldValues, {
      'visible-required-field': 'done',
      'hidden-required-field': '',
      'show-hidden-container': false
    });
    expect(isDisabled()).toBe(false);
  });

  it('recalculates required visibility when repeatable container is toggled', () => {
    const additionalDriverContainer = {
      ...elementBase([1]),
      id: 'additional-driver-container',
      repeated: true,
      properties: {},
      hide_ifs: [
        {
          field_type: 'hidden',
          field_id: 'show-additional-driver',
          field_key: 'show-additional-driver',
          comparison: 'is_true',
          index: 0,
          values: []
        }
      ]
    };
    const addDriverButton = {
      ...elementBase([2]),
      id: 'add-driver',
      properties: {
        actions: [
          {
            type: 'store_field_value',
            custom_store_field_key: 'show-additional-driver',
            custom_store_value: true
          }
        ]
      }
    };
    const continueButton = {
      ...elementBase([3]),
      id: 'continue',
      properties: {
        actions: [{ type: 'next' }],
        disable_if_fields_incomplete: true,
        submit: true
      }
    };
    const step = {
      subgrids: [
        {
          ...elementBase([]),
          id: 'root',
          repeated: false,
          properties: {}
        },
        additionalDriverContainer
      ],
      servar_fields: [
        {
          ...elementBase([0]),
          id: 'primary-driver-name',
          properties: {},
          servar: {
            key: 'primary-driver-name',
            metadata: {},
            repeated: false,
            required: true,
            type: 'text_field'
          }
        },
        {
          ...elementBase([1, 0]),
          id: 'additional-driver-name',
          properties: {},
          servar: {
            key: 'additional-driver-name',
            metadata: {},
            repeated: true,
            required: true,
            type: 'text_field'
          }
        }
      ],
      buttons: [addDriverButton, continueButton],
      texts: [],
      progress_bars: [],
      images: [],
      videos: [],
      tables: [],
      tabs: []
    };
    const isDisabled = () =>
      isButtonDisabled(
        continueButton,
        step,
        getVisiblePositions(step, 'test-form'),
        false
      );

    Object.assign(fieldValues, {
      'primary-driver-name': '',
      'additional-driver-name': [''],
      'show-additional-driver': false
    });
    expect(isDisabled()).toBe(true);

    fieldValues['primary-driver-name'] = 'Primary Driver';
    expect(isDisabled()).toBe(false);

    fieldValues['show-additional-driver'] = true;
    expect(isDisabled()).toBe(true);

    fieldValues['additional-driver-name'] = ['Additional Driver'];
    expect(isDisabled()).toBe(false);

    fieldValues['show-additional-driver'] = false;
    fieldValues['additional-driver-name'] = [''];
    expect(isDisabled()).toBe(false);
  });
});
