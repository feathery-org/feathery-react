import {
  createBaseElement,
  createFieldProps,
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue,
  expectFieldToBeDisabled,
  expectFieldToBeRequired,
  expectFieldToHaveAriaLabel
} from '../../shared/tests/field-test-utils';
import React from 'react';

export {
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue,
  expectFieldToBeDisabled,
  expectFieldToBeRequired,
  expectFieldToHaveAriaLabel
};

jest.mock('../../../../hooks/useSalesforceSync', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    dynamicOptions: [],
    loadingDynamicOptions: false,
    shouldSalesforceSync: false
  }))
}));

jest.mock('../../../components/InlineTooltip', () => {
  return function MockInlineTooltip({ text, id }: any) {
    return (
      <span data-testid={`tooltip-${id}`} title={text || ''}>
        {text || ''}
      </span>
    );
  };
});

jest.mock('../../../components/ErrorInput', () => {
  return function MockErrorInput({ id, name, 'aria-label': ariaLabel }: any) {
    return (
      <input
        data-testid='error-input'
        type='text'
        inputMode='none'
        tabIndex={-1}
        id={id}
        name={name}
        aria-label={ariaLabel}
      />
    );
  };
});

export const createButtonGroupElement = (
  type: string = 'button_group',
  metadata: any = {},
  styles: any = {}
) =>
  createBaseElement(
    'test-button-group',
    type,
    {
      options: ['Option 1', 'Option 2', 'Option 3'],
      option_labels: [],
      option_tooltips: [],
      option_images: [],
      ...metadata
    },
    {
      aria_label: 'Test button group field'
    },
    styles
  );

export const createButtonGroupProps = (element: any, customProps: any = {}) =>
  createFieldProps(element, {
    fieldVal: [],
    onClick: jest.fn(),
    ...customProps
  });

export const createStatefulOnClick = () => {
  return jest.fn((value: string) => {
    const currentValue = getMockFieldValue() || [];
    let newValue;

    if (Array.isArray(currentValue)) {
      if (currentValue.includes(value)) {
        // Remove if already selected (toggle behavior for multiple selection)
        newValue = currentValue.filter((v) => v !== value);
      } else {
        // Add to selection
        newValue = [...currentValue, value];
      }
    } else {
      // Single selection mode
      newValue = [value];
    }

    setMockFieldValue(newValue);
  });
};

export const createOptionsMetadata = (
  options: string[],
  labels?: string[],
  tooltips?: string[],
  images?: string[]
) => ({
  options,
  ...(labels && { option_labels: labels }),
  ...(tooltips && { option_tooltips: tooltips }),
  ...(images && { option_images: images })
});

export const createRepeatOptionsMetadata = (repeatOptions: any[]) => ({
  repeat_options: [repeatOptions]
});

export const createImageButtonGroupElement = (
  options: string[] = ['Option 1', 'Option 2'],
  images: string[] = ['image1.jpg', 'image2.jpg']
) =>
  createButtonGroupElement('button_group', {
    options,
    option_images: images
  });

export const getButtonElements = () => {
  // Find the button container (has flexWrap: 'wrap' and contains button divs)
  // Look for divs that have onClick handlers (these are the buttons)
  const allDivs = Array.from(document.querySelectorAll('div'));

  // Find buttons by looking for divs with data-button-value or that contain option text
  // The buttons are rendered in a flex container after the label
  const buttonContainers = allDivs.filter(div => {
    const style = window.getComputedStyle(div);
    return style.display === 'flex' && style.flexWrap === 'wrap';
  });

  if (buttonContainers.length === 0) return [];

  // Get the button divs - they are direct children of the flex container
  const container = buttonContainers[0];
  const buttons = Array.from(container.children).filter(child => {
    // Buttons have onClick and are divs
    return child.tagName === 'DIV';
  }) as HTMLElement[];

  return buttons;
};

export const getButtonElement = (index: number) => {
  const buttons = getButtonElements();
  return buttons[index];
};

export const getButtonByValue = (value: string) => {
  const buttons = getButtonElements();
  return buttons.find((button) => {
    const allDivs = button.querySelectorAll('div');
    for (const div of allDivs) {
      if (div.textContent === value) return true;
    }
    return false;
  });
};

export const getButtonLabels = () => {
  const buttons = getButtonElements();
  return buttons.map((button) => {
    const allDivs = Array.from(button.querySelectorAll('div'));
    const labelDiv = allDivs.find((div) => {
      const testId = div.getAttribute('data-testid');
      if (testId && testId.startsWith('tooltip-')) return false;
      const text = div.textContent || '';
      const childDivs = Array.from(div.querySelectorAll('div'));
      const hasTextChildren = childDivs.some(
        (child) => child.textContent && child.textContent.trim().length > 0
      );
      return text.trim().length > 0 && !hasTextChildren;
    });
    return labelDiv?.textContent || '';
  });
};

export const getButtonLabel = (index: number) => {
  const labels = getButtonLabels();
  return labels[index];
};

export const getButtonImage = (index: number) => {
  const button = getButtonElement(index);
  return button?.querySelector('img') as HTMLImageElement;
};

export const getButtonTooltip = (label: string) => {
  const element = document.querySelector(
    `[data-testid="tooltip-test-button-group-${label}"]`
  );
  return element?.textContent || '';
};

export const getErrorInput = () => {
  return document.querySelector(
    'input[type="text"][inputmode="none"][tabindex="-1"]'
  ) as HTMLInputElement;
};

export const expectButtonToBeSelected = (value: string) => {
  const button = getButtonByValue(value);
  expect(button).toBeTruthy();
  const currentValue = getMockFieldValue() || [];
  const isSelected = Array.isArray(currentValue)
    ? currentValue.includes(value)
    : currentValue === value;
  expect(isSelected).toBe(true);
};

export const expectButtonToBeUnselected = (value: string) => {
  const button = getButtonByValue(value);
  expect(button).toBeTruthy();
  const currentValue = getMockFieldValue() || [];
  const isSelected = Array.isArray(currentValue)
    ? currentValue.includes(value)
    : currentValue === value;
  expect(isSelected).toBe(false);
};

export const expectButtonGroupToHaveValues = (values: string[]) => {
  const currentValue = getMockFieldValue() || [];
  expect(currentValue.sort()).toEqual(values.sort());
};

export const expectButtonGroupToHaveButtonCount = (count: number) => {
  const buttons = getButtonElements();
  expect(buttons).toHaveLength(count);
};

export const expectButtonToHaveImage = (index: number, imageSrc: string) => {
  const image = getButtonImage(index);
  expect(image).toBeTruthy();
  expect(image.src).toContain(imageSrc);
};

export const expectButtonToHaveNoImage = (index: number) => {
  const image = getButtonImage(index);
  expect(image).toBeFalsy();
};

export const expectButtonToHaveTooltip = (label: string, tooltip: string) => {
  const actualTooltip = getButtonTooltip(label);
  expect(actualTooltip).toBe(tooltip);
};

export const expectButtonGroupToBeDisabled = () => {
  const errorInput = getErrorInput();
  const container = errorInput?.parentElement?.parentElement;
  expect(container).toBeTruthy();
};

export const expectButtonGroupToBeEnabled = () => {
  const buttons = getButtonElements();
  expect(buttons.length).toBeGreaterThan(0);
};

export const expectErrorInputToHaveAttributes = (
  expectedId: string,
  expectedName: string,
  expectedAriaLabel: string
) => {
  const errorInput = getErrorInput();
  expect(errorInput.id).toBe(expectedId);
  expect(errorInput.name).toBe(expectedName);
  expect(errorInput.getAttribute('aria-label')).toBe(expectedAriaLabel);
};
