import examples from 'libphonenumber-js/examples.mobile.json';
import * as LPN from 'libphonenumber-js';
import { getDefaultPhoneCountry, normalizePhoneNumber } from '../phoneNumber';
import { phoneFixtures, formatPhoneDigits } from './phoneFixtures';

const separators = [' ', '-', '.', '–', '‑', '\u00a0', '\u202f', '/'];
const variants = (national: string, formatted: string, canonical: string) => [
  national,
  formatted,
  canonical,
  `+${canonical}`,
  ...separators.flatMap((separator) => [
    formatPhoneDigits(national, separator),
    formatPhoneDigits(canonical, separator),
    `+${formatPhoneDigits(canonical, separator)}`
  ]),
  ` (${national.slice(0, 3)}) ${national.slice(3)} `
];
const cases = phoneFixtures.flatMap((fixture) =>
  [false, true].flatMap((locked) =>
    variants(fixture.national, fixture.formatted, fixture.canonical).map(
      (value) => [fixture.country, locked, value, fixture.canonical]
    )
  )
);

describe('phone formats × country settings', () => {
  it.each(cases)(
    '%s locked=%s input=%s',
    (country, locked, value, expected) => {
      expect(
        normalizePhoneNumber(
          value,
          { default_country: country, disable_other_countries: locked },
          LPN
        )
      ).toBe(expected);
    }
  );

  it.each(phoneFixtures)(
    'preserves explicit $country numbers under foreign defaults',
    ({ canonical }) => {
      for (const defaultCountry of ['US', 'GB', 'DE', 'IN', 'SG']) {
        for (const locked of [false, true]) {
          expect(
            normalizePhoneNumber(
              `+${canonical}`,
              {
                default_country: defaultCountry,
                disable_other_countries: locked
              },
              LPN
            )
          ).toBe(canonical);
          expect(
            normalizePhoneNumber(
              canonical,
              {
                default_country: defaultCountry,
                disable_other_countries: locked
              },
              LPN,
              true
            )
          ).toBe(canonical);
        }
      }
    }
  );

  it.each([
    ['٠٢٠ ٧٩٤٦ ٠٠١٨', 'GB', '442079460018'],
    ['۰۲۰ ۷۹۴۶ ۰۰۱۸', 'GB', '442079460018'],
    ['＋１（２０２）５５５－０１２３', 'US', '12025550123'],
    ['0044 20 7946 0018', 'GB', '442079460018'],
    ['011 44 20 7946 0018', 'US', '442079460018'],
    ['+44 (0)20 7946 0018', 'US', '442079460018'],
    ['+1\t202\n555\r0123', 'GB', '12025550123']
  ])('accepts dialing/Unicode format %s', (value, defaultCountry, expected) => {
    expect(
      normalizePhoneNumber(value, { default_country: defaultCountry }, LPN)
    ).toBe(expected);
  });

  it.each([
    undefined,
    null,
    '',
    false,
    true,
    {},
    [],
    NaN,
    Infinity,
    -2025550123,
    '123',
    '+2025550123',
    '++12025550123',
    '1+2025550123',
    'call 12025550123',
    '12025550123 ext. 9',
    '12025550123x9',
    'tel:+12025550123;ext=9',
    '12025550123,9',
    '12025550123;9',
    '12025550123#9',
    '12025550123abc',
    '12025550123000000000000'
  ])('preserves invalid/unsupported input %p', (value) => {
    expect(normalizePhoneNumber(value, { default_country: 'US' }, LPN)).toBe(
      value
    );
  });

  it.each(['US', 'us', undefined, '', 'invalid'])(
    'resolves %p default safely',
    (setting) => {
      expect(getDefaultPhoneCountry(setting)).toBe('US');
    }
  );
  it('resolves a lowercase country setting', () => {
    expect(getDefaultPhoneCountry('gb')).toBe('GB');
  });
  it.each([
    ['Europe/London', 'GB'],
    ['America/Toronto', 'CA'],
    ['Asia/Kolkata', 'IN'],
    ['unknown', 'US'],
    ['', 'US']
  ])('auto country for %s', (timeZone, country) => {
    const spy = jest
      .spyOn(Intl, 'DateTimeFormat')
      .mockReturnValue({ resolvedOptions: () => ({ timeZone }) } as any);
    try {
      expect(getDefaultPhoneCountry('auto')).toBe(country);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('each supported country with published example digits', () => {
  // The metadata's example digits are independent of this normalizer. Build
  // expected E.164 digits from calling code + the published national number.
  const cases = LPN.getCountries()
    .filter((country) => examples[country])
    .flatMap((country) => {
      const canonical = LPN.getCountryCallingCode(country) + examples[country];
      return [false, true].flatMap((locked) =>
        [
          `+${canonical}`,
          canonical,
          `+${formatPhoneDigits(canonical, '-')}`
        ].map((input) => [country, locked, input, canonical])
      );
    });
  it.each(cases)(
    '%s locked=%s input=%s',
    (country, locked, input, expected) => {
      expect(
        normalizePhoneNumber(
          input,
          { default_country: country, disable_other_countries: locked },
          LPN
        )
      ).toBe(expected);
    }
  );
});

it.each([
  ['4402079460018', 'GB', '442079460018'],
  ['330612345678', 'FR', '33612345678'],
  ['9109876543210', 'IN', '919876543210']
])(
  'repairs a redundant trunk prefix even on saved values: %s',
  (input, country, expected) => {
    expect(
      normalizePhoneNumber(input, { default_country: country }, LPN, true)
    ).toBe(expected);
  }
);

it.each(['US', 'GB', 'DE', 'IN', 'SG'])(
  'accepts an explicit 00 international prefix with %s default',
  (country) => {
    expect(
      normalizePhoneNumber(
        '00 44 20 7946 0018',
        { default_country: country },
        LPN
      )
    ).toBe('442079460018');
  }
);
