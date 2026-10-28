/**
 * The live editor as the engine drives it: what the host reads from the editor and what it does
 * around an open.
 */
import { createHost, layoutOnly, LiveEditor } from '../host';
import { conservedResidue } from '../projections';
import { toNormalForm } from '../adapter/toNormalForm';
import { fromNormalForm } from '../adapter/fromNormalForm';

const editorWith = (bytes: string) => {
  let doc = bytes;
  return {
    serialize: () => doc,
    open: (s: string) => {
      doc = s;
    }
  } as unknown as LiveEditor;
};

describe('lastParagraphMarkCopied (troy-1: every reopen of a document ending in a plain paragraph exports it)', () => {
  const plain = JSON.stringify({ sections: [{ blocks: [{ inlines: [{ text: 'Last.' }] }] }], background: { color: '#FFFFFF' } });
  const flagged = JSON.stringify({ sections: [{ blocks: [{ inlines: [{ text: 'Last.' }] }] }], lastParagraphMarkCopied: true, background: { color: '#FFFFFF' } });

  it('is an export flag of a selection (for paste); the host reads a whole document without it', () => {
    expect(createHost(editorWith(flagged)).serialize()).toBe(plain);
    expect(createHost(editorWith(plain)).serialize()).toBe(plain);
  });

  it('a document that carries it keeps it in the residue: the normal form never shows it, the bytes round-trip', () => {
    const { nf, residue } = toNormalForm(flagged);
    expect(JSON.stringify(nf)).not.toContain('lastParagraphMarkCopied');
    expect(fromNormalForm(nf, residue)).toBe(flagged);
    const root = (r: ReturnType<typeof toNormalForm>) => r.residue[r.nf.root.id];
    expect(conservedResidue(root(toNormalForm(flagged)))).toEqual(conservedResidue(root(toNormalForm(plain))));
  });
});

describe('layoutOnly (troy-1: each reopen re-lays out percent-width tables)', () => {
  const doc = (cellWidth: number, grid: number[], text = 'x') =>
    JSON.stringify({ sections: [{ blocks: [{ rows: [{ cells: [{ cellFormat: { preferredWidth: 18, preferredWidthType: 'Percent', cellWidth }, blocks: [{ inlines: [{ text }] }] }] }], grid, columnCount: 1 }] }] });
  it('two exports that differ only in laid-out widths are the same document', () => {
    expect(layoutOnly(doc(92.79100429098868, [92.79100429098868]), doc(93.15071866819031, [93.15071866819031]))).toBe(true);
  });
  it('any other difference counts', () => {
    expect(layoutOnly(doc(92.79, [92.79]), doc(93.15, [93.15], 'y'))).toBe(false);
    expect(layoutOnly(doc(92.79, [92.79]).replace('"preferredWidth":18', '"preferredWidth":19'), doc(92.79, [92.79]))).toBe(false);
  });
});
