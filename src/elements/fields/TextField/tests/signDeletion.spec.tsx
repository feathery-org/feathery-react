import {
  createTextFieldElement,
  createTextFieldProps,
  getMockFieldValue,
  setMockFieldValue,
  resetMockFieldValue
} from './test-utils';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import TextField from '../index';

/**
 * Deleting backwards through a negative number blanked the field.
 *
 * "-0.1" backspaced to "-0", which carries a sign but no magnitude to store.
 * The stored value is rightly cleared there — a stale number must not survive
 * hidden behind a bare sign — but this input is controlled, so pushing the
 * emptied value back down erased the sign too and the field jumped straight to
 * empty. The sign is held in the input instead, so deletion steps down one
 * character at a time the way it already did for a positive value.
 */
describe('deleting backwards through a bare sign', () => {
  const input = () => screen.getByLabelText('Test field') as HTMLInputElement;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockFieldValue();
  });

  // The real Form re-renders TextField whenever the field value changes, and
  // that re-render is what used to wipe the sign — a harness that only records
  // the accepted value would not see this bug at all.
  const Harness = ({ element }: any) => {
    const [, force] = React.useState(0);
    const onAccept = (val: any) => {
      setMockFieldValue(val);
      force((n) => n + 1);
    };
    return <TextField {...createTextFieldProps(element, { onAccept })} />;
  };

  const setup = (meta: any, servar: any, stored: string) => {
    setMockFieldValue(stored);
    const element = createTextFieldElement('integer_field', meta);
    Object.assign(element.servar, servar);
    render(<Harness element={element} />);
  };

  // Backspace over the last editable character. With lazy:false a suffix is
  // already rendered, and imask parks the caret in front of it, so the deletion
  // has to happen there rather than at the end of the string.
  const backspace = () =>
    act(() => {
      const el = input();
      fireEvent.focus(el);
      const at = el.value.replace(/[^\d.,-]+$/, '').length;
      el.value = el.value.slice(0, at - 1) + el.value.slice(at);
      el.setSelectionRange(at - 1, at - 1);
      fireEvent.input(el);
    });

  const NEG = { decimal_places: 1, allow_negative: true };

  it.each([
    ['plain', {}, ['-0.', '-0', '-', '']],
    ['currency prefix', { format: 'currency' }, ['-$0.', '-$0', '-$', '$']],
    ['percentage suffix', { format: 'percentage' }, ['-0.%', '-0%', '-%', '%']]
  ])('%s: -0.1 steps down one character per keystroke', (_n, servar, steps) => {
    setup(NEG, servar, '-0.1');
    steps.forEach((expected) => {
      backspace();
      expect(input().value).toBe(expected);
    });
  });

  // The shape above is only correct because it matches what an unsigned value
  // already did. Pinned here so the two paths can't drift apart again.
  it('mirrors how a positive value deletes', () => {
    setup({ decimal_places: 1 }, {}, '0.1');
    ['0.', '0', ''].forEach((expected) => {
      backspace();
      expect(input().value).toBe(expected);
    });
  });

  it('stores nothing while only a sign is left', () => {
    setup(NEG, {}, '-0.1');
    backspace();
    expect(getMockFieldValue()).toBe('');
  });

  it('stores the next magnitude typed onto a held sign', () => {
    setup(NEG, {}, '-0.1');
    backspace();
    act(() => {
      const el = input();
      el.value = '-0.4';
      el.setSelectionRange(4, 4);
      fireEvent.input(el);
    });
    expect(getMockFieldValue()).toBe('-0.4');
  });

  // Same guard from the other direction: replacing a value with a bare sign
  // must not leave the old number stored behind the sign.
  it('clears the old value when a selection is replaced by a sign', () => {
    setup({ decimal_places: 0, allow_negative: true }, {}, '123');
    act(() => {
      const el = input();
      fireEvent.focus(el);
      fireEvent.input(el, { target: { value: '-' } });
    });
    expect(getMockFieldValue()).toBe('');
    expect(input().value).toBe('-');
  });
});
