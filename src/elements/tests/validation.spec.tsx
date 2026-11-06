import React, { useEffect, useRef, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Element from '../../Form/grid/Element';
import Elements from '..';
import { featheryDoc, featheryWindow } from '../../utils/browser';
import { preloadStepFields } from '../fields';
import { ERROR_COLOR } from '../styles';
import { fieldValues, initState } from '../../utils/init';
import { validateElements } from '../../utils/validation';
import type { InlineErrors } from '../../utils/inlineErrors';

jest.mock('../fields/SignatureField/components/SignatureCanvas', () => ({
  __esModule: true,
  default: () => null
}));

jest.mock('../../hooks/useSalesforceSync', () => ({
  __esModule: true,
  default: () => ({
    dynamicOptions: [],
    loadingDynamicOptions: false,
    shouldSalesforceSync: false
  })
}));

const fields = ['Name', 'Choice', 'Details'].map((key, index) => ({
  id: `field-${key}`,
  type: 'field',
  position: [index],
  properties: { aria_label: key },
  styles: {
    background_color: 'ffffffff',
    font_size: 14,
    flex_direction: 'row',
    text_align: 'left'
  },
  mobile_styles: {},
  servar: {
    key,
    name: key,
    type:
      key === 'Choice'
        ? 'button_group'
        : key === 'Details'
        ? 'text_area'
        : 'text_field',
    required: true,
    repeated: false,
    metadata: {
      options: key === 'Choice' ? ['Yes', 'No'] : [],
      option_labels: [],
      option_images: []
    }
  }
}));
const step = { servar_fields: fields, buttons: [], subgrids: [] };
const visiblePositions = { '0': [true], '1': [true], '2': [true] };

function ValidationForm({ errorType }: { errorType: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const focusRef = useRef(null);
  const [inlineErrors, setInlineErrors] = useState<InlineErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [, setValues] = useState({ Name: '', Choice: [], Details: '' });

  const validate = (reportNativeErrors = true) =>
    validateElements({
      step,
      visiblePositions,
      errorType,
      formRef,
      triggerErrors: true,
      reportNativeErrors,
      setInlineErrors
    });

  const changeValue = (
    value: string | string[],
    element: typeof fields[number],
    _index: number | null,
    _rerender?: boolean,
    triggerErrors = true
  ) => {
    const key = element.servar.key;
    fieldValues[key] = value;
    setValues((prev) => ({ ...prev, [key]: value }));
    if (submitted && triggerErrors) validate(false);
    return true;
  };

  useEffect(() => {
    if (submitted) validate();
  }, [submitted]);

  return (
    <form ref={formRef} noValidate={errorType === 'inline'}>
      <span id='choice-hint'>Choose one option</span>
      {fields.map((element) => {
        const key = element.servar.key;
        return (
          <div key={key} data-testid={key}>
            <Element
              node={element}
              form={{
                activeStep: step,
                formSettings: { errorType },
                formRef,
                focusRef,
                onViewElements: [],
                inlineErrors,
                setInlineErrors,
                changeValue,
                fieldOnChange: () => () => {},
                elementProps: {
                  [key]: {
                    'data-testid': `${key}-control`,
                    ...(key === 'Choice' && {
                      'aria-describedby': 'choice-hint',
                      style: { padding: '2px' }
                    })
                  }
                }
              }}
            />
          </div>
        );
      })}
      <button type='button' onClick={() => setSubmitted(true)}>
        Next
      </button>
    </form>
  );
}

describe('field validation modes', () => {
  const originalErrors = initState.defaultErrors;
  const originalSdkKey = initState.sdkKey;

  beforeAll(async () => {
    (global as any).RadioNodeList ??= class RadioNodeList {};
    featheryWindow().matchMedia = jest.fn().mockReturnValue({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    });
    await preloadStepFields(step, visiblePositions);
  });

  beforeEach(() => {
    initState.sdkKey = 'test-sdk-key';
    initState.defaultErrors = { required: 'This is a required field' };
    Object.assign(fieldValues, { Name: '', Choice: [], Details: '' });
  });

  afterEach(() => {
    initState.sdkKey = originalSdkKey;
    initState.defaultErrors = originalErrors;
    fields.forEach(({ servar }) => delete fieldValues[servar.key]);
    jest.restoreAllMocks();
  });

  it('uses inline labels and control highlights without moving focus or consuming the first option click', async () => {
    const reportValidity = jest.spyOn(
      HTMLInputElement.prototype,
      'reportValidity'
    );
    const user = userEvent.setup();
    render(<ValidationForm errorType='inline' />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() =>
      expect(screen.getAllByText('This is a required field')).toHaveLength(3)
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    for (const { id, servar } of fields) {
      const wrapper = screen.getByTestId(`${servar.key}-control`);
      const controls = wrapper.querySelectorAll(
        'input:not([tabindex="-1"]):not([type="hidden"]), textarea, [role="button"]'
      );
      const error = screen
        .getByTestId(servar.key)
        .querySelector('[data-feathery-error-label]') as HTMLElement;
      expect(wrapper).not.toHaveAttribute('aria-invalid');
      expect(controls.length).toBeGreaterThan(0);
      controls.forEach((control) => {
        expect(control).toHaveAttribute('aria-invalid', 'true');
        expect(control.getAttribute('aria-describedby')).toContain(error.id);
      });
      // Highlight the controls themselves, leaving the surrounding field unoutlined.
      expect(wrapper.style.outline).toBe('');
      const borders = wrapper.querySelectorAll(`[id="bb-${id}"]`);
      expect(borders.length).toBeGreaterThan(0);
      borders.forEach((border) =>
        expect(border).toHaveStyle({ borderColor: ERROR_COLOR })
      );
    }

    const nameInput = screen.getByRole('textbox', { name: 'Name' });
    await user.type(nameInput, 'Ada');
    await waitFor(() =>
      expect(screen.getAllByText('This is a required field')).toHaveLength(2)
    );
    expect(nameInput).toHaveFocus();
    expect(nameInput).not.toHaveAttribute('aria-invalid');
    expect(screen.getByTestId('Name-control').style.outline).toBe('');

    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() =>
      expect(screen.getAllByText('This is a required field')).toHaveLength(1)
    );
    expect(fieldValues.Choice).toEqual(['Yes']);
    expect(
      screen.getByTestId('Choice').querySelector('input[type="hidden"]')
    ).toHaveValue('Yes');
    expect(screen.getByRole('button', { name: 'Yes' })).toHaveAttribute(
      'aria-describedby',
      'choice-hint'
    );
    expect(screen.getByTestId('Choice-control')).toHaveStyle('padding: 2px');
    expect(screen.getByTestId('Details')).toHaveTextContent(
      'This is a required field'
    );

    const detailsInput = screen.getByRole('textbox', { name: 'Details' });
    await user.type(detailsInput, 'Complete');
    await waitFor(() =>
      expect(
        screen.queryByText('This is a required field')
      ).not.toBeInTheDocument()
    );
    expect(detailsInput).toHaveFocus();
    expect(reportValidity).not.toHaveBeenCalled();
  });

  it('supports keyboard selection on an invalid button group', async () => {
    const user = userEvent.setup();
    render(<ValidationForm errorType='inline' />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    const choice = screen.getByRole('button', { name: 'Yes' });
    screen.getByRole('textbox', { name: 'Name' }).focus();
    await user.tab();
    expect(choice).toHaveFocus();
    expect(choice).toHaveAttribute('aria-invalid', 'true');
    await user.keyboard(' ');
    expect(fieldValues.Choice).toEqual(['Yes']);
    expect(choice).toHaveFocus();
    expect(choice).not.toHaveAttribute('aria-invalid');
  });

  it('highlights native errors and clears them during edits without reopening popups or rendering inline labels', async () => {
    const user = userEvent.setup();
    render(<ValidationForm errorType='html5' />);
    const nameInput = screen.getByRole('textbox', { name: 'Name' });
    // jsdom has no layout; expose the native control as visible for reporting.
    Object.defineProperty(nameInput, 'offsetParent', {
      configurable: true,
      value: nameInput.closest('form')
    });
    const reportValidity = jest
      .spyOn(nameInput as HTMLInputElement, 'reportValidity')
      .mockReturnValue(false);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(reportValidity).toHaveBeenCalledTimes(1));
    expect((nameInput as HTMLInputElement).validationMessage).toBe(
      'This is a required field'
    );
    expect(nameInput.closest('form')).not.toHaveAttribute('novalidate');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fields.forEach(({ servar }) => {
      expect(screen.getByTestId(`${servar.key}-control`)).not.toHaveAttribute(
        'aria-invalid'
      );
    });

    expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.queryByText('This is a required field')
    ).not.toBeInTheDocument();
    expect(featheryDoc().querySelector('[id="bb-field-Name"]')).toHaveStyle({
      borderColor: ERROR_COLOR
    });
    expect(screen.getByRole('button', { name: 'Yes' })).toHaveAttribute(
      'aria-invalid',
      'true'
    );

    // Editing clears native borders and validity without reporting the next error.
    await user.type(nameInput, 'Ada');
    expect(fieldValues.Name).toBe('Ada');
    await waitFor(() => expect(nameInput).not.toHaveAttribute('aria-invalid'));
    expect((nameInput as HTMLInputElement).validationMessage).toBe('');
    expect(nameInput).toHaveFocus();
    expect(reportValidity).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    expect(fieldValues.Choice).toEqual(['Yes']);
    expect(screen.getByRole('button', { name: 'Yes' })).not.toHaveAttribute(
      'aria-invalid'
    );
    expect(reportValidity).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

const controlCases = [
  ['TextField', 'text_field', 'input'],
  ['TextArea', 'text_area', 'textarea'],
  ['PasswordField', 'password', 'input'],
  ['PhoneField', 'phone_number', 'input[type="tel"]'],
  ['AddressLine1', 'gmap_line_1', 'input'],
  ['DropdownField', 'dropdown', 'select'],
  ['DropdownMultiField', 'dropdown_multi', '[role="combobox"]'],
  ['DateSelectorField', 'date_selector', 'input'],
  ['CheckboxField', 'checkbox', 'input[type="checkbox"]'],
  ['CheckboxGroupField', 'multiselect', '[role="group"]'],
  ['RadioButtonGroupField', 'select', '[role="radiogroup"]'],
  ['MatrixField', 'matrix', '[role="radiogroup"]'],
  ['PinInputField', 'pin_input', 'input'],
  ['SliderField', 'slider', '[role="slider"]'],
  ['ButtonGroupField', 'button_group', '[role="button"]'],
  ['FileUploadField', 'file_upload', '[role="button"], input[type="file"]'],
  ['ColorPickerField', 'hex_color', '[role="button"]'],
  ['RatingField', 'rating', '[role="radiogroup"]'],
  ['SignatureField', 'signature', '[role="button"]']
];

describe('accessible field errors', () => {
  const originalResizeObserver = global.ResizeObserver;
  beforeAll(() => {
    global.ResizeObserver = jest.fn().mockImplementation(() => ({
      observe: jest.fn(),
      unobserve: jest.fn(),
      disconnect: jest.fn()
    }));
  });
  afterAll(() => {
    global.ResizeObserver = originalResizeObserver;
  });
  it.each(controlCases)(
    'links %s errors to its controls in each validation mode',
    async (component, type, selector) => {
      const element = {
        ...fields[0],
        servar: {
          ...fields[0].servar,
          type,
          max_length: 4,
          metadata: {
            file_types: [],
            options: ['Yes', 'No'],
            option_labels: [],
            option_images: [],
            questions: [{ id: 'question', label: 'Question' }]
          }
        }
      };
      await preloadStepFields({ servar_fields: [element] }, { '0': [true] });
      const Field = (Elements as Record<string, React.ComponentType<any>>)[
        component
      ];
      const renderField = (errorType: string, inlineError = 'Required') => (
        <>
          <span id='field-hint'>Helpful description</span>
          <Field
            element={element}
            componentOnly={false}
            inlineError={inlineError}
            formSettings={{ errorType }}
            elementProps={{
              'data-testid': 'wrapper',
              'aria-describedby': 'field-hint'
            }}
          />
        </>
      );
      const { container, rerender } = render(renderField('inline'));
      const controls = container.querySelectorAll(selector);
      expect(controls.length).toBeGreaterThan(0);
      const errorId = screen.getByText('Required').id;
      expect(screen.getByTestId('wrapper')).not.toHaveAttribute('aria-invalid');
      controls.forEach((control) => {
        expect(control).toHaveAttribute('aria-invalid', 'true');
        expect(control.getAttribute('aria-describedby')).toContain(errorId);
        expect(control.getAttribute('aria-describedby')).toContain(
          'field-hint'
        );
      });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      // Composite fields describe their error once at the named group.
      container
        .querySelectorAll('[role="group"], [role="radiogroup"]')
        .forEach((group) => {
          expect(group).toHaveAccessibleName();
          expect(
            group.querySelector('[aria-invalid], [aria-describedby]')
          ).toBeNull();
        });

      rerender(renderField('html5'));
      expect(screen.queryByText('Required')).not.toBeInTheDocument();
      controls.forEach((control) => {
        expect(control).toHaveAttribute('aria-invalid', 'true');
        expect(control.getAttribute('aria-describedby')).not.toContain(errorId);
        expect(control.getAttribute('aria-describedby')).toContain(
          'field-hint'
        );
      });

      rerender(renderField('inline', ''));
      controls.forEach((control) => {
        expect(control).not.toHaveAttribute('aria-invalid');
        expect(control.getAttribute('aria-describedby')).toContain(
          'field-hint'
        );
      });
    }
  );
});

describe('composite field validation', () => {
  it.each([false, true])(
    'marks only unanswered matrix questions (multiple=%s)',
    async (multiple) => {
      const element = {
        ...fields[0],
        servar: {
          ...fields[0].servar,
          type: 'matrix',
          metadata: {
            multiple,
            options: ['Yes', 'No'],
            questions: [
              { id: 'answered', label: 'Answered question' },
              { id: 'missing', label: 'Missing question' }
            ]
          }
        }
      };
      await preloadStepFields({ servar_fields: [element] }, { '0': [true] });
      const renderMatrix = (value: Record<string, string[]>) => (
        <>
          <span id='matrix-hint'>Choose an answer for each question</span>
          <Elements.MatrixField
            element={element}
            componentOnly={false}
            inlineError='Required'
            formSettings={{ errorType: 'inline' }}
            fieldVal={value}
            elementProps={{ 'aria-describedby': 'matrix-hint' }}
          />
        </>
      );
      const { rerender } = render(
        renderMatrix({ answered: ['Yes'], missing: [] })
      );
      const role = multiple ? 'group' : 'radiogroup';
      const answered = screen.getByRole(role, { name: 'Answered question' });
      const missing = screen.getByRole(role, { name: 'Missing question' });
      expect(answered).not.toHaveAttribute('aria-invalid');
      expect(answered).toHaveAttribute('aria-describedby', 'matrix-hint');
      expect(missing).toHaveAttribute('aria-invalid', 'true');
      expect(missing.getAttribute('aria-describedby')).toContain(
        screen.getByText('Required').id
      );
      expect(missing.querySelector('[aria-invalid]')).toBeNull();

      rerender(renderMatrix({ answered: ['Yes'], missing: ['No'] }));
      expect(missing).not.toHaveAttribute('aria-invalid');
      expect(missing).toHaveAttribute('aria-describedby', 'matrix-hint');
    }
  );

  it('uses one rating Tab stop and arrow keys to select and wrap between stars', async () => {
    const element = {
      ...fields[0],
      servar: { ...fields[0].servar, type: 'rating', max_length: 10 }
    };
    await preloadStepFields({ servar_fields: [element] }, { '0': [true] });
    function Rating() {
      const [value, setValue] = useState(10);
      return (
        <>
          <Elements.RatingField
            element={element}
            componentOnly={false}
            fieldVal={value}
            onChange={setValue}
          />
          <button>Continue</button>
        </>
      );
    }
    const user = userEvent.setup();
    render(<Rating />);
    const first = screen.getByRole('radio', { name: '1' });
    const last = screen.getByRole('radio', { name: '10' });
    await user.tab();
    expect(last).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('aria-checked', 'true');
    expect(last).toHaveAttribute('tabindex', '-1');
    await user.keyboard('{ArrowUp}');
    expect(last).toHaveFocus();
    expect(last).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: '9' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(last).toHaveFocus();
  });
});
