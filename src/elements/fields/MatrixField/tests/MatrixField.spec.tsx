import {
  createMatrixElement,
  createMatrixProps,
  createStatefulOnChange,
  createOptionsMetadata,
  createQuestionsMetadata,
  createMultipleMatrixElement,
  createSingleMatrixElement,
  getMockFieldValue,
  resetMockFieldValue,
  setMockFieldValue,
  getMatrixInputs,
  getMatrixInput,
  getQuestionInputs,
  getColumnHeaders,
  getQuestionRows,
  getQuestionLabel,
  expectMatrixInputToBeChecked,
  expectMatrixInputToBeUnchecked,
  expectMatrixInputType,
  expectMatrixInputToBeDisabled,
  expectMatrixInputToBeEnabled,
  expectMatrixToHaveQuestionCount,
  expectMatrixToHaveOptionCount,
  expectQuestionToHaveTooltip,
  expectQuestionToHaveHighlightColor,
  expectMatrixToHaveValues,
  expectFieldToBeDisabled,
  expectFieldToHaveAriaLabel
} from './test-utils';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import MatrixField from '../index';

describe('MatrixField - Base Functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMockFieldValue();
  });

  describe('Basic Rendering', () => {
    it('renders MatrixField component with default props', () => {
      const element = createMatrixElement('matrix');
      const props = createMatrixProps(element);

      render(<MatrixField {...props} />);

      expect(screen.getByText('Test Label')).toBeTruthy();
      expectMatrixToHaveQuestionCount(2);
      expectMatrixToHaveOptionCount(3);
    });

    it('renders with correct matrix structure', () => {
      const element = createMatrixElement('matrix');
      const props = createMatrixProps(element);

      render(<MatrixField {...props} />);

      // Check column headers
      const headers = getColumnHeaders();
      expect(headers[0].textContent).toBe('Option 1');
      expect(headers[1].textContent).toBe('Option 2');
      expect(headers[2].textContent).toBe('Option 3');

      // Check question labels
      expect(getQuestionLabel('q1')).toBe('Question 1');
      expect(getQuestionLabel('q2')).toBe('Question 2');

      // Check input structure
      const inputs = getMatrixInputs();
      expect(inputs).toHaveLength(6); // 2 questions × 3 options
    });

    it('renders with single selection (radio) by default', () => {
      const element = createSingleMatrixElement();
      const props = createMatrixProps(element);

      render(<MatrixField {...props} />);

      expectMatrixInputType('radio');
    });

    it('renders with multiple selection (checkbox) when specified', () => {
      const element = createMultipleMatrixElement();
      const props = createMatrixProps(element);

      render(<MatrixField {...props} />);

      expectMatrixInputType('checkbox');
    });

    it('renders with disabled state', () => {
      const element = createMatrixElement('matrix');
      const props = createMatrixProps(element, { disabled: true });

      render(<MatrixField {...props} />);

      const inputs = getMatrixInputs();
      inputs.forEach((input) => {
        expectFieldToBeDisabled(input);
      });
    });
  });

  describe('onChange Functionality - Single Selection', () => {
    it('handles basic option selection in single mode', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createSingleMatrixElement();
      const props = createMatrixProps(element, { onChange: mockOnChange });

      render(<MatrixField {...props} />);

      act(() => {
        const input = getMatrixInput('q1', 'Option 2');
        fireEvent.click(input!);
      });

      expectMatrixToHaveValues({ q1: ['Option 2'] });
      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.any(HTMLInputElement)
        })
      );
    });

    it('replaces previous selection in same question (radio behavior)', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createSingleMatrixElement();
      const props = createMatrixProps(element, { onChange: mockOnChange });

      render(<MatrixField {...props} />);

      // Select first option
      act(() => {
        const input = getMatrixInput('q1', 'Option 1');
        fireEvent.click(input!);
      });

      expectMatrixToHaveValues({ q1: ['Option 1'] });

      // Select second option (should replace first)
      act(() => {
        const input = getMatrixInput('q1', 'Option 2');
        fireEvent.click(input!);
      });

      expectMatrixToHaveValues({ q1: ['Option 2'] });
      expect(mockOnChange).toHaveBeenCalledTimes(2);
    });

    it('allows different selections for different questions', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createSingleMatrixElement();
      const props = createMatrixProps(element, { onChange: mockOnChange });

      render(<MatrixField {...props} />);

      act(() => {
        const input1 = getMatrixInput('q1', 'Option 1');
        const input2 = getMatrixInput('q2', 'Option 3');
        fireEvent.click(input1!);
        fireEvent.click(input2!);
      });

      expectMatrixToHaveValues({
        q1: ['Option 1'],
        q2: ['Option 3']
      });
    });
  });

  describe('onChange Functionality - Multiple Selection', () => {
    it('handles basic option selection in multiple mode', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createMultipleMatrixElement();
      const props = createMatrixProps(element, { onChange: mockOnChange });

      render(<MatrixField {...props} />);

      act(() => {
        const input = getMatrixInput('q1', 'Option 2');
        fireEvent.click(input!);
      });

      expectMatrixToHaveValues({ q1: ['Option 2'] });
      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.any(HTMLInputElement)
        })
      );
    });

    it('allows multiple selections for same question (checkbox behavior)', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createMultipleMatrixElement();
      const props = createMatrixProps(element, { onChange: mockOnChange });

      render(<MatrixField {...props} />);

      act(() => {
        const input1 = getMatrixInput('q1', 'Option 1');
        const input2 = getMatrixInput('q1', 'Option 3');
        fireEvent.click(input1!);
        fireEvent.click(input2!);
      });

      expectMatrixToHaveValues({ q1: ['Option 1', 'Option 3'] });
      expect(mockOnChange).toHaveBeenCalledTimes(2);
    });

    it('handles unchecking options in multiple mode', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createMultipleMatrixElement();

      // Set initial mock field value to match the fieldVal prop
      setMockFieldValue({ q1: ['Option 1', 'Option 2'] });

      const props = createMatrixProps(element, {
        onChange: mockOnChange,
        fieldVal: { q1: ['Option 1', 'Option 2'] }
      });

      render(<MatrixField {...props} />);

      expectMatrixInputToBeChecked('q1', 'Option 1');
      expectMatrixInputToBeChecked('q1', 'Option 2');

      act(() => {
        const input = getMatrixInput('q1', 'Option 1');
        fireEvent.click(input!);
      });

      expectMatrixToHaveValues({ q1: ['Option 2'] });
    });
  });

  describe('Field Value Display', () => {
    it('displays provided field values correctly (single selection)', () => {
      const element = createSingleMatrixElement();
      const props = createMatrixProps(element, {
        fieldVal: { q1: ['Option 2'], q2: ['Option 1'] }
      });

      render(<MatrixField {...props} />);

      expectMatrixInputToBeChecked('q1', 'Option 2');
      expectMatrixInputToBeUnchecked('q1', 'Option 1');
      expectMatrixInputToBeUnchecked('q1', 'Option 3');

      expectMatrixInputToBeChecked('q2', 'Option 1');
      expectMatrixInputToBeUnchecked('q2', 'Option 2');
      expectMatrixInputToBeUnchecked('q2', 'Option 3');
    });

    it('displays provided field values correctly (multiple selection)', () => {
      const element = createMultipleMatrixElement();
      const props = createMatrixProps(element, {
        fieldVal: { q1: ['Option 1', 'Option 3'], q2: ['Option 2'] }
      });

      render(<MatrixField {...props} />);

      expectMatrixInputToBeChecked('q1', 'Option 1');
      expectMatrixInputToBeUnchecked('q1', 'Option 2');
      expectMatrixInputToBeChecked('q1', 'Option 3');

      expectMatrixInputToBeUnchecked('q2', 'Option 1');
      expectMatrixInputToBeChecked('q2', 'Option 2');
      expectMatrixInputToBeUnchecked('q2', 'Option 3');
    });

    it('handles empty field values', () => {
      const element = createMatrixElement('matrix');
      const props = createMatrixProps(element, { fieldVal: {} });

      render(<MatrixField {...props} />);

      const inputs = getMatrixInputs();
      inputs.forEach((input) => {
        expect(input.checked).toBe(false);
      });
    });

    it('updates display when field value changes', () => {
      const element = createMatrixElement('matrix');
      const props = createMatrixProps(element, {
        fieldVal: { q1: ['Option 1'] }
      });

      const { rerender } = render(<MatrixField {...props} />);

      expectMatrixInputToBeChecked('q1', 'Option 1');

      // Update field value
      const updatedProps = createMatrixProps(element, {
        fieldVal: { q1: ['Option 3'] }
      });
      rerender(<MatrixField {...updatedProps} />);

      expectMatrixInputToBeUnchecked('q1', 'Option 1');
      expectMatrixInputToBeChecked('q1', 'Option 3');
    });
  });

  describe('Option Columns - Display and Tooltips', () => {
    it('renders option columns with custom labels', () => {
      const options = ['val1', 'val2', 'val3'];
      const optionLabels = ['Label 1', 'Label 2', 'Label 3'];
      const element = createMatrixElement('matrix', {
        ...createOptionsMetadata(options, optionLabels)
      });
      const props = createMatrixProps(element);

      render(<MatrixField {...props} />);

      const headers = getColumnHeaders();
      expect(headers[0].textContent).toBe('val1'); // MatrixField uses the option values directly as headers
      expect(headers[1].textContent).toBe('val2');
      expect(headers[2].textContent).toBe('val3');
    });

    it('renders options correctly in input values', () => {
      const options = ['small', 'medium', 'large'];
      const element = createMatrixElement('matrix', {
        options,
        questions: [
          { id: 'q1', label: 'Size preference', tooltip: '', read_only: false }
        ]
      });
      const props = createMatrixProps(element);

      render(<MatrixField {...props} />);

      const smallInput = getMatrixInput('q1', 'small');
      const mediumInput = getMatrixInput('q1', 'medium');
      const largeInput = getMatrixInput('q1', 'large');

      expect(smallInput?.value).toBe('small');
      expect(mediumInput?.value).toBe('medium');
      expect(largeInput?.value).toBe('large');
    });
  });

  describe('Option Rows - Labels, Tooltips, Disabled, Highlight Color', () => {
    it('renders question labels correctly', () => {
      const questions = [
        {
          id: 'satisfaction',
          label: 'How satisfied are you?',
          tooltip: '',
          read_only: false
        },
        {
          id: 'recommendation',
          label: 'Would you recommend us?',
          tooltip: '',
          read_only: false
        }
      ];
      const element = createMatrixElement('matrix', {
        questions
      });
      const props = createMatrixProps(element);

      render(<MatrixField {...props} />);

      expect(getQuestionLabel('satisfaction')).toBe('How satisfied are you?');
      expect(getQuestionLabel('recommendation')).toBe(
        'Would you recommend us?'
      );
    });

    it('renders question tooltips correctly', () => {
      const questions = [
        {
          id: 'q1',
          label: 'Question 1',
          tooltip: 'Help text for question 1',
          read_only: false
        },
        {
          id: 'q2',
          label: 'Question 2',
          tooltip: 'Help text for question 2',
          read_only: false
        }
      ];
      const element = createMatrixElement('matrix', {
        questions
      });
      const props = createMatrixProps(element);

      render(<MatrixField {...props} />);

      expectQuestionToHaveTooltip('q1', 'Help text for question 1');
      expectQuestionToHaveTooltip('q2', 'Help text for question 2');
    });

    it('handles questions with empty tooltips', () => {
      const questions = [
        { id: 'q1', label: 'Question 1', tooltip: '', read_only: false },
        { id: 'q2', label: 'Question 2', tooltip: undefined, read_only: false }
      ];
      const element = createMatrixElement('matrix', {
        questions
      });
      const props = createMatrixProps(element);

      render(<MatrixField {...props} />);

      expectQuestionToHaveTooltip('q1', '');
      expectQuestionToHaveTooltip('q2', '');
    });

    it('disables inputs for read-only questions', () => {
      const questions = [
        { id: 'q1', label: 'Editable Question', tooltip: '', read_only: false },
        { id: 'q2', label: 'Read-only Question', tooltip: '', read_only: true }
      ];
      const element = createMatrixElement('matrix', {
        questions
      });
      const props = createMatrixProps(element);

      render(<MatrixField {...props} />);

      expectMatrixInputToBeEnabled('q1', 'Option 1');
      expectMatrixInputToBeEnabled('q1', 'Option 2');

      expectMatrixInputToBeDisabled('q2', 'Option 1');
      expectMatrixInputToBeDisabled('q2', 'Option 2');
    });

    it('applies highlight colors to question rows', () => {
      const questions = [
        { id: 'q1', label: 'Normal Question', tooltip: '', read_only: false },
        {
          id: 'q2',
          label: 'Highlighted Question',
          tooltip: '',
          read_only: false,
          highlight_color: 'ff0000'
        }
      ];
      const element = createMatrixElement('matrix', {
        questions
      });
      const props = createMatrixProps(element);

      render(<MatrixField {...props} />);

      expectQuestionToHaveHighlightColor('q2', '#ff0000');
    });

    it('sets default values for specific questions', () => {
      const element = createMatrixElement('matrix');
      const props = createMatrixProps(element, {
        fieldVal: { q1: ['Option 2'] } // Default value for q1
      });

      render(<MatrixField {...props} />);

      expectMatrixInputToBeChecked('q1', 'Option 2');
      expectMatrixInputToBeUnchecked('q2', 'Option 1');
      expectMatrixInputToBeUnchecked('q2', 'Option 2');
      expectMatrixInputToBeUnchecked('q2', 'Option 3');
    });
  });
});
