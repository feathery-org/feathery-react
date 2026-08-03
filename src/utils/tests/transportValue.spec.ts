import { sanitizeTransportValue } from '../transportValue';
import { justInsert } from '../array';
import { getDefaultFormFieldValue } from '../fieldHelperFunctions';

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
    ['a nested bigint', { nested: BigInt(42) }, { nested: '42' }],
    [
      'a function',
      function named() {},
      expect.stringContaining('function named')
    ],
    [
      'a nested function',
      { nested: function named() {} },
      { nested: expect.stringContaining('function named') }
    ],
    ['a symbol', Symbol('token'), 'Symbol(token)'],
    [
      'a nested symbol',
      { nested: Symbol('token') },
      { nested: 'Symbol(token)' }
    ],
    [
      'a promise',
      Promise.resolve('secret'),
      { kind: 'promise', present: true }
    ],
    [
      'a nested promise',
      { nested: { pending: Promise.resolve('secret') } },
      { nested: { pending: { kind: 'promise', present: true } } }
    ]
  ])(
    'recursively converts %s to JSON-shaped data',
    (_label, input, expected) => {
      const result = sanitizeTransportValue(input);
      expect(result).toEqual(expected);
      expect(() => JSON.stringify(result)).not.toThrow();
    }
  );

  it('converts File values to bounded typed presence descriptors', () => {
    const file = new File(['policy'], 'policy.pdf', {
      type: 'application/pdf'
    });

    expect(sanitizeTransportValue({ nested: { file } })).toEqual({
      nested: {
        file: {
          kind: 'file',
          present: true,
          name: 'policy.pdf',
          type: 'application/pdf',
          size: 6
        }
      }
    });
  });

  it('converts cycles to typed presence descriptors instead of hanging', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(sanitizeTransportValue(cyclic)).toEqual({
      self: { kind: 'circular', present: true }
    });
  });

  it('serializes the same object in sibling positions', () => {
    const shared = { value: 'shared' };

    expect(sanitizeTransportValue([shared, shared])).toEqual([
      { value: 'shared' },
      { value: 'shared' }
    ]);
  });

  it('serializes every row when an array is filled with one object', () => {
    const row = { value: 'row' };

    expect(sanitizeTransportValue(Array(3).fill(row))).toEqual([
      { value: 'row' },
      { value: 'row' },
      { value: 'row' }
    ]);
  });

  it('preserves padded repeat-container matrix rows in field changes', () => {
    const matrixField = {
      servar: {
        type: 'matrix',
        repeated: true,
        metadata: {
          multiple: false,
          questions: [
            { id: 'coverage', default_value: 'General Liability' },
            { id: 'location', default_value: 'Toronto' }
          ]
        }
      }
    };
    const initialRows = getDefaultFormFieldValue(matrixField);
    const beforeRows = justInsert(
      initialRows,
      { coverage: ['Umbrella'], location: ['Vancouver'] },
      4,
      matrixField
    );
    const afterRows = [
      ...beforeRows,
      { coverage: ['Property'], location: ['Montreal'] }
    ];

    expect(initialRows).toHaveLength(1);
    expect(beforeRows[0]).not.toBe(beforeRows[1]);
    expect(beforeRows[1]).toBe(beforeRows[2]);
    expect(beforeRows[2]).toBe(beforeRows[3]);

    const fieldChange = {
      key: 'coverage_schedule',
      before: sanitizeTransportValue(beforeRows),
      after: sanitizeTransportValue(afterRows)
    };
    const defaultRow = {
      coverage: ['General Liability'],
      location: ['Toronto']
    };

    expect(fieldChange).toEqual({
      key: 'coverage_schedule',
      before: [
        defaultRow,
        defaultRow,
        defaultRow,
        defaultRow,
        { coverage: ['Umbrella'], location: ['Vancouver'] }
      ],
      after: [
        defaultRow,
        defaultRow,
        defaultRow,
        defaultRow,
        { coverage: ['Umbrella'], location: ['Vancouver'] },
        { coverage: ['Property'], location: ['Montreal'] }
      ]
    });
    expect(JSON.stringify(fieldChange)).not.toContain('"kind":"circular"');
  });

  it('serializes a shared object at different depths', () => {
    const shared = { value: 'shared' };

    expect(sanitizeTransportValue({ a: shared, b: { c: shared } })).toEqual({
      a: { value: 'shared' },
      b: { c: { value: 'shared' } }
    });
  });

  it('converts mutual cycles to typed presence descriptors', () => {
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    a.b = b;
    b.a = a;

    expect(sanitizeTransportValue(a)).toEqual({
      b: {
        a: { kind: 'circular', present: true }
      }
    });
  });

  it('distinguishes shared references from cycles in the same value', () => {
    const shared: Record<string, unknown> = { value: 'shared' };
    const cyclic: Record<string, unknown> = { shared };
    shared.cyclic = cyclic;

    expect(sanitizeTransportValue([shared, shared])).toEqual([
      {
        value: 'shared',
        cyclic: {
          shared: { kind: 'circular', present: true }
        }
      },
      {
        value: 'shared',
        cyclic: {
          shared: { kind: 'circular', present: true }
        }
      }
    ]);
  });

  it('passes large values through unclipped, prompt bounding is the server digest\'s job', () => {
    const large = { nested: { text: 'x'.repeat(2000) } };
    expect(sanitizeTransportValue(large)).toEqual(large);
  });

  it('truncates a value too big for the request body, keeping the head', () => {
    const oversized = sanitizeTransportValue({
      text: 'x'.repeat(300_000)
    }) as string;
    expect(typeof oversized).toBe('string');
    expect(oversized.endsWith('…[truncated]')).toBe(true);
    expect(oversized.length).toBeLessThan(260_000);
    expect(oversized.startsWith('{"text":"xxx')).toBe(true);
  });

  it('truncates an oversized string without wrapping it in JSON', () => {
    const oversized = sanitizeTransportValue('y'.repeat(300_000)) as string;
    expect(oversized.startsWith('yyy')).toBe(true);
    expect(oversized.endsWith('…[truncated]')).toBe(true);
  });
});
