jest.mock('../../validation', () => ({
  phoneLib: { parsePhoneNumber: jest.fn() },
  phoneLibPromise: Promise.resolve(),
  loadPhoneValidator: jest.fn()
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
