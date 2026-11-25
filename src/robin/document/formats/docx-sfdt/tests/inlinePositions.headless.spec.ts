/**
 * Positions around inlines that are not text (Codex review item 2, rule 12): the editor counts a
 * bookmark marker, a field marker and an inline image as one position each, an inline content
 * control one at each end, and a run its text. Both directions use that one count: the descriptor's
 * selection (editor position to own-text offset) and a native text write (own-text offset to
 * editor position).
 */
import { EngineLane, startEngineLane } from './headless/engineLane';

let lane: EngineLane;
beforeAll(async () => {
  lane = await startEngineLane();
}, 600000);
afterAll(async () => {
  await lane?.close();
});

const img = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const p = (inlines: any[]) => ({ paragraphFormat: {}, characterFormat: {}, inlines });
const shapes: Record<string, any[]> = {
  plain: [{ text: 'plain ' }, { text: 'Alphaa' }],
  bookmark: [{ bookmarkType: 0, name: 'bm1' }, { text: 'Alphab' }, { bookmarkType: 1, name: 'bm1' }],
  field: [{ text: 'x' }, { fieldType: 0, hasFieldEnd: true }, { text: ' PAGE ' }, { fieldType: 2 }, { text: '1' }, { fieldType: 1 }, { text: ' Alphac' }],
  image: [{ imageString: `data:image/png;base64,${img}`, width: 12, height: 12, isInlineImage: true }, { text: 'Alphad' }],
  emptyBookmark: [{ text: 'a' }, { bookmarkType: 0, name: 'bm2' }, { bookmarkType: 1, name: 'bm2' }, { text: 'Alphae' }]
};
const words: Record<string, string> = { plain: 'Alphaa', bookmark: 'Alphab', field: 'Alphac', image: 'Alphad', emptyBookmark: 'Alphae' };
const doc = JSON.stringify({
  sections: [
    {
      sectionFormat: { pageWidth: 612, pageHeight: 792, leftMargin: 72, rightMargin: 72, topMargin: 72, bottomMargin: 72 },
      blocks: Object.values(shapes).map(p),
      headersFooters: {}
    }
  ]
});
let turn = 0;
const dispatch = async (verb: string, input: unknown): Promise<any> => {
  turn += 1;
  const out = await lane.call<any>('dispatch', verb, { turnId: `ip-${turn}`, editorId: 'ed', target: { type: 'envelope', id: 'env' }, input });
  if (out.status !== 'ok') throw new Error(JSON.stringify(out));
  return out.result;
};
const ownText = (n: any): string => {
  let out = '';
  const rec = (inlines: any[]) => {
    for (const i of inlines ?? []) {
      if (i.kind === 'run') out += i.text ?? '';
      if (Array.isArray(i.inlines)) rec(i.inlines);
    }
  };
  rec(n.inlines);
  return out;
};

describe('the descriptor selection after inlines that are not text', () => {
  it.each(Object.keys(shapes))('%s', async (shape) => {
    await lane.call('open', doc);
    const word = words[shape];
    const native = await lane.call<{ text: string }>('selectFound', word);
    expect(native.text).toBe(word);
    const d = await lane.call<any>('descriptor');
    const block = Object.keys(shapes).indexOf(shape);
    const id = await lane.call<string>('idAt', ['sections', 0, 'blocks', block]);
    const text = ownText((await dispatch('read', { ids: [id] })).nodes[0]);
    const at = text.indexOf(word);
    expect(d.selection).toEqual({ start: { id, offset: at }, end: { id, offset: at + word.length }, text: word, truncated: false });
  });
});

describe('a native text write after inlines that are not text', () => {
  it.each(Object.keys(shapes))('%s', async (shape) => {
    await lane.call('open', doc);
    const block = Object.keys(shapes).indexOf(shape);
    const id = await lane.call<string>('idAt', ['sections', 0, 'blocks', block]);
    const para = (await dispatch('read', { ids: [id] })).nodes[0];
    const run = para.inlines.find((i: any) => i.kind === 'run' && String(i.text).includes(words[shape]));
    const r = await dispatch('write', { intent: 'Rename.', scope: { ids: [run.id] }, changes: [{ kind: 'replace', id: run.id, base: run.base, node: { kind: 'run', ...(run.style ? { style: run.style } : {}), text: run.text.replace(words[shape], 'Omega') } }] });
    expect(r).toEqual(expect.objectContaining({ ok: true, committed: true }));
    expect(r.trace.committed.seams).toEqual(['text']);
  });
});

describe('a word parted by a marker after it', () => {
  it('a change before an empty bookmark pair stays a native text edit and keeps the bookmark', async () => {
    const d = JSON.parse(doc);
    d.sections[0].blocks = [p([{ text: 'Alphaf' }, { bookmarkType: 0, name: 'bm3' }, { bookmarkType: 1, name: 'bm3' }, { text: 'z' }])];
    await lane.call('open', JSON.stringify(d));
    const id = await lane.call<string>('idAt', ['sections', 0, 'blocks', 0]);
    const para = (await dispatch('read', { ids: [id] })).nodes[0];
    const run = para.inlines.find((i: any) => i.kind === 'run' && i.text === 'Alphaf');
    const r = await dispatch('write', { intent: 'Rename.', scope: { ids: [run.id] }, changes: [{ kind: 'replace', id: run.id, base: run.base, node: { kind: 'run', text: 'Omegaf' } }] });
    expect(r).toEqual(expect.objectContaining({ ok: true, committed: true }));
    expect(r.trace.committed.seams).toEqual(['text']);
    expect(await lane.call<string>('settled')).toContain('"bm3"');
  });
});
