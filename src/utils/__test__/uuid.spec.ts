import { uuidv4, validateUuid } from '../uuid';

// jsdom (jest 26) ships no web crypto, so stub it explicitly
const withCrypto = (impl: any, run: () => void) => {
  const original = (global as any).crypto;
  (global as any).crypto = impl;
  try {
    run();
  } finally {
    (global as any).crypto = original;
  }
};

const counterBytes = (bytes: Uint8Array) => {
  for (let i = 0; i < bytes.length; i++) bytes[i] = i * 17;
  return bytes;
};

describe('uuidv4', () => {
  it('delegates to crypto.randomUUID when available', () => {
    const randomUUID = jest.fn(() => '11111111-2222-4333-8444-555555555555');
    withCrypto({ randomUUID }, () => {
      expect(uuidv4()).toBe('11111111-2222-4333-8444-555555555555');
      expect(randomUUID).toHaveBeenCalled();
    });
  });

  it('falls back to getRandomValues in insecure contexts', () => {
    withCrypto({ getRandomValues: counterBytes }, () => {
      const id = uuidv4();
      expect(validateUuid(id)).toBe(true);
      expect(id[14]).toBe('4'); // version nibble
      expect('89ab').toContain(id[19]); // variant nibble
    });
  });
});

describe('validateUuid', () => {
  it('accepts uuids', () => {
    expect(validateUuid('11111111-2222-4333-8444-555555555555')).toBe(true);
    expect(validateUuid('00000000-0000-0000-0000-000000000000')).toBe(true);
  });

  it('rejects non-uuids', () => {
    expect(validateUuid('')).toBe(false);
    expect(validateUuid('Loader 1')).toBe(false);
    expect(validateUuid('11111111-2222-4333-8444-55555555555')).toBe(false);
  });
});
