/**
 * The tracked composition behind the splice seam: a moved node is a Deletion where it was and an
 * Insertion where it goes, and the bookmarks it holds stay with the moved copy only.
 */
import * as fs from 'fs';
import * as path from 'path';
import { WriteInput } from '../../../envelope';
import { DocumentSession } from '../../../session';
import { NfNode, NormalForm, shapeOf, walk } from '../../../tree';
import { prepareWrite } from '../../../verbs';
import { docxPack } from '../index';
import { composeTracked } from '../reconcile';
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
