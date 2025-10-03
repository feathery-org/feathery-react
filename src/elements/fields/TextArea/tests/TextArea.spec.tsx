import {
  createTextAreaElement,
  createTextAreaProps,
  createStatefulTextOnChange,
  getMockFieldValue,
  resetMockFieldValue
} from './test-utils';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import TextArea from '../index';

describe('TextArea - Base Functionality', () => {
  const textarea = () => screen.getByRole('textbox') as HTMLTextAreaElement;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockFieldValue();
  });

  describe('Basic Rendering', () => {
    it('renders TextArea component with default props', () => {
      const element = createTextAreaElement('text_area');
      const props = createTextAreaProps(element);

      render(<TextArea {...props} />);

      expect(screen.getByRole('textbox')).toBeTruthy();
      expect(screen.getByText('Test Label')).toBeTruthy();
      expect(textarea()).toBeInTheDocument();
    });

    it('renders with disabled state', () => {
      const element = createTextAreaElement('text_area');
      const props = createTextAreaProps(element);

      render(<TextArea {...props} disabled />);

      expect(textarea().hasAttribute('disabled')).toBe(true);
    });
  });

  describe('Text Input Processing', () => {
    it('handles basic text input and onChange', () => {
      const mockOnChange = createStatefulTextOnChange();
      const element = createTextAreaElement('text_area');
      const props = createTextAreaProps(element, { onChange: mockOnChange });

      render(<TextArea {...props} />);

      act(() => {
        const textareaElement = textarea();
        fireEvent.focus(textareaElement);
        fireEvent.change(textareaElement, { target: { value: 'Hello World' } });
        fireEvent.blur(textareaElement);
      });

      expect(getMockFieldValue()).toBe('Hello World');
      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.any(HTMLTextAreaElement)
        })
      );
    });
  });

  describe('Length Constraints', () => {
    it('respects min length constraints', () => {
      const element = createTextAreaElement('text_area', { min_length: 5 });
      const props = createTextAreaProps(element);

      render(<TextArea {...props} />);

      expect(textarea().getAttribute('minLength')).toBe('5');
    });

    it('enforces max length during input', () => {
      const mockOnChange = createStatefulTextOnChange();
      const element = createTextAreaElement('text_area', { max_length: 6 });
      const props = createTextAreaProps(element, { onChange: mockOnChange });

      render(<TextArea {...props} />);

      // Try to input text longer than max length
      const longText = 'This is a very long text that exceeds the limit';

      act(() => {
        const textareaElement = textarea();
        fireEvent.focus(textareaElement);
        fireEvent.change(textareaElement, { target: { value: longText } });
        fireEvent.blur(textareaElement);
      });

      expect(textarea().getAttribute('maxLength')).toBe('6');
    });
  });
});
