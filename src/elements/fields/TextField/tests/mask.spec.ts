import {
  getDecimalPlaces,
  getNumberMaskProps,
  roundToDecimalPlaces
} from '../mask';

const numberServar = (metadata: any = {}, servar: any = {}) => ({
  type: 'integer_field',
  format: '',
  metadata,
  ...servar
});

describe('getDecimalPlaces', () => {
  it('defaults to 2 when decimal_places is absent', () => {
    // Backward-compat contract: fields saved before this option shipped have {}
    expect(getDecimalPlaces(numberServar())).toBe(2);
  });

  it.each([
    [0, 0],
    [1, 1],
    [2, 2],
    ['0', 0],
    ['1', 1]
  ])('honors a valid value %p', (input, expected) => {
    expect(getDecimalPlaces(numberServar({ decimal_places: input }))).toBe(
      expected
    );
  });

  it.each([[3], [-1], [null], [undefined], [''], [' '], ['abc'], [{}]])(
    'falls back to 2 for invalid value %p',
    (input) => {
      expect(getDecimalPlaces(numberServar({ decimal_places: input }))).toBe(2);
    }
  );
});

describe('roundToDecimalPlaces', () => {
  it.each([
    ['1234.56', 0, '1235'],
    ['1234.56', 1, '1234.6'],
    ['1234.56', 2, '1234.56'],
    ['1234.5', 2, '1234.5'],
    [1234.56, 0, '1235'],
    ['-42.66', 1, '-42.7'],
    ['-42.66', 0, '-43']
  ])('rounds %p at scale %p to %p', (value, scale, expected) => {
    expect(roundToDecimalPlaces(value, scale)).toBe(expected);
  });

  it.each([[''], [null], [undefined]])('maps %p to empty string', (value) => {
    expect(roundToDecimalPlaces(value, 2)).toBe('');
  });

  it('leaves non-numeric input untouched', () => {
    expect(roundToDecimalPlaces('abc', 2)).toBe('abc');
  });
});

describe('getNumberMaskProps', () => {
  it('reproduces the pre-existing mask for empty metadata', () => {
    // The backward-compat contract. Any change here changes how every number
    // field already in production renders.
    const props = getNumberMaskProps(numberServar(), '1234.56');
    expect(props.mask).toBe('num');
    expect(props.unmask).toBe(true);
    expect(props.value).toBe('1234.56');
    expect(props.blocks.num).toMatchObject({
      radix: '.',
      thousandsSeparator: ',',
      scale: 2,
      padFractionalZeros: false,
      min: 0,
      max: Number.MAX_SAFE_INTEGER
    });
  });

  describe('format', () => {
    it('defaults currency to a dollar prefix', () => {
      const props = getNumberMaskProps(
        numberServar({}, { format: 'currency' }),
        ''
      );
      expect(props.mask).toBe('$num');
    });

    it.each([
      ['EUR', '€num'],
      ['GBP', '£num'],
      ['JPY', '¥num'],
      ['CAD', 'CA$num'],
      // Intl separates CHF from the amount with a non-breaking space
      ['CHF', 'CHF\u00A0num'],
      ['BRL', 'R$num']
    ])('renders %s as %p', (currency, expected) => {
      const props = getNumberMaskProps(
        numberServar({ currency }, { format: 'currency' }),
        ''
      );
      expect(props.mask).toBe(expected);
    });

    it('falls back to a dollar prefix for a malformed currency code', () => {
      const props = getNumberMaskProps(
        numberServar({ currency: 'XX1' }, { format: 'currency' }),
        ''
      );
      expect(props.mask).toBe('$num');
    });

    it('suffixes percentage', () => {
      const props = getNumberMaskProps(
        numberServar({}, { format: 'percentage' }),
        ''
      );
      expect(props.mask).toBe('num%');
    });

    it('wraps custom affixes around the number block', () => {
      const props = getNumberMaskProps(
        numberServar({ prefix: '~', suffix: ' kg' }, { format: 'custom' }),
        ''
      );
      expect(props.mask).toBe('~num kg');
    });

    it('degrades to a plain number when custom affixes are empty', () => {
      const props = getNumberMaskProps(
        numberServar({ prefix: '', suffix: '' }, { format: 'custom' }),
        ''
      );
      expect(props.mask).toBe('num');
    });

    it.each([
      // Unescaped `{}` would pull its contents into the *submitted* value, and
      // `[]` would be swallowed as an optional-group marker.
      ['{x}', 'num\\{x\\}'],
      ['[kg]', 'num\\[kg\\]'],
      ['ab0c', 'num\\a\\b\\0\\c'],
      ['\\', 'num\\\\'],
      // Characters with no special meaning pass through untouched.
      ['m2', 'num' + 'm2'],
      [' GB', 'num GB']
    ])('escapes a custom suffix of %p', (suffix, expected) => {
      const props = getNumberMaskProps(
        numberServar({ suffix }, { format: 'custom' }),
        ''
      );
      expect(props.mask).toBe(expected);
    });
  });

  describe('decimal_places', () => {
    it.each([
      [0, 0],
      [1, 1],
      [2, 2]
    ])('sets scale to %p', (decimal_places, expected) => {
      const props = getNumberMaskProps(numberServar({ decimal_places }), '');
      expect(props.blocks.num.scale).toBe(expected);
    });

    it('rounds the incoming value to the configured scale', () => {
      // Without this, imask drops the radix at scale 0 and rewrites 1234.56 as
      // 123456, then echoes the corruption back through onAccept on mount.
      const props = getNumberMaskProps(
        numberServar({ decimal_places: 0 }),
        '1234.56'
      );
      expect(props.value).toBe('1235');
    });
  });

  describe('thousands_separator', () => {
    it('drops the separator when disabled', () => {
      const props = getNumberMaskProps(
        numberServar({ thousands_separator: false }),
        ''
      );
      expect(props.blocks.num.thousandsSeparator).toBe('');
    });

    it.each([[true], [undefined]])('keeps a comma when %p', (value) => {
      const props = getNumberMaskProps(
        numberServar({ thousands_separator: value }),
        ''
      );
      expect(props.blocks.num.thousandsSeparator).toBe(',');
    });
  });

  describe('pad_decimals', () => {
    it('pads when enabled', () => {
      const props = getNumberMaskProps(numberServar({ pad_decimals: true }), '');
      expect(props.blocks.num.padFractionalZeros).toBe(true);
    });

    it.each([[false], [undefined]])('does not pad when %p', (value) => {
      const props = getNumberMaskProps(
        numberServar({ pad_decimals: value }),
        ''
      );
      expect(props.blocks.num.padFractionalZeros).toBe(false);
    });
  });

  describe('allow_negative', () => {
    it('opens the floor when enabled with no configured min', () => {
      const props = getNumberMaskProps(
        numberServar({ allow_negative: true }),
        ''
      );
      expect(props.blocks.num.min).toBe(-Number.MAX_SAFE_INTEGER);
    });

    it('honors a negative configured min when enabled', () => {
      const props = getNumberMaskProps(
        numberServar({ allow_negative: true }, { min_length: -50 }),
        ''
      );
      expect(props.blocks.num.min).toBe(-50);
    });

    it('honors a configured min of 0 when enabled', () => {
      // `??` not `||`, so an explicit 0 is not treated as unset
      const props = getNumberMaskProps(
        numberServar({ allow_negative: true }, { min_length: 0 }),
        ''
      );
      expect(props.blocks.num.min).toBe(0);
    });

    it('clamps a legacy negative min to 0 when disabled', () => {
      const props = getNumberMaskProps(
        numberServar({}, { min_length: -50 }),
        ''
      );
      expect(props.blocks.num.min).toBe(0);
    });
  });

  it('passes max_length through as the mask max', () => {
    const props = getNumberMaskProps(numberServar({}, { max_length: 100 }), '');
    expect(props.blocks.num.max).toBe(100);
  });
});
