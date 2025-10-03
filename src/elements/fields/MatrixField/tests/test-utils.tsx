import React from 'react';
import {
  createBaseElement,
  createFieldProps,
  mockResponsiveStyles,
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue,
  expectFieldToBeDisabled,
  expectFieldToBeRequired,
  expectFieldToHaveAriaLabel
} from '../../shared/tests/field-test-utils';

export {
  mockResponsiveStyles,
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue,
  expectFieldToBeDisabled,
  expectFieldToBeRequired,
  expectFieldToHaveAriaLabel
};

jest.mock('../../../components/TextHoverTooltip', () => {
  return function MockTextHoverTooltip({ children, text }: any) {
    return (
      <div data-testid='text-hover-tooltip' title={text || ''}>
        {children}
      </div>
    );
  };
});

export const createMatrixElement = (
  type: string = 'matrix',
  metadata: any = {},
  styles: any = {}
) =>
  createBaseElement(
    'test-matrix',
    type,
    {
      multiple: false,
      options: ['Option 1', 'Option 2', 'Option 3'],
      questions: [
        { id: 'q1', label: 'Question 1', tooltip: '', read_only: false },
        { id: 'q2', label: 'Question 2', tooltip: '', read_only: false }
      ],
      ...metadata
    },
    {
      aria_label: 'Test matrix field'
    },
    styles
  );

export const createMatrixProps = (element: any, customProps: any = {}) =>
  createFieldProps(element, {
    fieldVal: {},
    onChange: jest.fn(),
    ...customProps
  });

export const createStatefulOnChange = () => {
  return jest.fn((e: React.ChangeEvent<HTMLInputElement>) => {
    const currentValue = getMockFieldValue() || {};
    const questionId = e.target.getAttribute('data-question-id');
    const optionValue = e.target.value;
    const isChecked = e.target.checked;
    const isMultiple = e.target.type === 'checkbox';

    if (!questionId) return;

    const newValue = { ...currentValue };

    if (isMultiple) {
      // Handle checkbox behavior (multiple selections)
      if (!newValue[questionId]) newValue[questionId] = [];
      if (isChecked) {
        if (!newValue[questionId].includes(optionValue)) {
          newValue[questionId].push(optionValue);
        }
      } else {
        newValue[questionId] = newValue[questionId].filter(
          (val: string) => val !== optionValue
        );
      }
    } else {
      // Handle radio behavior (single selection)
      newValue[questionId] = isChecked ? [optionValue] : [];
    }

    setMockFieldValue(newValue);
  });
};

export const createOptionsMetadata = (
  options: string[],
  optionLabels?: string[],
  optionTooltips?: string[]
) => ({
  options,
  ...(optionLabels && { option_labels: optionLabels }),
  ...(optionTooltips && { option_tooltips: optionTooltips })
});

export const createQuestionsMetadata = (
  questions: Array<{
    id: string;
    label: string;
    tooltip?: string;
    read_only?: boolean;
    highlight_color?: string;
  }>
) => ({
  questions
});

export const createRepeatOptionsMetadata = (repeatOptions: any[]) => ({
  repeat_options: [repeatOptions]
});

export const createMultipleMatrixElement = (
  options: string[] = ['Option 1', 'Option 2', 'Option 3']
) =>
  createMatrixElement('matrix', {
    multiple: true,
    options,
    questions: [
      { id: 'q1', label: 'Question 1', tooltip: '', read_only: false },
      { id: 'q2', label: 'Question 2', tooltip: '', read_only: false }
    ]
  });

export const createSingleMatrixElement = (
  options: string[] = ['Option 1', 'Option 2', 'Option 3']
) =>
  createMatrixElement('matrix', {
    multiple: false,
    options,
    questions: [
      { id: 'q1', label: 'Question 1', tooltip: '', read_only: false },
      { id: 'q2', label: 'Question 2', tooltip: '', read_only: false }
    ]
  });

export const getMatrixContainer = () => {
  const container = document
    .querySelector('[data-testid="text-hover-tooltip"]')
    ?.closest('div');
  if (!container) throw new Error('Matrix container not found');
  return container as HTMLElement;
};

export const getMatrixInputs = () => {
  return Array.from(
    document.querySelectorAll('input[data-question-id]')
  ) as HTMLInputElement[];
};

export const getMatrixInput = (questionId: string, optionValue: string) => {
  const inputs = getMatrixInputs();
  return inputs.find(
    (input) =>
      input.getAttribute('data-question-id') === questionId &&
      input.value === optionValue
  );
};

export const getQuestionInputs = (questionId: string) => {
  const inputs = getMatrixInputs();
  return inputs.filter(
    (input) => input.getAttribute('data-question-id') === questionId
  );
};

export const getColumnHeaders = () => {
  const container = document.querySelector('div[style*="flex-direction: row"]');
  if (!container) return [];
  return Array.from(container.children).slice(1) as HTMLElement[]; // Skip first column (question labels)
};

export const getQuestionRows = () => {
  const containers = Array.from(
    document.querySelectorAll('[data-testid="text-hover-tooltip"]')
  );
  return containers.map((tooltip) => tooltip.closest('div')) as HTMLElement[];
};

export const getQuestionLabel = (questionId: string) => {
  const inputs = getQuestionInputs(questionId);
  if (inputs.length === 0) return null;
  const row = inputs[0].closest('div[style*="flex-direction: row"]');
  if (!row) return null;
  const labelContainer = row.querySelector(
    '[data-testid="text-hover-tooltip"]'
  );
  return labelContainer?.textContent || null;
};

export const expectMatrixInputToBeChecked = (
  questionId: string,
  optionValue: string
) => {
  const input = getMatrixInput(questionId, optionValue);
  expect(input?.checked).toBe(true);
};

export const expectMatrixInputToBeUnchecked = (
  questionId: string,
  optionValue: string
) => {
  const input = getMatrixInput(questionId, optionValue);
  expect(input?.checked).toBe(false);
};

export const expectMatrixInputType = (type: 'checkbox' | 'radio') => {
  const inputs = getMatrixInputs();
  inputs.forEach((input) => {
    expect(input.type).toBe(type);
  });
};

export const expectMatrixInputToBeDisabled = (
  questionId: string,
  optionValue: string
) => {
  const input = getMatrixInput(questionId, optionValue);
  expect(input?.disabled).toBe(true);
};

export const expectMatrixInputToBeEnabled = (
  questionId: string,
  optionValue: string
) => {
  const input = getMatrixInput(questionId, optionValue);
  expect(input?.disabled).toBe(false);
};

export const expectMatrixToHaveQuestionCount = (count: number) => {
  const questionRows = getQuestionRows();
  expect(questionRows).toHaveLength(count);
};

export const expectMatrixToHaveOptionCount = (count: number) => {
  const headers = getColumnHeaders();
  expect(headers).toHaveLength(count);
};

export const expectQuestionToHaveTooltip = (
  questionId: string,
  tooltip: string
) => {
  const inputs = getQuestionInputs(questionId);
  if (inputs.length === 0) throw new Error(`Question ${questionId} not found`);
  const row = inputs[0].closest('div[style*="flex-direction: row"]');
  const tooltipElement = row?.querySelector(
    '[data-testid="text-hover-tooltip"]'
  );
  expect(tooltipElement?.getAttribute('title')).toBe(tooltip);
};

export const expectQuestionToHaveHighlightColor = (
  questionId: string,
  color: string
) => {
  const inputs = getQuestionInputs(questionId);
  if (inputs.length === 0) throw new Error(`Question ${questionId} not found`);
  const row = inputs[0].closest(
    'div[style*="flex-direction: row"]'
  ) as HTMLElement;

  // Convert hex to RGB for comparison since browsers convert colors
  const hexToRgb = (hex: string) => {
    const cleanHex = hex.replace('#', '');
    const r = parseInt(cleanHex.substr(0, 2), 16);
    const g = parseInt(cleanHex.substr(2, 2), 16);
    const b = parseInt(cleanHex.substr(4, 2), 16);
    return `rgb(${r}, ${g}, ${b})`;
  };

  const expectedColor = color.startsWith('#') ? hexToRgb(color) : color;
  expect(row?.style.backgroundColor).toBe(expectedColor);
};

export const expectMatrixToHaveValues = (
  expectedValues: Record<string, string[]>
) => {
  const currentValue = getMockFieldValue() || {};
  Object.keys(expectedValues).forEach((questionId) => {
    const expected = expectedValues[questionId].sort();
    const actual = (currentValue[questionId] || []).sort();
    expect(actual).toEqual(expected);
  });
};
