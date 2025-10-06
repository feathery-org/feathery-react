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

describe('TextField - URL Type', () => {
  const input = () => screen.getByLabelText('Test field') as HTMLInputElement;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockFieldValue();
  });

  describe('URL Field Rendering', () => {
    it('renders URL input with default max length', () => {
      const urlElement = createTextFieldElement('url');
      const props = createTextFieldProps(urlElement);

      render(<TextField {...props} />);

      expect(input().getAttribute('maxLength')).toBe('256');
    });
  });

  describe('URL Field Processing', () => {
    it('handles URL input', () => {
      const mockOnAccept = createStatefulAcceptHandler();
      const urlElement = createTextFieldElement('url');
      const props = createTextFieldProps(urlElement);

      render(<TextField {...props} onAccept={mockOnAccept} />);

      act(() => {
        const inputElement = input();
        fireEvent.focus(inputElement);
        fireEvent.input(inputElement, {
          target: { value: 'https://example.com' }
        });
        fireEvent.blur(inputElement);
      });

      expect(getMockFieldValue()).toBe('https://example.com');
      expect(mockOnAccept).toHaveBeenCalledWith(
        'https://example.com',
        expect.anything(),
        expect.anything()
      );

      expect(input().value).toBe('https://example.com');
    });

    it('respects max length constraints', () => {
      const mockOnAccept = createStatefulAcceptHandler();
      const urlElement = createTextFieldElement('url');
      urlElement.servar.max_length = 12;
      const props = createTextFieldProps(urlElement);

      render(<TextField {...props} onAccept={mockOnAccept} />);

      act(() => {
        const inputElement = input();
        fireEvent.focus(inputElement);
        fireEvent.input(inputElement, {
          target: { value: 'https://very-long-url-that-exceeds-limit.com' }
        });
        fireEvent.blur(inputElement);
      });

      expect(getMockFieldValue()).toBe('https://very');
      expect(mockOnAccept).toHaveBeenCalledWith(
        'https://very',
        expect.anything(),
        expect.anything()
      );

      expect(input().value).toBe('https://very');
    });

    it('accepts URL input without http/https protocol', () => {
      const mockOnAccept = createStatefulAcceptHandler();
      const urlElement = createTextFieldElement('url');
      const props = createTextFieldProps(urlElement);

      render(<TextField {...props} onAccept={mockOnAccept} />);

      act(() => {
        const inputElement = input();
        fireEvent.focus(inputElement);
        fireEvent.input(inputElement, {
          target: { value: 'www.example.com' }
        });
        fireEvent.blur(inputElement);
      });

      expect(getMockFieldValue()).toBe('www.example.com');
      expect(mockOnAccept).toHaveBeenCalledWith(
        'www.example.com',
        expect.anything(),
        expect.anything()
      );

      expect(input().value).toBe('www.example.com');
    });

    it('accepts URL input without http/https protocol and without subdomain', () => {
      const mockOnAccept = createStatefulAcceptHandler();
      const urlElement = createTextFieldElement('url');
      const props = createTextFieldProps(urlElement);

      render(<TextField {...props} onAccept={mockOnAccept} />);

      act(() => {
        const inputElement = input();
        fireEvent.focus(inputElement);
        fireEvent.input(inputElement, {
          target: { value: 'example.com' }
        });
        fireEvent.blur(inputElement);
      });

      expect(getMockFieldValue()).toBe('example.com');
      expect(mockOnAccept).toHaveBeenCalledWith(
        'example.com',
        expect.anything(),
        expect.anything()
      );

      expect(input().value).toBe('example.com');
    });
  });
});
