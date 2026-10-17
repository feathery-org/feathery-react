/**
 * A Word table of contents (a TOC field) is derived content: after every change set the editor
 * rebuilds it from the headings, with the page numbers its layout gives them, untracked and inside
 * the change set's undo group; it is refreshed again when a card is resolved; the model cannot
 * write into it; its entries keep their character formatting across a rebuild.
 *
 * The document is a client proposal, so it never enters the repo: the tests run on the first
 * document in the private corpus (ROBIN_DOCUMENT_PRIVATE_CORPUS) holding a TOC field, and read
 * every heading, entry and page from the document at run time.
 */
import fs from 'fs';
import path from 'path';
import { EngineLane, startEngineLane } from './headless/engineLane';

const TOC_CODE = /"text":"\s*TOC\s[^"]*"/;
const corpus = process.env.ROBIN_DOCUMENT_PRIVATE_CORPUS;
const document = (() => {
  if (!corpus || !fs.existsSync(corpus)) return null;
  for (const file of fs.readdirSync(corpus).sort())
    if (file.endsWith('.sfdt.json')) {
      const text = fs.readFileSync(path.join(corpus, file), 'utf8');
      if (TOC_CODE.test(text)) return text;
    }
  return null;
})();
const describeWith = document ? describe : describe.skip;

interface Entry {
  text: string;
  page: string;
  /** The character format of each run of the entry's visible text. */
  formats: string[];
}

const clean = (s: string) => s.replace(/[\f\t]/g, ' ').replace(/\s+/g, ' ').trim();

/** The TOC field's code and entries, read from the native document by walking its fields. */
function tocOf(native: string): { code: string; entries: Entry[] } {
  const doc = JSON.parse(native);
  const inlines: Array<{ i: any; para: number }> = [];
  let para = 0;
  const visit = (blocks: any[]) => {
    for (const b of blocks ?? []) {
      if (Array.isArray(b.inlines)) {
        para += 1;
        for (const i of b.inlines) inlines.push({ i, para });
      }
      if (Array.isArray(b.rows)) for (const r of b.rows) for (const c of r.cells) visit(c.blocks);
    }
  };
  for (const s of doc.sections) visit(s.blocks);
  // fields as a stack: code text until the separator, then the result
  const stack: Array<{ code: string; result: boolean }> = [];
  let code = '';
  let inToc = false;
  const entries = new Map<number, Entry>();
  for (const { i, para: p } of inlines) {
    if (i.fieldType === 0) stack.push({ code: '', result: false });
    else if (i.fieldType === 2) {
      const top = stack[stack.length - 1];
      top.result = true;
      if (/^\s*TOC\s/.test(top.code) && !inToc) {
        inToc = true;
        code = top.code.trim();
      }
    } else if (i.fieldType === 1) {
      const top = stack.pop();
      if (top && /^\s*TOC\s/.test(top.code)) inToc = false;
    } else if (typeof i.text === 'string' && stack.length) {
      const top = stack[stack.length - 1];
      if (!top.result) top.code += i.text;
      else if (inToc) {
        const entry = entries.get(p) ?? { text: '', page: '', formats: [] };
        const name = top.code.trim().split(/\s+/)[0].toUpperCase();
        if (name === 'PAGEREF') entry.page += i.text;
        else if (name === 'HYPERLINK' && i.text !== '\t') {
          entry.text += i.text;
          entry.formats.push(JSON.stringify(i.characterFormat ?? {}));
        }
        entries.set(p, entry);
      }
    }
  }
  return {
    code,
    entries: [...entries.values()].filter((e) => e.text).map((e) => ({ ...e, text: clean(e.text) }))
  };
}

/** The paragraph styles a TOC field code lists entries from (its \t switch). */
const stylesOf = (code: string): string[] => {
  const t = /\\t\s+"([^"]*)"/.exec(code)?.[1] ?? '';
  const parts = t.split(',');
  return parts.filter((_, k) => k % 2 === 0).map((s) => s.trim()).filter(Boolean);
};

let lane: EngineLane;
let turn = 0;
const target = { type: 'envelope', id: 'env' };
const dispatch = async (verb: string, input: unknown): Promise<any> => {
  const out = await lane.call<any>('dispatch', verb, { turnId: `toc-${turn}`, editorId: 'ed', target, input });
  if (out.status !== 'ok') throw new Error(JSON.stringify(out).slice(0, 600));
  if (verb === 'write') await lane.call('finishTurn');
  return out.result;
};
const read = async (ids: string[], children: 'full' | 'stubs' = 'full'): Promise<Record<string, any>> => {
  const r = await dispatch('read', { ids, children });
  if (!r.ok) throw new Error(JSON.stringify(r).slice(0, 400));
  return Object.fromEntries(r.nodes.map((n: any) => [n.id, n]));
};
const at = (p: Array<string | number>) => lane.call<string>('idAt', p);
const strip = (v: any): any =>
  Array.isArray(v)
    ? v.map(strip)
    : v && typeof v === 'object'
    ? Object.fromEntries(
        Object.entries(v)
          .filter(([k]) => !['id', 'base', 'shape', 'usedBy', 'derived', 'pending', 'properties'].includes(k))
          .map(([k, x]) => [k, strip(x)])
      )
    : v;

/** The TOC as it reads now and the headings it should list, with their pages from the layout. */
async function state(): Promise<{ toc: { code: string; entries: Entry[] }; headings: Array<{ text: string; page: number }> }> {
  const toc = tocOf(await lane.call<string>('settled'));
  const headings = (await lane.call<Array<{ text: string; page: number }>>('headingPages', stylesOf(toc.code))).map((h) => ({ ...h, text: clean(h.text) }));
  return { toc, headings };
}
/** The TOC lists exactly the headings, in order, each with the page the layout gives it. */
async function expectCurrent(): Promise<void> {
  const { toc, headings } = await state();
  expect(toc.entries.map((e) => `${e.text} | ${e.page}`)).toEqual(headings.map((h) => `${h.text} | ${h.page}`));
}

/** The native path of the first section after the TOC's whose first paragraph is a heading the TOC lists. */
function headingSections(native: string, styles: string[]): number[] {
  const doc = JSON.parse(native);
  return doc.sections
    .map((s: any, k: number) => ({ k, first: s.blocks[0] }))
    .filter(({ first }: any) => styles.includes(first?.paragraphFormat?.styleName) && (first.inlines ?? []).some((i: any) => typeof i.text === 'string' && i.text.trim()))
    .map(({ k }: any) => k);
}

async function fresh(): Promise<{ native: string; styles: string[]; sections: number[] }> {
  turn += 1;
  await lane.call('open', document);
  const native = await lane.call<string>('settled');
  const styles = stylesOf(tocOf(native).code);
  return { native, styles, sections: headingSections(native, styles) };
}

describeWith('a table of contents is refreshed by the editor after every change', () => {
  beforeAll(async () => {
    lane = await startEngineLane();
  }, 600000);
  afterAll(async () => {
    await lane?.close();
  });

  it('(1) a section whose heading the contents lists is deleted: its entry goes and every page is the layout page; (7) the other entries keep their formats', async () => {
    const { sections } = await fresh();
    const before = await state();
    const secId = await at(['sections', sections[0]]);
    const sec = (await read([secId], 'stubs'))[secId];
    const r = await dispatch('write', { intent: 'Remove the section.', scope: { ids: [secId] }, changes: [{ kind: 'delete', id: secId, base: sec.base }] });
    expect(r.ok).toBe(true);
    const removed = clean(before.headings[0].text);
    const after = await state();
    expect(after.toc.entries.map((e) => e.text)).not.toContain(removed);
    await expectCurrent();
    expect(JSON.stringify(r.facts)).toMatch(/table of contents refreshed: \d+ entries, 0 added, 1 removed/);
    // (7) every entry that survived reads in the formats it had
    for (const e of after.toc.entries) {
      const was = before.toc.entries.find((x) => x.text === e.text);
      if (was) expect(e.formats).toEqual(was.formats);
    }
  }, 120000);

  it('(6) rejecting that card brings the section back and the contents matches the headings again', async () => {
    const { sections } = await fresh();
    const secId = await at(['sections', sections[0]]);
    const sec = (await read([secId], 'stubs'))[secId];
    await dispatch('write', { intent: 'Remove the section.', scope: { ids: [secId] }, changes: [{ kind: 'delete', id: secId, base: sec.base }] });
    await lane.call('clickCard', 0, 'Reject');
    const { toc, headings } = await state();
    expect(toc.entries.length).toBe(headings.length);
    await expectCurrent();
  }, 120000);

  it('(2) a heading-styled section is added: a new entry with its page, and the later entries move on', async () => {
    const { sections } = await fresh();
    const anchorId = await at(['sections', sections[1]]);
    const rootId = await at([]);
    const root = (await read([rootId], 'stubs'))[rootId];
    const anchor = (await read([anchorId]))[anchorId];
    const copy = strip(anchor);
    const heading = copy.blocks[0];
    const runs = (heading.inlines ?? []).filter((i: any) => i.kind === 'run' && typeof i.text === 'string' && i.text.trim());
    runs.forEach((x: any, k: number) => (x.text = k ? '' : 'Claims Contacts'));
    const r = await dispatch('write', { intent: 'Add a section.', scope: { ids: [] }, changes: [{ kind: 'insert_after', anchor: anchorId, container: root.shape, node: copy }] });
    expect(r.ok).toBe(true);
    const { toc } = await state();
    expect(toc.entries.map((e) => e.text)).toContain('Claims Contacts');
    await expectCurrent();
    expect(JSON.stringify(r.facts)).toMatch(/table of contents refreshed: \d+ entries, 1 added, 0 removed/);
  }, 120000);

  it('(3) a page-length table inside a section moves every later entry on by its pages', async () => {
    const { native, sections } = await fresh();
    const before = await state();
    const doc = JSON.parse(native);
    let tablePath: Array<string | number> | null = null;
    doc.sections.forEach((s: any, si: number) => s.blocks.forEach((b: any, bi: number) => {
      if (!tablePath && Array.isArray(b.rows)) tablePath = ['sections', si, 'blocks', bi];
    }));
    const tableId = await at(tablePath as unknown as Array<string | number>);
    const table = strip((await read([tableId]))[tableId]);
    table.rows = Array.from({ length: 60 }, () => strip(table.rows[0]));
    const secId = await at(['sections', sections[0]]);
    const sec = (await read([secId], 'stubs'))[secId];
    const headingId = sec.blocks[0].id;
    const r = await dispatch('write', { intent: 'Add a long table.', scope: { ids: [] }, changes: [{ kind: 'insert_after', anchor: headingId, container: sec.shape, node: table }] });
    expect(r.ok).toBe(true);
    const after = await state();
    await expectCurrent();
    // the entries after the table's section are on later pages than they were listed before
    const later = after.toc.entries.slice(1);
    const was = new Map(before.headings.map((h) => [h.text, h.page]));
    expect(later.every((e) => Number(e.page) > (was.get(e.text) ?? Infinity))).toBe(true);
  }, 120000);

  it('(4) a write into a contents entry is refused as derived content', async () => {
    const { native } = await fresh();
    const doc = JSON.parse(native);
    let entryPath: Array<string | number> | null = null;
    doc.sections.forEach((s: any, si: number) => s.blocks.forEach((b: any, bi: number) => {
      if (!entryPath && (b.inlines ?? []).some((i: any) => typeof i.text === 'string' && /^\s*HYPERLINK\s/.test(i.text))) entryPath = ['sections', si, 'blocks', bi];
    }));
    const pid = await at(entryPath as unknown as Array<string | number>);
    const p = (await read([pid]))[pid];
    const run = p.inlines.filter((i: any) => i.kind === 'run' && typeof i.text === 'string' && i.text.trim() && !/^\s*(TOC|HYPERLINK|PAGEREF)\s/.test(i.text))[0];
    const out = await lane.call<any>('dispatch', 'write', { turnId: `toc-${turn}`, editorId: 'ed', target, input: { intent: 'Rename the entry.', scope: { ids: [run.id] }, changes: [{ kind: 'replace', id: run.id, base: run.base, node: { kind: 'run', text: 'Renamed' } }] } });
    const result = out.result;
    expect(result.ok).toBe(false);
    const problem = (result.refusal?.problems ?? [result.refusal]).find((x: any) => x?.invariant === 'derived-content');
    expect(problem).toBeTruthy();
    expect(problem.hint).toContain('the table of contents is refreshed from the headings after your change; edit the headings');
  }, 120000);

  it('(5) the outline marks the contents and a read of an entry says it is derived from it', async () => {
    const { native } = await fresh();
    const outline = await dispatch('outline', {});
    expect(outline.lines).toMatch(/toc \(refreshed by the editor\)/);
    const doc = JSON.parse(native);
    let entryPath: Array<string | number> | null = null;
    doc.sections.forEach((s: any, si: number) => s.blocks.forEach((b: any, bi: number) => {
      if (!entryPath && (b.inlines ?? []).some((i: any) => typeof i.text === 'string' && /^\s*HYPERLINK\s/.test(i.text))) entryPath = ['sections', si, 'blocks', bi];
    }));
    const pid = await at(entryPath as unknown as Array<string | number>);
    expect((await read([pid]))[pid].derived).toEqual(expect.objectContaining({ source: 'toc' }));
  }, 120000);
});
