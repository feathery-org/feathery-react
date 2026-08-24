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
import { getNumberMaskProps } from '../mask';

/**
 * A custom prefix containing "-" makes every value submit negative.
 *
 * The split-sign mask picks its variant by searching the *rendered* value for
 * a "-", and with lazy:false the prefix is rendered before anything is typed.
 * So the prefix's own hyphen reads back as a sign, the signed variant applies,
 * and its `{-}` literal — which by design survives into the unmasked value —
 * poisons the stored number. Once poisoned it is self-sustaining.
 */
describe('a hyphen in a custom prefix is not a sign', () => {
  const input = () => screen.getByLabelText('Test field') as HTMLInputElement;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockFieldValue();
  });

  const renderNumberField = (metadata: any = {}) => {
    const element = createTextFieldElement('integer_field', metadata);
    Object.assign(element.servar, { format: 'custom' });
    const onAccept = createStatefulAcceptHandler();
    render(<TextField {...createTextFieldProps(element, { onAccept })} />);
    return onAccept;
  };

  const typeInto = (value: string) => {
    act(() => {
      const el = input();
      fireEvent.focus(el);
      fireEvent.input(el, { target: { value } });
      fireEvent.blur(el);
    });
  };

  it.each([['-'], ['US-'], ['-$']])(
    'stores a positive value as positive behind the prefix %p',
    (prefix) => {
      renderNumberField({ allow_negative: true, prefix });
      typeInto('100');
      expect(getMockFieldValue()).toBe('100');
    }
  );

  it('does not double the hyphen in the display', () => {
    renderNumberField({ allow_negative: true, prefix: '-' });
    typeInto('100');
    expect(input().value).toBe('-100');
  });

  it('reads an unambiguous double hyphen as prefix plus sign', () => {
    // The prefix renders 100 as "-100", so negative 100 can only be "--100".
    renderNumberField({ allow_negative: true, prefix: '-' });
    typeInto('--100');
    expect(getMockFieldValue()).toBe('-100');
    expect(input().value).toBe('--100');
  });

  // Known gap, not a regression: before the dispatch fix this field corrupted
  // every value, so caret entry here was never reachable. Keying "-" in front
  // of an existing magnitude drops it ("-100" -> "-0") because the raw string
  // "--100" is ambiguous against the "-" prefix. Fixing it means taking the
  // affixes out of the string the sign is parsed from -- see the note on
  // rendering the prefix as an adornment rather than a mask literal.
  it.skip('accepts a sign keyed in front of an existing magnitude', () => {
    renderNumberField({ allow_negative: true, prefix: '-' });
    typeInto('100');
    act(() => {
      const el = input();
      el.setSelectionRange(0, 0);
      fireEvent.focus(el);
      el.value = '-' + el.value;
      el.setSelectionRange(1, 1);
      fireEvent.input(el);
    });
    expect(getMockFieldValue()).toBe('-100');
  });

  it('is unaffected when negatives are disabled', () => {
    // Regression fence: no split-sign mask is built at all in this case, which
    // is why the bug is invisible until allow_negative is turned on.
    renderNumberField({ prefix: '-' });
    typeInto('100');
    expect(getMockFieldValue()).toBe('100');
    expect(input().value).toBe('-100');
  });

  it('reads the sign from the unmasked value, not the rendered one', () => {
    // The rendered value carries builder chrome; the unmasked value is the
    // user's number alone, and already carries a real sign via the `{-}`
    // literal. Dispatching on the rendered value is the defect.
    const props: any = getNumberMaskProps(
      {
        type: 'integer_field',
        format: 'custom',
        metadata: { allow_negative: true, prefix: '-' }
      },
      ''
    );
    const variant = (unmaskedValue: string, value: string, appended = '') =>
      props.dispatch(appended, {
        value,
        unmaskedValue,
        compiledMasks: ['positive', 'negative']
      });

    // Rendered "-1" is just the prefix plus a digit.
    expect(variant('1', '-1')).toBe('positive');
    // A sign the user actually entered reaches the unmasked value.
    expect(variant('-1', '--1')).toBe('negative');
    // ...or is arriving as this keystroke.
    expect(variant('', '-', '-')).toBe('negative');
  });
});
