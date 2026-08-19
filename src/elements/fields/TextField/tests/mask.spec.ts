import {
  formatNumberValue,
  getDecimalPlaces,
  getNumberMaskProps,
  roundToDecimalPlaces,
  showsFormatInText
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
      const props = getNumberMaskProps(
        numberServar({ pad_decimals: true }),
        ''
      );
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

    it('leaves the sign inside the block when a min of 0 blocks negatives', () => {
      // Nothing to split out: no negative value is in range, so this stays the
      // single-pattern mask rather than growing an unreachable variant.
      const props = getNumberMaskProps(
        numberServar(
          { allow_negative: true },
          { format: 'currency', min_length: 0 }
        ),
        ''
      );
      expect(props.mask).toBe('$num');
    });
  });

  it('passes max_length through as the mask max', () => {
    const props = getNumberMaskProps(numberServar({}, { max_length: 100 }), '');
    expect(props.blocks.num.max).toBe(100);
  });

  // The sign has to sit in front of a prefix, and imask keeps a number block's
  // own sign inside the block. So a prefixed field that allows negatives gets
  // two patterns and dispatches between them on the sign.
  describe('negative values with a prefix', () => {
    const negativeProps = (metadata: any = {}, servar: any = {}) =>
      getNumberMaskProps(
        numberServar(
          { allow_negative: true, ...metadata },
          { format: 'currency', ...servar }
        ),
        ''
      ) as any;

    // unmaskedValue is what dispatch reads; value is the rendered string and
    // is supplied only to prove it is *not* consulted.
    const dispatched = (props: any, value: string, appended = '') =>
      props.dispatch(appended, {
        value,
        unmaskedValue: value.replace(/[^\d.-]/g, ''),
        compiledMasks: ['positive', 'negative']
      });

    it('offers a signed variant ahead of the currency symbol', () => {
      expect(negativeProps().mask.map((m: any) => m.mask)).toEqual([
        '$num',
        '{-}$num'
      ]);
    });

    it('offers a signed variant ahead of a custom prefix, suffix intact', () => {
      const props = negativeProps(
        { prefix: '~', suffix: ' kg' },
        { format: 'custom' }
      );
      expect(props.mask.map((m: any) => m.mask)).toEqual([
        '~num kg',
        '{-}~num kg'
      ]);
    });

    it.each([
      ['', 'percentage'],
      ['', '']
    ])('stays a single pattern with no prefix (%p, %p)', (_p, format) => {
      // The number block can hold the sign itself here, and already renders it
      // in front: "-1,234.56%".
      const props = getNumberMaskProps(
        numberServar({ allow_negative: true }, { format }),
        ''
      );
      expect(typeof props.mask).toBe('string');
      expect(props.blocks.num.min).toBe(-Number.MAX_SAFE_INTEGER);
    });

    it('keeps the sign out of both number blocks', () => {
      // Each block only ever holds a magnitude, so imask cannot render a
      // second "-" after the symbol.
      negativeProps().mask.forEach((variant: any) =>
        expect(variant.blocks.num.min).toBeGreaterThanOrEqual(0)
      );
    });

    it('carries the sign into the unmasked value', () => {
      // `{}` is what keeps a pattern literal in the unmasked value; without it
      // the stored number would silently lose its sign.
      expect(negativeProps().mask[1].mask.startsWith('{-}')).toBe(true);
      expect(negativeProps().unmask).toBe(true);
    });

    it('sets lazy per variant, since MaskedDynamic does not pass it down', () => {
      negativeProps().mask.forEach((variant: any) =>
        expect(variant.lazy).toBe(false)
      );
    });

    it('maps a negative min to a magnitude ceiling on the signed variant', () => {
      // min -50 means the value can reach -50, so the magnitude can reach 50.
      const props = negativeProps({}, { min_length: -50 });
      expect(props.mask[1].blocks.num.max).toBe(50);
      expect(props.mask[1].blocks.num.min).toBe(0);
    });

    it('maps max_length to the unsigned variant only', () => {
      const props = negativeProps({}, { max_length: 100 });
      expect(props.mask[0].blocks.num.max).toBe(100);
      // A ceiling of 100 constrains no magnitude on the negative side.
      expect(props.mask[1].blocks.num.min).toBe(0);
    });

    it('carries precision and grouping into both variants', () => {
      const props = negativeProps({
        decimal_places: 1,
        pad_decimals: true,
        thousands_separator: false
      });
      props.mask.forEach((variant: any) =>
        expect(variant.blocks.num).toMatchObject({
          scale: 1,
          padFractionalZeros: true,
          thousandsSeparator: ''
        })
      );
    });

    it.each([
      ['', '-', 'negative'],
      ['$1,234', '-', 'negative'],
      ['-$1,234', '', 'negative'],
      ['', '1', 'positive'],
      ['$1,234', '5', 'positive'],
      ['', '', 'positive']
    ])('dispatches %p + %p to the %s pattern', (value, appended, expected) => {
      // Typed anywhere, including after the digits, a "-" selects the signed
      // pattern — which is what moves the sign in front of the symbol.
      expect(dispatched(negativeProps(), value, appended)).toBe(expected);
    });
  });
});

describe('showsFormatInText', () => {
  it('is off when the key is absent, so existing fields are untouched', () => {
    expect(showsFormatInText(numberServar())).toBe(false);
  });

  it('is on only for an explicit true', () => {
    expect(showsFormatInText(numberServar({ show_format_in_text: true }))).toBe(
      true
    );
  });

  it.each([[false], ['true'], [1], [null]])(
    'stays off for a non-boolean %p',
    (value) => {
      expect(
        showsFormatInText(numberServar({ show_format_in_text: value }))
      ).toBe(false);
    }
  );

  it('ignores the flag on a non-number field', () => {
    expect(
      showsFormatInText({
        type: 'text_field',
        metadata: { show_format_in_text: true }
      })
    ).toBe(false);
  });

  it.each([[null], [undefined], [{}]])('tolerates %p', (servar) => {
    expect(showsFormatInText(servar)).toBe(false);
  });
});

describe('formatNumberValue', () => {
  it.each([[''], [null], [undefined]])('maps %p to empty string', (value) => {
    expect(formatNumberValue(numberServar(), value)).toBe('');
  });

  it('passes non-numeric input through instead of rendering NaN', () => {
    expect(formatNumberValue(numberServar(), 'abc')).toBe('abc');
  });

  describe('format', () => {
    it.each([
      [{}, '1,234.56'],
      [{ format: 'currency' }, '$1,234.56'],
      [{ format: 'percentage' }, '1,234.56%'],
      [{ format: 'custom' }, '1,234.56']
    ])('renders %p as %p', (servar, expected) => {
      expect(formatNumberValue(numberServar({}, servar), 1234.56)).toBe(
        expected
      );
    });

    it('uses the configured currency symbol', () => {
      expect(
        formatNumberValue(
          numberServar({ currency: 'EUR' }, { format: 'currency' }),
          1234.56
        )
      ).toBe('€1,234.56');
    });

    it('wraps custom affixes unescaped, since nothing parses this as a mask', () => {
      expect(
        formatNumberValue(
          numberServar({ prefix: '~', suffix: ' {kg}' }, { format: 'custom' }),
          1234.56
        )
      ).toBe('~1,234.56 {kg}');
    });

    describe('negative values', () => {
      // The sign is outermost in every format, matching the input mask.
      it.each([
        [{}, '-1,234.56'],
        [{ format: 'currency' }, '-$1,234.56'],
        [{ format: 'percentage' }, '-1,234.56%'],
        [{ format: 'custom' }, '-1,234.56']
      ])('renders %p as %p', (servar, expected) => {
        expect(formatNumberValue(numberServar({}, servar), -1234.56)).toBe(
          expected
        );
      });

      it('puts the sign before a multi-character currency symbol', () => {
        expect(
          formatNumberValue(
            numberServar({ currency: 'CAD' }, { format: 'currency' }),
            -1234.56
          )
        ).toBe('-CA$1,234.56');
      });

      it('puts the sign before a custom prefix, outside both affixes', () => {
        expect(
          formatNumberValue(
            numberServar({ prefix: '~', suffix: ' kg' }, { format: 'custom' }),
            -1234.56
          )
        ).toBe('-~1,234.56 kg');
      });

      it('keeps the sign outside the symbol when padding decimals', () => {
        expect(
          formatNumberValue(
            numberServar({ pad_decimals: true }, { format: 'currency' }),
            -1234.5
          )
        ).toBe('-$1,234.50');
      });

      it('keeps the sign outside the symbol without a separator', () => {
        expect(
          formatNumberValue(
            numberServar(
              { thousands_separator: false },
              { format: 'currency' }
            ),
            -1234.56
          )
        ).toBe('-$1234.56');
      });

      it.each([
        [-0.004, 2],
        [-0.4, 0]
      ])('drops the sign when %p rounds away at %p places', (value, places) => {
        // The input shows "$0" for these too, since imask commits the rounding
        // before rendering. A bare "-$0" would read as a real negative.
        expect(
          formatNumberValue(
            numberServar({ decimal_places: places }, { format: 'currency' }),
            value
          )
        ).toBe('$0');
      });

      it('keeps the sign when rounding leaves a nonzero digit', () => {
        expect(
          formatNumberValue(
            numberServar({ decimal_places: 2 }, { format: 'currency' }),
            -0.005
          )
        ).toBe('-$0.01');
      });

      it('renders a negative string value the same as a number', () => {
        expect(
          formatNumberValue(
            numberServar({}, { format: 'currency' }),
            '-1234.56'
          )
        ).toBe('-$1,234.56');
      });
    });
  });

  describe('precision', () => {
    it.each([
      [0, '1,235'],
      [1, '1,234.6'],
      [2, '1,234.56']
    ])('rounds to %p decimal places', (places, expected) => {
      expect(
        formatNumberValue(numberServar({ decimal_places: places }), 1234.56)
      ).toBe(expected);
    });

    it('defaults to 2 decimal places when unset', () => {
      expect(formatNumberValue(numberServar(), 1234.567)).toBe('1,234.57');
    });

    it('shows only the digits present when padding is off', () => {
      expect(formatNumberValue(numberServar(), 1234.5)).toBe('1,234.5');
    });

    it('pads to the full precision when pad_decimals is on', () => {
      expect(
        formatNumberValue(numberServar({ pad_decimals: true }), 1234.5)
      ).toBe('1,234.50');
    });

    it('drops the separator when thousands_separator is off', () => {
      expect(
        formatNumberValue(numberServar({ thousands_separator: false }), 1234.56)
      ).toBe('1234.56');
    });
  });
});
