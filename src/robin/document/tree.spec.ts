import {
  NfNode,
  ancestorsOf,
  baseOf,
  canonicalJson,
  contentKey,
  hash64,
  indexTree,
  ownContentKey,
  walk
} from './tree';

const shape = {
  childLists: (n: NfNode) => (Array.isArray(n.kids) ? ['kids'] : [])
};
const tree = (): NfNode => ({
  id: 'root',
  kind: 'doc',
  kids: [
    {
      id: 'n1',
      kind: 'a',
      text: 'x',
      kids: [{ id: 'n2', kind: 'b', text: 'y' }]
    },
    { id: 'n3', kind: 'a', text: 'z' }
  ]
});

describe('tree mechanics', () => {
  it('canonical JSON ignores key order and undefined values', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: undefined }] })).toBe(
      '{"a":[{"d":2}],"b":1}'
    );
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('hashes to 16 hex digits, deterministically, and separates near inputs', () => {
    expect(hash64('abc')).toMatch(/^[0-9a-f]{16}$/);
    expect(hash64('abc')).toBe(hash64('abc'));
    expect(hash64('abc')).not.toBe(hash64('abd'));
    expect(hash64('')).not.toBe(hash64(' '));
  });

  it('base ignores ids, base and annotations but sees pending; content key ignores pending too', () => {
    const a = {
      id: 'n1',
      kind: 'p',
      text: 't',
      usedBy: ['n9'],
      derived: { v: 1 },
      base: 'x'
    };
    const b = { id: 'n7', kind: 'p', text: 't' };
    expect(baseOf(a)).toBe(baseOf(b));
    expect(baseOf({ ...b, pending: { kind: 'insertion' } })).not.toBe(
      baseOf(b)
    );
    expect(contentKey({ ...b, pending: { kind: 'insertion' } })).toBe(
      contentKey(b)
    );
    expect(baseOf({ ...b, text: 'u' })).not.toBe(baseOf(b));
    expect(baseOf({ kind: 'p', kids: [{ id: 'n1', text: 'q' }] })).toBe(
      baseOf({ kind: 'p', kids: [{ id: 'n8', text: 'q' }] })
    );
  });

  it('walks in document order with placements, and indexes ancestors', () => {
    const seen: string[] = [];
    walk(tree(), shape, (p) => {
      seen.push(`${p.node.id}@${p.depth}:${p.key}[${p.index}]`);
    });
    expect(seen).toEqual([
      'root@0:null[0]',
      'n1@1:kids[0]',
      'n2@2:kids[0]',
      'n3@1:kids[1]'
    ]);
    const index = indexTree(tree(), shape);
    expect(ancestorsOf('n2', index)).toEqual(['n1', 'root']);
    expect(index.get('n3')?.parent?.id).toBe('root');
  });

  it('skips a subtree when the visitor returns false', () => {
    const seen: string[] = [];
    walk(tree(), shape, (p) => {
      seen.push(p.node.id);
      return p.node.id !== 'n1';
    });
    expect(seen).toEqual(['root', 'n1', 'n3']);
  });

  it('own content changes with own fields and child membership, not with a child edit', () => {
    const t = tree();
    const n1 = t.kids as NfNode[];
    const before = ownContentKey(n1[0], shape);
    (n1[0].kids as NfNode[])[0].text = 'changed';
    expect(ownContentKey(n1[0], shape)).toBe(before);
    (n1[0].kids as NfNode[]).push({ id: 'n4', kind: 'b' });
    expect(ownContentKey(n1[0], shape)).not.toBe(before);
    n1[0].text = 'other';
    expect(ownContentKey(n1[0], shape)).not.toBe(
      ownContentKey({ ...n1[0], text: 'x' }, shape)
    );
  });
});
