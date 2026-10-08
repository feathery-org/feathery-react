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
