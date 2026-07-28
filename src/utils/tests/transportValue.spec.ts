import { sanitizeTransportValue } from '../transportValue';

describe('sanitizeTransportValue assistant boundary', () => {
  it.each([
    ['null', null, null],
    ['undefined', undefined, null],
    ['a string', 'plain text', 'plain text'],
    ['a number', 42, 42],
    ['a boolean', false, false],
    ['an array', [1, 'two'], [1, 'two']],
    ['a nested object', { nested: { ok: true } }, { nested: { ok: true } }],
    ['a bigint', BigInt(42), '42'],
    ['a function', function named() {}, expect.stringContaining('function named')],
    ['a symbol', Symbol('token'), 'Symbol(token)'],
    ['a promise', Promise.resolve('secret'), { kind: 'promise', present: true }],
    [
      'a nested promise',
      { nested: { pending: Promise.resolve('secret') } },
      { nested: { pending: { kind: 'promise', present: true } } }
    ]
  ])('recursively converts %s to JSON-shaped data', (_label, input, expected) => {
    const result = sanitizeTransportValue(input, 1000);
    expect(result).toEqual({ value: expected, truncated: false });
    expect(() => JSON.stringify(result.value)).not.toThrow();
  });

  it('converts File values to bounded typed presence descriptors', () => {
    const file = new File(['policy'], 'policy.pdf', {
      type: 'application/pdf'
    });

    expect(sanitizeTransportValue({ nested: { file } }, 1000)).toEqual({
      value: {
        nested: {
          file: {
            kind: 'file',
            present: true,
            name: 'policy.pdf',
            type: 'application/pdf',
            size: 6
          }
        }
      },
      truncated: false
    });
  });

  it('converts cycles to typed presence descriptors instead of hanging', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(sanitizeTransportValue(cyclic, 1000)).toEqual({
      value: { self: { kind: 'circular', present: true } },
      truncated: false
    });
  });

  it.each([
    ['ordinary text', 'x'.repeat(2000)],
    ['escape-heavy text', '\u0000'.repeat(2000)],
    ['a large object', { nested: { text: 'x'.repeat(2000) } }],
    ['a large array', Array.from({ length: 1000 }, (_, index) => index)]
  ])('bounds the serialized representation of %s', (_label, input) => {
    const result = sanitizeTransportValue(input, 500);
    expect(result.truncated).toBe(true);
    expect(JSON.stringify(result.value).length).toBeLessThanOrEqual(500);
  });
});
