/**
 * The table of contents as derived content, off the editor (the editor's rebuild itself is proved in
 * `toc.headless.spec.ts`): which paragraphs a TOC field holds and lists, the refusal of a write into
 * it (a true positive and a true negative), the fact that reports the rebuild, the plan's last
 * step, and N1 both ways (it admits what the rebuild changes and nothing outside the contents).
 */
import { WriteInput } from '../../../envelope';
import { comparableText, toFixedPoint } from '../../../proof';
import { DocumentSession } from '../../../session';
import { NfNode, NormalForm, baseOf, shapeOf } from '../../../tree';
import { makeView } from '../../../view';
import { prepareWrite } from '../../../verbs';
import { docxPack } from '../index';
import { NORMALIZATIONS } from '../projections';
import { tocField, tocSources } from '../toc';
import { docxTree } from '../tree';
import { TocShape, withToc } from './tocFixture';

function stateOf(native: string) {
  let doc = native;
  const host = { serialize: () => doc, open: (x: string) => { doc = x; }, canUndo: () => false, undo: () => {}, canRedo: () => false, redo: () => {}, readOnly: () => false };
  return new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'e' } }).state;
}
const write = (native: string, w: Partial<WriteInput>) => prepareWrite(stateOf(native), { intent: 'test', scope: { ids: [] }, ...w } as WriteInput);
const normalized = (nf: NormalForm) => comparableText(docxPack, toFixedPoint(NORMALIZATIONS, nf));
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
/** The commit plan for a verified write, as the reconciler asks for it. */
const planOf = (s: ReturnType<typeof stateOf>, r: { intended: NormalForm; intendedResidue: Record<string, unknown> }) =>
  docxPack.reconcile.plan({ turnId: 't', before: s.view, intended: makeView(r.intended, docxPack), beforeResidue: s.residue, intendedResidue: r.intendedResidue, beforeNative: '' });
const runs = (p: NfNode) => (p.inlines as NfNode[]).filter((i) => i.kind === 'run');

describe.each<[TocShape, string, number]>([
  ['levels', 'Heading 1', 5],
  ['styles', 'Heading 2', 10]
])('a contents table by %s', (shape, style, listed) => {
  const native = withToc(shape);
  const s = stateOf(native);
  const toc = tocField(s.view.nf);

  it('is found with its paragraphs, the styles it lists and its entries; its headings are the paragraphs in them', () => {
    expect(toc).not.toBeNull();
    if (!toc) return;
    expect([...toc.styles]).toEqual([style]);
    expect(toc.entries.length).toBe(listed);
    // one entry paragraph per heading and the paragraph holding the field's end
    expect(toc.paragraphs.length).toBe(listed + 1);
    expect(tocSources(s.view.nf, toc).map((h) => h.text)).toEqual(toc.entries);
  });

  it('derived-content: a run of an entry rewritten is refused with the hint; the heading it lists is not', () => {
    if (!toc) throw new Error('no contents');
    const entry = toc.paragraphs[1];
    const run = runs(entry).find((r) => /^[A-Z0-9]/.test(String(r.text)) && !/^(HYPERLINK|PAGEREF|TOC)/.test(String(r.text).trim()) && !/^\d+$/.test(String(r.text))) as NfNode;
    const r = write(native, { scope: { ids: [run.id] }, changes: [{ kind: 'replace', id: run.id, base: baseOf(run), node: { kind: 'run', text: 'Renamed' } }] });
    expect(r.outcome).toBe('refused');
    if (r.outcome !== 'refused') return;
    const problem = (r.refusal.problems ?? [r.refusal]).find((p) => p.invariant === 'derived-content');
    expect(problem?.hint).toBe('the table of contents is refreshed from the headings after your change; edit the headings');
    // a paragraph inserted among the entries is refused too
    const parent = s.view.placement(entry.id)?.parent as NfNode;
    const inside = write(native, { changes: [{ kind: 'insert_after', anchor: entry.id, container: shapeOf(parent, docxTree), node: { kind: 'paragraph', inlines: [{ kind: 'run', text: 'x' }] } } as never] });
    expect(inside.outcome === 'refused' && (inside.refusal.problems ?? [inside.refusal]).map((x) => x.invariant)).toEqual(['derived-content']);
    // the heading itself is the model's to edit, and the fact says what the rebuild lists
    const [heading] = tocSources(s.view.nf, toc);
    const hr = runs(heading.node)[0];
    const ok = write(native, { scope: { ids: [hr.id] }, changes: [{ kind: 'replace', id: hr.id, base: baseOf(hr), node: { kind: 'run', ...(hr.style ? { style: hr.style } : {}), text: 'Renamed Heading' } }] });
    expect(ok.outcome).toBe('verified');
    if (ok.outcome !== 'verified') return;
    expect(ok.facts).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'toc', summary: `table of contents refreshed: ${listed} entries, 1 added, 1 removed` })]));
    // and the plan ends with the editor's rebuild
    expect(planOf(s, ok).steps.map((step) => step.seam).pop()).toBe('toc');
  });

  it('N1 admits what the rebuild changes (pages, entry formats, _Toc bookmarks, paragraph count) and nothing outside the contents', () => {
    if (!toc) throw new Error('no contents');
    const nf = s.view.nf;
    const rebuilt = copy(nf);
    const t = tocField(rebuilt) as NonNullable<ReturnType<typeof tocField>>;
    // a page number, an entry's format, a dropped entry, and a bookmark the editor adds to a heading
    const page = runs(t.paragraphs[0]).find((r) => r.text === '99') as NfNode;
    page.text = '7';
    runs(t.paragraphs[1])[0].style = runs(t.paragraphs[0])[0].style ?? 'f0';
    (t.container[t.listKey] as NfNode[]).splice((t.container[t.listKey] as NfNode[]).indexOf(t.paragraphs[2]), 1);
    const [h] = tocSources(rebuilt, t);
    (h.node.inlines as NfNode[]).unshift({ id: 'nx', kind: 'bookmark', bookmarkType: 0, name: '_Toc000000001' } as NfNode);
    (h.node.inlines as NfNode[]).push({ id: 'ny', kind: 'bookmark', bookmarkType: 1, name: '_Toc000000001' } as NfNode);
    expect(normalized(rebuilt)).toBe(normalized(nf));
    // the heading's own text is not the rebuild's
    runs(h.node)[0].text = 'Changed';
    expect(normalized(rebuilt)).not.toBe(normalized(nf));
  });
});

it('a contents table whose styles no paragraph is in is not rebuilt: the fact says so and the plan has no rebuild', () => {
  const native = withToc('styles').replace('\\\\t \\"Heading 2,1\\"', '\\\\t \\"No Such Style,1\\"');
  const s = stateOf(native);
  const toc = tocField(s.view.nf);
  expect(toc && [...toc.styles]).toEqual(['No Such Style']);
  const p = (s.view.nf.root.sections as NfNode[])[1].blocks as NfNode[];
  const run = runs(p[1])[0];
  const r = write(native, { scope: { ids: [run.id] }, changes: [{ kind: 'replace', id: run.id, base: baseOf(run), node: { kind: 'run', text: 'Changed' } }] });
  expect(r.outcome).toBe('verified');
  if (r.outcome !== 'verified') return;
  expect(r.facts).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'toc', summary: expect.stringContaining('table of contents not refreshed') })]));
  expect(planOf(s, r).steps.map((step) => step.seam)).not.toContain('toc');
});

it('a contents table someone typed is not a field: no rebuild, no fact, nothing refused', () => {
  const native = withToc('levels').replace(/"fieldType":[012](,"hasFieldEnd":true)?/g, '"text":""');
  const s = stateOf(native);
  expect(tocField(s.view.nf)).toBeNull();
  const p = (s.view.nf.root.sections as NfNode[])[0].blocks as NfNode[];
  const run = runs(p[1]).find((r) => String(r.text).trim()) as NfNode;
  const r = write(native, { scope: { ids: [run.id] }, changes: [{ kind: 'replace', id: run.id, base: baseOf(run), node: { kind: 'run', text: 'Typed' } }] });
  expect(r.outcome).toBe('verified');
  if (r.outcome !== 'verified') return;
  expect(r.facts.map((f) => f.name)).not.toContain('toc');
  expect(planOf(s, r).steps.map((step) => step.seam)).not.toContain('toc');
});
