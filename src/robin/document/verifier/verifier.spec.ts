import { baseOf, shapeOf } from '../tree';
import { makeView } from '../view';
import { stateOf } from '../tests/fixtures';
import { box, para, toyNative } from '../tests/toyPack';
import { CheckRunner, problem } from './index';
import { checkBases, conflictMessage, referrersOf } from './base';
import {
  formatPropertyProblems,
  newFormatProblems,
  propertyProblems,
  unknownFormatProblems
} from './schema';
import { diffTrees, scopeProblems } from './scope';
import type { NfNode, NormalForm } from '../tree';
import type { WriteInput } from '../envelope';

const doc = toyNative(
  para('Title', { bold: true }),
  box([para('one'), para('two', { bold: true })], { name: 'alpha' }),
  para('Items: 2', { formula: 'count(alpha)' })
);
// n1 Title, n2 box alpha, n3 one, n4 two, n5 formula

const write = (over: Partial<WriteInput>): WriteInput => ({
  intent: 'test',
  scope: { ids: [] },
  changes: [{ kind: 'delete', id: 'n1', base: 'x' }],
  ...over
});

describe('check runner', () => {
  it('records each check in order and collects problems', () => {
    const r = new CheckRunner();
    expect(r.run('a', () => [])).toBe(true);
    expect(r.run('b', () => [problem('b', 'broke')])).toBe(false);
    r.record('c', true);
    expect(r.checks).toEqual([
      { name: 'a', pass: true },
      { name: 'b', pass: false },
      { name: 'c', pass: true }
    ]);
    expect(r.failed).toBe(true);
    expect(r.problems[0]).toEqual({
      invariant: 'b',
      destroyed: 'broke',
      detail: [],
      retry: 'modified_input',
      read: []
    });
  });
});

describe('base hashes (compare-and-swap)', () => {
  const s = stateOf(doc);
  const base = (id: string) => baseOf(s.view.get(id));
  const shape = (id: string) => shapeOf(s.view.get(id) as NfNode, s.pack.tree);

  it('passes when every carried hash matches the live document (true negative)', () => {
    expect(
      checkBases(
        s.view,
        s.pack,
        write({
          changes: [
            { kind: 'delete', id: 'n3', base: base('n3') },
            {
              kind: 'insert_after',
              anchor: 'n4',
              container: shape('n2'),
              node: { text: 'x' }
            },
            {
              kind: 'set',
              target: { find: { kind: 'para' }, total: 4 },
              props: { bold: true }
            },
            {
              kind: 'set',
              target: {
                formatId: 'f1',
                base: baseOf(s.view.nf.formats.f1),
                referrers: 2
              },
              props: { bold: false }
            }
          ]
        }),
        'h'
      )
    ).toBeNull();
  });

  it('reports a stale node with its live state, a stale container, a moved total and referrers (true positive)', () => {
    const c = checkBases(
      s.view,
      s.pack,
      write({
        changes: [
          { kind: 'replace', id: 'n3', base: 'old', node: { text: 'x' } },
          {
            kind: 'insert_before',
            anchor: 'n4',
            container: 'old',
            node: { text: 'y' }
          },
          {
            kind: 'set',
            target: { find: { kind: 'para', limit: 1 }, total: 3 },
            props: { bold: true }
          },
          {
            kind: 'set',
            target: {
              formatId: 'f1',
              base: baseOf(s.view.nf.formats.f1),
              referrers: 5
            },
            props: { bold: false }
          }
        ]
      }),
      'h'
    );
    expect(c?.stale.map((e) => [e.id, e.base, e.shape])).toEqual([
      ['n3', 'old', undefined],
      ['n2', undefined, 'old']
    ]);
    expect(c?.stale[0].live).toEqual(
      expect.objectContaining({
        id: 'n3',
        kind: 'para',
        text: 'one',
        base: base('n3'),
        shape: shape('n3')
      })
    );
    expect(c?.bulk).toEqual([
      { find: { kind: 'para', limit: 1 }, total: 3, live: 4 }
    ]);
    expect(c?.formats).toEqual([
      {
        id: 'f1',
        base: baseOf(s.view.nf.formats.f1),
        referrers: 5,
        live: 2,
        liveBase: baseOf(s.view.nf.formats.f1),
        liveEntry: { base: baseOf(s.view.nf.formats.f1), bold: true }
      }
    ]);
    expect(c?.outlineHash).toBe('h');
    expect(conflictMessage(c as NonNullable<typeof c>)).toBe(
      '2 node(s) changed since they were read; a bulk target now matches 4 node(s), not 3; format f1 now has 2 referrer(s), not 5.'
    );
  });

  it('reports a changed format entry with the live entry', () => {
    const c = checkBases(
      s.view,
      s.pack,
      write({
        changes: [
          {
            kind: 'set',
            target: { formatId: 'f1', base: 'old', referrers: 2 },
            props: { bold: false }
          }
        ]
      }),
      'h'
    );
    expect(c?.formats[0]).toEqual(
      expect.objectContaining({
        id: 'f1',
        base: 'old',
        liveBase: baseOf({ bold: true }),
        liveEntry: { base: baseOf({ bold: true }), bold: true }
      })
    );
  });

  it('a change inside a child moves the parent base but not its shape; a new child moves both', () => {
    const edited = stateOf(doc.replace('"text":"one"', '"text":"uno"'));
    expect(baseOf(edited.view.get('n2'))).not.toBe(base('n2'));
    expect(shapeOf(edited.view.get('n2') as NfNode, edited.pack.tree)).toBe(
      shape('n2')
    );
    const grown = stateOf(
      doc.replace('"items":[', '"items":[{"t":"p","text":"zero"},')
    );
    expect(shapeOf(grown.view.get('n2') as NfNode, grown.pack.tree)).not.toBe(
      shape('n2')
    );
  });

  it('counts referrers by a node own fields only', () => {
    expect(referrersOf(s.view, s.pack, 'f1').sort()).toEqual(['n1', 'n4']);
  });
});

describe('property schema', () => {
  const s = stateOf(doc);
  it('accepts valid values and null clears (true negative)', () => {
    expect(
      propertyProblems(
        s.pack,
        'para',
        { bold: true, size: 12, align: null },
        'n1'
      )
    ).toEqual([]);
    expect(formatPropertyProblems(s.pack, { size: 30 }, 'f1')).toEqual([]);
    expect(newFormatProblems(s.pack, { 'tmp:a': { bold: true } })).toEqual([]);
  });

  it('refuses unknown names, derived properties and invalid values, naming the card (true positive)', () => {
    const [p] = propertyProblems(
      s.pack,
      'para',
      { colour: 'red', length: 3, size: 100 },
      'n1'
    );
    expect(p.invariant).toBe('property-invalid');
    expect(p.read).toEqual(['schema(para)']);
    expect(p.destroyed).toContain('colour on para n1: unknown property');
    expect(p.destroyed).toContain('length on para n1: derived');
    expect(p.destroyed).toContain(
      'size on para n1: 100 must be an integer from 6 to 72'
    );
    expect(p.hint).toBe('Writable properties here: bold, size, align.');
    expect(
      propertyProblems(s.pack, 'doc', { bold: true }, 'root')[0].destroyed
    ).toContain('has no properties');
    expect(
      formatPropertyProblems(s.pack, { align: 'left' }, 'f1')[0].read
    ).toEqual(['schema(format)']);
    expect(
      newFormatProblems(s.pack, { 'tmp:a': { shade: 1 } })[0].invariant
    ).toBe('format-entry-rejected');
  });

  it('finds format references the document and the write do not have', () => {
    const known = new Set(['f1', 'f2', 'tmp:new']);
    expect(
      unknownFormatProblems(
        s.pack,
        [{ style: 'f1' }, { style: 'tmp:new' }],
        known
      )
    ).toEqual([]);
    const [p] = unknownFormatProblems(
      s.pack,
      [{ items: [{ style: 'f9' }] }],
      known
    );
    expect(p.invariant).toBe('unknown-format');
    expect(p.detail).toEqual(['f9']);
  });
});

describe('scope', () => {
  const s = stateOf(doc);
  const edit = (mutate: (nf: NormalForm) => void) => {
    const nf: NormalForm = JSON.parse(JSON.stringify(s.view.nf));
    mutate(nf);
    return makeView(nf, s.pack);
  };
  const blocks = (nf: NormalForm) => nf.root.blocks as NfNode[];
  const items = (nf: NormalForm) => blocks(nf)[1].items as NfNode[];
  const check = (
    after: ReturnType<typeof edit>,
    ids: string[],
    extra: Partial<Parameters<typeof scopeProblems>[0]> = {}
  ) =>
    scopeProblems({
      before: s.view,
      after,
      pack: s.pack,
      diff: diffTrees(s.view, after, s.pack),
      write: write({ scope: { ids } }),
      bulkHits: new Map(),
      finalizerIds: new Set(),
      ...extra
    });

  it('diffs own changes, removals, creations, moves and reorders', () => {
    const after = edit((nf) => {
      items(nf)[0].text = 'ONE';
      items(nf).reverse();
      blocks(nf).splice(0, 1);
      blocks(nf).push({ id: 'n9', kind: 'para', text: 'new', style: 'f2' });
    });
    const d = diffTrees(s.view, after, s.pack);
    expect([...d.removed]).toEqual(['n1']);
    expect([...d.created]).toEqual(['n9']);
    expect([...d.changed].sort()).toEqual(['n2', 'n3', 'root']);
    expect([...d.moved]).toEqual(['n3']);
    expect([...d.membershipOnly].sort()).toEqual(['n2', 'root']);
  });

  it('covers a declared node and everything below it (true negative)', () => {
    expect(
      check(
        edit((nf) => {
          items(nf)[0].text = 'ONE';
        }),
        ['n3']
      )
    ).toEqual([]);
    expect(
      check(
        edit((nf) => {
          items(nf)[0].text = 'ONE';
        }),
        ['n2']
      )
    ).toEqual([]);
  });

  it('covers a parent whose only change is a created child, without declaring it', () => {
    expect(
      check(
        edit((nf) => {
          items(nf).push({ id: 'n9', kind: 'para', text: 'x', style: 'f2' });
        }),
        []
      )
    ).toEqual([]);
  });

  it('covers a deletion only when the deleted node is declared', () => {
    expect(
      check(
        edit((nf) => {
          items(nf).splice(0, 1);
        }),
        ['n3']
      )
    ).toEqual([]);
    const [p] = check(
      edit((nf) => {
        items(nf).splice(0, 1);
      }),
      []
    );
    expect(p.invariant).toBe('scope');
    expect(p.destroyed).toContain('n3 (para "one") removed');
  });

  it('refuses a change to an undeclared node, naming it (true positive)', () => {
    const [p] = check(
      edit((nf) => {
        blocks(nf)[0].text = 'Changed';
        items(nf)[0].text = 'ONE';
      }),
      ['n3']
    );
    expect(p.invariant).toBe('scope');
    expect(p.detail).toEqual([{ id: 'n1', removed: false }]);
  });

  it('covers finalizer-declared nodes and bulk matches that scope.bulk repeats', () => {
    const after = edit((nf) => {
      blocks(nf)[2].text = 'Items: 3';
    });
    expect(check(after, [], { finalizerIds: new Set(['n5']) })).toEqual([]);
    const bulkWrite = write({
      scope: { ids: [], bulk: [{ find: { kind: 'para' }, total: 4 }] },
      changes: [
        {
          kind: 'set',
          target: { find: { kind: 'para', limit: 9 }, total: 4 },
          props: { bold: true }
        }
      ]
    });
    const args = {
      before: s.view,
      after,
      pack: s.pack,
      diff: diffTrees(s.view, after, s.pack),
      finalizerIds: new Set<string>()
    };
    expect(
      scopeProblems({
        ...args,
        write: bulkWrite,
        bulkHits: new Map([[0, ['n5']]])
      })
    ).toEqual([]);
    const unrepeated = { ...bulkWrite, scope: { ids: [] } };
    const problems = scopeProblems({
      ...args,
      write: unrepeated,
      bulkHits: new Map([[0, ['n5']]])
    });
    expect(problems.map((p) => p.destroyed)).toEqual([
      expect.stringContaining('not repeated in scope.bulk'),
      expect.stringContaining('outside the declared scope: n5')
    ]);
  });

  it('requires a format-entry set to be acknowledged in scope.formats', () => {
    const fw = write({
      changes: [
        {
          kind: 'set',
          target: { formatId: 'f1', base: 'b', referrers: 2 },
          props: { bold: false }
        }
      ]
    });
    const args = {
      before: s.view,
      after: s.view,
      pack: s.pack,
      diff: diffTrees(s.view, s.view, s.pack),
      bulkHits: new Map(),
      finalizerIds: new Set<string>()
    };
    expect(scopeProblems({ ...args, write: fw })[0].destroyed).toContain(
      'scope.formats does not acknowledge'
    );
    expect(
      scopeProblems({
        ...args,
        write: {
          ...fw,
          scope: { ids: [], formats: [{ id: 'f1', referrers: 2 }] }
        }
      })
    ).toEqual([]);
  });
});
