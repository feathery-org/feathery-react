import {
  createTextFieldElement,
  createTextFieldProps,
  createStatefulAcceptHandler,
  getMockFieldValue,
  setMockFieldValue,
  resetMockFieldValue
} from './test-utils';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import TextField from '../index';

describe('TextField - Integer Type', () => {
  const input = () => screen.getByLabelText('Test field') as HTMLInputElement;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockFieldValue();
  });

  describe('Integer Field Rendering', () => {
    it('renders integer input with decimal input mode', () => {
      const integerElement = createTextFieldElement('integer_field');
      const props = createTextFieldProps(integerElement);

      render(<TextField {...props} />);

      expect(input().getAttribute('inputMode')).toBe('decimal');
    });
  });

  describe('Integer Field Number Processing', () => {
    it('handles number input', () => {
      const mockOnAccept = createStatefulAcceptHandler();
      const integerElement = createTextFieldElement('integer_field');
      const props = createTextFieldProps(integerElement);

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
      const mockOnAccept = createStatefulAcceptHandler();
      const integerElement = createTextFieldElement('integer_field');
      const props = createTextFieldProps(integerElement);

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
      const mockOnAccept = createStatefulAcceptHandler();
      const integerElement = createTextFieldElement('integer_field');
      const props = createTextFieldProps(integerElement);

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
      const mockOnAccept = createStatefulAcceptHandler();
      const integerElement = createTextFieldElement('integer_field');
      integerElement.servar.format = 'currency';
      const props = createTextFieldProps(integerElement);

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

  describe('Number Formats', () => {
    // Drives the input one character at a time, as a real user would.
    const typeInto = (value: string) => {
      act(() => {
        const inputElement = input();
        fireEvent.focus(inputElement);
        fireEvent.input(inputElement, { target: { value } });
        fireEvent.blur(inputElement);
      });
    };

    const renderNumberField = (metadata: any = {}, servar: any = {}) => {
      const element = createTextFieldElement('integer_field', metadata);
      Object.assign(element.servar, servar);
      const onAccept = createStatefulAcceptHandler();
      render(<TextField {...createTextFieldProps(element, { onAccept })} />);
      return onAccept;
    };

    it('suffixes a percentage format without changing the stored value', () => {
      renderNumberField({}, { format: 'percentage' });
      typeInto('1234.56');
      expect(input().value).toBe('1,234.56%');
      expect(getMockFieldValue()).toBe('1234.56');
    });

    it('uses the configured currency symbol', () => {
      renderNumberField({ currency: 'EUR' }, { format: 'currency' });
      typeInto('1234.56');
      expect(input().value).toBe('€1,234.56');
      expect(getMockFieldValue()).toBe('1234.56');
    });

    it('renders custom affixes as literals and excludes them from the value', () => {
      renderNumberField(
        { prefix: '~', suffix: ' kg' },
        { format: 'custom' }
      );
      typeInto('1234.5');
      expect(input().value).toBe('~1,234.5 kg');
      expect(getMockFieldValue()).toBe('1234.5');
    });

    it('keeps a mask-special custom suffix out of the stored value', () => {
      // Unescaped, imask treats {} as a fixed group and folds "x" into the
      // unmasked value, submitting "1234.5x" for a numeric field.
      renderNumberField({ suffix: '{x}' }, { format: 'custom' });
      typeInto('1234.5');
      expect(getMockFieldValue()).toBe('1234.5');
    });

    it('omits the thousands separator when disabled', () => {
      renderNumberField({ thousands_separator: false });
      typeInto('1234.56');
      expect(input().value).toBe('1234.56');
      expect(getMockFieldValue()).toBe('1234.56');
    });

    it('pads decimal zeros when enabled without changing the stored value', () => {
      renderNumberField({ pad_decimals: true }, { format: 'currency' });
      typeInto('1234.5');
      expect(input().value).toBe('$1,234.50');
      expect(getMockFieldValue()).toBe('1234.5');
    });

    it('accepts a negative value when allow_negative is set', () => {
      renderNumberField({ allow_negative: true });
      typeInto('-42.5');
      expect(input().value).toBe('-42.5');
      expect(getMockFieldValue()).toBe('-42.5');
    });

    it('strips the sign when allow_negative is absent', () => {
      renderNumberField();
      typeInto('-42.5');
      expect(input().value).toBe('42.5');
      expect(getMockFieldValue()).toBe('42.5');
    });

    it('rounds a stored value to a lowered precision instead of corrupting it', () => {
      // imask drops the radix at scale 0, so without pre-rounding this renders
      // 123,456 and echoes that back through onAccept on mount.
      setMockFieldValue('1234.56');
      const onAccept = renderNumberField({ decimal_places: 0 });
      expect(input().value).toBe('1,235');
      expect(getMockFieldValue()).toBe('1235');
      expect(onAccept).toHaveBeenCalled();
    });

    it('uses a numeric keypad at zero decimal places', () => {
      renderNumberField({ decimal_places: 0 });
      expect(input().getAttribute('inputMode')).toBe('numeric');
    });

    it('keeps a decimal keypad at nonzero decimal places', () => {
      renderNumberField({ decimal_places: 1 });
      expect(input().getAttribute('inputMode')).toBe('decimal');
    });
  });
});
