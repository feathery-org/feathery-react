/**
 * Documents that arrive with many pending changes of someone else (troy-1: the production generator
 * marks its output as tracked changes by "Robin", without a change-set tag): a text replace, a
 * section delete and a column insert each prove; a failed commit rolls back exactly (byte for byte
 * but for the widths the editor lays out again on a reopen); every
 * pre-existing revision keeps its id and its anchors; and our card stays separate from theirs.
 */
import fs from 'fs';
import path from 'path';
import { EngineLane, startEngineLane } from './headless/engineLane';
import { layoutOnly, wholeDocument } from '../host';

let lane: EngineLane;
beforeAll(async () => {
  lane = await startEngineLane();
}, 600000);
afterAll(async () => {
  await lane?.close();
});

let turn = 0;
const dispatch = async (verb: string, input: unknown): Promise<any> => {
  const out = await lane.call<any>('dispatch', { protocolVersion: 1, turnId: `fr-${turn}`, editorId: 'ed', target: { type: 'envelope', id: 'env' }, verb, input });
  if (out.status !== 'ok') throw new Error(JSON.stringify(out.failure));
  if (verb === 'write') await lane.call('finishTurn');
  return out.response.result;
};
const read = async (ids: string[]): Promise<Record<string, any>> => {
  const r = await dispatch('read', { ids });
  if (!r.ok) throw new Error(JSON.stringify(r).slice(0, 400));
  return Object.fromEntries(r.nodes.map((n: any) => [n.id, n]));
};
const strip = (v: any): any =>
  Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !['base', 'shape', 'usedBy', 'derived', 'pending', 'properties'].includes(k)).map(([k, x]) => [k, strip(x)])) : v;

interface Rev { author: string; type: string; anchors: number; sections: Set<number>; chars: number; others: number }
/** Each revision of the document by id: its author, how many places anchor it and where. */
function revisionsOf(native: string): Map<string, Rev> {
  const d = JSON.parse(native);
  const out = new Map<string, Rev>();
  for (const r of d.revisions ?? []) out.set(r.revisionId, { author: r.author, type: r.revisionType, anchors: 0, sections: new Set(), chars: 0, others: 0 });
  const walk = (n: any, section: number) => {
    if (Array.isArray(n)) return n.forEach((x) => walk(x, section));
    if (!n || typeof n !== 'object') return;
    for (const id of n.revisionIds ?? []) {
      const r = out.get(id);
      if (!r) continue;
      r.anchors += 1;
      r.sections.add(section);
      if (typeof n.text === 'string') r.chars += n.text.length;
      else r.others += 1;
    }
    Object.entries(n).forEach(([k, v]) => k !== 'revisionIds' && walk(v, section));
  };
  (d.sections ?? []).forEach((s: any, i: number) => walk(s, i));
  return out;
}

/** What one author's revisions of one kind cover: characters of text and other anchors (rows, marks). */
function coverage(revs: Map<string, Rev>, keep: (id: string) => boolean): Record<string, { chars: number; others: number }> {
  const out: Record<string, { chars: number; others: number }> = {};
  for (const [id, r] of revs) {
    if (!keep(id)) continue;
    const c = (out[`${r.author}/${r.type}`] ??= { chars: 0, others: 0 });
    c.chars += r.chars;
    c.others += r.others;
  }
  return out;
}

/** The flagship with every run of every other body paragraph marked as an insertion by the generator. */
function generatedFlagship(author: string): string {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'corpus', 'flagship-v4b.sfdt.json'), 'utf8'));
  d.revisions = d.revisions ?? [];
  let n = 0;
  const mark = (blocks: any[]) =>
    blocks.forEach((b, i) => {
      if (Array.isArray(b.blocks)) return mark(b.blocks);
      if (Array.isArray(b.rows)) return b.rows.forEach((r: any) => r.cells.forEach((c: any) => mark(c.blocks)));
      if (i % 2 || !Array.isArray(b.inlines)) return;
      for (const run of b.inlines)
        if (typeof run.text === 'string' && run.text) {
          const id = `gen${String(n++).padStart(6, '0')}`;
          run.revisionIds = [id];
          d.revisions.push({ author, date: '2026-10-01T00:00:00Z', revisionType: 'Insertion', revisionId: id });
        }
    });
  d.sections.forEach((s: any) => mark(s.blocks));
  return JSON.stringify(d);
}

const privateDir = process.env.ROBIN_DOCUMENT_PRIVATE_CORPUS;
const mare = privateDir ? path.join(privateDir, 'hilb-mare-generated.sfdt.json') : '';

const documents: Array<[string, () => string]> = [
  ['the flagship with 100+ pending insertions by "Robin"', () => generatedFlagship('Robin')],
  ['the flagship with pending insertions by the generator\'s marked "Robin"', () => generatedFlagship('Robin⁡⁠⁡')],
  ...(mare && fs.existsSync(mare) ? ([["Mare's generated proposal (private corpus)", () => fs.readFileSync(mare, 'utf8')]] as Array<[string, () => string]>) : [])
];

async function open(make: () => string): Promise<{ pre: string; before: Map<string, { author: string; anchors: number }> }> {
  turn += 1;
  await lane.call('open', make());
  // the document as the engine reads it: the editor's export may add a paste flag
  const pre = wholeDocument(await lane.call<string>('settled'));
  return { pre, before: revisionsOf(pre) };
}

/**
 * Every revision the document had keeps its id, author and anchors, except inside a section the
 * write deleted: there the editor coalesces what our deletion now spans (adjacent runs of one
 * insertion become one run, rows' insertions of one author one revision), so there what is kept is
 * the coverage: each author's insertions still cover the same text and the same rows.
 */
function keptRevisions(before: Map<string, Rev>, after: Map<string, Rev>, deleted?: number) {
  const lost: string[] = [];
  const outside = (id: string) => !before.get(id)?.sections.has(deleted ?? -1);
  for (const [id, r] of before) {
    if (!outside(id)) continue;
    const now = after.get(id);
    if (!now || now.author !== r.author || now.anchors !== r.anchors) lost.push(`${id}: ${r.author} ${r.anchors} -> ${now ? `${now.author} ${now.anchors}` : 'gone'}`);
  }
  if (deleted !== undefined) {
    const inside = (revs: Map<string, Rev>, mine: (id: string) => boolean) => coverage(revs, (id) => mine(id) && (revs.get(id) as Rev).sections.has(deleted));
    const had = inside(before, () => true);
    // what the document had, less the deletion this write added
    const has = inside(after, (id) => before.has(id) || (after.get(id) as Rev).type !== 'Deletion');
    for (const [k, c] of Object.entries(had)) if (JSON.stringify(has[k]) !== JSON.stringify(c)) lost.push(`${k} in the deleted section: ${JSON.stringify(c)} -> ${JSON.stringify(has[k])}`);
  }
  return lost;
}

/** The writes: a text replace in the first paragraph with text, a section delete, a column insert. */
async function writes(): Promise<Array<{ name: string; input: any; section?: number }>> {
  const root = (await read(['root'])).root;
  const sections = root.sections.map((s: any) => s.id);
  const out: Array<{ name: string; input: any; section?: number }> = [];
  const hits = (await dispatch('find', { kind: 'paragraph', limit: 200 })).hits.filter((h: any) => /\w{4,}/.test(h.snippet));
  let run: any;
  for (const h of hits) {
    const p = (await read([h.id]))[h.id];
    run = (p.inlines ?? []).find((i: any) => i.kind === 'run' && /\w{4,}/.test(i.text ?? ''));
    if (run) break;
  }
  out.push({ name: 'text replace', input: { intent: 'Reword.', scope: { ids: [run.id] }, changes: [{ kind: 'replace', id: run.id, base: run.base, node: { ...strip(run), text: `${run.text} (reworded)` } }] } });
  // a section no formula elsewhere reads, from the end (a delete of one that is read is refused)
  for (const doomed of [...sections].reverse()) {
    const s = (await read([doomed]))[doomed];
    const input = { intent: 'Remove a section.', scope: { ids: [doomed] }, changes: [{ kind: 'delete', id: doomed, base: s.base }] };
    if ((await dispatch('write', { ...input, dryRun: true })).ok) {
      out.push({ name: 'section delete', input, section: sections.indexOf(doomed) });
      break;
    }
  }
  const tables = (await dispatch('find', { kind: 'table', limit: 40 })).hits.map((h: any) => h.id);
  for (const tid of tables) {
    const t = (await read([tid]))[tid];
    const widths = new Set(t.rows.map((r: any) => r.cells.length));
    if (widths.size !== 1 || t.rows.length < 2) continue;
    out.push({
      name: 'column insert',
      input: {
        intent: 'Add a column.',
        scope: { ids: t.rows.map((r: any) => r.cells[r.cells.length - 1].id) },
        changes: t.rows.map((r: any) => {
          const last = r.cells[r.cells.length - 1];
          return { kind: 'insert_after', anchor: last.id, container: r.shape, node: { kind: 'cell', style: last.style, blocks: [{ kind: 'paragraph', style: last.blocks[0]?.style, inlines: [{ kind: 'run', text: 'New' }] }] } };
        })
      }
    });
    break;
  }
  return out;
}

describe.each(documents)('%s', (_name, make) => {
  it('each write proves, keeps every pending revision it had, and its card stays its own', async () => {
    const { before } = await open(make);
    const theirs = [...before.values()];
    expect(theirs.length).toBeGreaterThan(50);
    for (const { name, input, section } of await (async () => writes())()) {
      const { before: had } = await open(make);
      const cardsBefore = await lane.call<Array<{ title: string }>>('rail');
      const r = await dispatch('write', input);
      if (!r.ok) throw new Error(`${name}: ${JSON.stringify(r.refusal ?? r.conflict ?? r.error).slice(0, 600)}`);
      expect([name, r.trace.proof.outcome]).toEqual([name, 'passed']);
      const after = revisionsOf(await lane.call<string>('settled'));
      const lost = keptRevisions(had, after, section);
      expect([name, lost.slice(0, 5)]).toEqual([name, []]);
      // ours are new ids, authored Robin, carrying this turn's change set; theirs carry none
      const ours = [...after.entries()].filter(([id]) => !had.has(id));
      expect([name, ours.length > 0]).toEqual([name, true]);
      const revisions = await lane.call<Array<{ group: string | null; author: string }>>('revisions');
      expect([name, revisions.some((x) => x.group === `fr-${turn}`)]).toEqual([name, true]);
      expect([name, revisions.filter((x) => x.group === `fr-${turn}`).every((x) => x.author === 'Robin')]).toEqual([name, true]);
      // in the rail, theirs stay as they were and ours is one card of its own
      const cardsAfter = (await lane.call<Array<{ title: string }>>('rail')).map((c) => c.title);
      const ourTitle = cardsAfter.find((t) => !cardsBefore.some((c) => c.title === t));
      expect([name, cardsAfter.length, ourTitle !== undefined]).toEqual([name, cardsBefore.length + 1, true]);
    }
  });

  it('a commit that does not land as composed rolls back exactly', async () => {
    for (const { name, input } of (await (async () => { await open(make); return writes(); })()).filter((w) => w.name !== 'text replace')) {
      const { pre } = await open(make);
      await lane.call('injectFailure');
      const r = await dispatch('write', input);
      expect([name, r.ok, r.refusal?.invariant]).toEqual([name, false, 'proof-failed']);
      // exact: the bytes before, or (a snapshot reopened re-lays out percent-width tables) the same
      // bytes but for laid-out cell widths and grids
      expect([name, r.trace.proof.rollback]).toEqual([name, expect.objectContaining({ exact: true, equivalent: true })]);
      // the document as the engine reads it (the editor's own export adds a paste flag after a reopen)
      const now = wholeDocument(await lane.call<string>('settled'));
      if (!layoutOnly(now, pre)) {
        const L = /"cellWidth":-?[\d.eE+-]+|"grid":\[[\d.eE+,\s-]*\]/g;
        const a = pre.replace(L, '');
        const b = now.replace(L, '');
        let i = 0;
        while (i < b.length && b[i] === a[i]) i += 1;
        throw new Error(`${name}: rollback differs beyond layout at ${i}: ${a.slice(i - 200, i + 150)}\n  now: ${b.slice(i - 200, i + 150)}`);
      }
    }
  });
});
