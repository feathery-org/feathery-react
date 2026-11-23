/**
 * A paragraph holding a text box, moved, copied or with its box deleted by the engine: the card
 * lands, and accepting or rejecting it leaves exactly the boxes it should.
 */
import * as fs from 'fs';
import * as path from 'path';
import { EngineLane, startEngineLane } from './headless/engineLane';

let lane: EngineLane;
beforeAll(async () => {
  lane = await startEngineLane();
}, 600000);
afterAll(async () => {
  await lane?.close();
});

const flagship = JSON.parse(fs.readFileSync(path.join(__dirname, 'corpus', 'flagship-v4d.sfdt.json'), 'utf8'));
const textBox = flagship.sections[0].blocks[0].inlines[0];
const p = (inlines: any[]) => ({ paragraphFormat: {}, characterFormat: {}, inlines });
const doc = JSON.stringify({
  sections: [
    {
      sectionFormat: { pageWidth: 612, pageHeight: 792, leftMargin: 72, rightMargin: 72, topMargin: 72, bottomMargin: 72 },
      blocks: [p([{ text: 'First paragraph.' }]), p([textBox, { text: 'Cover' }]), p([{ text: 'Last paragraph.' }])],
      headersFooters: {}
    }
  ]
});
let turn = 0;
const dispatch = async (verb: string, input: unknown): Promise<any> => {
  const out = await lane.call<any>('dispatch', verb, { turnId: `tb-${turn}`, editorId: 'ed', target: { type: 'envelope', id: 'env' }, input });
  if (out.status !== 'ok') throw new Error(JSON.stringify(out));
  if (verb === 'write') await lane.call('finishTurn');
  return out.result;
};
const blocks = (native: string) =>
  JSON.parse(native).sections[0].blocks.map((b: any) => {
    const boxes = (b.inlines ?? []).filter((x: any) => x.textFrame).length;
    return `${'[box]'.repeat(boxes)}${(b.inlines ?? []).map((x: any) => x.text ?? '').join('')}`;
  });

describe('a paragraph holding a text box, written by the engine', () => {
  it.each([
    ['moved to the end', 'move', ['First paragraph.', 'Last paragraph.', '[box]Cover'], ['First paragraph.', '[box]Cover', 'Last paragraph.']],
    ['copied to the end', 'copy', ['First paragraph.', '[box]Cover', 'Last paragraph.', '[box]Cover'], ['First paragraph.', '[box]Cover', 'Last paragraph.']],
    ['the box deleted', 'delete', ['First paragraph.', 'Cover', 'Last paragraph.'], ['First paragraph.', '[box]Cover', 'Last paragraph.']]
  ])('%s: the card lands, accept and reject leave the right boxes', async (_name, kind, accepted, rejected) => {
    for (const decision of ['Accept', 'Reject'] as const) {
      turn += 1;
      await lane.call('open', doc);
      const holder = await lane.call<string>('idAt', ['sections', 0, 'blocks', 1]);
      const last = await lane.call<string>('idAt', ['sections', 0, 'blocks', 2]);
      const section = await lane.call<string>('idAt', ['sections', 0]);
      const n = Object.fromEntries((await dispatch('read', { ids: [holder, section] })).nodes.map((x: any) => [x.id, x]));
      const { base, shape, ...read } = n[holder];
      const change =
        kind === 'move'
          ? { kind: 'move', id: holder, shape, anchor: last, container: n[section].shape, position: 'after' }
          : kind === 'copy'
          ? { kind: 'insert_after', anchor: last, container: n[section].shape, node: { id: holder, kind: 'paragraph' } }
          : { kind: 'replace', id: holder, base, node: { ...read, inlines: read.inlines.filter((x: any) => x.kind !== 'shape') } };
      const r = await dispatch('write', { intent: 'Put the cover paragraph at the end.', scope: { ids: [holder, last] }, changes: [change] });
      expect(r).toEqual(expect.objectContaining({ ok: true, committed: true, landed: 'card' }));

      await lane.call('clickCard', 0, decision);
      expect(blocks(await lane.call<string>('settled'))).toEqual(decision === 'Accept' ? accepted : rejected);
    }
  });
});
