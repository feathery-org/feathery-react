jest.mock('../../validation', () => ({
  phoneLib: { parsePhoneNumber: jest.fn() },
  phoneLibPromise: Promise.resolve(),
  loadPhoneValidator: jest.fn(),
  validators: { url: jest.requireActual('../../validation').validators.url }
}));

import {
  decodeAndValidateFiles,
  validateAndNormalizeForFill
} from '../validate';

const country = (metadata: Record<string, any> = {}) => ({
  key: 'country',
  type: 'gmap_country',
  metadata
});

describe('validateAndNormalizeForFill: gmap_country', () => {
  it('accepts a matching country name when store_abbreviation is off', () => {
    const result = validateAndNormalizeForFill(country(), 'United States');
    expect(result).toEqual({ ok: true, value: 'United States' });
  });

  it('accepts a matching country name case-insensitively', () => {
    const result = validateAndNormalizeForFill(country(), 'united states');
    expect(result).toEqual({ ok: true, value: 'United States' });
  });

  it('accepts a matching country code when store_abbreviation is on', () => {
    const result = validateAndNormalizeForFill(
      country({ store_abbreviation: true }),
      'us'
    );
    expect(result).toEqual({ ok: true, value: 'US' });
  });

  it('rejects a name when store_abbreviation expects a code', () => {
    const result = validateAndNormalizeForFill(
      country({ store_abbreviation: true }),
      'United States'
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a country that does not exist', () => {
    const result = validateAndNormalizeForFill(country(), 'Narnia');
    expect(result).toEqual({
      ok: false,
      error: 'Value is not a recognized country name.'
    });
  });

  it('rejects a non-string value', () => {
    const result = validateAndNormalizeForFill(country(), 42);
    expect(result.ok).toBe(false);
  });
});

const state = (metadata: Record<string, any> = {}) => ({
  key: 'state',
  type: 'gmap_state',
  metadata
});

describe('validateAndNormalizeForFill: gmap_state', () => {
  it('accepts a matching state name for the default country (us)', () => {
    const result = validateAndNormalizeForFill(state(), 'California');
    expect(result).toEqual({ ok: true, value: 'California' });
  });

  it('accepts a matching state code case-insensitively when store_abbreviation is on', () => {
    const result = validateAndNormalizeForFill(
      state({ store_abbreviation: true }),
      'ca'
    );
    expect(result).toEqual({ ok: true, value: 'CA' });
  });

  it('normalizes a state name to its code when store_abbreviation is on', () => {
    const result = validateAndNormalizeForFill(
      state({ store_abbreviation: true }),
      'California'
    );
    expect(result).toEqual({ ok: true, value: 'CA' });
  });

  it('rejects a state that does not exist for the resolved country', () => {
    const result = validateAndNormalizeForFill(state(), 'Narnia');
    expect(result).toEqual({
      ok: false,
      error: 'Value is not a recognized state.'
    });
  });

  it('passes a value through unvalidated for a country with no defined state list', () => {
    const result = validateAndNormalizeForFill(
      state({ default_country: 'fr' }),
      'anything'
    );
    expect(result).toEqual({ ok: true, value: 'anything' });
  });

  it('accepts an empty string unvalidated, matching normalizeGmapState', () => {
    const result = validateAndNormalizeForFill(state(), '');
    expect(result).toEqual({ ok: true, value: '' });
  });

  it('rejects a non-string value', () => {
    const result = validateAndNormalizeForFill(state(), 42);
    expect(result.ok).toBe(false);
  });
});

describe('decodeAndValidateFiles', () => {
  const servar = (
    metadata: Record<string, any> = {},
    overrides: Record<string, any> = {}
  ) => ({
    key: 'photo',
    type: 'file_upload',
    metadata: { file_types: [], ...metadata },
    ...overrides
  });

  it('round-trips a small base64 file into a File with the right name and type', () => {
    const dataBase64 = Buffer.from('hello world').toString('base64');
    const result = decodeAndValidateFiles(servar(), [
      { name: 'hello.txt', mimeType: 'text/plain', dataBase64 }
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toBeInstanceOf(File);
    expect(result.files[0].name).toBe('hello.txt');
    expect(result.files[0].type).toBe('text/plain');
  });

  it('rejects an empty files array', () => {
    const result = decodeAndValidateFiles(servar(), []);
    expect(result.ok).toBe(false);
  });

  it('rejects a non-array value', () => {
    const result = decodeAndValidateFiles(servar(), 'not-an-array');
    expect(result.ok).toBe(false);
  });
});

describe('validateAndNormalizeForFill: date_selector', () => {
  const dateField = (metadata: Record<string, any> = {}) => ({
    key: 'dob',
    type: 'date_selector',
    metadata
  });

  it('accepts a real date', () => {
    const result = validateAndNormalizeForFill(dateField(), '2024-02-29');
    expect(result.ok).toBe(true);
  });

  it.each(['2026-13-45', '2026-02-30', '2025-02-29', '2026-00-10'])(
    'rejects %s instead of rolling it over',
    (value) => {
      const result = validateAndNormalizeForFill(dateField(), value);
      expect(result).toEqual({
        ok: false,
        error: "Field 'dob' expects 'YYYY-MM-DD'."
      });
    }
  );

  it('accepts a real date with a time', () => {
    const result = validateAndNormalizeForFill(
      dateField({ choose_time: true }),
      '2026-03-31T10:30'
    );
    expect(result.ok).toBe(true);
  });

  it.each(['2026-02-30T10:30', '2026-13-01T10:30'])(
    'rejects the impossible date part of %s',
    (value) => {
      const result = validateAndNormalizeForFill(
        dateField({ choose_time: true }),
        value
      );
      expect(result).toEqual({
        ok: false,
        error: "Field 'dob' expects 'YYYY-MM-DDTHH:mm'."
      });
    }
  );
});
