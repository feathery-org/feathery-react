import fs from 'fs';
import path from 'path';
import { EngineLane, startEngineLane } from './headless/engineLane';

const flagship = fs.readFileSync(path.join(__dirname, 'corpus', 'flagship-v4b.sfdt.json'), 'utf8');

let lane: EngineLane;
beforeAll(async () => {
  lane = await startEngineLane();
}, 600000);
afterAll(async () => {
  await lane?.close();
});

const dispatch = async (turnId: string, verb: string, input: unknown): Promise<any> => {
  const out = await lane.call<any>('dispatch', verb, { turnId, editorId: 'ed', target: { type: 'envelope', id: 'env' }, input });
  if (out.status !== 'ok') throw new Error(JSON.stringify(out));
  if (verb === 'write' && out.result.ok) await lane.call('finishTurn');
  return out.result;
};
const read = async (ids: string[]): Promise<Record<string, any>> =>
  Object.fromEntries((await dispatch('read', 'read', { ids })).nodes.map((n: any) => [n.id, n]));
const idAt = (p: Array<string | number>) => lane.call<string>('idAt', p);
const occurrencesIn = (text: string, needle: string) => text.split(needle).length - 1;

describe('moving content that holds another card pending replace (Hilb post-v9 B2, 0590e168)', () => {
  it('lands, and accepting everything leaves the replaced text once, at the new place', async () => {
    await lane.call('open', flagship);
    const paragraphId = await idAt(['sections', 3, 'blocks', 16]);
    const run = (await read([paragraphId]))[paragraphId].inlines.find((i: any) => i.kind === 'run');
    const { id, base, kind, style } = run;
    const replaced = await dispatch('card-A', 'write', { intent: 'Replace the clause.', scope: { ids: [id] }, changes: [{ kind: 'replace', id, base, node: { id, kind, style, text: 'This clause was replaced.' } }] });
    expect(replaced.ok).toBe(true);

    const anchorId = await idAt(['sections', 3, 'blocks', 2]);
    const sectionId = await idAt(['sections', 3]);
    const nodes = await read([paragraphId, anchorId, sectionId]);
    const move = await dispatch('card-B', 'write', { intent: 'Move it.', scope: { ids: [paragraphId, anchorId, sectionId] }, changes: [{ kind: 'move', id: paragraphId, shape: nodes[paragraphId].shape, anchor: anchorId, position: 'after', container: nodes[sectionId].shape }] });
    expect(move).toMatchObject({ ok: true, committed: true });

    await lane.call('acceptAllLive');
    const accepted = await lane.call<string>('serialize');
    expect(occurrencesIn(accepted, 'This clause was replaced.')).toBe(1);
    expect(occurrencesIn(accepted, `"${run.text}"`)).toBe(0);
  });

  it('returns the fingerprints of what the move marked, so an edit inside the moved content lands on them (Hilb a2fda572)', async () => {
    await lane.call('open', flagship);
    const paragraphId = await idAt(['sections', 3, 'blocks', 16]);
    const anchorId = await idAt(['sections', 3, 'blocks', 2]);
    const sectionId = await idAt(['sections', 3]);
    const nodes = await read([paragraphId, anchorId, sectionId]);
    const { id, kind, style } = nodes[paragraphId].inlines.find((i: any) => i.kind === 'run');

    const move = await dispatch('move', 'write', { intent: 'Move it.', scope: { ids: [paragraphId, anchorId, sectionId] }, changes: [{ kind: 'move', id: paragraphId, shape: nodes[paragraphId].shape, anchor: anchorId, position: 'after', container: nodes[sectionId].shape }] });
    expect(move).toMatchObject({ ok: true, committed: true });

    const base = move.fingerprints[id]?.base;
    const edit = await dispatch('edit', 'write', { intent: 'Reword it.', scope: { ids: [id] }, changes: [{ kind: 'replace', id, base, node: { id, kind, style, text: 'This clause was reworded.' } }] });
    expect(edit).toMatchObject({ ok: true, committed: true });
  });
});
