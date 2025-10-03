import {
  createTextFieldElement,
  createTextFieldProps,
  createStatefulAcceptHandler,
  getMockFieldValue,
  resetMockFieldValue
} from './test-utils';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import TextField from '../index';

import { debug } from 'jest-preview';

describe('TextField - SSN Type', () => {
  const toggleButton = () => screen.getByLabelText('Toggle SSN visibility');
  const input = () => screen.getByLabelText('Test field') as HTMLInputElement;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockFieldValue();
  });

  describe('SSN Field Rendering', () => {
    it('renders SSN input with numeric input mode', () => {
      const ssnElement = createTextFieldElement('ssn');
      const props = createTextFieldProps(ssnElement);

      render(<TextField {...props} />);

      expect(input().getAttribute('inputMode')).toBe('numeric');
    });
  });

  describe('SSN Field Processing', () => {
    it('handles SSN input with formatting', () => {
      const mockOnAccept = createStatefulAcceptHandler();
      const ssnElement = createTextFieldElement('ssn');
      const props = createTextFieldProps(ssnElement);

      const { rerender } = render(
        <TextField {...props} onAccept={mockOnAccept} />
      );

      act(() => {
        const inputElement = input();
        fireEvent.focus(inputElement);
        fireEvent.input(inputElement, { target: { value: '123456789' } });
        fireEvent.blur(inputElement);
      });

      debug();
      expect(getMockFieldValue()).toBe('123456789');
      expect(mockOnAccept).toHaveBeenCalledWith(
        '123456789',
        expect.anything(),
        expect.anything()
      );

      rerender(<TextField key='a' {...props} onAccept={mockOnAccept} />);

      expect(input().value).toBe('∗∗∗ - ∗∗ - ∗∗∗∗');
      act(() => {
        fireEvent.click(toggleButton());
      });
      expect(input().value).toBe('123 - 45 - 6789');
    });

    it('restricts input to numeric characters', () => {
      const mockOnAccept = createStatefulAcceptHandler();
      const ssnElement = createTextFieldElement('ssn');
      const props = createTextFieldProps(ssnElement);

      const { rerender } = render(
        <TextField {...props} onAccept={mockOnAccept} />
      );

      act(() => {
        const inputElement = input();
        fireEvent.focus(inputElement);
        fireEvent.input(inputElement, {
          target: { value: 'abc123def456ghi789' }
        });
        fireEvent.blur(inputElement);
      });

      expect(getMockFieldValue()).toBe('123456789');
      expect(mockOnAccept).toHaveBeenCalledWith(
        '123456789',
        expect.anything(),
        expect.anything()
      );

      rerender(<TextField key='a' {...props} onAccept={mockOnAccept} />);

      expect(input().value).toBe('∗∗∗ - ∗∗ - ∗∗∗∗');
      act(() => {
        fireEvent.click(toggleButton());
      });
      expect(input().value).toBe('123 - 45 - 6789');
    });

    it('handles last four digits configuration', () => {
      const mockOnAccept = createStatefulAcceptHandler();
      const ssnElement = createTextFieldElement('ssn', {
        last_four_digits: true
      });
      const props = createTextFieldProps(ssnElement);

      const { rerender } = render(
        <TextField {...props} onAccept={mockOnAccept} />
      );

      act(() => {
        const inputElement = input();
        fireEvent.focus(inputElement);
        fireEvent.input(inputElement, { target: { value: '6789' } });
        fireEvent.blur(inputElement);
      });

      expect(getMockFieldValue()).toBe('6789');
      expect(mockOnAccept).toHaveBeenCalledWith(
        '6789',
        expect.anything(),
        expect.anything()
      );

      rerender(<TextField key='a' {...props} onAccept={mockOnAccept} />);

      expect(input().value).toBe('∗∗∗ - ∗∗ - ∗∗∗∗');
      act(() => {
        const showButton = screen.getByLabelText('Toggle SSN visibility');
        fireEvent.click(showButton);
      });
      expect(input().value).toBe('∗∗∗ - ∗∗ - 6789');
    });
  });
});
