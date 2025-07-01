import './test-utils';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import TextField from '../index';
import {
  createMockElement,
  createDefaultProps,
  createStatefulOnAccept,
  getMockFieldValue,
  resetMockFieldValue
} from './test-utils';

describe('TextField - Integer Type', () => {
  const input = () => screen.getByLabelText('Test field') as HTMLInputElement;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockFieldValue();
  });

  describe('Integer Field Rendering', () => {
    it('renders integer input with decimal input mode', () => {
      const integerElement = createMockElement('integer_field');
      const props = createDefaultProps(integerElement);

      render(<TextField {...props} />);

      expect(input().getAttribute('inputMode')).toBe('decimal');
    });
  });

  describe('Integer Field Number Processing', () => {
    it('handles number input', () => {
      const mockOnAccept = createStatefulOnAccept();
      const integerElement = createMockElement('integer_field');
      const props = createDefaultProps(integerElement);

      render(<TextField {...props} onAccept={mockOnAccept} />);

      act(() => {
        const inputElement = input();
        fireEvent.focus(inputElement);
        fireEvent.input(inputElement, { target: { value: '12345' } });
        fireEvent.blur(inputElement);
      });

      expect(getMockFieldValue()).toBe('12345');
      expect(mockOnAccept).toHaveBeenCalledWith(
        '12345',
        expect.anything(),
        expect.anything()
      );

      expect(input().value).toBe('12,345');
    });

    it('handles decimal separator with user input', () => {
      const mockOnAccept = createStatefulOnAccept();
      const integerElement = createMockElement('integer_field');
      const props = createDefaultProps(integerElement);

      render(<TextField {...props} onAccept={mockOnAccept} />);

      act(() => {
        const inputElement = input();
        fireEvent.focus(inputElement);
        fireEvent.input(inputElement, { target: { value: '1234.56' } });
        fireEvent.blur(inputElement);
      });

      expect(getMockFieldValue()).toBe('1234.56');
      expect(mockOnAccept).toHaveBeenCalledWith(
        '1234.56',
        expect.anything(),
        expect.anything()
      );

      expect(input().value).toBe('1,234.56');
    });

    it('restricts input to numeric characters', () => {
      const mockOnAccept = createStatefulOnAccept();
      const integerElement = createMockElement('integer_field');
      const props = createDefaultProps(integerElement);

      render(<TextField {...props} onAccept={mockOnAccept} />);

      act(() => {
        const inputElement = input();
        fireEvent.focus(inputElement);
        fireEvent.input(inputElement, { target: { value: 'abc123.45def' } });
        fireEvent.blur(inputElement);
      });

      expect(getMockFieldValue()).toBe('123.45');
      expect(mockOnAccept).toHaveBeenCalledWith(
        '123.45',
        expect.anything(),
        expect.anything()
      );

      expect(input().value).toBe('123.45');
    });

    it('handles currency formatting', () => {
      const mockOnAccept = createStatefulOnAccept();
      const integerElement = createMockElement('integer_field');
      integerElement.servar.format = 'currency';
      const props = createDefaultProps(integerElement);

      render(<TextField {...props} onAccept={mockOnAccept} />);

      act(() => {
        const inputElement = input();
        fireEvent.focus(inputElement);
        fireEvent.input(inputElement, { target: { value: '1234.56' } });
        fireEvent.blur(inputElement);
      });

      expect(getMockFieldValue()).toBe('1234.56');
      expect(mockOnAccept).toHaveBeenCalledWith(
        '1234.56',
        expect.anything(),
        expect.anything()
      );

      expect(input().value).toBe('$1,234.56');
    });
  });
});
