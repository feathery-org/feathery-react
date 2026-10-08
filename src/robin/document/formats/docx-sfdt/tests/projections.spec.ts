import * as fs from 'fs';
import * as path from 'path';
import { comparable, comparableText } from '../../../proof';
import { NfNode, NormalForm, canonicalJson, walk } from '../../../tree';
import { docxPack } from '../index';
import { toNormalForm } from '../adapter/toNormalForm';
import { docxTree } from '../tree';
import {
  N1,
  N2,
  N3,
  N4,
  N5,
  N6,
  N7,
  N9,
  N10,
  NORMALIZATIONS,
  UNDO_NORMALIZATIONS,
  accept,
  authoredBy,
  conservedResidue,
  expectedRejection,
  reject
} from '../projections';
import { markSubtree } from '../reconcile';

const native = fs.readFileSync(path.join(__dirname, 'corpus', 'flagship-v4b.sfdt.json'), 'utf8');
const fresh = () => toNormalForm(native).nf;
const all = (nf: NormalForm) => {
  const out: NfNode[] = [];
  walk(nf.root, docxTree, ({ node }) => {
    out.push(node);
  });
  return out;
};
const ins = (group = 't') => ({ kind: 'Insertion', author: 'Robin', group });
const del = (group = 't') => ({ kind: 'Deletion', author: 'Robin', group });
const same = (a: NormalForm, b: NormalForm) => JSON.stringify(a) === JSON.stringify(b);

describe('accept and reject projections', () => {
  it('leave a document with no pending changes as it is', () => {
    expect(same(accept(fresh()), fresh())).toBe(true);
    expect(same(reject(fresh()), fresh())).toBe(true);
  });

  it('accept drops a deleted run and keeps an inserted one; reject the reverse', () => {
    const nf = fresh();
    const para = all(nf).find((n) => n.kind === 'paragraph' && (n.inlines as NfNode[]).filter((i) => i.kind === 'run').length >= 2) as NfNode;
    const [a, b] = (para.inlines as NfNode[]).filter((i) => i.kind === 'run');
    a.pending = del();
    b.pending = ins();
    const ids = (doc: NormalForm) => (all(doc).find((n) => n.id === para.id)?.inlines as NfNode[]).map((i) => i.id);
    expect(ids(accept(nf))).not.toContain(a.id);
    expect(ids(accept(nf))).toContain(b.id);
    expect(ids(reject(nf))).toContain(a.id);
    expect(ids(reject(nf))).not.toContain(b.id);
    expect(JSON.stringify(accept(nf))).not.toContain('"pending"');
  });

  it('a paragraph whose mark and every run are deleted disappears; one with a live run stays', () => {
    const nf = fresh();
    const para = all(nf).find((n) => n.kind === 'paragraph' && (n.inlines as NfNode[]).some((i) => i.kind === 'run')) as NfNode;
    para.pending = { mark: del() };
    for (const r of (para.inlines as NfNode[]).filter((i) => i.kind === 'run')) r.pending = del();
    expect(all(accept(nf)).some((n) => n.id === para.id)).toBe(false);
    expect(all(reject(nf)).some((n) => n.id === para.id)).toBe(true);
    delete (para.inlines as NfNode[]).find((i) => i.kind === 'run')?.pending;
    expect(all(accept(nf)).some((n) => n.id === para.id)).toBe(true);
  });

  it('a table whose every row is deleted disappears, and so does a control wrapping it', () => {
    const nf = fresh();
    const table = all(nf).find((n) => n.kind === 'table') as NfNode;
    for (const r of table.rows as NfNode[]) r.pending = del();
    expect(all(accept(nf)).some((n) => n.id === table.id)).toBe(false);
    expect(all(reject(nf)).some((n) => n.id === table.id)).toBe(true);
  });

  it('a cell or section whose every block is inserted goes on reject; an untouched one stays', () => {
    const nf = fresh();
    const table = all(nf).find((n) => n.kind === 'table') as NfNode;
    const cell = (table.rows as NfNode[])[0].cells as NfNode[];
    const insertAll = (n: NfNode) => (n.blocks as NfNode[]).forEach((b) => markSubtree(b, ins()));
    insertAll(cell[0]);
    expect(all(reject(nf)).some((n) => n.id === cell[0].id)).toBe(false);
    expect(all(accept(nf)).some((n) => n.id === cell[0].id)).toBe(true);
    const section = (nf.root.sections as NfNode[]).find((x) => (x.blocks as NfNode[]).every((b) => b.kind === 'paragraph')) as NfNode;
    const kept = fresh();
    expect(section).toBeDefined();
    insertAll(section);
    expect(all(reject(nf)).some((n) => n.id === section.id)).toBe(false);
    // the untouched cell and section stay
    expect(all(reject(kept)).some((n) => n.id === cell[0].id)).toBe(true);
    expect(all(reject(kept)).some((n) => n.id === section.id)).toBe(true);
  });

  it('reads mixed revisions on one anchor as the editor does: inserted then deleted is gone either way', () => {
    // measured in the headless lane: the editor's accept-all and reject-all both remove such a run
    const nf = fresh();
    const run = all(nf).find((n) => n.kind === 'run') as NfNode;
    run.pending = { ...ins('u'), revisions: [ins('u'), del('t')] };
    expect(all(accept(nf)).some((n) => n.id === run.id)).toBe(false);
    expect(all(reject(nf)).some((n) => n.id === run.id)).toBe(false);
  });
});

describe('normalizations (each a true positive and a true negative)', () => {
  it('N1 page-number text in a header or footer only', () => {
    const nf = fresh();
    const footerRun = all(nf).find((n) => n.kind === 'run' && /^\d+$/.test(String(n.text)));
    expect(footerRun).toBeDefined();
    const before = JSON.stringify(nf);
    (footerRun as NfNode).text = '99';
    expect(JSON.stringify(N1.apply(nf))).toBe(JSON.stringify(N1.apply(JSON.parse(before))));
    const body = all(nf).find((n) => n.kind === 'run' && /[a-z]/.test(String(n.text))) as NfNode;
    const changed = JSON.parse(JSON.stringify(nf));
    (all(changed).find((n) => n.id === body.id) as NfNode).text = 'Different';
    expect(JSON.stringify(N1.apply(nf))).not.toBe(JSON.stringify(N1.apply(changed)));
  });

  it('each normalization returns its input when it has nothing left to change, a new document otherwise', () => {
    let nf = fresh();
    for (const n of [N1, N2, N3, N4, N5, N6, N7]) {
      const once = n.apply(nf);
      expect(n.apply(once)).toBe(once);
      nf = once;
    }
    // N4 on a document with the flag returns a copy and leaves the input as it was
    const flagged = fresh();
    flagged.root.trackChanges = true;
    const out = N4.apply(flagged);
    expect(out).not.toBe(flagged);
    expect(flagged.root.trackChanges).toBe(true);
  });

  it('the proof text of every corpus document, pending changes included, equals canonical comparable', () => {
    const dir = path.join(__dirname, 'corpus');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const doc = toNormalForm(fs.readFileSync(path.join(dir, file), 'utf8')).nf;
      expect(comparableText(docxPack, doc)).toBe(canonicalJson(comparable(docxPack, doc)));
    }
    const marked = fresh();
    const run = all(marked).find((n) => n.kind === 'run') as NfNode;
    run.pending = ins();
    expect(comparableText(docxPack, marked)).toBe(canonicalJson(comparable(docxPack, marked)));
  });

  it('N3 bidi:false on a run format, and nothing else', () => {
    const nf = fresh();
    const run = all(nf).find((n) => n.kind === 'run' && typeof n.style === 'string') as NfNode;
    const withBidi = JSON.parse(JSON.stringify(nf)) as NormalForm;
    const target = all(withBidi).find((n) => n.id === run.id) as NfNode;
    withBidi.formats.extra = { ...withBidi.formats[String(run.style)], bidi: false };
    target.style = 'extra';
    const canon = (d: NormalForm) => JSON.stringify(Object.fromEntries(all(d).map((n) => [n.id, n.style ? d.formats[String(n.style)] : null])));
    expect(canon(N3.apply(withBidi))).toBe(canon(N3.apply(nf)));
    withBidi.formats.extra = { ...withBidi.formats[String(run.style)], bidi: true };
    expect(canon(N3.apply(withBidi))).not.toBe(canon(N3.apply(nf)));
  });

  it('N4 the root trackChanges flag', () => {
    const a = fresh();
    const b = fresh();
    b.root.trackChanges = !a.root.trackChanges;
    expect(JSON.stringify(N4.apply(a))).toBe(JSON.stringify(N4.apply(b)));
    b.root.defaultTabWidth = 99;
    expect(JSON.stringify(N4.apply(a))).not.toBe(JSON.stringify(N4.apply(b)));
  });

  it('N2 drops references to empty formats only', () => {
    const nf = fresh();
    const run = all(nf).find((n) => n.kind === 'run' && n.style === undefined) as NfNode;
    const withEmpty = JSON.parse(JSON.stringify(nf)) as NormalForm;
    withEmpty.formats.empty = {};
    (all(withEmpty).find((n) => n.id === run.id) as NfNode).style = 'empty';
    const canon = (d: NormalForm) => JSON.stringify(all(d).map((n) => [n.id, n.style ? d.formats[String(n.style)] : null]));
    expect(canon(N2.apply(withEmpty))).toBe(canon(N2.apply(nf)));
  });

  it('N5 styleName Normal on empty paragraphs only', () => {
    const nf = fresh();
    nf.formats.normalOnly = { styleName: 'Normal' };
    const empty = all(nf).find((n) => n.kind === 'paragraph' && !(n.inlines as NfNode[]).length) as NfNode;
    const full = all(nf).find((n) => n.kind === 'paragraph' && (n.inlines as NfNode[]).some((i) => i.kind === 'run' && String(i.text).trim())) as NfNode;
    const stripped = JSON.parse(JSON.stringify(nf)) as NormalForm;
    (all(stripped).find((n) => n.id === empty.id) as NfNode).style = 'normalOnly';
    expect((all(N5.apply(stripped)).find((n) => n.id === empty.id) as NfNode).style).toBeUndefined();
    (all(stripped).find((n) => n.id === full.id) as NfNode).style = 'normalOnly';
    expect((all(N5.apply(stripped)).find((n) => n.id === full.id) as NfNode).style).toBe('normalOnly');
  });

  it('N6 merges adjacent runs that differ only in text', () => {
    const nf = fresh();
    const para = all(nf).find((n) => n.kind === 'paragraph' && (n.inlines as NfNode[]).filter((i) => i.kind === 'run').length === 1) as NfNode;
    const split = JSON.parse(JSON.stringify(nf)) as NormalForm;
    const p = all(split).find((n) => n.id === para.id) as NfNode;
    const inlines = p.inlines as NfNode[];
    const k = inlines.findIndex((i) => i.kind === 'run');
    const text = String(inlines[k].text);
    inlines.splice(k, 1, { ...inlines[k], text: text.slice(0, 3) }, { ...inlines[k], id: 'split2', text: text.slice(3) });
    const texts = (d: NormalForm) => ((all(d).find((n) => n.id === para.id) as NfNode).inlines as NfNode[]).map((i) => i.text);
    expect(texts(N6.apply(split))).toEqual(texts(N6.apply(nf)));
    inlines[k + 1].pending = ins();
    expect(texts(N6.apply(split))).not.toEqual(texts(N6.apply(nf)));
  });

  it('N7 row defaults an undo adds, only in undo comparisons', () => {
    const nf = fresh();
    const row = all(nf).find((n) => n.kind === 'row' && typeof n.style === 'string') as NfNode;
    const undone = JSON.parse(JSON.stringify(nf)) as NormalForm;
    undone.formats.withGrid = { ...undone.formats[String(row.style)], gridBefore: 0, gridAfter: 0 };
    (all(undone).find((n) => n.id === row.id) as NfNode).style = 'withGrid';
    const fmt = (d: NormalForm) => d.formats[String((all(d).find((n) => n.id === row.id) as NfNode).style)];
    expect(fmt(N7.apply(undone))).toEqual(fmt(N7.apply(nf)));
  });

  it('N10 the content control properties the editor fills in on a new control, and nothing else', () => {
    // measured on the rig (WP3 T3) and in the headless lane (D17): a control written without
    // properties reads back with exactly these
    const editorDefaults = { lockContentControl: false, lockContents: false, type: 'RichText', hasPlaceHolderText: false, multiline: false, isTemporary: false, characterFormat: {}, contentControlListItems: [] };
    const nf = fresh();
    const control = all(nf).find((n) => n.kind === 'control') as NfNode;
    const withProps = (props: unknown) => {
      const d = JSON.parse(JSON.stringify(nf)) as NormalForm;
      const c = all(d).find((n) => n.id === control.id) as NfNode;
      if (props === undefined) delete c.contentControlProperties;
      else c.contentControlProperties = props;
      return d;
    };
    const props = (d: NormalForm) => (all(N10.apply(d)).find((n) => n.id === control.id) as NfNode).contentControlProperties;
    // true negative: the editor's defaults are the same as none
    expect(props(withProps(editorDefaults))).toEqual(props(withProps(undefined)));
    // true positive: a property the write set is kept, whatever the editor filled in beside it
    expect(props(withProps({ ...editorDefaults, lockContents: true }))).toEqual({ lockContents: true });
    expect(props(withProps({ ...editorDefaults, type: 'Text' }))).toEqual({ type: 'Text' });
    expect(NORMALIZATIONS.map((n) => n.name)).toContain('N10');
  });

  it('N9 a paragraph property an undo writes back explicitly as the value it inherits, only in undo comparisons', () => {
    const nf = fresh();
    const para = all(nf).find((n) => n.kind === 'paragraph' && typeof n.style === 'string' && nf.formats[String(n.style)]?.styleName === 'Normal') as NfNode;
    const fmt = (d: NormalForm) => d.formats[String((all(d).find((n) => n.id === para.id) as NfNode).style)];
    const withValue = (value: unknown) => {
      const d = JSON.parse(JSON.stringify(nf)) as NormalForm;
      d.formats.explicit = { ...d.formats[String(para.style)], textAlignment: value };
      (all(d).find((n) => n.id === para.id) as NfNode).style = 'explicit';
      return d;
    };
    // the document default is Left: an explicit Left is the same paragraph (true negative)
    expect(fmt(N9.apply(withValue('Left')))).toEqual(fmt(N9.apply(nf)));
    // an explicit Center is a real difference (true positive)
    expect(fmt(N9.apply(withValue('Center')))).not.toEqual(fmt(N9.apply(nf)));
    const once = N9.apply(nf);
    expect(N9.apply(once)).toBe(once);
    expect(UNDO_NORMALIZATIONS.map((n) => n.name)).toEqual(['N7', 'N9']);
  });
});

describe('authorship, residue and the expected rejection', () => {
  it('a pending view is this turn\'s only when every revision in it is', () => {
    expect(authoredBy(ins('t1'), 't1')).toBe(true);
    expect(authoredBy({ mark: del('t1') }, 't1')).toBe(true);
    expect(authoredBy({ ...ins('u'), revisions: [ins('u'), del('t1')] }, 't1')).toBe(false);
    expect(authoredBy({ kind: 'Insertion', author: 'Robin' }, 't1')).toBe(false);
  });

  it('conserves native-only data but not anchors, geometry or binding tags', () => {
    const a = { keys: ['inlines', 'contentControlProperties'], hidden: {}, hiddenIn: { contentControlProperties: [{ at: 2, k: 'tag', v: 'x' }, { at: 3, k: 'color', v: '#000' }] } };
    const b = { keys: ['inlines', 'contentControlProperties', 'revisionIds'], hidden: { revisionIds: ['r'] }, hiddenIn: { contentControlProperties: [{ at: 2, k: 'tag', v: 'y' }, { at: 3, k: 'color', v: '#000' }] } };
    expect(conservedResidue(a)).toEqual(conservedResidue(b));
    const c = { ...b, hiddenIn: { contentControlProperties: [{ at: 3, k: 'color', v: '#FFF' }] } };
    expect(conservedResidue(a)).not.toEqual(conservedResidue(c));
    expect(conservedResidue({ keys: [], hidden: { images: { 0: 'data' } }, hiddenIn: {} })).not.toEqual(conservedResidue({ keys: [], hidden: {}, hiddenIn: {} }));
  });

  it('rejecting restores the text but keeps formatting applied untracked', () => {
    const before = fresh();
    const intended = JSON.parse(JSON.stringify(before)) as NormalForm;
    const run = all(intended).find((n) => n.kind === 'run') as NfNode;
    intended.formats.boldNow = { bold: true };
    run.style = 'boldNow';
    const restored = expectedRejection(before, intended);
    expect((all(restored).find((n) => n.id === run.id) as NfNode).style).toBe('boldNow');
    expect(restored.formats.boldNow).toEqual({ bold: true });
  });
});
