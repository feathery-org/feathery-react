import {
  createStatefulAcceptHandler,
  createTextFieldElement,
  createTextFieldProps,
  getMockFieldValue,
  resetMockFieldValue
} from './test-utils';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import TextField from '../index';

describe('TextField - Email Type', () => {
  const input = () => screen.getByLabelText('Test field') as HTMLInputElement;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockFieldValue();
  });

  describe('Email Field Rendering', () => {
    it('renders email input with correct type', () => {
      const emailElement = createTextFieldElement('email');
      const props = createTextFieldProps(emailElement);

      render(<TextField {...props} />);

      expect(input().getAttribute('type')).toBe('email');
    });
  });

  describe('Email Field Processing', () => {
    it('handles email input', () => {
      const mockOnAccept = createStatefulAcceptHandler();
      const emailElement = createTextFieldElement('email');
      const props = createTextFieldProps(emailElement);

      render(<TextField {...props} onAccept={mockOnAccept} />);

      act(() => {
        const inputElement = input();
        fireEvent.focus(inputElement);
        fireEvent.input(inputElement, {
          target: { value: 'test@example.com' }
        });
        fireEvent.blur(inputElement);
      });

      expect(getMockFieldValue()).toBe('test@example.com');
      expect(mockOnAccept).toHaveBeenCalledWith(
        'test@example.com',
        expect.anything(),
        expect.anything()
      );

      expect(input().value).toBe('test@example.com');
    });

    it('handles email with special characters', () => {
      const mockOnAccept = createStatefulAcceptHandler();
      const emailElement = createTextFieldElement('email');
      const props = createTextFieldProps(emailElement);

      render(<TextField {...props} onAccept={mockOnAccept} />);

      act(() => {
        const inputElement = input();
        fireEvent.focus(inputElement);
        fireEvent.input(inputElement, {
          target: { value: 'user+test@example-domain.com' }
        });
        fireEvent.blur(inputElement);
      });

      expect(getMockFieldValue()).toBe('user+test@example-domain.com');
      expect(mockOnAccept).toHaveBeenCalledWith(
        'user+test@example-domain.com',
        expect.anything(),
        expect.anything()
      );

      expect(input().value).toBe('user+test@example-domain.com');
    });

    it('respects max length constraints', () => {
      const mockOnAccept = createStatefulAcceptHandler();
      const emailElement = createTextFieldElement('email');
      emailElement.servar.max_length = 12;
      const props = createTextFieldProps(emailElement);

      render(<TextField {...props} onAccept={mockOnAccept} />);

      act(() => {
        const inputElement = input();
        fireEvent.focus(inputElement);
        fireEvent.input(inputElement, {
          target: { value: 'very-long-email@example.com' }
        });
        fireEvent.blur(inputElement);
      });

      expect(getMockFieldValue()).toBe('very-long-em');
      expect(mockOnAccept).toHaveBeenCalledWith(
        'very-long-em',
        expect.anything(),
        expect.anything()
      );

      expect(input().value).toBe('very-long-em');
    });
  });
});
