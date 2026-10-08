/**
 * The tracked composition behind the splice seam: a moved node is a Deletion where it was and an
 * Insertion where it goes, and the bookmarks it holds stay with the moved copy only.
 */
import * as fs from 'fs';
import * as path from 'path';
import { WriteInput } from '../../../envelope';
import { DocumentSession } from '../../../session';
import { NfNode, NormalForm, baseOf, shapeOf, walk } from '../../../tree';
import { makeView } from '../../../view';
import { prepareWrite } from '../../../verbs';
import { docxPack } from '../index';
import { accept, expectedRejection, reject } from '../projections';
import { composeTracked, hierOf, plan } from '../reconcile';
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

  it('a deleted node that is not moved keeps its bookmarks', () => {
    const intended = JSON.parse(JSON.stringify(s.view.nf)) as NormalForm;
    const blocks = arr<NfNode>(arr<NfNode>(intended.root.sections)[1].blocks);
    blocks.splice(10, 1);
    const { tracked } = composeTracked(s.view, intended, 't');
    const [deleted] = occurrences(tracked, control.id);
    expect(trackedAs(deleted)).toBe('Deletion');
    expect(bookmarks(deleted)).toBe(bookmarks(control));
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
      const { tracked, untracked } = composeTracked(s.view, intended, 't');
      expect(untracked).not.toContain(control.id);
      const copies = find(tracked, control.id);
      expect(copies.map(trackedAs).sort()).toEqual(['Deletion', 'Insertion']);
      const bindingIn = (nf: NormalForm) => find(nf, control.id).map((n) => JSON.stringify(n.binding ?? null));
      expect(bindingIn(reject(tracked))).toEqual([JSON.stringify(control.binding)]);
      expect(bindingIn(accept(tracked))).toEqual([JSON.stringify(next ?? null)]);
      // what rejecting should restore keeps the feature as it was (formatting would stay applied)
      expect(bindingIn(expectedRejection(s.view.nf, intended))).toEqual([JSON.stringify(control.binding)]);
    });
});
