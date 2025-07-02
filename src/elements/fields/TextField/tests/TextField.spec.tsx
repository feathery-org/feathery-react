import {
  createMockElement,
  createDefaultProps,
  createStatefulOnAccept,
  getMockFieldValue,
  resetMockFieldValue
} from './test-utils';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import TextField from '../index';

describe('TextField - Base Functionality', () => {
  const input = () => screen.getByLabelText('Test field') as HTMLInputElement;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockFieldValue();
  });

  describe('Basic Rendering', () => {
    it('renders TextField component with default props', () => {
      const element = createMockElement('text_field');
      const props = createDefaultProps(element);

      render(<TextField {...props} />);

      expect(screen.getByRole('textbox')).toBeTruthy();
      expect(screen.getByText('Test Label')).toBeTruthy();
    });

    it('renders with disabled state', () => {
      const element = createMockElement('text_field');
      const props = createDefaultProps(element);

      render(<TextField {...props} disabled />);

      expect(input().hasAttribute('disabled')).toBe(true);
    });
  });

  describe('Text Field Processing', () => {
    it('handles basic text input', () => {
      const mockOnAccept = createStatefulOnAccept();
      const element = createMockElement('text_field');
      const props = createDefaultProps(element);

      render(<TextField {...props} onAccept={mockOnAccept} />);

      act(() => {
        const inputElement = input();
        fireEvent.focus(inputElement);
        fireEvent.input(inputElement, { target: { value: 'Hello World' } });
        fireEvent.blur(inputElement);
      });

      expect(getMockFieldValue()).toBe('Hello World');
      expect(mockOnAccept).toHaveBeenCalledWith(
        'Hello World',
        expect.anything(),
        expect.anything()
      );

      expect(input().value).toBe('Hello World');
    });

    it('handles constrained text input - letters only', () => {
      const mockOnAccept = createStatefulOnAccept();
      const element = createMockElement('text_field', {
        allowed_characters: 'letters'
      });
      const props = createDefaultProps(element);

      render(<TextField {...props} onAccept={mockOnAccept} />);

      act(() => {
        const inputElement = input();
        fireEvent.focus(inputElement);
        fireEvent.input(inputElement, { target: { value: 'Hello123World' } });
        fireEvent.blur(inputElement);
      });

      expect(getMockFieldValue()).toBe('HelloWorld');
      expect(mockOnAccept).toHaveBeenCalledWith(
        'HelloWorld',
        expect.anything(),
        expect.anything()
      );

      expect(input().value).toBe('HelloWorld');
    });

    it('handles constrained text input - digits only', () => {
      const mockOnAccept = createStatefulOnAccept();
      const element = createMockElement('text_field', {
        allowed_characters: 'digits'
      });
      const props = createDefaultProps(element);

      render(<TextField {...props} onAccept={mockOnAccept} />);

      act(() => {
        const inputElement = input();
        fireEvent.focus(inputElement);
        fireEvent.input(inputElement, { target: { value: 'abc123def456' } });
        fireEvent.blur(inputElement);
      });

      expect(getMockFieldValue()).toBe('123456');
      expect(mockOnAccept).toHaveBeenCalledWith(
        '123456',
        expect.anything(),
        expect.anything()
      );

      expect(input().value).toBe('123456');
      expect(input().getAttribute('inputMode')).toBe('numeric');
    });

    it('handles prefix and suffix', () => {
      const mockOnAccept = createStatefulOnAccept();
      const element = createMockElement('text_field', {
        prefix: 'Mr. ',
        suffix: ' Jr.'
      });
      const props = createDefaultProps(element);

      render(<TextField {...props} onAccept={mockOnAccept} />);

      act(() => {
        const inputElement = input();
        fireEvent.focus(inputElement);
        fireEvent.input(inputElement, { target: { value: 'John' } });
        fireEvent.blur(inputElement);
      });

      expect(getMockFieldValue()).toBe('John');
      expect(mockOnAccept).toHaveBeenCalledWith(
        'John',
        expect.anything(),
        expect.anything()
      );

      expect(input().value).toBe('Mr. John Jr.');
    });
  });
});
