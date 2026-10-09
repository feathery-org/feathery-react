import {
  PROTOCOL_VERSION,
  idShape,
  parseBridgePayload,
  parseVerbInput,
  sameEditor,
  stripReadOnlyKeys,
  validateVerbResult,
  descriptorSchema,
  declaredTempIds,
  setTargetForm,
  refusedResult,
  makeRefusal,
  readOnlyResult,
  wrongEditorResult,
  CORE_INVARIANTS,
  WriteInput
} from './envelope';

// The fixtures below are the contract's own examples (sections 3 to 13), with the format name
// replaced by a neutral one: the core folder names no format.
const FORMAT = 'toy-format';

const cell = (row: string) => ({
  style: 'f31',
  blocks: [
    {
      style: 'f5',
      inlines: [
        {
          inlines: [],
          binding: {
            name: 'premium_tax',
            type: 'currency',
            expr: 'mul(line_total,tax_rate)',
            row
          }
        }
      ]
    }
  ]
});

/** Section 13.1, rewritten with the product's f-ids and illustrative bases. */
const liveColumnWrite = {
  intent:
    'Add a Premium tax column: a header cell, one formula cell per body row computing mul(line_total, tax_rate), and an empty total cell.',
  scope: { ids: ['n130', 'n146', 'n165', 'n183', 'n200', 'n218', 'n226'] },
  formats: {},
  changes: [
    {
      kind: 'insert_after',
      anchor: 'n130',
      container: 'c1',
      node: {
        style: 'f27',
        blocks: [{ style: 'f5', inlines: [{ text: 'Premium tax' }] }]
      }
    },
    {
      kind: 'insert_after',
      anchor: 'n146',
      container: 'c2',
      node: cell('property-r1')
    },
    {
      kind: 'insert_after',
      anchor: 'n165',
      container: 'c3',
      node: cell('property-r2')
    },
    {
      kind: 'insert_after',
      anchor: 'n183',
      container: 'c4',
      node: cell('property-r3')
    },
    {
      kind: 'insert_after',
      anchor: 'n200',
      container: 'c5',
      node: cell('property-r4')
    },
    {
      kind: 'insert_after',
      anchor: 'n218',
      container: 'c6',
      node: cell('property-r5')
    },
    {
      kind: 'insert_after',
      anchor: 'n226',
      container: 'c7',
      node: { style: 'f31', blocks: [{ style: 'f5', inlines: [] }] }
    }
  ]
};

const trace = {
  protocolVersion: 1,
  format: FORMAT,
  turnId: '3f8a1c',
  requested: {
    changes: 7,
    kinds: { insert_after: 7 },
    scopeIds: 7,
    bulk: 0,
    formats: 0,
    dryRun: false
  },
  verified: {
    outcome: 'passed',
    checks: [
      { name: 'envelope', pass: true },
      { name: 'base-hashes', pass: true },
      { name: 'scope', pass: true },
      { name: 'orphaned-dependents', pass: true }
    ],
    ms: 11
  },
  committed: { outcome: 'committed', seams: ['splice'], touched: 9, ms: 212 },
  proof: {
    outcome: 'passed',
    landed: true,
    reversible: true,
    normalizations: ['N2', 'N4'],
    rollback: null,
    ms: 7
  },
  timing: { totalMs: 241 }
};

const write = (overrides: Record<string, unknown>) => ({
  intent: 'Bold the motor premium label.',
  scope: { ids: ['n204'] },
  changes: [
    {
      kind: 'set',
      target: { ids: ['n204'], shape: { n204: '7c' } },
      props: { bold: true }
    }
  ],
  ...overrides
});

describe('section 2.1 id grammar', () => {
  it.each([
    ['n0', 'node'],
    ['n204', 'node'],
    ['f7', 'format'],
    ['tmp:tax_header', 'temporary'],
    ['tmp:a', 'temporary'],
    ['root', 'root']
  ])('%s is a %s id', (id, shape) => {
    expect(idShape(id)).toBe(shape);
  });

  it.each([
    'N12',
    'n',
    'n12a',
    'S27',
    'tmp:',
    'tmp:_x',
    'tmp:Upper',
    `tmp:${'a'.repeat(65)}`,
    'Root',
    '',
    12
  ])('%p has no id shape', (id) => {
    expect(idShape(id)).toBeNull();
  });

  it('accepts the longest temporary id', () => {
    expect(idShape(`tmp:${'a'.repeat(64)}`)).toBe('temporary');
  });
});

describe('section 3 outline input', () => {
  it('accepts no depth and depths 1 to 6', () => {
    expect(parseVerbInput('outline', {}).ok).toBe(true);
    expect(parseVerbInput('outline', { depth: 1 }).ok).toBe(true);
    expect(parseVerbInput('outline', { depth: 6 }).ok).toBe(true);
  });

  it('refuses depth out of range, non-integer and unknown fields', () => {
    for (const input of [
      { depth: 0 },
      { depth: 7 },
      { depth: 2.5 },
      { depth: 3, full: true }
    ]) {
      const r = parseVerbInput('outline', input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.refusal.invariant).toBe('envelope');
    }
  });
});

describe('section 4 read input', () => {
  it('accepts the contract example and node, format and root ids', () => {
    expect(
      parseVerbInput('read', {
        ids: ['n60', 'n12'],
        formats: 'referenced',
        properties: false
      }).ok
    ).toBe(true);
    expect(
      parseVerbInput('read', { ids: ['root', 'f31', 'n1'], formats: 'all' }).ok
    ).toBe(true);
  });

  it('refuses empty, oversized, temporary and malformed id lists', () => {
    const many = Array.from({ length: 65 }, (_, i) => `n${i}`);
    for (const ids of [[], many, ['tmp:x'], ['60']]) {
      expect(parseVerbInput('read', { ids }).ok).toBe(false);
    }
    expect(parseVerbInput('read', { ids: ['n1'], formats: 'some' }).ok).toBe(
      false
    );
  });

  it('names the offending path and tells the model to copy ids', () => {
    const r = parseVerbInput('read', { ids: ['n1', 'S27'] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.detail).toEqual([
      expect.stringContaining('ids[1]: must be a node id, a format id or root')
    ]);
    expect(r.refusal.retry).toBe('modified_input');
  });
});

describe('section 5 find input', () => {
  it('accepts the contract example and each single criterion', () => {
    expect(
      parseVerbInput('find', {
        text: 'Motor premium',
        kind: 'paragraph',
        within: 'n60',
        limit: 40
      }).ok
    ).toBe(true);
    expect(parseVerbInput('find', { kind: 'table' }).ok).toBe(true);
    expect(
      parseVerbInput('find', {
        feature: { name: 'binding', value: 'tax_rate' }
      }).ok
    ).toBe(true);
    expect(parseVerbInput('find', { format: 'f7' }).ok).toBe(true);
  });

  it('refuses a query with no criterion, a bad limit or long text', () => {
    expect(parseVerbInput('find', { within: 'n60' }).ok).toBe(false);
    expect(parseVerbInput('find', { kind: 'table', limit: 201 }).ok).toBe(
      false
    );
    expect(parseVerbInput('find', { text: 'x'.repeat(501) }).ok).toBe(false);
    expect(parseVerbInput('find', { text: '' }).ok).toBe(false);
  });
});

describe('section 6 write envelope', () => {
  it('accepts the section 13.1 live-column write', () => {
    const r = parseVerbInput('write', liveColumnWrite);
    expect(r).toEqual({ ok: true, value: liveColumnWrite });
  });

  it('accepts every section 6.3 set target form and the section 6.4 scope', () => {
    const r = parseVerbInput('write', {
      intent: 'Restyle the motor rows and the shared heading format.',
      scope: {
        ids: ['n66', 'n84', 'n204'],
        bulk: [{ find: { kind: 'paragraph', format: 'f7' }, total: 23 }],
        formats: [{ id: 'f31', referrers: 18 }]
      },
      changes: [
        {
          kind: 'set',
          target: { ids: ['n66', 'n84'], shape: { n66: '1f', n84: '2a' } },
          props: { bold: true, fontColor: '#1F3864' }
        },
        {
          kind: 'set',
          target: {
            id: 'n204',
            shape: '7c',
            match: { text: 'Motor premium', span: { start: 0, end: 13 } }
          },
          props: { bold: true }
        },
        {
          kind: 'set',
          target: { find: { kind: 'paragraph', format: 'f7' }, total: 23 },
          props: { alignment: 'Center' }
        },
        {
          kind: 'set',
          target: { formatId: 'f31', base: '0b', referrers: 18 },
          props: { fontColor: '#1F3864' }
        }
      ]
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      r.value.changes.map((c) =>
        c.kind === 'set' ? setTargetForm(c.target) : null
      )
    ).toEqual(['ids', 'match', 'find', 'format']);
  });

  it('accepts replace, delete and move with bases, and null clearing a property', () => {
    const r = parseVerbInput(
      'write',
      write({
        scope: { ids: ['n12', 'n13', 'n14', 'n20'] },
        changes: [
          {
            kind: 'replace',
            id: 'n12',
            base: 'a',
            node: { id: 'n12', kind: 'paragraph', inlines: [] }
          },
          { kind: 'delete', id: 'n13', base: 'b' },
          {
            kind: 'move',
            id: 'n14',
            shape: 'c',
            anchor: 'n20',
            position: 'before',
            container: 'd'
          },
          {
            kind: 'set',
            target: { ids: ['n20'], shape: { n20: 'e' } },
            props: { shading: null }
          }
        ]
      })
    );
    expect(r.ok).toBe(true);
  });

  it('accepts a temporary id declared by an earlier change and used later', () => {
    const r = parseVerbInput(
      'write',
      write({
        changes: [
          {
            kind: 'insert_after',
            anchor: 'n204',
            container: 'p1',
            node: {
              id: 'tmp:copy',
              blocks: [{ id: 'tmp:subtotal', inlines: [] }]
            }
          },
          {
            kind: 'insert_after',
            anchor: 'tmp:subtotal',
            node: { inlines: [] }
          },
          {
            kind: 'set',
            target: { ids: ['tmp:copy'], shape: {} },
            props: { bold: true }
          }
        ]
      })
    );
    expect(r.ok).toBe(true);
  });

  it('refuses a temporary id used before it is declared, as unknown-id', () => {
    const r = parseVerbInput(
      'write',
      write({
        changes: [
          { kind: 'insert_after', anchor: 'tmp:later', node: { inlines: [] } },
          {
            kind: 'insert_after',
            anchor: 'n204',
            container: 'p1',
            node: { id: 'tmp:later', inlines: [] }
          }
        ]
      })
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.invariant).toBe('unknown-id');
    expect(r.refusal.destroyed).toContain('changes[0]');
  });

  it('refuses a temporary id declared twice', () => {
    const r = parseVerbInput(
      'write',
      write({
        changes: [
          {
            kind: 'insert_after',
            anchor: 'n204',
            container: 'p',
            node: { id: 'tmp:a' }
          },
          {
            kind: 'insert_after',
            anchor: 'n204',
            container: 'p',
            node: { id: 'tmp:a' }
          }
        ]
      })
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.refusal.detail).toEqual([
        expect.stringContaining('declared twice')
      ]);
  });

  it('refuses a change on an engine id without its base, and an insert without container', () => {
    const noBase = parseVerbInput(
      'write',
      write({ changes: [{ kind: 'delete', id: 'n13' }] })
    );
    expect(noBase.ok).toBe(false);
    if (!noBase.ok) {
      expect(noBase.refusal.invariant).toBe('envelope');
      expect(noBase.refusal.destroyed).toContain('changes[0].base');
    }
    const noContainer = parseVerbInput(
      'write',
      write({ changes: [{ kind: 'insert_before', anchor: 'n13', node: {} }] })
    );
    expect(noContainer.ok).toBe(false);
    if (!noContainer.ok)
      expect(noContainer.refusal.destroyed).toContain('changes[0].container');
  });

  it('refuses an ids target whose base map does not match its ids', () => {
    const missing = parseVerbInput(
      'write',
      write({
        changes: [
          {
            kind: 'set',
            target: { ids: ['n1', 'n2'], shape: { n1: 'a' } },
            props: { bold: true }
          }
        ]
      })
    );
    const extra = parseVerbInput(
      'write',
      write({
        changes: [
          {
            kind: 'set',
            target: { ids: ['n1'], shape: { n1: 'a', n2: 'b' } },
            props: { bold: true }
          }
        ]
      })
    );
    expect(missing.ok).toBe(false);
    expect(extra.ok).toBe(false);
  });

  it('classifies an array node as node-not-one-node and a missing node as placeholder-call', () => {
    const many = parseVerbInput(
      'write',
      write({
        changes: [
          { kind: 'insert_after', anchor: 'n1', container: 'p', node: [{}, {}] }
        ]
      })
    );
    expect(many.ok).toBe(false);
    if (!many.ok) expect(many.refusal.invariant).toBe('node-not-one-node');

    const none = parseVerbInput(
      'write',
      write({ changes: [{ kind: 'replace', id: 'n1', base: 'a', node: null }] })
    );
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.refusal.invariant).toBe('placeholder-call');
  });

  it('refuses an empty change list as placeholder-call', () => {
    const empty = parseVerbInput('write', write({ changes: [] }));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.refusal.invariant).toBe('placeholder-call');
  });

  it('never judges the wording of the intent: real changes under any intent are accepted', () => {
    for (const intent of ['TODO', '...', 'n/a', ' placeholder. '])
      expect(parseVerbInput('write', write({ intent })).ok).toBe(true);
  });

  it('refuses unknown fields, unknown change kinds, bad positions and malformed nested ids', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [write({ turnId: 'x' }), 'unknown field(s) "turnId"'],
      [
        write({ changes: [{ kind: 'insert', anchor: 'n1', node: {} }] }),
        'must be one of replace'
      ],
      [
        write({
          changes: [
            {
              kind: 'move',
              id: 'n1',
              shape: 'a',
              anchor: 'n2',
              container: 'b',
              position: 'firstChild'
            }
          ]
        }),
        'changes[0].position'
      ],
      [
        write({
          changes: [
            {
              kind: 'replace',
              id: 'n1',
              base: 'a',
              node: { blocks: [{ id: 'p7' }] }
            }
          ]
        }),
        'changes[0].node.blocks[0].id'
      ],
      [
        write({
          changes: [
            { kind: 'set', target: { id: 'n1' }, props: { bold: true } }
          ]
        }),
        'target must be exactly one of'
      ],
      [
        write({
          changes: [
            {
              kind: 'set',
              target: { ids: ['n1'], shape: { n1: 'a' } },
              props: {}
            }
          ]
        }),
        'at least one property'
      ],
      [write({ intent: 'x'.repeat(401) }), 'intent'],
      [write({ scope: { ids: ['tmp:a'] } }), 'scope.ids[0]']
    ];
    for (const [input, expected] of cases) {
      const r = parseVerbInput('write', input);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      const details = (r.refusal.problems ?? [r.refusal]).flatMap(
        (p) => p.detail as string[]
      );
      expect(details.join('\n')).toContain(expected);
      expect(CORE_INVARIANTS).toContain(r.refusal.invariant);
    }
  });

  it('refuses root as a written id', () => {
    const r = parseVerbInput(
      'write',
      write({ changes: [{ kind: 'delete', id: 'root', base: 'a' }] })
    );
    expect(r.ok).toBe(false);
  });

  it('collects several invariants into problems, summarising the first', () => {
    const r = parseVerbInput(
      'write',
      write({
        changes: [
          { kind: 'insert_after', anchor: 'n1', container: 'p', node: [{}] },
          { kind: 'delete', id: 'n2', base: 'b', extra: 1 }
        ]
      })
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.problems?.map((p) => p.invariant).sort()).toEqual([
      'envelope',
      'node-not-one-node'
    ]);
    expect(r.refusal.invariant).toBe(r.refusal.problems?.[0].invariant);
  });

  it('accepts dryRun and new format entries keyed by temporary id', () => {
    const r = parseVerbInput(
      'write',
      write({
        dryRun: true,
        formats: { 'tmp:heading_blue': { fontColor: '#1F3864' } }
      })
    );
    expect(r.ok).toBe(true);
    const bad = parseVerbInput('write', write({ formats: { f99: {} } }));
    expect(bad.ok).toBe(false);
  });

  it('lets a temporary format id be used by a later set', () => {
    const r = parseVerbInput(
      'write',
      write({
        formats: { 'tmp:fmt': {} },
        changes: [
          {
            kind: 'set',
            target: { ids: ['n1'], shape: { n1: 'a' } },
            props: { format: 'tmp:fmt' }
          }
        ]
      })
    );
    expect(r.ok).toBe(true);
  });
});

describe('section 6.2 read-only keys', () => {
  it('strips pending, usedBy, derived and properties at every depth', () => {
    const { node, stripped } = stripReadOnlyKeys({
      id: 'n1',
      pending: { kind: 'insertion' },
      cells: [
        {
          id: 'n2',
          usedBy: ['n9'],
          derived: { width: 3 },
          blocks: [{ properties: {} }]
        }
      ]
    });
    expect(node).toEqual({ id: 'n1', cells: [{ id: 'n2', blocks: [{}] }] });
    expect(stripped.sort()).toEqual([
      'derived',
      'pending',
      'properties',
      'usedBy'
    ]);
  });

  it('reports nothing stripped on a clean node and does not mutate its input', () => {
    const input = { id: 'n1', inlines: [{ text: 'a' }] };
    const copy = JSON.parse(JSON.stringify(input));
    expect(stripReadOnlyKeys(input)).toEqual({ node: copy, stripped: [] });
    expect(input).toEqual(copy);
  });

  it('lists temporary ids a node declares, skipping read-only subtrees', () => {
    expect(
      declaredTempIds({
        id: 'tmp:a',
        rows: [{ id: 'n3' }, { id: 'tmp:b' }],
        pending: { id: 'tmp:c' }
      })
    ).toEqual(['tmp:a', 'tmp:b']);
  });
});

describe('results validate against the result contract', () => {
  it('section 3.2 outline result', () => {
    expect(
      validateVerbResult('outline', {
        ok: true,
        outlineHash: '5c0f1a9e2b7d4c31',
        depth: 3,
        lines: 'n1 section 1\n  n12 paragraph "Insurance proposal"'
      })
    ).toEqual({ ok: true });
  });

  it('section 4.2 read result, with properties', () => {
    expect(
      validateVerbResult('read', {
        ok: true,
        outlineHash: '5c0f',
        nodes: [
          {
            id: 'n60',
            base: '9a3c',
            shape: 'd41e',
            kind: 'table',
            rows: [],
            properties: { width: { value: 400, source: 'override' } }
          }
        ],
        formats: { f31: { base: '0b77', bold: true } },
        missing: ['n999']
      })
    ).toEqual({ ok: true });
    expect(
      validateVerbResult('read', {
        ok: true,
        outlineHash: '5c0f',
        nodes: [
          {
            id: 'n60',
            base: '9a3c',
            shape: 'd41e',
            kind: 'table',
            properties: { width: { value: 1, source: 'guess' } }
          }
        ],
        formats: {},
        missing: []
      }).ok
    ).toBe(false);
  });

  it('section 5.2 find result', () => {
    expect(
      validateVerbResult('find', {
        ok: true,
        outlineHash: '5c0f',
        hits: [
          {
            id: 'n204',
            kind: 'paragraph',
            within: ['n130', 'n61', 'n60', 'n1'],
            snippet: 'Motor premium subtotal: $9,000.00',
            span: { start: 0, end: 13 }
          }
        ],
        truncated: false,
        total: 1
      })
    ).toEqual({ ok: true });
  });

  it('section 6.5 write success result', () => {
    const result = {
      ok: true,
      committed: true,
      dryRun: false,
      cardId: '3f8a1c',
      landed: 'card',
      outlineHash: 'a91e',
      mapping: { 'tmp:tax_header': 'n901', 'tmp:tax_r1': 'n902' },
      touched: ['n130', 'n146', 'n901', 'n902'],
      finalizerScope: [
        { name: 'restripe', ids: ['n60'] },
        { name: 'formulas', ids: ['n781', 'n773'] }
      ],
      facts: [
        {
          kind: 'inserted',
          ids: ['n901'],
          summary: '1 cell inserted after n130 in row n61 ("Premium tax")'
        },
        {
          kind: 'finalizer',
          name: 'formulas',
          ids: ['n902'],
          summary: 'premium_tax computed for 5 rows'
        }
      ],
      warnings: [
        { code: 'undo-history-cleared', message: 'The card is the way back.' }
      ],
      trace
    };
    expect(validateVerbResult('write', result)).toEqual({ ok: true });
    expect(validateVerbResult('write', { ...result, landed: 'maybe' }).ok).toBe(
      false
    );
    expect(
      validateVerbResult('write', { ...result, mapping: { 'tmp:a': 'x1' } }).ok
    ).toBe(false);
  });

  it('section 13.2 refusal result, built by the helpers', () => {
    const refusal = makeRefusal([
      {
        invariant: 'orphaned-dependents',
        destroyed:
          '4 formula(s) would be left reading values this change removes.',
        detail: [
          {
            name: 'grand_total',
            ids: ['n781'],
            expr: 'sum(summary_subtotal,summary_tax)',
            reads: []
          }
        ],
        retry: 'modified_input',
        read: ['binding'],
        hint: 'Either leave what they read in place, or rewrite each listed formula.'
      }
    ]);
    const result = refusedResult(refusal, {
      ...trace,
      verified: { ...trace.verified, outcome: 'refused' }
    } as never);
    expect(result.error).toEqual({
      code: 'document.refused',
      message: refusal.destroyed
    });
    expect(result.retry).toBe('modified_input');
    expect(result.refusal.problems).toBeUndefined();
    expect(validateVerbResult('write', result)).toEqual({ ok: true });
  });

  it('section 7.2 conflict result', () => {
    expect(
      validateVerbResult('write', {
        ok: false,
        error: {
          code: 'document.conflict',
          message: '2 node(s) changed since they were read.'
        },
        retry: 'modified_input',
        conflict: {
          stale: [
            {
              id: 'n204',
              base: '7c',
              live: { id: 'n204', base: 'e1', shape: '90', kind: 'paragraph' }
            },
            {
              id: 'n61',
              shape: '3b',
              live: { id: 'n61', base: '77', shape: 'c8', kind: 'row' }
            }
          ],
          bulk: [
            { find: { kind: 'paragraph', format: 'f7' }, total: 23, live: 25 }
          ],
          formats: [
            {
              id: 'f31',
              base: '0b',
              referrers: 18,
              live: 19,
              liveBase: '4d',
              liveEntry: { base: '4d', bold: true }
            }
          ],
          outlineHash: 'a91e'
        }
      })
    ).toEqual({ ok: true });
  });

  it('a stale entry repeats exactly one carried hash', () => {
    const conflict = (entry: Record<string, unknown>) =>
      validateVerbResult('write', {
        ok: false,
        error: { code: 'document.conflict', message: '' },
        retry: 'modified_input',
        conflict: { stale: [entry], bulk: [], formats: [], outlineHash: 'h' }
      }).ok;
    const live = { id: 'n1', base: 'b', shape: 's', kind: 'paragraph' };
    expect(conflict({ id: 'n1', shape: 'x', live })).toBe(true);
    expect(conflict({ id: 'n1', base: 'x', shape: 'y', live })).toBe(false);
    expect(conflict({ id: 'n1', live })).toBe(false);
  });

  it('section 7.3 and 7.4 failures', () => {
    expect(
      validateVerbResult('write', {
        ok: false,
        error: {
          code: 'document.uncertain',
          message:
            'The editor did not acknowledge a verified document result. The change may have applied.'
        },
        retry: 'do_not_retry',
        recovery:
          'Stop editing and ask the user to inspect the review card before requesting another change.'
      })
    ).toEqual({ ok: true });
    expect(validateVerbResult('write', readOnlyResult())).toEqual({ ok: true });
    expect(validateVerbResult('read', wrongEditorResult())).toEqual({
      ok: true
    });
    expect(
      validateVerbResult('write', {
        ok: false,
        error: { code: 'document.other', message: '' }
      }).ok
    ).toBe(false);
  });
});

describe('section 9 descriptor', () => {
  it('accepts the contract example and a descriptor without selection', () => {
    const descriptor = {
      protocolVersion: PROTOCOL_VERSION,
      editorId: 'ed-3a1f',
      target: { type: 'envelope', id: 'env_8f2c' },
      format: FORMAT,
      readOnly: false,
      outlineHash: '5c0f1a9e2b7d4c31',
      selection: {
        start: { id: 'n204', offset: 0 },
        end: { id: 'n204', offset: 13 },
        text: 'Motor premium',
        truncated: false
      }
    };
    expect(descriptorSchema.safeParse(descriptor).success).toBe(true);
    const { selection, ...bare } = descriptor;
    expect(selection.text).toBe('Motor premium');
    expect(descriptorSchema.safeParse(bare).success).toBe(true);
    expect(
      descriptorSchema.safeParse({
        ...descriptor,
        selection: { ...selection, text: 'x'.repeat(501) }
      }).success
    ).toBe(false);
  });
});

describe('section 10 bridge payload', () => {
  const payload = {
    protocolVersion: 1,
    turnId: '3f8a1c',
    editorId: 'ed-3a1f',
    target: { type: 'envelope', id: 'env_8f2c' },
    verb: 'write',
    input: liveColumnWrite
  };

  it('parses the contract example and leaves input validation to the verb', () => {
    const r = parseBridgePayload(payload);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const input = parseVerbInput(r.value.verb, r.value.input);
    expect(input.ok).toBe(true);
    expect((input as { value: WriteInput }).value.changes).toHaveLength(7);
  });

  it('reports an unsupported protocol version and a malformed payload as dispatch failures', () => {
    expect(parseBridgePayload({ ...payload, protocolVersion: 2 })).toEqual({
      ok: false,
      failure: expect.objectContaining({ reason: 'protocol-unsupported' })
    });
    expect(parseBridgePayload({ ...payload, verb: 'apply' })).toEqual({
      ok: false,
      failure: expect.objectContaining({ reason: 'payload-invalid' })
    });
    expect(parseBridgePayload({ ...payload, extra: 1 })).toEqual({
      ok: false,
      failure: expect.objectContaining({ reason: 'payload-invalid' })
    });
  });

  it('rechecks editor id and target', () => {
    const mounted = {
      editorId: 'ed-3a1f',
      target: { type: 'envelope', id: 'env_8f2c' }
    };
    expect(sameEditor(payload, mounted)).toBe(true);
    expect(sameEditor({ ...payload, editorId: 'ed-other' }, mounted)).toBe(
      false
    );
    expect(
      sameEditor(
        { ...payload, target: { type: 'envelope', id: 'env_x' } },
        mounted
      )
    ).toBe(false);
  });
});
