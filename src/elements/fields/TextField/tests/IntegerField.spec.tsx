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
      renderNumberField({ prefix: '~', suffix: ' kg' }, { format: 'custom' });
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

    describe('negative values', () => {
      it('puts the sign in front of the currency symbol', () => {
        renderNumberField({ allow_negative: true }, { format: 'currency' });
        typeInto('-1234.56');
        expect(input().value).toBe('-$1,234.56');
        expect(getMockFieldValue()).toBe('-1234.56');
      });

      it('moves the sign in front when it is typed after the digits', () => {
        renderNumberField({ allow_negative: true }, { format: 'currency' });
        typeInto('1234.56-');
        expect(input().value).toBe('-$1,234.56');
        expect(getMockFieldValue()).toBe('-1234.56');
      });

      it('drops back to the unsigned symbol when the sign is removed', () => {
        renderNumberField({ allow_negative: true }, { format: 'currency' });
        typeInto('-1234.56');
        typeInto('1,234.56');
        expect(input().value).toBe('$1,234.56');
        expect(getMockFieldValue()).toBe('1234.56');
      });

      it('renders a stored negative value with the sign in front on mount', () => {
        // The mask has to resolve the sign from the value alone, not just from
        // keystrokes, or a saved value reads differently than a typed one.
        setMockFieldValue('-1234.56');
        renderNumberField({ allow_negative: true }, { format: 'currency' });
        expect(input().value).toBe('-$1,234.56');
        expect(getMockFieldValue()).toBe('-1234.56');
      });

      it('puts the sign in front of a multi-character symbol', () => {
        renderNumberField(
          { allow_negative: true, currency: 'CAD' },
          { format: 'currency' }
        );
        typeInto('-1234.56');
        expect(input().value).toBe('-CA$1,234.56');
        expect(getMockFieldValue()).toBe('-1234.56');
      });

      it('puts the sign outside a custom prefix and keeps the suffix', () => {
        renderNumberField(
          { allow_negative: true, prefix: '~', suffix: ' kg' },
          { format: 'custom' }
        );
        typeInto('-1234.5');
        expect(input().value).toBe('-~1,234.5 kg');
        expect(getMockFieldValue()).toBe('-1234.5');
      });

      it('keeps the sign ahead of a percentage suffix', () => {
        renderNumberField({ allow_negative: true }, { format: 'percentage' });
        typeInto('-1234.56');
        expect(input().value).toBe('-1,234.56%');
        expect(getMockFieldValue()).toBe('-1234.56');
      });

      it('pads decimals behind a leading sign', () => {
        renderNumberField(
          { allow_negative: true, pad_decimals: true },
          { format: 'currency' }
        );
        typeInto('-1234.5');
        expect(input().value).toBe('-$1,234.50');
        expect(getMockFieldValue()).toBe('-1234.5');
      });

      it('still strips the sign on a currency field that disallows negatives', () => {
        renderNumberField({}, { format: 'currency' });
        typeInto('-1234.56');
        expect(input().value).toBe('$1,234.56');
        expect(getMockFieldValue()).toBe('1234.56');
      });

      it('still enforces a negative min once the sign moves out of the block', () => {
        // The sign lives outside the number block here, so the block has to
        // enforce the bound as a magnitude ceiling — otherwise a field with a
        // min of -50 would happily take -100. imask rejects the digit that
        // would breach it, the same as it does for an unprefixed field.
        renderNumberField(
          { allow_negative: true },
          { format: 'currency', min_length: -50 }
        );
        typeInto('-100');
        expect(getMockFieldValue()).toBe('-10');
        expect(input().value).toBe('-$10');
      });
    });

    // Every test above drives the input by replacing its whole value, which is
    // how a paste behaves. Real typing inserts one character at the caret, and
    // with lazy:false the caret starts *after* the eagerly rendered prefix — so
    // a "-" keystroke lands at position 1, inside the mask. Cover that path.
    describe('sign typed one keystroke at a time', () => {
      const pressKey = (char: string) => {
        act(() => {
          const el = input();
          const start = el.selectionStart ?? el.value.length;
          fireEvent.focus(el);
          el.value = el.value.slice(0, start) + char + el.value.slice(start);
          el.setSelectionRange(start + char.length, start + char.length);
          fireEvent.input(el);
        });
      };
      const typeKeys = (keys: string) => [...keys].forEach(pressKey);
      const caretToEnd = () => {
        const el = input();
        el.setSelectionRange(el.value.length, el.value.length);
      };

      it('accepts "-" keyed with the caret after the eager currency symbol', () => {
        renderNumberField({ allow_negative: true }, { format: 'currency' });
        expect(input().value).toBe('$');
        caretToEnd();
        pressKey('-');
        expect(input().value).toBe('-$');
      });

      it('accepts "-" keyed with the caret before the currency symbol', () => {
        renderNumberField({ allow_negative: true }, { format: 'currency' });
        input().setSelectionRange(0, 0);
        pressKey('-');
        expect(input().value).toBe('-$');
      });

      it('builds up a negative amount key by key', () => {
        renderNumberField({ allow_negative: true }, { format: 'currency' });
        caretToEnd();
        typeKeys('-100');
        expect(input().value).toBe('-$100');
        expect(getMockFieldValue()).toBe('-100');
      });

      it('moves the sign in front when "-" is keyed after the digits', () => {
        renderNumberField({ allow_negative: true }, { format: 'currency' });
        caretToEnd();
        typeKeys('100');
        caretToEnd();
        pressKey('-');
        expect(input().value).toBe('-$100');
      });

      it('shows a leading "-" without storing it, until a digit arrives', () => {
        // parseFloat("-") is NaN and String(-0) is "0", so storing the bare
        // sign would round-trip back into the input and erase the keystroke.
        const onAccept = renderNumberField(
          { allow_negative: true },
          { format: 'currency' }
        );
        caretToEnd();
        pressKey('-');
        expect(input().value).toBe('-$');
        expect(onAccept).not.toHaveBeenCalled();

        caretToEnd();
        pressKey('5');
        expect(input().value).toBe('-$5');
        expect(onAccept).toHaveBeenCalledWith(
          '-5',
          expect.anything(),
          expect.anything()
        );
      });

      it('withholds every sign-only intermediate on the way to -0.5', () => {
        const onAccept = renderNumberField(
          { allow_negative: true },
          { format: 'currency' }
        );
        ['-', '0', '.', '5'].forEach((key) => {
          caretToEnd();
          pressKey(key);
        });
        expect(input().value).toBe('-$0.5');
        // "-", "-0" and "-0." are all sign-without-magnitude; only the
        // complete value is ever stored.
        expect(onAccept.mock.calls.map((call: any[]) => call[0])).toEqual([
          '-0.5'
        ]);
      });

      it('holds the sign on an unprefixed field too', () => {
        // imask reports this intermediate as "-0" rather than "-".
        const onAccept = renderNumberField({ allow_negative: true });
        pressKey('-');
        expect(input().value).toBe('-');
        expect(onAccept).not.toHaveBeenCalled();
      });

      it('clears an existing value rather than hiding it behind a bare sign', () => {
        // Backspacing the last digit of -5 leaves "-". Withholding that would
        // leave -5 in form state while the input looks empty, so commit the
        // clear instead.
        setMockFieldValue('-5');
        const onAccept = renderNumberField(
          { allow_negative: true },
          { format: 'currency' }
        );
        expect(input().value).toBe('-$5');
        caretToEnd();
        act(() => {
          const el = input();
          const start = el.selectionStart ?? el.value.length;
          fireEvent.focus(el);
          el.value = el.value.slice(0, start - 1) + el.value.slice(start);
          el.setSelectionRange(start - 1, start - 1);
          fireEvent.input(el);
        });
        expect(getMockFieldValue()).toBe('');
      });

      it('drops a keyed "-" when negatives are off', () => {
        renderNumberField({}, { format: 'currency' });
        caretToEnd();
        typeKeys('-100');
        expect(input().value).toBe('$100');
      });
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
