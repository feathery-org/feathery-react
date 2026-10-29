import * as fs from 'fs';
import * as path from 'path';
import { comparable, comparableText, prove, toFixedPoint } from '../../../proof';
import { NfNode, NormalForm, canonicalJson, walk } from '../../../tree';
import { docxPack } from '../index';
import { makeView } from '../../../view';
import { toNormalForm } from '../adapter/toNormalForm';
import { detail, ownText } from '../outline';
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
  N11,
  N12,
  N13,
  N14,
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
  // N1: a computed field's cached result belongs to the editor (measured in the lane: PAGE,
  // NUMPAGES and SECTIONPAGES are rewritten on open, case and switches aside; other fields keep
  // what was written)
  const fieldInlines = (code: string, result: string, id: string): NfNode[] => [
    { id: `${id}a`, kind: 'run', text: 'Page ' },
    { id: `${id}b`, kind: 'field', fieldType: 0, hasFieldEnd: true },
    { id: `${id}c`, kind: 'run', text: ` ${code} ` },
    { id: `${id}d`, kind: 'field', fieldType: 2 },
    { id: `${id}e`, kind: 'run', text: result },
    { id: `${id}f`, kind: 'field', fieldType: 1 }
  ];
  /** The document with one paragraph's inlines replaced: in the body, in a table cell, or in a footer. */
  const withField = (where: 'body' | 'cell' | 'footer', code: string, result: string) => {
    const nf = fresh();
    const paragraphs = all(nf).filter((n) => n.kind === 'paragraph');
    const inCell = new Set<string>();
    const inStory = new Set<string>();
    const rec = (node: NfNode, keys: string[]) => {
      if (keys.includes('cells')) inCell.add(node.id);
      if (keys.some((k) => k.includes('/'))) inStory.add(node.id);
      for (const key of docxTree.childLists(node)) {
        const list = key.split('/').reduce((o: any, k) => o?.[k], node);
        for (const child of Array.isArray(list) ? list : []) rec(child as NfNode, [...keys, key]);
      }
    };
    rec(nf.root, []);
    const target =
      where === 'cell'
        ? paragraphs.find((n) => inCell.has(n.id))
        : where === 'footer'
        ? paragraphs.find((n) => inStory.has(n.id))
        : paragraphs.find((n) => !inCell.has(n.id) && !inStory.has(n.id) && ownText(n));
    if (!target) throw new Error(`no ${where} paragraph`);
    target.inlines = fieldInlines(code, result, `${target.id}x`);
    return nf;
  };
  const same = (a: NormalForm, b: NormalForm) => canonicalJson(N1.apply(a)) === canonicalJson(N1.apply(b));

  it('N1 a computed field result is the editor\'s wherever it sits: body, table cell, footer; PAGE, NUMPAGES, SECTIONPAGES', () => {
    expect(same(withField('body', 'PAGE', '1'), withField('body', 'PAGE', '4'))).toBe(true);
    expect(same(withField('cell', 'NUMPAGES \\* Arabic', '1'), withField('cell', 'NUMPAGES \\* Arabic', '5'))).toBe(true);
    expect(same(withField('footer', 'sectionpages', '9'), withField('footer', 'sectionpages', '2'))).toBe(true);
  });

  it('N1 leaves every other field result and every digit outside a field as written', () => {
    expect(same(withField('body', 'MERGEFIELD Name', '1'), withField('body', 'MERGEFIELD Name', '4'))).toBe(false);
    expect(same(withField('footer', 'SECTION', '1'), withField('footer', 'SECTION', '2'))).toBe(false);
    // the code itself is content: a PAGE field is not a NUMPAGES field
    expect(same(withField('body', 'PAGE', '1'), withField('body', 'NUMPAGES', '1'))).toBe(false);
    const nf = fresh();
    const digits = all(nf).find((n) => n.kind === 'run' && typeof n.text === 'string' && /[a-z]/i.test(n.text)) as NfNode;
    const changed = JSON.parse(JSON.stringify(nf)) as NormalForm;
    (all(changed).find((n) => n.id === digits.id) as NfNode).text = '12345';
    expect(same(nf, changed)).toBe(false);
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

  it('N11 a paragraph with only the Normal style and empty borders and list is one with no format', () => {
    const nf = fresh();
    const para = all(nf).find((n) => n.kind === 'paragraph' && typeof n.style === 'string' && ownText(n)) as NfNode;
    const withStyle = (entry: Record<string, unknown> | undefined) => {
      const d = JSON.parse(JSON.stringify(nf)) as NormalForm;
      const p = all(d).find((n) => n.id === para.id) as NfNode;
      if (entry === undefined) delete p.style;
      else {
        d.formats.probe = entry;
        p.style = 'probe';
      }
      return d;
    };
    const styleOf = (d: NormalForm) => (all(N11.apply(d)).find((n) => n.id === para.id) as NfNode).style;
    const editorDefault = { borders: { top: {}, left: {}, right: {}, bottom: {}, horizontal: {}, vertical: {} }, styleName: 'Normal', listFormat: {} };
    // true negative: what the editor gives a paragraph written without a format
    expect(styleOf(withStyle(editorDefault))).toBe(styleOf(withStyle(undefined)));
    // true positive: another style, or a real border, still counts
    // an empty paragraph, which N5 has left without its Normal
    expect(styleOf(withStyle({ borders: editorDefault.borders, listFormat: {} }))).toBe(styleOf(withStyle(undefined)));
    expect(styleOf(withStyle({ ...editorDefault, styleName: 'Heading 1' }))).toBe('probe');
    expect(styleOf(withStyle({ ...editorDefault, borders: { top: { lineStyle: 'Single' } } }))).toBe('probe');
    expect(NORMALIZATIONS.map((n) => n.name)).toContain('N11');
  });

  it('N12 the editor\'s fill of a new table, row or cell format is the same as none (matrix-2 T10)', () => {
    const nf = fresh();
    const cell = all(nf).find((n) => n.kind === 'cell' && typeof n.style === 'string') as NfNode;
    const row = all(nf).find((n) => n.kind === 'row' && typeof n.style === 'string') as NfNode;
    const table = all(nf).find((n) => n.kind === 'table' && typeof n.style === 'string') as NfNode;
    const sides = { top: {}, left: {}, right: {}, bottom: {}, diagonalDown: {}, diagonalUp: {}, horizontal: {}, vertical: {} };
    const entryOf = (d: NormalForm, id: string) => d.formats[String((all(d).find((n) => n.id === id) as NfNode).style)];
    const withEntry = (id: string, entry: Record<string, unknown>) => {
      const d = JSON.parse(JSON.stringify(nf)) as NormalForm;
      d.formats.probe = entry;
      (all(d).find((n) => n.id === id) as NfNode).style = 'probe';
      return N12.apply(d);
    };
    // true negatives: measured in the lane, a format written with only widths and a fill reads back so
    const written = { preferredWidth: 174, preferredWidthType: 'Point', verticalAlignment: 'Center', shading: { backgroundColor: '#001B49FF' } };
    const read = { borders: sides, shading: { backgroundColor: '#001B49FF', foregroundColor: 'empty', texture: 'TextureNone' }, preferredWidth: 174, preferredWidthType: 'Point', columnSpan: 1, rowSpan: 1, verticalAlignment: 'Center' };
    expect(entryOf(withEntry(cell.id, read), cell.id)).toEqual(entryOf(withEntry(cell.id, written), cell.id));
    expect(entryOf(withEntry(row.id, { isHeader: true, borders: sides, gridBefore: 0, gridAfter: 0 }), row.id)).toEqual({ isHeader: true });
    expect(entryOf(withEntry(table.id, { borders: sides, shading: {}, topMargin: 0, rightMargin: 5.4, leftMargin: 5.4, bottomMargin: 0, preferredWidth: 100, preferredWidthType: 'Percent' }), table.id)).toEqual({ preferredWidth: 100, preferredWidthType: 'Percent' });
    // true positives: a real border, a span, a margin still count
    expect(entryOf(withEntry(cell.id, { ...read, columnSpan: 2 }), cell.id)).toEqual(expect.objectContaining({ columnSpan: 2 }));
    expect(entryOf(withEntry(cell.id, { ...read, borders: { ...sides, top: { lineStyle: 'Single' } } }), cell.id)).toEqual(expect.objectContaining({ borders: expect.anything() }));
    expect(entryOf(withEntry(table.id, { leftMargin: 7 }), table.id)).toEqual({ leftMargin: 7 });
    expect(NORMALIZATIONS.map((n) => n.name)).toContain('N12');
  });

  it('N12 the empty sides the editor adds beside a written border are the same as none (7164f8e6 t2)', () => {
    const nf = fresh();
    const cell = all(nf).find((n) => n.kind === 'cell' && typeof n.style === 'string') as NfNode;
    const apply = (borders: Record<string, unknown>) => {
      const d = JSON.parse(JSON.stringify(nf)) as NormalForm;
      d.formats.probe = { borders };
      (all(d).find((n) => n.id === cell.id) as NfNode).style = 'probe';
      const out = N12.apply(d);
      return out.formats[String((all(out).find((n) => n.id === cell.id) as NfNode).style)];
    };
    const top = { lineStyle: 'Single', lineWidth: 0.5, color: '#000000FF' };
    expect(apply({ top, diagonalDown: {}, diagonalUp: {}, horizontal: {}, vertical: {} })).toEqual(apply({ top }));
    expect(apply({ top, bottom: { lineStyle: 'Single' } })).not.toEqual(apply({ top }));
  });

  it('N13 an empty text run is the same as none (troy-1: a moved cell came back without it)', () => {
    const nf = fresh();
    const para = all(nf).find((n) => n.kind === 'paragraph' && Array.isArray(n.inlines) && (n.inlines as NfNode[]).some((i) => i.kind === 'run')) as NfNode;
    const withRuns = (extra: Array<Record<string, unknown>>) => {
      const d = JSON.parse(JSON.stringify(nf)) as NormalForm;
      const p = all(d).find((n) => n.id === para.id) as NfNode;
      p.inlines = [...(p.inlines as NfNode[]), ...extra] as never;
      return N13.apply(d);
    };
    const inlinesOf = (d: NormalForm) => (all(d).find((n) => n.id === para.id) as NfNode).inlines;
    // true negative: an empty run, styled or not, is no run
    expect(inlinesOf(withRuns([{ id: 'e1', kind: 'run', text: '', style: (para.inlines as NfNode[])[0].style }]))).toEqual(inlinesOf(withRuns([])));
    // true positive: text, or a pending change on it, still counts
    expect(inlinesOf(withRuns([{ id: 'e2', kind: 'run', text: ' ' }]))).toHaveLength((para.inlines as NfNode[]).length + 1);
    expect(inlinesOf(withRuns([{ id: 'e3', kind: 'run', text: '', pending: { kind: 'Insertion' } }]))).toHaveLength((para.inlines as NfNode[]).length + 1);
    expect(NORMALIZATIONS.map((n) => n.name)).toContain('N13');
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

  it('N14 with N6 reads a control split into bare and explicitly inherited runs as one run (dts seq 4 fee cell)', () => {
    const nf = fresh();
    const para = all(nf).find((n) => n.kind === 'paragraph' && typeof n.style === 'string' && nf.formats[String(n.style)]?.styleName === 'Normal') as NfNode;
    const withControl = (explicit: Record<string, unknown>, texts: string[]) => {
      const d = JSON.parse(JSON.stringify(nf)) as NormalForm;
      d.formats.explicit = explicit;
      (all(d).find((n) => n.id === para.id) as NfNode).inlines = [
        {
          id: 'fee',
          kind: 'control',
          inlines: texts.map((text, i) => ({ id: `fee${i}`, kind: 'run', text, ...(i % 2 ? { style: 'explicit' } : {}) }))
        }
      ];
      return d;
    };
    const fee = (d: NormalForm) => {
      const runs = (all(toFixedPoint([N6, N14], d)).find((n) => n.id === 'fee') as NfNode).inlines as NfNode[];
      return runs.map(({ id, ...run }) => run);
    };
    const whole = fee(withControl({}, ['$996.75']));
    // Normal gives fontSize 11 and the document default Calibri: restating both is no difference (true negative)
    expect(fee(withControl({ fontSize: 11, fontFamily: 'Calibri' }, ['$', '996', '.', '75']))).toEqual(whole);
    // A font the run does not inherit is a real difference (true positive)
    expect(fee(withControl({ fontSize: 11, fontFamily: 'Arial' }, ['$', '996', '.', '75']))).not.toEqual(whole);
    const once = N14.apply(nf);
    expect(N14.apply(once)).toBe(once);
  });

  it('N14 keeps a shared run format apart when its runs sit in paragraphs of different styles', () => {
    const nf = fresh();
    const normals = all(nf).filter((n) => n.kind === 'paragraph' && typeof n.style === 'string' && nf.formats[String(n.style)]?.styleName === 'Normal');
    const runFormats = (headingFirst: boolean) => {
      const d = JSON.parse(JSON.stringify(nf)) as NormalForm;
      d.formats.headingChar = { bold: true };
      d.formats.headingPara = { styleName: 'Bold Heading' };
      d.formats.shared = { bold: true, italic: true, fontSize: 11 };
      d.root.styles = [...((d.root.styles as unknown[]) ?? []), { name: 'Bold Heading', basedOn: 'Normal', characterFormat: 'headingChar' }];
      const [first, second] = normals.map((p) => all(d).find((n) => n.id === p.id) as NfNode);
      (headingFirst ? first : second).style = 'headingPara';
      first.inlines = [{ id: 'r1', kind: 'run', text: 'one', style: 'shared' }];
      second.inlines = [{ id: 'r2', kind: 'run', text: 'two', style: 'shared' }];
      const out = N14.apply(d);
      const format = (id: string) => out.formats[String((all(out).find((n) => n.id === id) as NfNode).style)] ?? {};
      return headingFirst ? [format('r1'), format('r2')] : [format('r2'), format('r1')];
    };
    // [heading run, normal run]: each keeps only what its own paragraph does not give it
    for (const headingFirst of [true, false])
      expect(runFormats(headingFirst)).toEqual([{ italic: true }, { bold: true, italic: true }]);
  });
});

describe('authorship, residue and the expected rejection', () => {
  it('the outline names every card on a row, so one deleted after it was inserted reads as deleted (76b6047e)', () => {
    const nf = fresh();
    const row = all(nf).find((n) => n.kind === 'row') as NfNode;
    row.pending = { ...ins('A'), revisions: [ins('A'), del('B')] };
    expect(detail(row, makeView(nf, docxPack))).toContain('[pending Insertion by Robin, then Deletion by Robin]');
    row.pending = ins('A');
    expect(detail(row, makeView(nf, docxPack))).toContain('[pending Insertion by Robin]');
  });

  // Another card's inserted heading, then this turn's write over it, as the live document reads back
  const cardRuns = (live: Array<{ text: string; pending: unknown }>) => {
    const before = fresh();
    const para = all(before).find((n) => n.kind === 'paragraph' && (n.inlines as NfNode[]).some((i) => i.kind === 'run')) as NfNode;
    const run = (para.inlines as NfNode[]).find((i) => i.kind === 'run') as NfNode;
    para.inlines = [{ ...run, text: 'Garage State', pending: ins('A') }];
    const after = JSON.parse(JSON.stringify(before)) as NormalForm;
    (all(after).find((n) => n.id === para.id) as NfNode).inlines = live.map((r, i) => ({ ...run, id: `${run.id}-${i}`, ...r }));
    return prove(docxPack, { before, intended: after, live: after, turnId: 't', intendedResidue: {}, liveResidue: {} });
  };

  it("a deletion inside another card's inserted run keeps that card whole (3c41412c t46)", () => {
    const p = cardRuns([
      { text: 'Garage ', pending: { ...ins('A'), revisions: [ins('A'), del('t')] } },
      { text: 'State', pending: ins('A') }
    ]);
    expect(p.authorshipDiff).toEqual([]);
  });

  it("text the editor tagged with another card is still not this change's (3c41412c t37, 5a5796c5 t7)", () => {
    const merged = cardRuns([
      { text: 'Garage State', pending: ins('A') },
      { text: '$1,171.00', pending: ins('A') }
    ]);
    expect(merged.authorshipDiff).toEqual(expect.arrayContaining([expect.stringContaining('not grouped under this change')]));
    const moved = cardRuns([
      { text: 'Garage State', pending: ins('A') },
      { text: '$16,904.91', pending: { ...ins('A'), move: 'n3115' } }
    ]);
    expect(moved.authorship).toBe(false);
  });

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

  it('a rebuilt table conserves only the keys its residue holds, not shown keys the write left out (ae748313 t7)', () => {
    const read = { keys: ['rows', 'grid', 'tableFormat', 'description', 'title', 'columnCount', 'bidi'], hidden: { grid: [], columnCount: 3, bidi: false }, hiddenIn: {} };
    const rebuilt = { ...read, keys: ['rows', 'grid', 'tableFormat', 'columnCount', 'bidi'] };
    expect(conservedResidue(read)).toEqual(conservedResidue(rebuilt));
    const lost = { ...rebuilt, keys: ['rows', 'grid', 'tableFormat', 'columnCount'], hidden: { grid: [], columnCount: 3 } };
    expect(conservedResidue(read)).not.toEqual(conservedResidue(lost));
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
