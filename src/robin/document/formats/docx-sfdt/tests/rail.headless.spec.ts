/**
 * The review rail and undo routing, driven as a person drives them in the real editor: the
 * product's TrackedChangeGroups and toolbar HistoryGroup rendered over the live editor, with the
 * engine's session registered as the card resolver and the undo route (as robinDocument.ts does).
 */
import fs from 'fs';
import path from 'path';
import { EngineLane, startEngineLane } from './headless/engineLane';
import { docxPack } from '../index';
import { NfNode } from '../../../tree';

const flagship = fs.readFileSync(path.join(__dirname, 'corpus', 'flagship-v4b.sfdt.json'), 'utf8');

let lane: EngineLane;
beforeAll(async () => {
  lane = await startEngineLane();
}, 600000);
afterAll(async () => {
  await lane?.close();
});

let turn = 0;
const dispatch = async (verb: string, input: unknown): Promise<any> => {
  const out = await lane.call<any>('dispatch', { protocolVersion: 1, turnId: `rail-${turn}`, editorId: 'ed', target: { type: 'envelope', id: 'env' }, verb, input });
  if (out.status !== 'ok') throw new Error(JSON.stringify(out.failure));
  // the turn settles after a write, as the hosted handler's finishTurn does
  if (verb === 'write') await lane.call('finishTurn');
  return out.response.result;
};
const read = async (ids: string[]): Promise<Record<string, any>> => {
  const r = await dispatch('read', { ids });
  if (!r.ok) throw new Error(JSON.stringify(r).slice(0, 400));
  return Object.fromEntries(r.nodes.map((n: any) => [n.id, n]));
};
const at = (p: Array<string | number>) => lane.call<string>('idAt', p);
const strip = (v: any): any =>
  Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !['base', 'shape', 'usedBy', 'derived', 'pending', 'properties'].includes(k)).map(([k, x]) => [k, strip(x)])) : v;
async function fresh(): Promise<string> {
  turn += 1;
  await lane.call('open', flagship);
  return lane.call<string>('userEdit', '0;1;0', 'U');
}
const settled = () => lane.call<string>('settled');
const same = (a: string, b: string) => lane.call<boolean>('equivalent', a, b);
const groups = (native: string) => [...new Set((JSON.parse(native).revisions ?? []).map((r: any) => { try { return JSON.parse(r.customData ?? 'null')?.changeSetId; } catch { return null; } }).filter(Boolean))];

describe('the review rail and undo routing in the real editor', () => {
  it('a text card: the engine title, native per-edit review, Reject, then toolbar Undo brings it back', async () => {
    const pre = await fresh();
    const pid = await at(['sections', 3, 'blocks', 16]);
    const run = (await read([pid]))[pid].inlines.find((i: any) => i.kind === 'run');
    const r = await dispatch('write', { intent: 'Replace the clause.', scope: { ids: [run.id] }, changes: [{ kind: 'replace', id: run.id, base: run.base, node: { ...strip(run), text: 'This clause was replaced.' } }] });
    expect(r.landed).toBe('card');
    const cards = await lane.call<Array<{ title: string; perEditButtons: number }>>('rail');
    expect(cards.map((c) => c.title)).toEqual(['Edited a paragraph']);
    await lane.call('clickCard', 0, 'Reject');
    expect(await lane.call('rail')).toEqual([]);
    expect(await same(await settled(), pre)).toBe(true);
    await lane.call('clickToolbar', 'Undo');
    expect((await lane.call<Array<{ title: string }>>('rail')).map((c) => c.title)).toEqual(['Edited a paragraph']);
  });

  it('a structural card is the engine’s: no per-edit buttons; Reject restores byte for byte; Ctrl+Z brings it back; Accept settles it', async () => {
    const pre = await fresh();
    const tid = await at(['sections', 3, 'blocks', 10, 'blocks', 0]);
    const t = (await read([tid]))[tid];
    const rowsBefore = t.rows.length;
    const r = await dispatch('write', { intent: 'Remove a line.', scope: { ids: [t.rows[2].id] }, changes: [{ kind: 'delete', id: t.rows[2].id, base: t.rows[2].base }] });
    expect(r.landed).toBe('card');
    const committed = await settled();
    const cards = await lane.call<Array<{ title: string; perEditButtons: number }>>('rail');
    expect(cards).toEqual([{ title: 'Removed a row', perEditButtons: 0 }]);
    await lane.call('clickCard', 0, 'Reject');
    expect(await settled()).toBe(pre);
    expect(await lane.call('rail')).toEqual([]);
    await lane.call('pressInDocument', 'z');
    expect(await same(await settled(), committed)).toBe(true);
    expect((await lane.call<Array<{ title: string }>>('rail')).map((c) => c.title)).toEqual(['Removed a row']);
    await lane.call('clickCard', 0, 'Accept');
    const accepted = await settled();
    expect(await lane.call('rail')).toEqual([]);
    expect(groups(accepted)).toEqual([]);
    const nf = docxPack.adapter.toNormalForm(accepted).nf;
    const table = ((((nf.root.sections as NfNode[])[3].blocks as NfNode[])[10].blocks as NfNode[])[0]) as NfNode;
    expect((table.rows as NfNode[]).length).toBe(rowsBefore - 1);
  });

  it('Accept on an engine card keeps the place the person was reading', async () => {
    await fresh();
    const tid = await at(['sections', 3, 'blocks', 10, 'blocks', 0]);
    const t = (await read([tid]))[tid];
    await dispatch('write', { intent: 'Remove a line.', scope: { ids: [t.rows[2].id] }, changes: [{ kind: 'delete', id: t.rows[2].id, base: t.rows[2].base }] });
    const place = await lane.call<number>('viewerScroll', 2400);
    expect(place).toBeGreaterThan(1000);
    await lane.call('clickCard', 0, 'Accept');
    expect(await lane.call('rail')).toEqual([]);
    expect(Math.abs((await lane.call<number>('viewerScroll')) - place)).toBeLessThan(40);
  });

  it('a card\'s title goes to its first change a person can see, past a page break', async () => {
    await fresh();
    const pid = await at(['sections', 3, 'blocks', 16]);
    const sid = await at(['sections', 3]);
    const n = await read([sid, pid]);
    const sec = n[sid];
    const style = n[pid].style;
    const r = await dispatch('write', {
      intent: 'Start a new page with a note.',
      scope: { ids: [sid] },
      changes: [
        { kind: 'insert_after', anchor: pid, container: sec.shape, node: { kind: 'paragraph', id: 'tmp:p1', style, inlines: [{ kind: 'run', text: '\f' }] } },
        { kind: 'insert_after', anchor: 'tmp:p1', container: sec.shape, node: { kind: 'paragraph', style, inlines: [{ kind: 'run', text: 'A note on its own page.' }] } }
      ]
    });
    if (!r.ok) throw new Error(JSON.stringify(r).slice(0, 800));
    await lane.call('rail');
    await lane.call('clickTitle', 0);
    expect(await lane.call<string>('caretParagraphText')).toContain('A note on its own page.');
  });

  // matrix-1 T3: the model's own column write, then Reject on its card in the rail. Every control
  // the card inserted goes, tags included, and the bindings index holds no phantom name.
  it('Reject on a new bound column removes every control it inserted, from the document and the bindings index', async () => {
    turn += 1;
    await lane.call('open', fs.readFileSync(path.join(__dirname, 'corpus', 'flagship-v4d.sfdt.json'), 'utf8'));
    const pre = await settled();
    const before = await lane.call<{ indexed: string[]; tags: string[] }>('bindingNames');
    const run = JSON.parse(fs.readFileSync(path.join(__dirname, 'runs', 'matrix-1-run.json'), 'utf8')) as { writes: Array<{ task: string; input: any }> };
    const r = await dispatch('write', (run.writes.find((w) => w.task === 'T3') as { input: any }).input);
    if (!r.ok) throw new Error(JSON.stringify(r).slice(0, 600));
    const mid = await lane.call<{ indexed: string[]; tags: string[] }>('bindingNames');
    expect(mid.tags.filter((t) => /premium_tax/.test(t))).toHaveLength(5);
    expect(mid.indexed).toContain('premium_tax');
    expect((await lane.call<Array<{ title: string }>>('rail')).map((c) => c.title)).toEqual(['Added a column']);
    await lane.call('clickCard', 0, 'Reject');
    const after = await lane.call<{ indexed: string[]; tags: string[] }>('bindingNames');
    expect(after.tags.filter((t) => /premium_tax/.test(t))).toEqual([]);
    expect(after.indexed).not.toContain('premium_tax');
    expect(after).toEqual(before);
    expect(await same(await settled(), pre)).toBe(true);
  });

  it('Reject on a bound column card that is not the last change set (by projection) removes its controls too', async () => {
    turn += 1;
    await lane.call('open', fs.readFileSync(path.join(__dirname, 'corpus', 'flagship-v4d.sfdt.json'), 'utf8'));
    const before = await lane.call<{ indexed: string[]; tags: string[] }>('bindingNames');
    const run = JSON.parse(fs.readFileSync(path.join(__dirname, 'runs', 'matrix-1-run.json'), 'utf8')) as { writes: Array<{ task: string; input: any }> };
    const r = await dispatch('write', (run.writes.find((w) => w.task === 'T3') as { input: any }).input);
    if (!r.ok) throw new Error(JSON.stringify(r).slice(0, 600));
    // a later change set elsewhere, so the column card is no longer the last and resolves by projection
    turn += 1;
    const sid = await at(['sections', 2]);
    const sec = (await read([sid]))[sid];
    const p = sec.blocks.find((b: any) => b.kind === 'paragraph' && b.inlines?.length);
    const r2 = await dispatch('write', { intent: 'Add a note.', scope: { ids: [] }, changes: [{ kind: 'insert_after', anchor: p.id, container: sec.shape, node: { kind: 'paragraph', style: p.style, inlines: [{ kind: 'run', text: 'A later note.' }] } }] });
    if (!r2.ok) throw new Error(JSON.stringify(r2).slice(0, 600));
    const cards = await lane.call<Array<{ title: string }>>('rail');
    const column = cards.findIndex((c) => c.title === 'Added a column');
    expect(column).toBeGreaterThanOrEqual(0);
    await lane.call('clickCard', column, 'Reject');
    const after = await lane.call<{ indexed: string[]; tags: string[] }>('bindingNames');
    expect(after.tags.filter((t) => /premium_tax/.test(t))).toEqual([]);
    expect(after.indexed).not.toContain('premium_tax');
    expect(after.tags).toEqual(before.tags);
    expect((await lane.call<Array<{ title: string }>>('rail')).map((c) => c.title)).toEqual(['Added a paragraph']);
  });

  it('Reject on a new section with its own bindings removes them too (the Umbrella case)', async () => {
    const pre = await fresh();
    const before = await lane.call<{ indexed: string[]; tags: string[] }>('bindingNames');
    const sid = await at(['sections', 1]);
    const s = (await read([sid]))[sid];
    const root = (await read(['root'])).root;
    const fresh_ = (v: any): any => (Array.isArray(v) ? v.map(fresh_) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(strip(v)).filter(([k]) => k !== 'id').map(([k, x]) => [k, fresh_(x)])) : v);
    const r = await dispatch('write', {
      intent: 'Add an Umbrella section.',
      scope: { ids: [] },
      changes: [{
        kind: 'insert_after',
        anchor: sid,
        container: root.shape,
        node: {
          kind: 'section',
          style: s.style,
          headersFooters: fresh_(s.headersFooters),
          blocks: [
            { kind: 'paragraph', style: s.blocks[0].style, inlines: [{ kind: 'run', text: 'Section 4 - Umbrella' }] },
            { kind: 'paragraph', style: s.blocks[1].style, inlines: [{ kind: 'run', text: 'Limit of indemnity ' }, { kind: 'control', binding: { name: 'umbrella_limit', type: 'currency' }, inlines: [{ kind: 'run', text: '$5,000,000.00' }] }, { kind: 'run', text: ' any one occurrence.' }] }
          ]
        }
      }]
    });
    if (!r.ok) throw new Error(JSON.stringify(r).slice(0, 600));
    expect((await lane.call<{ tags: string[] }>('bindingNames')).tags.some((t) => /umbrella_limit/.test(t))).toBe(true);
    expect((await lane.call<Array<{ title: string; perEditButtons: number }>>('rail')).map((c) => c.perEditButtons)).toEqual([0]);
    await lane.call('clickCard', 0, 'Reject');
    const after = await lane.call<{ indexed: string[]; tags: string[] }>('bindingNames');
    expect(after.tags.filter((t) => /umbrella/.test(t))).toEqual([]);
    expect(after.indexed).not.toContain('umbrella_limit');
    expect(after).toEqual(before);
    expect(await settled()).toBe(pre);
  });

  it('toolbar Undo after a structural commit goes to the engine: the document before the write', async () => {
    const pre = await fresh();
    const tid = await at(['sections', 3, 'blocks', 10, 'blocks', 0]);
    const t = (await read([tid]))[tid];
    await dispatch('write', { intent: 'Remove a line.', scope: { ids: [t.rows[2].id] }, changes: [{ kind: 'delete', id: t.rows[2].id, base: t.rows[2].base }] });
    await lane.call('clickToolbar', 'Undo');
    expect(await settled()).toBe(pre);
    await lane.call('clickToolbar', 'Redo');
    expect(groups(await settled())).toEqual([`rail-${turn}`]);
  });

  it('a rewritten formula is the engine’s card: Accept leaves one control with the new formula, no empty shell', async () => {
    await fresh();
    const hits = (await dispatch('find', { feature: { name: 'formula' } })).hits as Array<{ id: string }>;
    const nodes = await read(hits.map((h) => h.id));
    const formulas = Object.values(nodes).filter((n: any) => n.kind === 'control' && typeof n.binding?.expr === 'string') as any[];
    const control = formulas.find((n) => formulas.filter((m) => m.binding.name === n.binding.name).length === 1);
    const expr = `mul(${control.binding.expr},1)`;
    await dispatch('write', { intent: 'Write the formula out.', scope: { ids: [control.id] }, changes: [{ kind: 'replace', id: control.id, base: control.base, node: { ...strip(control), binding: { ...control.binding, expr } } }] });
    const cards = await lane.call<Array<{ title: string; perEditButtons: number }>>('rail');
    expect(cards).toEqual([{ title: 'Edited a field', perEditButtons: 0 }]);
    await lane.call('clickCard', 0, 'Accept');
    const nf = docxPack.adapter.toNormalForm(await settled()).nf;
    const all: NfNode[] = [];
    const rec = (n: any) => { if (Array.isArray(n)) return n.forEach(rec); if (!n || typeof n !== 'object') return; if (n.kind === 'control' && n.binding?.name === control.binding.name) all.push(n); Object.values(n).forEach(rec); };
    rec(nf.root);
    expect(all).toHaveLength(1);
    expect((all[0].binding as any).expr).toBe(expr);
    expect(JSON.stringify(all[0])).not.toContain('"pending"');
  });
});
