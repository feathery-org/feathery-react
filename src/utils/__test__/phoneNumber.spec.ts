import * as LPN from 'libphonenumber-js';
import { normalizePhoneNumber, getDefaultPhoneCountry } from '../phoneNumber';

describe('normalizePhoneNumber', () => {
  it.each([
    ['+1 (202) 555-0123', {}, '12025550123'],
    ['1.202.555.0123', {}, '12025550123'],
    ['(202) 555-0123', {}, '12025550123'],
    ['020 7946 0018', { default_country: 'GB' }, '442079460018'],
    ['44 20 7946 0018', { default_country: 'US' }, '442079460018'],
    [
      '020 7946 0018',
      { default_country: 'GB', disable_other_countries: true },
      '442079460018'
    ],
    [
      '+1 202 555 0123',
      { default_country: 'GB', disable_other_countries: true },
      '12025550123'
    ],
    ['06 12 34 56 78', { default_country: 'FR' }, '33612345678'],
    ['12025550123', {}, '12025550123'],
    ['(661) 234-5678', {}, '16612345678'],
    ['6612345678', {}, '16612345678'],
    [
      '15123456789',
      { default_country: 'DE', disable_other_countries: true },
      '4915123456789'
    ],
    [2025550123, {}, '12025550123'],
    ['', {}, ''],
    [null, {}, null],
    ['+2025550123', {}, '+2025550123'],
    ['123', {}, '123'],
    ['call 2025550123', {}, 'call 2025550123'],
    ['2025550123 ext 12', {}, '2025550123 ext 12']
  ])('normalizes %p with %p', (value, metadata, expected) => {
    expect(normalizePhoneNumber(value, metadata, LPN)).toBe(expected);
  });

  it('preserves values while the library is unavailable', () => {
    expect(normalizePhoneNumber('(202) 555-0123', {}, null)).toBe(
      '(202) 555-0123'
    );
  });

  it('uses the same timezone country as the phone field', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: 'Europe/London' })
    } as any);
    expect(getDefaultPhoneCountry('auto')).toBe('GB');
    spy.mockRestore();
  });

  it('falls back to US for unsupported settings', () => {
    expect(getDefaultPhoneCountry('invalid')).toBe('US');
  });
});
