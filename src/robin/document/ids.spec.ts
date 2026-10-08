import { IdTable, formatRefsIn, mintWritten, renameFormatRefs } from './ids';
import { NfNode, NormalForm, indexTree, walk } from './tree';
import { box, makeToyPack, para, toyNative } from './tests/toyPack';

const pack = makeToyPack();
const adopt = (table: IdTable, native: string, previous: NormalForm[] = []) =>
  table.adopt(
    pack.adapter.toNormalForm(native),
    pack.tree,
    pack.formatRefKeys,
    previous
  );
const ids = (nf: NormalForm) => {
  const out: string[] = [];
  walk(nf.root, pack.tree, ({ node }) => {
    out.push(`${node.id}:${node.kind}:${node.text ?? node.name ?? ''}`);
  });
  return out;
};

describe('id table: adoption and re-anchoring', () => {
  it('mints root, node and format ids, rekeys residue, and keeps the round trip', () => {
    const native = toyNative(
      para('a', { bold: true }),
      para('b', { x: 'kept' }),
      box([para('c')], { name: 'k' })
    );
    const { nf, residue } = adopt(new IdTable(), native);
    expect(ids(nf)).toEqual([
      'root:doc:',
      'n1:para:a',
      'n2:para:b',
      'n3:box:k',
      'n4:para:c'
    ]);
    expect(Object.keys(nf.formats)).toEqual(['f1', 'f2']);
    expect(residue).toEqual({ n2: { x: 'kept' } });
    expect(pack.adapter.fromNormalForm(nf, residue)).toBe(native);
  });

  it('re-adopting the same bytes keeps every id', () => {
    const table = new IdTable();
    const native = toyNative(para('a'), para('a'), para('b', { size: 9 }));
    const first = adopt(table, native);
    const second = adopt(table, native, [first.nf]);
    expect(second.nf).toEqual(first.nf);
  });

  it('keeps ids across a user insert at the top, and mints one id for the new node', () => {
    const table = new IdTable();
    const first = adopt(table, toyNative(para('a'), para('b')));
    const second = adopt(table, toyNative(para('new'), para('a'), para('b')), [
      first.nf
    ]);
    expect(ids(second.nf)).toEqual([
      'root:doc:',
      'n3:para:new',
      'n1:para:a',
      'n2:para:b'
    ]);
  });

  it('keeps a node id when its text changes (same kind in the same gap)', () => {
    const table = new IdTable();
    const first = adopt(table, toyNative(para('a'), para('b'), para('c')));
    const second = adopt(table, toyNative(para('a'), para('B!'), para('c')), [
      first.nf
    ]);
    expect(ids(second.nf)).toEqual([
      'root:doc:',
      'n1:para:a',
      'n2:para:B!',
      'n3:para:c'
    ]);
  });

  it('gives repeated equal paragraphs distinct ids in sequence, and a deleted one is not reused', () => {
    const table = new IdTable();
    const first = adopt(table, toyNative(para('x'), para('x'), para('x')));
    const second = adopt(table, toyNative(para('x'), para('x')), [first.nf]);
    expect(ids(second.nf)).toEqual(['root:doc:', 'n1:para:x', 'n2:para:x']);
  });

  it('pins a node by the identity the pack tracks, even when its content and place change', () => {
    const table = new IdTable();
    const first = adopt(
      table,
      toyNative(
        box([para('1')], { name: 'alpha' }),
        box([para('2')], { name: 'beta' })
      )
    );
    const second = adopt(
      table,
      toyNative(
        box([para('2'), para('3')], { name: 'beta' }),
        box([para('1'), para('9')], { name: 'alpha' })
      ),
      [first.nf]
    );
    const byName = Object.fromEntries(
      ids(second.nf)
        .filter((s) => s.includes(':box:'))
        .map((s) => [s.split(':')[2], s.split(':')[0]])
    );
    const before = Object.fromEntries(
      ids(first.nf)
        .filter((s) => s.includes(':box:'))
        .map((s) => [s.split(':')[2], s.split(':')[0]])
    );
    expect(byName).toEqual(before);
  });

  it('keeps a format id while its content is unchanged and mints one for new content', () => {
    const table = new IdTable();
    const first = adopt(table, toyNative(para('a', { bold: true }), para('b')));
    const second = adopt(
      table,
      toyNative(para('a', { bold: true }), para('b', { size: 20 })),
      [first.nf]
    );
    const styleOf = (nf: NormalForm, text: string) => {
      let s = '';
      walk(nf.root, pack.tree, ({ node }) => {
        if (node.text === text) s = String(node.style);
      });
      return s;
    };
    expect(styleOf(second.nf, 'a')).toBe(styleOf(first.nf, 'a'));
    expect(second.nf.formats[styleOf(second.nf, 'b')]).toEqual({ size: 20 });
    expect(Object.keys(first.nf.formats)).not.toContain(
      styleOf(second.nf, 'b')
    );
  });

  it('after a tracked commit, continues kept and new nodes from the intended tree and deleted ones from before', () => {
    const table = new IdTable();
    const pre = adopt(table, toyNative(para('keep'), para('drop'))).nf;
    // the intended document: "drop" removed, a new paragraph minted as n9 by the write
    const intended: NormalForm = JSON.parse(JSON.stringify(pre));
    const blocks = intended.root.blocks as NfNode[];
    blocks.splice(1, 1, {
      id: 'n9',
      kind: 'para',
      text: 'added',
      style: blocks[0].style
    });
    const post = adopt(
      table,
      toyNative(
        para('keep'),
        para('drop', { rev: 'del' }),
        para('added', { rev: 'ins' })
      ),
      [intended, pre]
    );
    expect(ids(post.nf)).toEqual([
      'root:doc:',
      'n1:para:keep',
      'n2:para:drop',
      'n9:para:added'
    ]);
  });
});

describe('minting a written tree', () => {
  const originalParents = (nf: NormalForm) => {
    const index = indexTree(nf.root, pack.tree);
    return (id: string) => index.get(id)?.parent?.id ?? null;
  };

  it('maps temporary ids, mints id-less nodes and keeps engine ids', () => {
    const table = new IdTable();
    const { nf } = adopt(table, toyNative(para('a')));
    (nf.root.blocks as NfNode[]).push({
      id: 'tmp:box',
      kind: 'box',
      items: [{ kind: 'para', text: 'in' } as NfNode]
    } as NfNode);
    const r = mintWritten(nf.root, pack.tree, table, originalParents(nf));
    expect(r.mapping).toEqual({ 'tmp:box': 'n2' });
    expect(r.created).toEqual(['n2', 'n3']);
    expect(r.copies).toEqual({});
    expect(ids(nf)).toEqual([
      'root:doc:',
      'n1:para:a',
      'n2:box:',
      'n3:para:in'
    ]);
  });

  it('treats a repeated id as a copy; the occurrence the write left in place keeps it', () => {
    const table = new IdTable();
    const { nf } = adopt(table, toyNative(box([para('a')], { name: 'k' })));
    const original = (nf.root.blocks as NfNode[])[0];
    const parents = originalParents(nf);
    // a copy of the box placed before the original: the copy and everything in it are new
    const copy = JSON.parse(JSON.stringify(original));
    (nf.root.blocks as NfNode[]).unshift(copy);
    const r = mintWritten(
      nf.root,
      pack.tree,
      table,
      parents,
      (n) => n === copy
    );
    expect(ids(nf)).toEqual([
      'root:doc:',
      'n3:box:k',
      'n4:para:a',
      'n1:box:k',
      'n2:para:a'
    ]);
    expect(r.copies).toEqual({ n3: 'n1', n4: 'n2' });
  });

  it('without an untouched occurrence, the one under the original parent keeps the id', () => {
    const table = new IdTable();
    const { nf } = adopt(table, toyNative(para('a'), box([para('b')])));
    const parents = originalParents(nf);
    const [a, bx] = nf.root.blocks as NfNode[];
    const moved = JSON.parse(JSON.stringify(a));
    const kept = JSON.parse(JSON.stringify(a));
    (bx.items as NfNode[]).push(moved);
    nf.root.blocks = [kept, bx];
    const r = mintWritten(
      nf.root,
      pack.tree,
      table,
      parents,
      (n) => n === moved || n === kept
    );
    expect(ids(nf)).toEqual([
      'root:doc:',
      'n1:para:a',
      'n2:box:',
      'n3:para:b',
      'n4:para:a'
    ]);
    expect(r.copies).toEqual({ n4: 'n1' });
  });

  it('keeps the id of a node moved into a new container', () => {
    const table = new IdTable();
    const { nf } = adopt(table, toyNative(para('a'), para('b')));
    const [a, b] = nf.root.blocks as NfNode[];
    nf.root.blocks = [{ kind: 'box', items: [a] } as unknown as NfNode, b];
    const r = mintWritten(nf.root, pack.tree, table, originalParents(nf));
    expect(ids(nf)).toEqual(['root:doc:', 'n3:box:', 'n1:para:a', 'n2:para:b']);
    expect(r.copies).toEqual({});
  });
});

describe('format references', () => {
  it('finds and renames references under the pack keys only', () => {
    const node = {
      id: 'n1',
      kind: 'para',
      style: 'a',
      note: { style: 'b' },
      text: 'a'
    };
    expect([...formatRefsIn(node, ['style'])].sort()).toEqual(['a', 'b']);
    renameFormatRefs(
      node,
      ['style'],
      new Map([
        ['a', 'f1'],
        ['b', 'f2']
      ])
    );
    expect(node).toEqual({
      id: 'n1',
      kind: 'para',
      style: 'f1',
      note: { style: 'f2' },
      text: 'a'
    });
  });
});
