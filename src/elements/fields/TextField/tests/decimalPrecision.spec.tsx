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

/**
 * Decimal-entry precision for number fields.
 *
 * Contract under test: entering a value with more decimal places than the
 * field is configured for must never change its magnitude. The committed value
 * is the input rounded half-away-from-zero to `decimal_places`, which is what
 * roundToDecimalPlaces already does for values arriving from storage — so the
 * entry path and the mount path agree.
 */
type Case = {
  id: string;
  group: string;
  desc: string;
  meta?: any;
  servar?: any;
  stored?: string;
  action: 'paste' | 'keys' | 'mount';
  input: string;
  display: string;
  value: string;
};

const S0 = { decimal_places: 0 };
const S1 = { decimal_places: 1 };
const S2 = { decimal_places: 2 };
const NEG = { allow_negative: true };

const CASES: Case[] = [
  // ---- Normal paths: whole numbers, every configured precision ----
  { id: 'N-01', group: 'Normal', desc: 'whole number at 0 dp', meta: S0, action: 'keys', input: '42', display: '42', value: '42' },
  { id: 'N-02', group: 'Normal', desc: 'whole number at 1 dp', meta: S1, action: 'keys', input: '42', display: '42', value: '42' },
  { id: 'N-03', group: 'Normal', desc: 'whole number at 2 dp (default)', meta: S2, action: 'keys', input: '42', display: '42', value: '42' },
  { id: 'N-04', group: 'Normal', desc: 'in-precision decimal at 1 dp', meta: S1, action: 'keys', input: '42.5', display: '42.5', value: '42.5' },
  { id: 'N-05', group: 'Normal', desc: 'in-precision decimal at 2 dp', meta: S2, action: 'keys', input: '42.56', display: '42.56', value: '42.56' },
  { id: 'N-06', group: 'Normal', desc: 'thousands grouping at 0 dp', meta: S0, action: 'keys', input: '1234', display: '1,234', value: '1234' },
  { id: 'N-07', group: 'Normal', desc: 'negative whole at 0 dp', meta: { ...S0, ...NEG }, action: 'keys', input: '-42', display: '-42', value: '-42' },

  // ---- The defect: decimals typed into a 0 dp field ----
  { id: 'B-01', group: 'Bug#1', desc: 'one decimal digit, keystrokes', meta: S0, action: 'keys', input: '12.5', display: '13', value: '13' },
  { id: 'B-02', group: 'Bug#1', desc: 'one decimal digit, pasted', meta: S0, action: 'paste', input: '12.5', display: '13', value: '13' },
  { id: 'B-03', group: 'Bug#1', desc: 'two decimal digits, keystrokes', meta: S0, action: 'keys', input: '1234.56', display: '1,235', value: '1235' },
  { id: 'B-04', group: 'Bug#1', desc: 'two decimal digits, pasted', meta: S0, action: 'paste', input: '1234.56', display: '1,235', value: '1235' },
  { id: 'B-05', group: 'Bug#1', desc: 'rounds down below the half', meta: S0, action: 'keys', input: '12.4', display: '12', value: '12' },
  { id: 'B-06', group: 'Bug#1', desc: 'rounds up above the half', meta: S0, action: 'keys', input: '12.6', display: '13', value: '13' },
  { id: 'B-07', group: 'Bug#1', desc: 'sub-unit rounds to zero', meta: S0, action: 'keys', input: '0.4', display: '0', value: '0' },
  { id: 'B-08', group: 'Bug#1', desc: 'negative decimal, keystrokes', meta: { ...S0, ...NEG }, action: 'keys', input: '-12.5', display: '-13', value: '-13' },
  { id: 'B-09', group: 'Bug#1', desc: 'negative decimal, pasted', meta: { ...S0, ...NEG }, action: 'paste', input: '-0.4', display: '0', value: '0' },
  // Fields that already accept decimals are untouched by this change, and they
  // truncate at the mask's precision rather than rounding. Recorded so the
  // difference from the 0 dp path is deliberate and visible, not discovered
  // later; making these round means widening their entry scale too, which
  // collides with pad_decimals. Tracked separately.
  { id: 'B-10', group: 'Bug#1', desc: 'excess precision at 1 dp truncates (pre-existing)', meta: S1, action: 'keys', input: '1.25', display: '1.2', value: '1.2' },
  { id: 'B-11', group: 'Bug#1', desc: 'excess precision at 2 dp truncates (pre-existing)', meta: S2, action: 'keys', input: '1.239', display: '1.23', value: '1.23' },

  // ---- Boundary values ----
  { id: 'V-01', group: 'Boundary', desc: 'exact half rounds away from zero', meta: S0, action: 'keys', input: '0.5', display: '1', value: '1' },
  { id: 'V-02', group: 'Boundary', desc: 'negative exact half', meta: { ...S0, ...NEG }, action: 'keys', input: '-0.5', display: '-1', value: '-1' },
  { id: 'V-03', group: 'Boundary', desc: 'carries into a new digit', meta: S0, action: 'keys', input: '99.99', display: '100', value: '100' },
  { id: 'V-04', group: 'Boundary', desc: 'negative carry', meta: { ...S0, ...NEG }, action: 'keys', input: '-99.99', display: '-100', value: '-100' },
  { id: 'V-05', group: 'Boundary', desc: 'zero at 0 dp', meta: S0, action: 'keys', input: '0', display: '0', value: '0' },
  { id: 'V-06', group: 'Boundary', desc: 'max_length ceiling still enforced', meta: S0, servar: { max_length: 100 }, action: 'keys', input: '150', display: '15', value: '15' },
  { id: 'V-07', group: 'Boundary', desc: 'rounding up to max_length is allowed', meta: S0, servar: { max_length: 100 }, action: 'paste', input: '99.7', display: '100', value: '100' },
  { id: 'V-08', group: 'Boundary', desc: 'rounding may not breach max_length', meta: S0, servar: { max_length: 99 }, action: 'paste', input: '99.7', display: '99', value: '99' },
  { id: 'V-09', group: 'Boundary', desc: 'rounding may not breach a negative min', meta: { ...S0, ...NEG }, servar: { min_length: -99 }, action: 'paste', input: '-99.7', display: '-99', value: '-99' },

  // ---- Edge cases ----
  { id: 'E-01', group: 'Edge', desc: 'trailing radix only', meta: S0, action: 'keys', input: '12.', display: '12', value: '12' },
  { id: 'E-02', group: 'Edge', desc: 'leading radix', meta: S0, action: 'keys', input: '.5', display: '1', value: '1' },
  { id: 'E-03', group: 'Edge', desc: 'second radix ignored', meta: S0, action: 'keys', input: '1.2.3', display: '1', value: '1' },
  { id: 'E-04', group: 'Edge', desc: 'grouped input with decimal', meta: S0, action: 'paste', input: '1,234.5', display: '1,235', value: '1235' },
  { id: 'E-05', group: 'Edge', desc: 'currency format at 0 dp', meta: S0, servar: { format: 'currency' }, action: 'keys', input: '12.5', display: '$13', value: '13' },
  { id: 'E-06', group: 'Edge', desc: 'percentage format at 0 dp', meta: S0, servar: { format: 'percentage' }, action: 'keys', input: '12.5', display: '13%', value: '13' },
  { id: 'E-07', group: 'Edge', desc: 'thousands separator disabled', meta: { ...S0, thousands_separator: false }, action: 'keys', input: '1234.5', display: '1235', value: '1235' },
  { id: 'E-08', group: 'Edge', desc: 'pad_decimals is inert at 0 dp', meta: { ...S0, pad_decimals: true }, action: 'keys', input: '12.5', display: '13', value: '13' },
  { id: 'E-09', group: 'Edge', desc: 'pad_decimals still pads at 2 dp', meta: { ...S2, pad_decimals: true }, action: 'keys', input: '12.5', display: '12.50', value: '12.5' },
  { id: 'E-10', group: 'Edge', desc: 'negative with currency prefix', meta: { ...S0, ...NEG }, servar: { format: 'currency' }, action: 'keys', input: '-12.5', display: '-$13', value: '-13' },

  // ---- Mount path (previously fixed; regression fence) ----
  { id: 'M-01', group: 'Mount', desc: 'stored excess precision rounds, not shifts', meta: S0, stored: '1234.56', action: 'mount', input: '', display: '1,235', value: '1235' },
  { id: 'M-02', group: 'Mount', desc: 'stored in-precision untouched', meta: S2, stored: '1234.56', action: 'mount', input: '', display: '1,234.56', value: '1234.56' },
  { id: 'M-03', group: 'Mount', desc: 'stored negative rounds', meta: { ...S0, ...NEG }, stored: '-12.5', action: 'mount', input: '', display: '-13', value: '-13' },

  // ---- Negative / invalid inputs ----
  { id: 'X-01', group: 'Invalid', desc: 'letters rejected', meta: S0, action: 'keys', input: 'abc', display: '', value: '' },
  { id: 'X-02', group: 'Invalid', desc: 'digits salvaged from mixed input', meta: S0, action: 'keys', input: '1a2', display: '12', value: '12' },
  { id: 'X-03', group: 'Invalid', desc: 'empty input', meta: S0, action: 'paste', input: '', display: '', value: '' },
  // Accepted change: the radix is now a valid character, and imask canonicalises
  // a lone one to 0 on commit. Previously it was rejected outright and left the
  // field empty. Same class as X-05 and belongs with the negative-zero work.
  { id: 'X-04', group: 'Invalid', desc: 'radix alone canonicalises to 0', meta: S0, action: 'keys', input: '.', display: '0', value: '0' },
  // Unchanged from before this fix: imask renders a held sign as "-0". Nothing
  // is stored, which is the part that matters. The display is the parked
  // negative-zero item.
  { id: 'X-05', group: 'Invalid', desc: 'sign alone is held, not stored', meta: { ...S0, ...NEG }, action: 'keys', input: '-', display: '-0', value: '' },
  { id: 'X-06', group: 'Invalid', desc: 'double sign', meta: { ...S0, ...NEG }, action: 'keys', input: '--5', display: '-5', value: '-5' },
  { id: 'X-07', group: 'Invalid', desc: 'sign stripped when negatives off', meta: S0, action: 'keys', input: '-12.5', display: '13', value: '13' },
  { id: 'X-08', group: 'Invalid', desc: 'pasted currency string', meta: S0, action: 'paste', input: '$12.50', display: '13', value: '13' },
  { id: 'X-09', group: 'Invalid', desc: 'whitespace only', meta: S0, action: 'paste', input: '   ', display: '', value: '' },
  { id: 'X-10', group: 'Invalid', desc: 'literal NaN text', meta: S0, action: 'paste', input: 'NaN', display: '', value: '' },
  { id: 'X-11', group: 'Invalid', desc: 'literal Infinity text', meta: S0, action: 'paste', input: 'Infinity', display: '', value: '' },
  { id: 'X-12', group: 'Invalid', desc: 'exponent notation not expanded', meta: S0, action: 'paste', input: '1e3', display: '13', value: '13' }
];

describe('decimal entry precision', () => {
  const input = () => screen.getByLabelText('Test field') as HTMLInputElement;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockFieldValue();
  });

  // TextField is controlled: it reads the field value on every render, and the
  // real Form re-renders it whenever that value changes. Accepting a value
  // without re-rendering would leave the component looking at a stale value, so
  // the harness has to model the re-render or it tests something else entirely.
  const Harness = ({ element }: any) => {
    const [, force] = React.useState(0);
    const onAccept = (val: any) => {
      setMockFieldValue(val);
      force((n) => n + 1);
    };
    return <TextField {...createTextFieldProps(element, { onAccept })} />;
  };

  // With lazy:false a suffix like "%" or " kg" is rendered before anything is
  // typed, and imask parks the caret in front of it on focus. Appending at
  // value.length instead would type past the suffix, where every character is
  // rejected — a field that works in a browser would look completely broken.
  const caret = (shown: string) => {
    const m = shown.match(/[^\d.,-]+$/);
    return m ? shown.length - m[0].length : shown.length;
  };

  const run = (c: Case) => {
    if (c.stored !== undefined) setMockFieldValue(c.stored);
    const element = createTextFieldElement('integer_field', c.meta ?? {});
    Object.assign(element.servar, c.servar ?? {});
    render(<Harness element={element} />);

    if (c.action === 'paste') {
      act(() => {
        const el = input();
        fireEvent.focus(el);
        fireEvent.input(el, { target: { value: c.input } });
      });
    } else if (c.action === 'keys') {
      [...c.input].forEach((ch) => {
        act(() => {
          const el = input();
          fireEvent.focus(el);
          const at = caret(el.value);
          el.value = el.value.slice(0, at) + ch + el.value.slice(at);
          el.setSelectionRange(at + ch.length, at + ch.length);
          fireEvent.input(el);
        });
      });
    }
    // Commit, as leaving the field does. A real focus loss fires both: imask
    // listens for native blur to finalise the value, while React delegates
    // onBlur through the bubbling focusout event. Firing only one tests a
    // browser that does not exist.
    act(() => {
      fireEvent.blur(input());
      fireEvent.focusOut(input());
    });
    return { display: input().value, value: String(getMockFieldValue() ?? '') };
  };

  it.each(CASES.map((c) => [c.id, c] as [string, Case]))('%s', (_id, c) => {
    const got = run(c);
    // eslint-disable-next-line no-console
    console.log(
      `ROW|${c.id}|${c.group}|${c.desc}|${c.action}|${c.input}|${c.display}|${c.value}|${got.display}|${got.value}`
    );
    expect({ display: got.display, value: got.value }).toEqual({
      display: c.display,
      value: c.value
    });
  });
});
