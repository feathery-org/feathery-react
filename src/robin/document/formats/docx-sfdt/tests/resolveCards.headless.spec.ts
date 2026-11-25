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

const dispatch = async (verb: string, input: unknown, turnId = 'card-turn-1'): Promise<any> => {
  const out = await lane.call<any>('dispatch', verb, { turnId, editorId: 'ed', target: { type: 'envelope', id: 'env' }, input });
  if (out.status !== 'ok') throw new Error(JSON.stringify(out));
  if (verb === 'write' && out.result.ok) await lane.call('finishTurn');
  return out.result;
};

const retitle = async (turnId: string) => {
  const id = await lane.call<string>('idAt', ['sections', 3, 'blocks', 16]);
  const run = (await dispatch('read', { ids: [id] })).nodes[0].inlines.find((i: any) => i.kind === 'run');
  return dispatch(
    'write',
    { intent: 'Replace the clause.', scope: { ids: [run.id] }, changes: [{ kind: 'replace', id: run.id, base: run.base, node: { id: run.id, kind: run.kind, style: run.style, text: 'This clause was replaced.' } }] },
    turnId
  );
};

describe("Robin resolving its own pending cards (Hilb post-v9 G1)", () => {
  it('lists a written card, withdraws it by prefix, and leaves the document as it was', async () => {
    await lane.call('open', flagship);
    const before = await lane.call<string>('serialize');
    const turnId = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    expect(await retitle(turnId)).toMatchObject({ ok: true, landed: 'card' });
    const { cards } = await lane.call<any>('descriptor');
    expect(cards).toEqual([expect.objectContaining({ id: turnId, intent: 'Replace the clause.' })]);

    const withdrawn = await dispatch('resolve', { cards: [turnId.slice(0, 8)], accept: false });

    expect(withdrawn).toMatchObject({ ok: true, cards: [turnId], accepted: false });
    expect(await lane.call<string>('serialize')).toEqual(before);
    expect((await lane.call<any>('descriptor')).cards).toBeUndefined();
  });

  it("reports Robin's resolve as Robin's change, not the person's", async () => {
    await lane.call('open', flagship);
    const turnId = 'b1b2c3d4e5f60718293a4b5c6d7e8f90';
    await retitle(turnId);
    await lane.call<string[]>('changeEvents');

    await dispatch('resolve', { cards: [turnId], accept: false });
    const events = await lane.call<string[]>('changeEvents');

    expect(events.length).toBeGreaterThan(0);
    expect(events.filter((e) => e.endsWith(':person'))).toEqual([]);
  });

  it('keeps the ids of identical nodes certain after a withdrawal, so a rewrite from its fingerprints lands (3a756c01)', async () => {
    const para = (text: string) => ({ paragraphFormat: {}, characterFormat: {}, inlines: [{ characterFormat: {}, text }] });
    await lane.call('open', JSON.stringify({ sections: [{ sectionFormat: {}, blocks: [para('Premium'), para('Premium'), para('Premium'), para('End')], headersFooters: {} }] }));
    const [first, second, third] = await Promise.all([1, 2, 3].map((i) => lane.call<string>('idAt', ['sections', 0, 'blocks', i - 1])));
    const nodes = Object.fromEntries((await dispatch('read', { ids: [first, second, third] })).nodes.map((n: any) => [n.id, n]));
    const turnId = 'b1c2d3e4f5a60718293a4b5c6d7e8f90';
    await dispatch('write', { intent: 'Remove a premium line.', scope: { ids: [second] }, changes: [{ kind: 'delete', id: second, base: nodes[second].base }] }, turnId);

    const withdrawn = await dispatch('resolve', { cards: [turnId.slice(0, 8)], accept: false });
    const base = withdrawn.fingerprints[third]?.base ?? nodes[third].base;
    const run = nodes[third].inlines[0];
    const rewrite = await dispatch(
      'write',
      { intent: 'Rename the last premium line.', scope: { ids: [third] }, changes: [{ kind: 'replace', id: third, base, node: { id: third, kind: 'paragraph', inlines: [{ id: run.id, kind: 'run', text: 'Premium total' }] } }] },
      'c1c2d3e4f5a60718293a4b5c6d7e8f90'
    );

    expect(rewrite).toMatchObject({ ok: true, committed: true });
  });

  it('refuses a card that is not pending, and a prefix naming two cards', async () => {
    await lane.call('open', flagship);
    await retitle('ffff0000aaaa1111');
    const notPending = await dispatch('resolve', { cards: ['0123456789abcdef'], accept: false });
    expect(notPending).toMatchObject({ ok: false, refusal: { invariant: 'card-not-pending', retry: 'do_not_retry' } });

    await lane.call('open', flagship);
    await retitle('ffff0000aaaa1111');
    const id = await lane.call<string>('idAt', ['sections', 3, 'blocks', 2]);
    const run = (await dispatch('read', { ids: [id] })).nodes[0].inlines.find((i: any) => i.kind === 'run');
    await dispatch('write', { intent: 'Second change.', scope: { ids: [run.id] }, changes: [{ kind: 'replace', id: run.id, base: run.base, node: { id: run.id, kind: run.kind, style: run.style, text: 'Second.' } }] }, 'ffff0000aaaa2222');
    const ambiguous = await dispatch('resolve', { cards: ['ffff0000'], accept: true });
    expect(ambiguous).toMatchObject({ ok: false, refusal: { invariant: 'card-ambiguous', retry: 'modified_input' } });
  });
});
