/**
 * A Word table of contents (a TOC field) is derived content: after every change set the editor
 * rebuilds it from the headings, with the page numbers its layout gives them, untracked and inside
 * the change set's undo group; it is refreshed again when a card is resolved; the model cannot
 * write into it; its entries keep their character formatting across a rebuild.
 *
 * Three shapes: the first document in the private corpus (ROBIN_DOCUMENT_PRIVATE_CORPUS) holding a
 * TOC field (a client proposal, so it never enters the repo; a style-based contents, `\t`, with
 * hyperlinks), and the committed flagship with a contents by heading level and one by style with no
 * hyperlinks (`tocFixture.ts`). Every heading, entry and page is read from the document at run time.
 */
import fs from 'fs';
import path from 'path';
import { EngineLane, startEngineLane } from './headless/engineLane';
import { SITE, TocOptions, withToc } from './tocFixture';

const TOC_CODE = /"text":"\s*TOC\s[^"]*"/;
const corpus = process.env.ROBIN_DOCUMENT_PRIVATE_CORPUS;
const privateDocument = (() => {
  if (!corpus || !fs.existsSync(corpus)) return null;
  for (const file of fs.readdirSync(corpus).sort())
    if (file.endsWith('.sfdt.json')) {
      const text = fs.readFileSync(path.join(corpus, file), 'utf8');
      if (TOC_CODE.test(text)) return text;
    }
  return null;
})();
const SHAPES: Array<[string, string]> = [
  ...(privateDocument ? [['a private proposal, by style with hyperlinks', privateDocument] as [string, string]] : []),
  ['the flagship, by heading level with hyperlinks', withToc('levels')],
  ['the flagship, by style with no hyperlinks', withToc('styles')]
];

interface Entry {
  text: string;
  page: string;
  /** The character format of each run of the entry's visible text. */
  formats: string[];
}
interface Toc {
  code: string;
  entries: Entry[];
  /** Each entry's PAGEREF field code. */
  pagerefs: string[];
}

const clean = (s: string) => s.replace(/[\f\t]/g, ' ').replace(/\s+/g, ' ').trim();
const fieldName = (code: string) => code.trim().split(/\s+/)[0].toUpperCase();

/** The TOC field's code and entries, read from the native document by walking its fields. */
function tocOf(native: string): Toc {
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
  let depth = -1;
  const entries = new Map<number, Entry>();
  const pagerefs: string[] = [];
  for (const { i, para: p } of inlines) {
    if (i.fieldType === 0) stack.push({ code: '', result: false });
    else if (i.fieldType === 2) {
      const top = stack[stack.length - 1];
      top.result = true;
      if (fieldName(top.code) === 'TOC' && depth === -1) {
        depth = stack.length;
        code = top.code.trim();
      }
    } else if (i.fieldType === 1) {
      const top = stack.pop();
      if (stack.length + 1 === depth) depth = -2;
      else if (top && depth > 0 && fieldName(top.code) === 'PAGEREF') pagerefs.push(top.code);
    } else if (typeof i.text === 'string' && stack.length) {
      const top = stack[stack.length - 1];
      if (!top.result) top.code += i.text;
      else if (depth > 0) {
        const entry = entries.get(p) ?? { text: '', page: '', formats: [] };
        if (fieldName(top.code) === 'PAGEREF') entry.page += i.text;
        else if (i.text !== '\t') {
          entry.text += i.text;
          entry.formats.push(JSON.stringify(i.characterFormat ?? {}));
        }
        entries.set(p, entry);
      }
    }
  }
  return {
    code,
    entries: [...entries.values()].filter((e) => clean(e.text)).map((e) => ({ ...e, text: clean(e.text) })),
    pagerefs
  };
}

/** The paragraph styles a TOC field code lists entries from (its \o levels and \t styles). */
const stylesOf = (code: string): string[] => {
  const out: string[] = [];
  const o = /\\o\s+"(\d+)-(\d+)"/.exec(code);
  if (o) for (let k = Number(o[1]); k <= Number(o[2]); k += 1) out.push(`Heading ${k}`);
  const t = /\\t\s+"([^"]*)"/.exec(code)?.[1] ?? '';
  t.split(',')
    .filter((_, k) => k % 2 === 0)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((s) => out.push(s));
  return out;
};

/** The listed headings among the body's top-level blocks, in order, by native path. */
function listedHeadings(native: string, styles: string[]): Array<{ si: number; bi: number }> {
  const out: Array<{ si: number; bi: number }> = [];
  JSON.parse(native).sections.forEach((s: any, si: number) =>
    s.blocks.forEach((b: any, bi: number) => {
      if (styles.includes(b.paragraphFormat?.styleName) && (b.inlines ?? []).some((i: any) => typeof i.text === 'string' && i.text.trim())) out.push({ si, bi });
    })
  );
  return out;
}

/** A contents entry paragraph's native path: the first paragraph holding a PAGEREF code. */
function entryPath(native: string): Array<string | number> {
  let found: Array<string | number> | null = null;
  JSON.parse(native).sections.forEach((s: any, si: number) =>
    s.blocks.forEach((b: any, bi: number) => {
      if (!found && (b.inlines ?? []).some((i: any) => typeof i.text === 'string' && /^\s*PAGEREF\s/.test(i.text))) found = ['sections', si, 'blocks', bi];
    })
  );
  if (!found) throw new Error('no contents entry');
  return found;
}

let lane: EngineLane;
let turn = 0;
const target = { type: 'envelope', id: 'env' };
const dispatch = async (verb: string, input: unknown): Promise<any> => {
  const out = await lane.call<any>('dispatch', verb, { turnId: `toc-${turn}`, editorId: 'ed', target, input });
  if (out.status !== 'ok') throw new Error(JSON.stringify(out).slice(0, 600));
  if (verb === 'write') await lane.call('finishTurn');
  return out.result;
};
const write = async (input: unknown): Promise<any> => {
  const r = await dispatch('write', input);
  if (!r.ok) throw new Error(JSON.stringify(r).slice(0, 1500));
  return r;
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
const textRuns = (p: any) => (p.inlines ?? []).filter((i: any) => i.kind === 'run' && typeof i.text === 'string' && i.text.trim());

/** The TOC as it reads now and the headings it should list, with their pages from the layout. */
async function state(): Promise<{ toc: Toc; headings: Array<{ text: string; page: number }> }> {
  const toc = tocOf(await lane.call<string>('settled'));
  const headings = (await lane.call<Array<{ text: string; page: number }>>('headingPages', stylesOf(toc.code))).map((h) => ({ ...h, text: clean(h.text) }));
  return { toc, headings };
}
/** The TOC lists exactly the headings, in order, each with the page the layout gives it. */
async function expectCurrent(): Promise<void> {
  const { toc, headings } = await state();
  expect(toc.entries.map((e) => `${e.text} | ${e.page}`)).toEqual(headings.map((h) => `${h.text} | ${h.page}`));
}

beforeAll(async () => {
  lane = await startEngineLane();
}, 600000);
afterAll(async () => {
  await lane?.close();
});

describe.each(SHAPES)('a table of contents is refreshed by the editor after every change: %s', (_name, document) => {
  /** Open the document; its listed headings by native path. */
  async function fresh(): Promise<{ native: string; headings: Array<{ si: number; bi: number }> }> {
    turn += 1;
    await lane.call('open', document);
    const native = await lane.call<string>('settled');
    return { native, headings: listedHeadings(native, stylesOf(tocOf(native).code)) };
  }
  /** The node a heading stands for: its section when it opens one, else the paragraph itself. */
  async function headingUnit(h: { si: number; bi: number }): Promise<{ id: string; node: any; container: string }> {
    const secId = await at(['sections', h.si]);
    if (h.bi === 0) {
      const rootId = await at([]);
      const root = (await read([rootId], 'stubs'))[rootId];
      return { id: secId, node: (await read([secId]))[secId], container: root.shape };
    }
    const sec = (await read([secId], 'stubs'))[secId];
    const id = await at(['sections', h.si, 'blocks', h.bi]);
    return { id, node: (await read([id]))[id], container: sec.shape };
  }

  /** The first listed heading whose section (or paragraph) the document lets a write delete. */
  async function deletable(headings: Array<{ si: number; bi: number }>): Promise<{ unit: { id: string; node: any }; text: string }> {
    for (const h of headings) {
      const unit = await headingUnit(h);
      const change = { intent: 'Remove it.', scope: { ids: [unit.id] }, changes: [{ kind: 'delete', id: unit.id, base: unit.node.base }] };
      if ((await dispatch('write', { ...change, dryRun: true })).ok) {
        const heading = unit.node.kind === 'section' ? unit.node.blocks[0] : unit.node;
        return { unit, text: clean(textRuns(heading).map((x: any) => x.text).join('')) };
      }
    }
    throw new Error('no listed heading can be deleted');
  }

  it('(1) a listed heading is deleted: its entry goes, every page is the layout page, every PAGEREF is well formed; (7) the other entries keep their formats', async () => {
    const { headings } = await fresh();
    const before = await state();
    const { unit, text } = await deletable(headings);
    const r = await write({ intent: 'Remove it.', scope: { ids: [unit.id] }, changes: [{ kind: 'delete', id: unit.id, base: unit.node.base }] });
    const after = await state();
    expect(before.toc.entries.map((e) => e.text)).toContain(text);
    expect(after.toc.entries.map((e) => e.text)).not.toContain(text);
    await expectCurrent();
    // the fact counts what the rebuild did: every entry it lists, and those it dropped
    expect(JSON.stringify(r.facts)).toContain(`table of contents refreshed: ${after.toc.entries.length} entries, 0 added, ${before.toc.entries.length - after.toc.entries.length} removed`);
    // every page reference names its bookmark as Word reads it (the editor writes no space before it)
    expect(after.toc.pagerefs.length).toBe(after.toc.entries.length);
    for (const code of after.toc.pagerefs) expect(code).toMatch(/^ PAGEREF _Toc\w+ \\h $/);
    // (7) every entry that survived reads in the formats it had
    for (const e of after.toc.entries) {
      const was = before.toc.entries.find((x) => x.text === e.text);
      if (was) expect(e.formats).toEqual(was.formats);
    }
  }, 120000);

  it('(6) rejecting that card brings the heading back and the contents matches the headings again', async () => {
    const { headings } = await fresh();
    const { unit } = await deletable(headings);
    await write({ intent: 'Remove it.', scope: { ids: [unit.id] }, changes: [{ kind: 'delete', id: unit.id, base: unit.node.base }] });
    await lane.call('clickCard', 0, 'Reject');
    const { toc, headings: now } = await state();
    expect(toc.entries.length).toBe(now.length);
    await expectCurrent();
  }, 120000);

  it('(2) a heading is added: a new entry with its page, and the later entries move on', async () => {
    const { headings } = await fresh();
    const unit = await headingUnit(headings[1]);
    const copy = strip(unit.node);
    const heading = copy.kind === 'section' ? copy.blocks[0] : copy;
    textRuns(heading).forEach((x: any, k: number) => (x.text = k ? '' : 'Claims Contacts'));
    const r = await write({ intent: 'Add one.', scope: { ids: [] }, changes: [{ kind: 'insert_after', anchor: unit.id, container: unit.container, node: copy }] });
    expect((await state()).toc.entries.map((e) => e.text)).toContain('Claims Contacts');
    await expectCurrent();
    expect(JSON.stringify(r.facts)).toContain(`table of contents refreshed: ${(await state()).toc.entries.length} entries, 1 added, 0 removed`);
  }, 120000);

  it('(3) a page-length table after the first heading moves every later entry on by its pages', async () => {
    const { native, headings } = await fresh();
    const before = await state();
    const doc = JSON.parse(native);
    let tablePath: Array<string | number> | null = null;
    doc.sections.forEach((s: any, si: number) =>
      s.blocks.forEach((b: any, bi: number) => {
        if (!tablePath && Array.isArray(b.rows)) tablePath = ['sections', si, 'blocks', bi];
      })
    );
    const tableId = await at(tablePath as unknown as Array<string | number>);
    const table = strip((await read([tableId]))[tableId]);
    table.rows = Array.from({ length: 60 }, () => strip(table.rows[0]));
    const { si, bi } = headings[0];
    const secId = await at(['sections', si]);
    const sec = (await read([secId], 'stubs'))[secId];
    await write({ intent: 'Add a long table.', scope: { ids: [] }, changes: [{ kind: 'insert_after', anchor: sec.blocks[bi].id, container: sec.shape, node: table }] });
    const after = await state();
    await expectCurrent();
    // the entries after the first heading are on later pages than the layout put them before
    const was = new Map(before.headings.map((h) => [h.text, h.page]));
    expect(after.toc.entries.slice(1).every((e) => Number(e.page) > (was.get(e.text) ?? Infinity))).toBe(true);
  }, 120000);

  it('(8) a heading renamed as a tracked edit: the contents follows in the same undo; rejecting it in the rail puts the contents back, and one undo brings both again', async () => {
    const { headings } = await fresh();
    const pre = await lane.call<string>('settled');
    const pid = await at(['sections', headings[1].si, 'blocks', headings[1].bi]);
    const run = textRuns((await read([pid]))[pid])[0];
    const r = await write({ intent: 'Rename the heading.', scope: { ids: [run.id] }, changes: [{ kind: 'replace', id: run.id, base: run.base, node: { ...strip(run), text: 'Service Team' } }] });
    expect(r.landed).toBe('card');
    // one card: the rebuild is untracked, never a change to review
    expect((await lane.call<Array<{ title: string }>>('rail')).length).toBe(1);
    expect((await lane.call<Array<{ group: string | null }>>('revisions')).every((x) => x.group === `toc-${turn}`)).toBe(true);
    expect((await state()).toc.entries.map((e) => e.text)).toContain('Service Team');
    await expectCurrent();
    const committed = await lane.call<string>('settled');
    // one undo takes back the rename and the refreshed contents together (the entries are read, since
    // the proof's equivalence leaves the contents out)
    await lane.call('pressInDocument', 'z');
    expect(await lane.call<boolean>('equivalent', await lane.call<string>('settled'), pre)).toBe(true);
    expect((await state()).toc.entries.map((e) => `${e.text} | ${e.page}`)).toEqual(tocOf(pre).entries.map((e) => `${e.text} | ${e.page}`));
    await lane.call('pressInDocument', 'y');
    expect(await lane.call<boolean>('equivalent', await lane.call<string>('settled'), committed)).toBe(true);
    expect((await state()).toc.entries.map((e) => `${e.text} | ${e.page}`)).toEqual(tocOf(committed).entries.map((e) => `${e.text} | ${e.page}`));
    // the editor's own reject, from the rail: the contents lists the old name again
    await lane.call('clickCard', 0, 'Reject');
    expect((await state()).toc.entries.map((e) => e.text)).not.toContain('Service Team');
    await expectCurrent();
    // and one undo brings back the card and the contents that lists it
    await lane.call('pressInDocument', 'z');
    expect((await state()).toc.entries.map((e) => e.text)).toContain('Service Team');
    expect((await lane.call<Array<{ title: string }>>('rail')).length).toBe(1);
  }, 120000);

  it('(4) a write into a contents entry is refused as derived content', async () => {
    const { native } = await fresh();
    const pid = await at(entryPath(native));
    const run = (await read([pid]))[pid].inlines.filter((i: any) => i.kind === 'run' && typeof i.text === 'string' && i.text.trim() && !/^\s*(TOC|HYPERLINK|PAGEREF)\s/.test(i.text) && !/^\d+$/.test(i.text.trim()))[0];
    const result = await dispatch('write', { intent: 'Rename the entry.', scope: { ids: [run.id] }, changes: [{ kind: 'replace', id: run.id, base: run.base, node: { kind: 'run', text: 'Renamed' } }] });
    expect(result.ok).toBe(false);
    const problem = (result.refusal?.problems ?? [result.refusal]).find((x: any) => x?.invariant === 'derived-content');
    expect(problem).toBeTruthy();
    expect(problem.hint).toContain('the table of contents is refreshed from the headings after your change; edit the headings');
  }, 120000);

  it('(5) the outline marks the contents and a read of an entry says it is derived from it', async () => {
    const { native } = await fresh();
    const outline = await dispatch('outline', {});
    expect(outline.lines).toMatch(/toc \(refreshed by the editor\)/);
    const pid = await at(entryPath(native));
    expect((await read([pid]))[pid].derived).toEqual(expect.objectContaining({ source: 'toc' }));
  }, 120000);
});

/** Review of the rebuild (PR 1956): shapes where the editor's own update does the wrong thing. */
describe('the contents rebuild never rebuilds the wrong field, never fails the change, never piles up bookmarks', () => {
  async function open(options: TocOptions, shape: 'levels' | 'styles' = 'levels') {
    turn += 1;
    await lane.call('open', withToc(shape, options));
    const native = await lane.call<string>('settled');
    const styles = stylesOf(tocOf(native).code);
    return { native, headings: listedHeadings(native, styles.length ? styles : [shape === 'levels' ? 'Heading 1' : 'Heading 2']) };
  }
  const rename = async (h: { si: number; bi: number }, text: string) => {
    const pid = await at(['sections', h.si, 'blocks', h.bi]);
    const run = textRuns((await read([pid]))[pid])[0];
    return dispatch('write', { intent: 'Rename.', scope: { ids: [run.id] }, changes: [{ kind: 'replace', id: run.id, base: run.base, node: { ...strip(run), text } }] });
  };
  const factsOf = (r: any) => JSON.stringify(r.facts ?? []);
  const links = (native: string) => native.split(`HYPERLINK \\"${SITE}\\"`).length - 1;

  it('H1: a body hyperlink whose code holds "toc" is never rebuilt as the contents, on the first write or the second', async () => {
    const { native, headings } = await open({ bodyLinks: true });
    expect(links(native)).toBe(2);
    for (const [k, text] of [[1, 'First Rename'], [2, 'Second Rename']] as Array<[number, string]>) {
      const r = await rename(headings[k], text);
      expect(r.ok).toBe(true);
      const now = await lane.call<string>('settled');
      expect(links(now)).toBe(2);
      expect(tocOf(now).entries.map((e) => e.text)).toContain(text);
      await expectCurrent();
    }
  }, 120000);

  it.each([
    ['\\c (a table of figures)', ' TOC \\c "Table" \\h ', '\\c'],
    ['\\b (a bookmark range)', ' TOC \\o "1-1" \\b Section2 \\h ', '\\b']
  ])('H2: a contents with %s is not rebuilt as a headings contents: the change lands, the contents stays, the fact names the switch', async (_n, code, sw) => {
    const { native, headings } = await open({ code });
    const r = await rename(headings[1], 'Renamed Heading');
    expect(r.ok).toBe(true);
    const now = await lane.call<string>('settled');
    expect(tocOf(now)).toEqual(tocOf(native));
    expect(factsOf(r)).toContain('table of contents not refreshed');
    expect(factsOf(r)).toContain(JSON.stringify(sw).slice(1, -1));
    expect(factsOf(r)).not.toContain('table of contents refreshed');
  }, 120000);

  it('M1: a code the editor cannot build (level 0) lands the change, keeps the contents and leaves undo working', async () => {
    const { native, headings } = await open({ code: ' TOC \\t "Heading 2,0" ' }, 'styles');
    const r = await rename(headings[1], 'Renamed Heading');
    expect(r.ok).toBe(true);
    expect(factsOf(r)).toContain('table of contents not refreshed');
    expect(tocOf(await lane.call<string>('settled'))).toEqual(tocOf(native));
    expect(await lane.call('historyState')).toEqual({ open: 0, insertingToc: false });
    const edited = await lane.call<string>('userEdit', '0;0;0', 'U');
    await lane.call('pressInDocument', 'z');
    expect(await lane.call<boolean>('equivalent', await lane.call<string>('settled'), edited)).toBe(false);
  }, 120000);

  it('M1: a rebuild that throws halfway rolls the whole change back and leaves no undo group open', async () => {
    const { native, headings } = await open({});
    await lane.call('injectTocFailure');
    const r = await rename(headings[1], 'Renamed Heading');
    expect(r.ok).toBe(false);
    const now = await lane.call<string>('settled');
    expect(await lane.call<boolean>('equivalent', now, native)).toBe(true);
    expect(tocOf(now)).toEqual(tocOf(native));
    expect(await lane.call('historyState')).toEqual({ open: 0, insertingToc: false });
    // the person's own edit and undo still work
    await lane.call<string>('userEdit', '0;0;0', 'U');
    await lane.call('pressInDocument', 'z');
    expect(await lane.call<boolean>('equivalent', await lane.call<string>('settled'), native)).toBe(true);
  }, 120000);

  it('M2: a title before the field in its first paragraph is the model\'s to edit; the contents is not rebuilt around it, and the fact says why', async () => {
    await open({ prefix: 'Contents of this proposal ' });
    const native = await lane.call<string>('settled');
    const doc = JSON.parse(native);
    const bi = doc.sections[0].blocks.findIndex((b: any) => (b.inlines ?? []).some((i: any) => i.text === 'Contents of this proposal '));
    const pid = await at(['sections', 0, 'blocks', bi]);
    const run = (await read([pid]))[pid].inlines.find((i: any) => i.text === 'Contents of this proposal ');
    const r = await dispatch('write', { intent: 'Retitle.', scope: { ids: [run.id] }, changes: [{ kind: 'replace', id: run.id, base: run.base, node: { ...strip(run), text: 'In this proposal ' } }] });
    if (!r.ok) throw new Error(JSON.stringify(r).slice(0, 1200));
    const now = await lane.call<string>('settled');
    // the editor's rebuild would move the title into a paragraph of its own, drop its style and add
    // an empty paragraph each time: such a contents is left as it is, and the fact says so
    expect(tocOf(now)).toEqual(tocOf(native));
    expect(JSON.stringify(r.facts)).toContain('table of contents not refreshed: text shares a paragraph with it');
  }, 120000);

  it('M2: the whole contents can be removed', async () => {
    const { native } = await open({});
    const doc = JSON.parse(native);
    const first = doc.sections[0].blocks.findIndex((b: any) => (b.inlines ?? []).some((i: any) => typeof i.text === 'string' && /^\s*TOC\s/.test(i.text)));
    const last = doc.sections[0].blocks.findIndex((b: any, k: number) => k > first && (b.inlines ?? []).length === 1 && b.inlines[0].fieldType === 1);
    const ids: string[] = [];
    for (let k = first; k <= last; k += 1) ids.push(await at(['sections', 0, 'blocks', k]));
    const nodes = await read(ids, 'stubs');
    const r = await dispatch('write', { intent: 'Remove the contents.', scope: { ids }, changes: ids.map((id) => ({ kind: 'delete', id, base: nodes[id].base })) });
    if (!r.ok) throw new Error(JSON.stringify(r).slice(0, 1200));
    await lane.call('acceptAllLive');
    expect(tocOf(await lane.call<string>('settled')).entries).toEqual([]);
  }, 120000);

  it.each([...SHAPES, ['the flagship, a heading starting with a cross-reference bookmark', withToc('levels', { refFirst: true })]])('M4: _Toc bookmarks do not pile up across writes (%s)', async (_n, document) => {
    turn += 1;
    await lane.call('open', document);
    const native = await lane.call<string>('settled');
    const headings = listedHeadings(native, stylesOf(tocOf(native).code));
    const count = async () => ((await lane.call<string>('settled')).match(/"name":"_Toc/gi) ?? []).length;
    const pid = await at(['sections', headings[1].si, 'blocks', headings[1].bi]);
    const run = textRuns((await read([pid]))[pid])[0];
    // a tracked insertion at the heading's start, before its bookmark
    await write({ intent: 'Prefix.', scope: { ids: [run.id] }, changes: [{ kind: 'replace', id: run.id, base: run.base, node: { ...strip(run), text: `Revised ${run.text}` } }] });
    const once = await count();
    await rename(headings[2], 'Second Rename');
    await rename(headings[3], 'Third Rename');
    const counts = [once, await count()];
    await rename(headings[4] ?? headings[0], 'Fourth Rename');
    counts.push(await count());
    expect(counts).toEqual([once, once, once]);
  }, 120000);

  it('M5: a contents the editor will not touch (locked) is reported as not refreshed, never as refreshed', async () => {
    const { native, headings } = await open({ locked: true });
    const r = await rename(headings[1], 'Renamed Heading');
    if (!r.ok) throw new Error(JSON.stringify(r).slice(0, 1200));
    expect(factsOf(r)).not.toContain('table of contents refreshed');
    expect(factsOf(r)).toContain('table of contents not refreshed');
    expect(tocOf(await lane.call<string>('settled')).entries).toEqual(tocOf(native).entries);
  }, 120000);
});
