import { WriteInput, parseVerbInput, validateVerbResult } from './envelope';
import { baseOf, NfNode, shapeOf } from './tree';
import { findVerb, outlineVerb, prepareWrite, readVerb } from './verbs';
import { stateOf } from './tests/fixtures';
import { box, para, toyNative } from './tests/toyPack';

const doc = toyNative(
  para('Title', { bold: true }),
  box([para('one'), para('two', { bold: true, x: 'native' })], {
    name: 'alpha'
  }),
  para('Items: 2', { formula: 'count(alpha)' })
);
// n1 Title (f1), n2 box alpha, n3 one (f2), n4 two (f1), n5 formula (f2)

const fresh = () => stateOf(doc);
const b = (s: ReturnType<typeof fresh>, id: string) => baseOf(s.view.get(id));
const sh = (s: ReturnType<typeof fresh>, id: string) =>
  shapeOf(
    (id === 'root' ? s.view.nf.root : s.view.get(id)) as NfNode,
    s.pack.tree
  );
const write = (input: WriteInput) => {
  const parsed = parseVerbInput('write', input);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.refusal));
  return parsed.value;
};

describe('read', () => {
  it('returns subtrees with id, base and kind first, annotations and referenced formats', () => {
    const s = fresh();
    const r = readVerb(s, { ids: ['n2', 'n2', 'n99'] });
    expect(validateVerbResult('read', r)).toEqual({ ok: true });
    expect(r.missing).toEqual(['n99']);
    expect(r.nodes).toHaveLength(1);
    const [n2] = r.nodes;
    expect(Object.keys(n2).slice(0, 4)).toEqual([
      'id',
      'base',
      'shape',
      'kind'
    ]);
    expect(n2.base).toBe(b(s, 'n2'));
    expect(n2.usedBy).toEqual(['n5']);
    expect((n2.items as NfNode[])[1]).toEqual({
      id: 'n4',
      base: b(s, 'n4'),
      shape: sh(s, 'n4'),
      kind: 'para',
      text: 'two',
      style: 'f1'
    });
    expect(Object.keys(r.formats).sort()).toEqual(['f1', 'f2']);
    expect(r.formats.f1).toEqual({ base: baseOf({ bold: true }), bold: true });
  });

  it('adds derived values and, on request, effective properties with their source', () => {
    const s = fresh();
    const r = readVerb(s, {
      ids: ['n5', 'n4'],
      properties: true,
      formats: 'none'
    });
    expect(r.nodes[0].derived).toEqual({ value: 2 });
    expect(r.nodes[1].properties).toEqual({
      bold: { value: true, source: 'format' },
      size: { value: 11, source: 'default' },
      align: { value: 'left', source: 'default' }
    });
    expect(r.formats).toEqual({});
  });

  it('reads root with children stubbed, and format ids directly', () => {
    const s = fresh();
    const r = readVerb(s, { ids: ['root', 'f2'], formats: 'none' });
    expect(r.nodes[0]).toEqual({
      id: 'root',
      base: baseOf(s.view.nf.root),
      shape: sh(s, 'root'),
      kind: 'doc',
      blocks: ['n1', 'n2', 'n5'].map((id) => ({
        id,
        base: b(s, id),
        shape: sh(s, id),
        kind: s.view.get(id)?.kind
      }))
    });
    expect(Object.keys(r.formats)).toEqual(['f2']);
    expect(
      Object.keys(readVerb(s, { ids: ['n1'], formats: 'all' }).formats)
    ).toEqual(['f1', 'f2']);
  });
});

describe('find', () => {
  it('matches text case-insensitively with span, snippet and ancestors', () => {
    const r = findVerb(fresh(), { text: 'TWO' });
    expect(validateVerbResult('find', r)).toEqual({ ok: true });
    expect(r.hits).toEqual([
      {
        id: 'n4',
        kind: 'para',
        within: ['n2'],
        snippet: 'two',
        span: { start: 0, end: 3 }
      }
    ]);
  });

  it('combines kind, feature, format and within with AND, and truncates at limit', () => {
    const s = fresh();
    expect(findVerb(s, { kind: 'para' }).total).toBe(4);
    expect(
      findVerb(s, { kind: 'para', within: 'n2' }).hits.map((h) => h.id)
    ).toEqual(['n3', 'n4']);
    expect(
      findVerb(s, { feature: { name: 'named', value: 'alpha' } }).hits.map(
        (h) => h.id
      )
    ).toEqual(['n2']);
    expect(
      findVerb(s, { feature: { name: 'named', value: 'beta' } }).total
    ).toBe(0);
    expect(findVerb(s, { format: 'f1' }).hits.map((h) => h.id)).toEqual([
      'n1',
      'n4'
    ]);
    const limited = findVerb(s, { kind: 'para', limit: 2 });
    expect([limited.hits.length, limited.truncated, limited.total]).toEqual([
      2,
      true,
      4
    ]);
  });
});

describe('outline', () => {
  it('renders the live document', () => {
    expect(outlineVerb(fresh(), {}).lines.split('\n')[0]).toBe(
      'n1 para "Title"'
    );
  });
});

describe('write: verified changes', () => {
  it('inserts with temporary ids, sets on a temporary id, recomputes formulas, and reports facts', () => {
    const s = fresh();
    const r = prepareWrite(
      s,
      write({
        intent: 'Add a third item and bold it.',
        scope: { ids: ['n4'] },
        changes: [
          {
            kind: 'insert_after',
            anchor: 'n4',
            container: sh(s, 'n2'),
            node: { id: 'tmp:three', text: 'three', style: 'f2' }
          },
          {
            kind: 'set',
            target: { ids: ['tmp:three'], shape: {} },
            props: { bold: true }
          }
        ]
      })
    );
    expect(r.outcome).toBe('verified');
    if (r.outcome !== 'verified') return;
    expect(r.mapping).toEqual({ 'tmp:three': 'n6' });
    const items = (r.intended.root.blocks as NfNode[])[1].items as NfNode[];
    expect(items[2]).toEqual({
      id: 'n6',
      kind: 'para',
      text: 'three',
      style: 'f1'
    });
    expect((r.intended.root.blocks as NfNode[])[2].text).toBe('Items: 3');
    expect(r.finalizerScope).toEqual([{ name: 'formulas', ids: ['n5'] }]);
    expect(r.touched.sort()).toEqual(['n2', 'n5', 'n6']);
    expect(r.facts.map((f) => f.summary)).toEqual([
      '1 para inserted after n4 ("three")',
      'bold=true set on 1 node(s)',
      '1 formula(s) recomputed'
    ]);
    expect(r.checks.map((c) => c.name)).toEqual([
      'envelope',
      'unknown-id',
      'unknown-format',
      'base-hashes',
      'format-entry-rejected',
      'unknown-format',
      'apply-failed',
      'id-shape-mismatch',
      'property-invalid',
      'scope',
      'orphaned-dependents',
      'box-name-unique'
    ]);
    expect(r.checks.every((c) => c.pass)).toBe(true);
  });

  it('replace keeps the id and residue of a same-kind node; a copy gets a new id and the residue', () => {
    const s = fresh();
    const r = prepareWrite(
      s,
      write({
        intent: 'Rename two and copy it to the top.',
        scope: { ids: ['n4', 'n1'] },
        changes: [
          {
            kind: 'replace',
            id: 'n4',
            base: b(s, 'n4'),
            node: { text: 'TWO', style: 'f1' }
          },
          {
            kind: 'insert_before',
            anchor: 'n1',
            container: sh(s, 'root'),
            node: { id: 'n4', kind: 'para', text: 'two', style: 'f1' }
          }
        ]
      })
    );
    expect(r.outcome).toBe('verified');
    if (r.outcome !== 'verified') return;
    const blocks = r.intended.root.blocks as NfNode[];
    expect(blocks[0]).toEqual({
      id: 'n6',
      kind: 'para',
      text: 'two',
      style: 'f1'
    });
    expect(((blocks[2].items as NfNode[])[1] as NfNode).id).toBe('n4');
    expect(r.intendedResidue).toEqual({
      n4: { x: 'native' },
      n6: { x: 'native' }
    });
  });

  it('deletes and moves, with facts', () => {
    const s = fresh();
    const r = prepareWrite(
      s,
      write({
        intent: 'Move the title into the box and drop one.',
        scope: { ids: ['n1', 'n3'] },
        changes: [
          {
            kind: 'move',
            id: 'n1',
            shape: sh(s, 'n1'),
            anchor: 'n4',
            position: 'after',
            container: sh(s, 'n2')
          },
          { kind: 'delete', id: 'n3', base: b(s, 'n3') }
        ]
      })
    );
    expect(r.outcome).toBe('verified');
    if (r.outcome !== 'verified') return;
    expect(
      ((r.intended.root.blocks as NfNode[])[0].items as NfNode[]).map(
        (n) => n.id
      )
    ).toEqual(['n4', 'n1']);
    expect(r.facts.map((f) => f.kind)).toEqual(['moved', 'deleted']);
    expect(r.finalizerScope).toEqual([{ name: 'formulas', ids: [] }]);
  });

  it('sets by span, by bulk query and on a shared format entry', () => {
    const s = fresh();
    const r = prepareWrite(
      s,
      write({
        intent: 'Bigger text everywhere.',
        scope: {
          ids: ['n3'],
          bulk: [{ find: { kind: 'para', within: 'n2' }, total: 2 }],
          formats: [{ id: 'f1', referrers: 2 }]
        },
        changes: [
          {
            kind: 'set',
            target: {
              id: 'n3',
              shape: sh(s, 'n3'),
              match: { text: 'ONE', span: { start: 0, end: 3 } }
            },
            props: { align: 'center' }
          },
          {
            kind: 'set',
            target: { find: { kind: 'para', within: 'n2' }, total: 2 },
            props: { size: 14 }
          },
          {
            kind: 'set',
            target: {
              formatId: 'f1',
              base: baseOf(s.view.nf.formats.f1),
              referrers: 2
            },
            props: { size: 20 }
          }
        ]
      })
    );
    expect(r.outcome).toBe('verified');
    if (r.outcome !== 'verified') return;
    expect(r.intended.formats.f1).toEqual({ bold: true, size: 20 });
    const items = (r.intended.root.blocks as NfNode[])[1].items as NfNode[];
    expect(items[0].align).toBe('center');
    expect(r.intended.formats[String(items[0].style)]).toEqual({ size: 14 });
  });

  it('warns when read-only keys are stripped from written nodes', () => {
    const s = fresh();
    const r = prepareWrite(
      s,
      write({
        intent: 'Retitle.',
        scope: { ids: ['n1'] },
        changes: [
          {
            kind: 'replace',
            id: 'n1',
            base: b(s, 'n1'),
            node: {
              text: 'New',
              style: 'f1',
              usedBy: ['n5'],
              pending: { kind: 'insertion' }
            }
          }
        ]
      })
    );
    expect(r.outcome).toBe('verified');
    expect(r.warnings).toEqual([
      {
        code: 'stripped-read-only',
        message: 'Ignored read-only key(s) on written nodes: usedBy, pending.'
      }
    ]);
  });
});

describe('write: conflicts', () => {
  it('returns the live node when the user changed it since it was read', () => {
    const s = fresh();
    const r = prepareWrite(
      s,
      write({
        intent: 'x',
        scope: { ids: ['n3'] },
        changes: [{ kind: 'delete', id: 'n3', base: 'stale' }]
      })
    );
    expect(r.outcome).toBe('conflict');
    if (r.outcome !== 'conflict') return;
    expect(r.conflict.stale[0].live).toEqual(
      expect.objectContaining({ id: 'n3', text: 'one' })
    );
    expect(r.checks.slice(-1)).toEqual([{ name: 'base-hashes', pass: false }]);
  });
});

describe('write: refusals (each a true positive; the verified cases above are the negatives)', () => {
  const refusal = (input: WriteInput) => {
    const r = prepareWrite(fresh(), write(input));
    if (r.outcome !== 'refused')
      throw new Error(`expected a refusal, got ${r.outcome}`);
    return r.refusal;
  };
  const s = fresh();

  it('unknown-id', () => {
    const r = refusal({
      intent: 'x',
      scope: { ids: ['n77'] },
      changes: [{ kind: 'delete', id: 'n77', base: 'b' }]
    });
    expect(r.invariant).toBe('unknown-id');
    expect(r.destroyed).toContain('changes[0] names n77');
  });

  it('unknown-format, for a missing entry and a dangling reference', () => {
    expect(
      refusal({
        intent: 'x',
        scope: { ids: [], formats: [{ id: 'f9', referrers: 0 }] },
        changes: [
          {
            kind: 'set',
            target: { formatId: 'f9', base: 'b', referrers: 0 },
            props: { bold: true }
          }
        ]
      }).invariant
    ).toBe('unknown-format');
    expect(
      refusal({
        intent: 'x',
        scope: { ids: ['n1'] },
        changes: [
          {
            kind: 'replace',
            id: 'n1',
            base: b(s, 'n1'),
            node: { text: 'a', style: 'f9' }
          }
        ]
      }).invariant
    ).toBe('unknown-format');
  });

  it('format-entry-rejected', () => {
    expect(
      refusal({
        intent: 'x',
        scope: { ids: [] },
        formats: { 'tmp:f': { shade: 'red' } },
        changes: [
          {
            kind: 'insert_after',
            anchor: 'n1',
            container: sh(s, 'root'),
            node: { text: 'a', style: 'tmp:f' }
          }
        ]
      }).invariant
    ).toBe('format-entry-rejected');
  });

  it('id-shape-mismatch', () => {
    const r = refusal({
      intent: 'x',
      scope: { ids: ['n1'] },
      changes: [
        {
          kind: 'insert_after',
          anchor: 'n1',
          container: sh(s, 'root'),
          node: { id: 'n2', kind: 'para', text: 'a', style: 'f1' }
        }
      ]
    });
    expect(r.invariant).toBe('id-shape-mismatch');
    expect(r.destroyed).toContain(
      'n2 is a box in the document but is written as a para'
    );
  });

  it('apply-failed: a node that cannot sit there, an undecidable kind, a span that does not read as claimed', () => {
    expect(
      refusal({
        intent: 'x',
        scope: { ids: [] },
        changes: [
          {
            kind: 'insert_after',
            anchor: 'n3',
            container: sh(s, 'n2'),
            node: { items: [] }
          }
        ]
      }).destroyed
    ).toContain('a box cannot be placed in the items of a box');
    expect(
      refusal({
        intent: 'x',
        scope: { ids: [] },
        changes: [
          {
            kind: 'insert_after',
            anchor: 'n1',
            container: sh(s, 'root'),
            node: { colour: 'red' }
          }
        ]
      }).destroyed
    ).toContain('cannot tell what kind of node');
    expect(
      refusal({
        intent: 'x',
        scope: { ids: ['n3'] },
        changes: [
          {
            kind: 'set',
            target: {
              id: 'n3',
              shape: sh(s, 'n3'),
              match: { text: 'two', span: { start: 0, end: 3 } }
            },
            props: { bold: true }
          }
        ]
      }).destroyed
    ).toContain('reads "one"');
    expect(
      refusal({
        intent: 'x',
        scope: { ids: ['n2'] },
        changes: [
          {
            kind: 'move',
            id: 'n2',
            shape: sh(s, 'n2'),
            anchor: 'n3',
            position: 'after',
            container: sh(s, 'n2')
          }
        ]
      }).destroyed
    ).toContain('which is inside it');
    expect(
      refusal({
        intent: 'x',
        scope: { ids: ['n3'] },
        changes: [
          { kind: 'delete', id: 'n3', base: b(s, 'n3') },
          { kind: 'delete', id: 'n3', base: b(s, 'n3') }
        ]
      }).destroyed
    ).toContain('an earlier change removed it');
  });

  it('property-invalid', () => {
    expect(
      refusal({
        intent: 'x',
        scope: { ids: ['n1'] },
        changes: [
          {
            kind: 'set',
            target: { ids: ['n1'], shape: { n1: sh(s, 'n1') } },
            props: { length: 2 }
          }
        ]
      }).invariant
    ).toBe('property-invalid');
  });

  it('scope', () => {
    const r = refusal({
      intent: 'x',
      scope: { ids: ['n3'] },
      changes: [
        {
          kind: 'replace',
          id: 'n1',
          base: b(s, 'n1'),
          node: { text: 'a', style: 'f1' }
        }
      ]
    });
    expect(r.invariant).toBe('scope');
    expect(r.destroyed).toContain('n1 (para "Title")');
  });

  it('a pack invariant: deleting what a formula reads', () => {
    const r = refusal({
      intent: 'x',
      scope: { ids: ['n2'] },
      changes: [{ kind: 'delete', id: 'n2', base: b(s, 'n2') }]
    });
    expect(r.invariant).toBe('orphaned-dependents');
    expect(r.read).toEqual(['formula']);
  });

  it('collects every failing invariant of one stage into problems', () => {
    const r = refusal({
      intent: 'x',
      scope: { ids: ['n1', 'n3'] },
      changes: [
        {
          kind: 'set',
          target: { ids: ['n1'], shape: { n1: sh(s, 'n1') } },
          props: { size: 1 }
        },
        {
          kind: 'insert_after',
          anchor: 'n3',
          container: sh(s, 'n2'),
          node: { items: [] }
        }
      ]
    });
    expect(r.problems?.map((p) => p.invariant)).toEqual([
      'apply-failed',
      'property-invalid'
    ]);
  });
});
