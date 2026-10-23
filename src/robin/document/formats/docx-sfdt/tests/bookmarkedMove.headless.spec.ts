/**
 * Codex review item 1, natively: a paragraph holding a bookmark is moved by the engine (a tracked
 * move, a card the engine owns), the person then formats part of the moved text (the editor splits
 * the run), the document is opened again (the engine's snapshot no longer applies), and the card
 * is rejected from the rail. The bookmark must come back with the paragraph, whatever the person's
 * formatting did to its runs.
 */
import { EngineLane, startEngineLane } from './headless/engineLane';

let lane: EngineLane;
beforeAll(async () => {
  lane = await startEngineLane();
}, 600000);
afterAll(async () => {
  await lane?.close();
});

const p = (inlines: any[]) => ({ paragraphFormat: {}, characterFormat: {}, inlines });
const doc = JSON.stringify({
  sections: [
    {
      sectionFormat: { pageWidth: 612, pageHeight: 792, leftMargin: 72, rightMargin: 72, topMargin: 72, bottomMargin: 72 },
      blocks: [
        p([{ text: 'First paragraph.' }]),
        p([{ bookmarkType: 0, name: 'anchor' }, { text: 'Moved paragraph text' }, { bookmarkType: 1, name: 'anchor' }]),
        p([{ text: 'Third paragraph.' }]),
        p([{ text: 'Last paragraph.' }])
      ],
      headersFooters: {}
    }
  ]
});
let turn = 0;
const dispatch = async (verb: string, input: unknown): Promise<any> => {
  const out = await lane.call<any>('dispatch', verb, { turnId: `bm-${turn}`, editorId: 'ed', target: { type: 'envelope', id: 'env' }, input });
  if (out.status !== 'ok') throw new Error(JSON.stringify(out));
  if (verb === 'write') await lane.call('finishTurn');
  return out.result;
};
const bookmarksIn = (native: string) => {
  const out: string[] = [];
  const d = JSON.parse(native);
  d.sections[0].blocks.forEach((b: any, i: number) => {
    for (const x of b.inlines ?? []) if (x.bookmarkType !== undefined) out.push(`${i}:${x.name}:${x.bookmarkType}`);
  });
  return out;
};
const texts = (native: string) => JSON.parse(native).sections[0].blocks.map((b: any) => (b.inlines ?? []).map((x: any) => x.text ?? '').join(''));

describe('a bookmarked paragraph moved, partly formatted, reopened and rejected', () => {
  it.each([
    ['the middle bolded', '0;3;6', '0;3;15'],
    ['the start bolded', '0;3;1', '0;3;6'],
    ['nothing formatted', null, null]
  ])('%s: the bookmark comes back with the paragraph', async (_name, from, to) => {
    turn += 1;
    await lane.call('open', doc);
    const moved = await lane.call<string>('idAt', ['sections', 0, 'blocks', 1]);
    const last = await lane.call<string>('idAt', ['sections', 0, 'blocks', 3]);
    const section = await lane.call<string>('idAt', ['sections', 0]);
    const n = Object.fromEntries((await dispatch('read', { ids: [moved, section] })).nodes.map((x: any) => [x.id, x]));
    const r = await dispatch('write', { intent: 'Move the paragraph to the end.', scope: { ids: [moved] }, changes: [{ kind: 'move', id: moved, shape: n[moved].shape, anchor: last, container: n[section].shape, position: 'after' }] });
    expect(r).toEqual(expect.objectContaining({ ok: true, committed: true, landed: 'card' }));
    if (from && to) {
      // the moved copy now sits last (block 4; the deleted copy keeps block 1): select inside it
      await lane.call('selectText', from.replace('0;3;', '0;4;'), to.replace('0;3;', '0;4;'));
      await lane.call('boldSelection');
    }
    // the document opened again: the engine's snapshot of the move no longer applies
    await lane.call('editorOpen', await lane.call<string>('settled'));
    const rail = await lane.call<Array<{ title: string }>>('rail');
    const card = rail.findIndex((c) => /Moved/.test(c.title));
    expect(card).toBeGreaterThanOrEqual(0);
    await lane.call('clickCard', card, 'Reject');
    const after = await lane.call<string>('settled');
    expect(texts(after)).toEqual(['First paragraph.', 'Moved paragraph text', 'Third paragraph.', 'Last paragraph.']);
    expect(bookmarksIn(after)).toEqual(['1:anchor:0', '1:anchor:1']);
  });
});
