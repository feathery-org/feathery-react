/**
 * The tracked composition behind the splice seam: a moved node is a Deletion where it was and an
 * Insertion where it goes, and the bookmarks it holds stay with the moved copy only.
 */
import * as fs from 'fs';
import * as path from 'path';
import { WriteInput } from '../../../envelope';
import { DocumentSession } from '../../../session';
import { NfNode, NormalForm, baseOf, clone, shapeOf, walk } from '../../../tree';
import { makeView } from '../../../view';
import { prepareWrite } from '../../../verbs';
import { docxPack } from '../index';
import { accept, expectedRejection, reject } from '../projections';
import { ownText } from '../outline';
import { composeTracked, editorOffset, hierOf, inOrder, plan } from '../reconcile';
import { docxTree } from '../tree';
import { arr } from '../util';

const flagship = fs.readFileSync(path.join(__dirname, 'corpus', 'flagship-v4b.sfdt.json'), 'utf8');
const state = () => {
  let doc = flagship;
  const host = { serialize: () => doc, open: (s: string) => { doc = s; }, canUndo: () => false, undo: () => {}, canRedo: () => false, redo: () => {}, readOnly: () => false };
  return new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'e' } }).state;
};
const occurrences = (nf: NormalForm, id: string) => {
  const out: NfNode[] = [];
  walk(nf.root, docxTree, ({ node }) => {
    if (node.id === id) out.push(node);
  });
  return out;
};
const bookmarks = (n: NfNode) => {
  let count = 0;
  walk(n, docxTree, ({ node }) => {
    if (node.kind === 'bookmark') count += 1;
  });
  return count;
};

/** How a copy is tracked: the revision kind its content carries (pending sits on runs, marks and rows). */
const trackedAs = (n: NfNode) => {
  const text = JSON.stringify(n);
  return text.includes('"Deletion"') && !text.includes('"Insertion"') ? 'Deletion' : text.includes('"Insertion"') && !text.includes('"Deletion"') ? 'Insertion' : 'mixed';
};

describe('composeTracked', () => {
  const s = state();
  const sections = arr<NfNode>(s.view.nf.root.sections);
  const control = arr<NfNode>(sections[1].blocks)[10];
  const anchor = arr<NfNode>(sections[0].blocks)[3];

  it('the flagship control holds bookmarks (the precondition for both cases)', () => {
    expect(bookmarks(control)).toBeGreaterThan(0);
  });

  it('a moved node keeps its bookmarks on the inserted copy only', () => {
    const r = prepareWrite(state(), {
      intent: 'test',
      scope: { ids: [control.id] },
      changes: [{ kind: 'move', id: control.id, shape: shapeOf(control, docxTree), anchor: anchor.id, position: 'after', container: shapeOf(sections[0], docxTree) }]
    } as WriteInput);
    expect(r.outcome).toBe('verified');
    if (r.outcome !== 'verified') return;
    const { tracked } = composeTracked(s.view, r.intended, 't');
    const copies = occurrences(tracked, control.id);
    expect(copies).toHaveLength(2);
    const inserted = copies.find((c) => trackedAs(c) === 'Insertion') as NfNode;
    const deleted = copies.find((c) => trackedAs(c) === 'Deletion') as NfNode;
    expect(bookmarks(inserted)).toBe(bookmarks(control));
    expect(bookmarks(deleted)).toBe(0);
  });

  it('a move within the same list is tracked: a Deletion where it was, an Insertion where it goes', () => {
    // the QA move that landed immediate: the order changed, nothing left the list
    const blocks = arr<NfNode>(sections[1].blocks);
    const moving = blocks[10];
    const target = blocks[2];
    const r = prepareWrite(state(), {
      intent: 'test',
      scope: { ids: [moving.id] },
      changes: [{ kind: 'move', id: moving.id, shape: shapeOf(moving, docxTree), anchor: target.id, position: 'after', container: shapeOf(sections[1], docxTree) }]
    } as WriteInput);
    if (r.outcome !== 'verified') throw new Error(r.outcome);
    const { tracked, untracked } = composeTracked(s.view, r.intended, 't');
    const copies = occurrences(tracked, moving.id);
    expect(copies.map(trackedAs).sort()).toEqual(['Deletion', 'Insertion']);
    // the inserted copy sits where the write put it, the deleted one where it was
    const list = arr<NfNode>(arr<NfNode>(tracked.root.sections)[1].blocks).map((b) => b.id);
    expect(list.indexOf(moving.id)).toBe(3);
    expect(list.lastIndexOf(moving.id)).toBe(11);
    expect(bookmarks(copies.find((c) => trackedAs(c) === 'Deletion') as NfNode)).toBe(0);
    expect(untracked).toEqual([]);
    const p = plan({ turnId: 't', before: s.view, intended: makeView(r.intended, docxPack), beforeResidue: s.residue, intendedResidue: r.intendedResidue, beforeNative: flagship });
    expect(p.landed).toBe('card');
  });

  it('a deleted text box is itself a tracked Deletion, so accepting removes the box (92d19295 t1)', () => {
    const intended = JSON.parse(JSON.stringify(s.view.nf)) as NormalForm;
    let holder: NfNode | undefined;
    walk(intended.root, docxTree, ({ node }) => {
      if (!holder && arr<NfNode>(node.inlines).some((i) => i.kind === 'shape')) holder = node;
    });
    const shape = arr<NfNode>(holder?.inlines).find((i) => i.kind === 'shape') as NfNode;
    (holder as NfNode).inlines = arr<NfNode>(holder?.inlines).filter((i) => i !== shape);
    const { tracked } = composeTracked(s.view, intended, 't');
    const [deleted] = occurrences(tracked, shape.id);
    expect(deleted.pending).toEqual(expect.objectContaining({ kind: 'Deletion', group: 't' }));
    expect(occurrences(accept(tracked), shape.id)).toHaveLength(0);
    expect(occurrences(reject(tracked), shape.id)).toHaveLength(1);
  });

  it('a deleted node that is not moved keeps its bookmarks', () => {
    const intended = JSON.parse(JSON.stringify(s.view.nf)) as NormalForm;
    const blocks = arr<NfNode>(arr<NfNode>(intended.root.sections)[1].blocks);
    blocks.splice(10, 1);
    const { tracked } = composeTracked(s.view, intended, 't');
    const [deleted] = occurrences(tracked, control.id);
    expect(trackedAs(deleted)).toBe('Deletion');
    expect(bookmarks(deleted)).toBe(bookmarks(control));
  });

  it('a paragraph rewritten inside an earlier pending insertion keeps that insertion mark', () => {
    const nf = JSON.parse(JSON.stringify(s.view.nf)) as NormalForm;
    let id = '';
    walk(nf.root, docxTree, ({ node }) => {
      const runs = arr<NfNode>(node.inlines);
      if (id || node.kind !== 'paragraph' || !runs.length || runs.some((r) => r.kind !== 'run')) return;
      id = node.id;
      const earlier = { kind: 'Insertion', author: 'Robin', group: 'X' };
      node.pending = { mark: { ...earlier } };
      for (const r of runs) r.pending = { ...earlier };
    });
    const intended = JSON.parse(JSON.stringify(nf)) as NormalForm;
    const [rewritten] = occurrences(intended, id);
    delete rewritten.pending;
    rewritten.inlines = [{ kind: 'run', text: 'fixed' }];
    const { tracked } = composeTracked(makeView(nf, docxPack), intended, 'X.2');
    const [paragraph] = occurrences(tracked, id);
    expect(paragraph.pending).toEqual({ mark: { kind: 'Insertion', author: 'Robin', group: 'X' } });
  });
});

describe('composeTracked: moving text still pending in an earlier card', () => {
  it('the moved copy is the mover\'s alone, the copy left behind keeps the earlier insertion (ece57233 t3)', () => {
    const nf = JSON.parse(JSON.stringify(state().view.nf)) as NormalForm;
    const blocks = arr<NfNode>(arr<NfNode>(nf.root.sections)[1].blocks);
    const at = blocks.findIndex((b, i) => i > 3 && b.kind === 'paragraph' && arr<NfNode>(b.inlines).length > 0 && arr<NfNode>(b.inlines).every((r) => r.kind === 'run'));
    const moving = blocks[at];
    const earlier = { kind: 'Insertion', author: 'Robin', group: 'X' };
    moving.pending = { mark: { ...earlier } };
    for (const r of arr<NfNode>(moving.inlines)) r.pending = { ...earlier };
    const intended = JSON.parse(JSON.stringify(nf)) as NormalForm;
    const list = arr<NfNode>(arr<NfNode>(intended.root.sections)[1].blocks);
    list.splice(2, 0, ...list.splice(at, 1));
    const { tracked } = composeTracked(makeView(nf, docxPack), intended, 'Y');
    const [placed, left] = occurrences(tracked, moving.id);
    const groups = (n: NfNode) => {
      const out = new Set<string>();
      walk(n, docxTree, ({ node }) => {
        for (const p of [node.pending, (node.pending as NfNode | undefined)?.mark])
          for (const r of arr<NfNode>((p as NfNode | undefined)?.revisions ?? (p ? [p] : []))) if (r.kind) out.add(`${r.kind} ${r.group}`);
      });
      return [...out].sort();
    };
    expect(groups(placed)).toEqual(['Insertion Y']);
    expect(groups(left)).toEqual(['Deletion Y', 'Insertion X']);
  });
});

describe('inOrder: which ids a reordering moved', () => {
  const size = (id: string) => (id === 'T' ? 1000 : 1);
  it('the fewest nodes move: a large node carried past four small ones is the one that moved', () => {
    expect([...inOrder(['a', 'b', 'c', 'd', 'T'], ['T', 'a', 'b', 'c', 'd'], size)]).toEqual(['a', 'b', 'c', 'd']);
  });
  it('between two that swap, the small one moved', () => {
    expect([...inOrder(['p', 'T'], ['T', 'p'], size)]).toEqual(['T']);
    expect([...inOrder(['T', 'p'], ['p', 'T'], size)]).toEqual(['T']);
  });
  it('an unchanged order, insertions and removals move nothing', () => {
    expect([...inOrder(['a', 'b', 'c'], ['x', 'a', 'c'])]).toEqual(['a', 'c']);
  });
});

describe('plan: a set on a shared format entry', () => {
  it('lands on every referrer through the format seam (the first formatId target driven through plan)', () => {
    // two body paragraphs whose runs share one character format
    let doc = JSON.stringify({
      sections: [
        { blocks: [{ inlines: [{ text: 'Alpha', characterFormat: { bold: true } }] }, { inlines: [{ text: 'Beta', characterFormat: { bold: true } }] }] }
      ]
    });
    const host = { serialize: () => doc, open: (x: string) => { doc = x; }, canUndo: () => false, undo: () => {}, canRedo: () => false, redo: () => {}, readOnly: () => false };
    const s = new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'e' } }).state;
    const nodes = s.view.nodes();
    const referrersOf = (id: string) => nodes.filter((n) => Object.values(n).includes(id));
    const formatId = String(nodes.find((n) => n.kind === 'run')?.style);
    const referrers = referrersOf(formatId);
    const italic = s.view.nf.formats[formatId]?.italic !== true;
    const entryBefore = JSON.stringify(s.view.nf.formats[formatId]);
    const r = prepareWrite(s, {
      intent: 'Make the runs of this format bold.',
      scope: { ids: [], formats: [{ id: formatId, referrers: referrers.length }] },
      changes: [{ kind: 'set', target: { formatId, base: baseOf(s.view.nf.formats[formatId]), referrers: referrers.length }, props: { italic } }]
    } as WriteInput);
    if (r.outcome !== 'verified') throw new Error(JSON.stringify(r).slice(0, 900));
    expect(r.intended.formats[formatId]).toEqual(expect.objectContaining({ italic }));
    // the document before the write is not changed by it
    expect(JSON.stringify(s.view.nf.formats[formatId])).toBe(entryBefore);
    const p = plan({ turnId: 't', before: s.view, intended: makeView(r.intended, docxPack), beforeResidue: s.residue, intendedResidue: r.intendedResidue, beforeNative: doc });
    expect(p.steps.map((x) => x.seam)).toEqual(['format']);
    const ops = p.steps[0].payload as Array<{ props: Record<string, unknown> }>;
    expect(ops).toHaveLength(referrers.length);
    for (const op of ops) expect(op.props).toEqual(expect.objectContaining({ italic }));
    expect(p.landed).toBe('immediate');
  });
});

describe('composeTracked: feature attributes are content, not formatting', () => {
  const find = (nf: NormalForm, id: string) => occurrences(nf, id);
  const cases: Array<[string, (b: Record<string, unknown>) => unknown]> = [
    ['a rewritten formula', (b) => ({ ...b, expr: '0' })],
    ['an unbound control (binding removed)', () => undefined]
  ];
  for (const [name, change] of cases)
    it(`${name} on a kept control is a tracked replacement that reject undoes`, () => {
      const s = state();
      const control = s.view.nodes().find((n) => n.kind === 'control' && typeof (n.binding as { expr?: unknown } | undefined)?.expr === 'string') as NfNode;
      expect(control).toBeDefined();
      const intended = JSON.parse(JSON.stringify(s.view.nf)) as NormalForm;
      const target = find(intended, control.id)[0];
      const next = change(target.binding as Record<string, unknown>);
      if (next === undefined) delete target.binding;
      else target.binding = next;
      // a write that replaces the binding may leave the title out (acd4ca62 #10)
      delete target.title;
      const { tracked, untracked } = composeTracked(s.view, intended, 't');
      expect(untracked).not.toContain(control.id);
      const copies = find(tracked, control.id);
      expect(copies.map(trackedAs).sort()).toEqual(['Deletion', 'Insertion']);
      const bindingIn = (nf: NormalForm) => find(nf, control.id).map((n) => JSON.stringify(n.binding ?? null));
      expect(bindingIn(reject(tracked))).toEqual([JSON.stringify(control.binding)]);
      expect(bindingIn(accept(tracked))).toEqual([JSON.stringify(next ?? null)]);
      // what rejecting should restore keeps the feature as it was (formatting would stay applied)
      expect(bindingIn(expectedRejection(s.view.nf, intended))).toEqual([JSON.stringify(control.binding)]);
      const titled = JSON.parse(JSON.stringify(s.view.nf)) as NormalForm;
      find(titled, control.id)[0].title = 'Total Annual Premium';
      expect(find(expectedRejection(titled, intended), control.id)[0].title).toBe('Total Annual Premium');
    });
});

describe('plan: paragraph, table, row and cell properties', () => {
  const s = state();
  const nodes = s.view.nodes();
  // a plain table the editor addresses natively (not inside a block control)
  const table = nodes.find((n) => n.kind === 'table' && hierOf(s.view, arr<NfNode>(arr<NfNode>(arr<NfNode>(n.rows)[0].cells)[0].blocks)[0].id) !== null) as NfNode;
  const row = arr<NfNode>(table.rows)[1];
  const cell = arr<NfNode>(row.cells)[1];
  const paragraph = nodes.find((n) => n.kind === 'paragraph' && hierOf(s.view, n.id) !== null && typeof n.style === 'string') as NfNode;
  const planFor = (id: string, props: Record<string, unknown>) => {
    const node = s.view.get(id) as NfNode;
    const r = prepareWrite(state(), { intent: 'x', scope: { ids: [id] }, changes: [{ kind: 'set', target: { ids: [id], shape: { [id]: shapeOf(node, docxTree) } }, props }] } as WriteInput);
    if (r.outcome !== 'verified') throw new Error(JSON.stringify(r).slice(0, 600));
    return plan({ turnId: 't', before: s.view, intended: makeView(r.intended, docxPack), beforeResidue: s.residue, intendedResidue: r.intendedResidue, beforeNative: flagship });
  };
  const ops = (p: ReturnType<typeof plan>) => p.steps[0].payload as Array<{ target: string; props: Record<string, unknown> }>;

  it('a paragraph property goes through the native format seam and lands immediately', () => {
    const p = planFor(paragraph.id, { textAlignment: 'Center' });
    expect(p.steps.map((x) => x.seam)).toEqual(['format']);
    expect(p.landed).toBe('immediate');
    expect(p.history).toBe('editor');
    expect(ops(p)).toEqual([expect.objectContaining({ target: 'paragraph', props: { textAlignment: 'Center' } })]);
  });

  it('cell, row and table properties go through the native format seam', () => {
    const c = planFor(cell.id, { verticalAlignment: 'Bottom' });
    expect(c.steps.map((x) => x.seam)).toEqual(['format']);
    expect(ops(c)).toEqual([expect.objectContaining({ target: 'cell', props: { verticalAlignment: 'Bottom' } })]);
    const current = (s.view.nf.formats[String(cell.style)]?.shading ?? {}) as Record<string, unknown>;
    const shade = planFor(cell.id, { shading: { ...current, backgroundColor: '#FFEE00' } });
    expect(ops(shade)).toEqual([expect.objectContaining({ target: 'cell', props: { background: '#FFEE00' } })]);
    const r = planFor(row.id, { height: 30, heightType: 'AtLeast' });
    expect(ops(r)).toEqual([expect.objectContaining({ target: 'row', props: expect.objectContaining({ height: 30 }) })]);
    const t = planFor(table.id, { tableAlignment: 'Center' });
    expect(ops(t)).toEqual([expect.objectContaining({ target: 'table', props: { tableAlignment: 'Center' } })]);
  });

  it('a property with no native setter falls back to splice, and lands immediately because nothing is tracked', () => {
    const borders = { top: { lineStyle: 'Single', lineWidth: 1.5, color: '#000000' } };
    const p = planFor(cell.id, { borders });
    expect(p.steps.map((x) => x.seam)).toEqual(['splice']);
    expect(p.landed).toBe('immediate');
    expect(p.history).toBe('engine');
    // the warnings agree with what landed: no card to name as the way back
    expect(p.warnings?.map((w) => w.code)).toEqual(['undo-history-cleared', 'immediate-not-tracked']);
    expect(p.warnings?.find((w) => w.code === 'undo-history-cleared')?.message).not.toMatch(/card/);
  });

  it('a deletion card does not warn of immediate changes for what a finalizer derived (a restripe)', () => {
    const st = state();
    const bound = arr<NfNode>(arr<NfNode>(arr<NfNode>(st.view.nf.root.sections)[1].blocks)[10].blocks)[0];
    const gone = arr<NfNode>(bound.rows)[2];
    const r = prepareWrite(st, { intent: 'x', scope: { ids: [gone.id] }, changes: [{ kind: 'delete', id: gone.id, base: gone.base }] } as WriteInput);
    if (r.outcome !== 'verified') throw new Error(r.outcome);
    const derived = r.facts.filter((f) => f.kind === 'finalizer').flatMap((f) => f.ids);
    expect(r.facts.some((f) => f.name === 'restripe')).toBe(true);
    const ctx = { turnId: 't', before: st.view, intended: makeView(r.intended, docxPack), beforeResidue: st.residue, intendedResidue: r.intendedResidue, beforeNative: flagship };
    const p = plan({ ...ctx, derived });
    expect(p.landed).toBe('card');
    expect(p.warnings?.map((w) => w.code)).toEqual(['undo-history-cleared']);
    // the restriped cells do land untracked: without the finalizer's facts they would be the write's own
    expect(plan(ctx).warnings?.map((w) => w.code)).toContain('immediate-not-tracked');
  });
});

describe('editor offsets from the normal form', () => {
  it('counts each inline control boundary as the editor does (measured: one position each)', () => {
    const s = state();
    const para = arr<NfNode>(arr<NfNode>(s.view.nf.root.sections)[0].blocks)[2];
    const text = String(ownText(para));
    // "Insurance premium tax is charged at |8.5%| percent." with a control around 8.5%
    expect(editorOffset(s.view, para.id, text.indexOf('Insurance'))).toBe(0);
    expect(editorOffset(s.view, para.id, text.indexOf('8.5%'))).toBe(text.indexOf('8.5%') + 1);
    expect(editorOffset(s.view, para.id, text.indexOf('percent'))).toBe(text.indexOf('percent') + 2);
  });

  it('a text op after a control carries the exact editor offsets', () => {
    const s = state();
    const para = arr<NfNode>(arr<NfNode>(s.view.nf.root.sections)[0].blocks)[2];
    const last = arr<NfNode>(para.inlines).filter((i) => i.kind === 'run').pop() as NfNode;
    const r = prepareWrite(s, { intent: 'x', scope: { ids: [last.id] }, changes: [{ kind: 'replace', id: last.id, base: baseOf(last), node: { kind: 'run', ...(last.style ? { style: last.style } : {}), text: String(last.text).replace('percent', 'per cent') } }] } as WriteInput);
    if (r.outcome !== 'verified') throw new Error(JSON.stringify(r).slice(0, 500));
    const p = plan({ turnId: 't', before: s.view, intended: makeView(r.intended, docxPack), beforeResidue: s.residue, intendedResidue: r.intendedResidue, beforeNative: flagship });
    const [op] = p.steps[0].payload as Array<{ a: number; at: number }>;
    expect(op.at).toBe(op.a + 2);
  });
});

describe('plan: text beside another card\'s pending change', () => {
  it('edits the runs on each side alone and never retypes the pending text (Hilb t2)', () => {
    const s = state();
    const nf = clone(s.view.nf);
    let before = makeView(nf, docxPack);
    // a plain one-run paragraph split into three runs, the middle one pending another card's deletion
    const para = before.nodes().find((n) => n.kind === 'paragraph' && hierOf(before, n.id) !== null && arr<NfNode>(n.inlines).length === 1 && String(arr<NfNode>(n.inlines)[0].text).split(' ').length >= 4) as NfNode;
    const [run] = arr<NfNode>(para.inlines);
    const words = String(run.text).split(' ');
    const [first, middle, last] = [words[0], ` ${words.slice(1, -1).join(' ')} `, words[words.length - 1]].map((text, k) => ({ ...clone(run), id: `${run.id}s${k}`, text }));
    para.inlines = [first, middle, last];
    middle.pending = { kind: 'Deletion', author: 'Robin', group: 'earlier' };
    before = makeView(nf, docxPack);
    const intendedNf = clone(nf);
    const runs = arr<NfNode>(makeView(intendedNf, docxPack).get(para.id)?.inlines);
    runs[0].text = 'Berkley Southwest';
    runs[runs.length - 1].text = '10 Even Payment';
    const p = plan({ turnId: 't', before, intended: makeView(intendedNf, docxPack), beforeResidue: s.residue, intendedResidue: s.residue, beforeNative: flagship });
    expect(p.steps[0].seam).toBe('text');
    const ops = p.steps[0].payload as Array<{ oldMid: string; newMid: string }>;
    expect(ops.map((o) => [o.oldMid, o.newMid])).toEqual([[first.text, 'Berkley Southwest'], [last.text, '10 Even Payment']]);
  });
});

describe('a write that carries a control\'s native properties', () => {
  it('has them stripped as read-only, with the hint to write the binding or the title', () => {
    const s = state();
    const control = s.view.nodes().find((n) => n.kind === 'control' && Array.isArray(n.inlines)) as NfNode;
    expect(control.contentControlProperties).toBeUndefined();
    const r = prepareWrite(s, {
      intent: 'x',
      scope: { ids: [control.id] },
      changes: [{ kind: 'replace', id: control.id, base: baseOf(control), node: { ...control, title: 'Tax rate', contentControlProperties: { lockContents: true, tag: 'raw' } } }]
    } as WriteInput);
    if (r.outcome !== 'verified') throw new Error(JSON.stringify(r).slice(0, 500));
    const warning = r.warnings.find((w) => w.code === 'stripped-read-only');
    expect(warning?.message).toMatch(/contentControlProperties.*`binding`.*`title`/);
    const written = r.intended.root && makeView(r.intended, docxPack).get(control.id) as NfNode;
    expect(written.title).toBe('Tax rate');
    expect(written.contentControlProperties).toBeUndefined();
  });
});
