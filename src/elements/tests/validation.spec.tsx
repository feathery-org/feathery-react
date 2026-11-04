import React, { useEffect, useRef, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Element from '../../Form/grid/Element';
import { preloadStepFields } from '../fields';
import { ERROR_COLOR } from '../styles';
import { fieldValues, initState } from '../../utils/init';
import { validateElements } from '../../utils/validation';
import type { InlineErrors } from '../../utils/inlineErrors';

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

  const validate = () =>
    validateElements({
      step,
      visiblePositions,
      errorType,
      formRef,
      triggerErrors: true,
      setInlineErrors
    });

  const changeValue = (
    value: string | string[],
    element: typeof fields[number],
    _index: number | null,
    _rerender = true,
    triggerErrors = true
  ) => {
    const key = element.servar.key;
    fieldValues[key] = value;
    setValues((prev) => ({ ...prev, [key]: value }));
    if (submitted && triggerErrors) validate();
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
    window.matchMedia = jest.fn().mockReturnValue({
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

    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(3));
    for (const { id, servar } of fields) {
      const control = screen.getByTestId(`${servar.key}-control`);
      const error = screen
        .getByTestId(servar.key)
        .querySelector('[role="alert"]') as HTMLElement;
      expect(control).toHaveAttribute('aria-invalid', 'true');
      expect(control.getAttribute('aria-describedby')).toContain(error.id);
      // Highlight the controls themselves, leaving the surrounding field unoutlined.
      expect(control.style.outline).toBe('');
      const borders = control.querySelectorAll(`[id="bb-${id}"]`);
      expect(borders.length).toBeGreaterThan(0);
      borders.forEach((border) =>
        expect(border).toHaveStyle({ borderColor: ERROR_COLOR })
      );
    }

    const nameInput = screen.getByRole('textbox', { name: 'Name' });
    await user.type(nameInput, 'Ada');
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    expect(nameInput).toHaveFocus();
    expect(screen.getByTestId('Name-control')).not.toHaveAttribute(
      'aria-invalid'
    );
    expect(screen.getByTestId('Name-control').style.outline).toBe('');

    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1));
    expect(fieldValues.Choice).toEqual(['Yes']);
    expect(
      screen.getByTestId('Choice').querySelector('input[type="hidden"]')
    ).toHaveValue('Yes');
    expect(screen.getByTestId('Choice-control')).toHaveAttribute(
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
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    );
    expect(detailsInput).toHaveFocus();
    expect(reportValidity).not.toHaveBeenCalled();
  });

  it('preserves native error reporting without rendering inline feedback', async () => {
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

    // Native typing retains its existing suppression of popup revalidation.
    await user.type(nameInput, 'Ada');
    expect(fieldValues.Name).toBe('Ada');
    expect(reportValidity).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
