import { EngineLane, startEngineLane } from './headless/engineLane';

let lane: EngineLane;
beforeAll(async () => {
  lane = await startEngineLane();
}, 600000);
afterAll(async () => {
  await lane?.close();
});

let turn = 0;
const dispatch = async (verb: string, input: unknown): Promise<any> => {
  turn += 1;
  const out = await lane.call<any>('dispatch', verb, { turnId: `fr-${turn}`, editorId: 'ed', target: { type: 'envelope', id: 'env' }, input });
  if (out.status !== 'ok') throw new Error(JSON.stringify(out));
  if (verb === 'write' && out.result.ok) await lane.call('finishTurn');
  return out.result;
};
const nodeAt = async (path: Array<string | number>): Promise<any> => {
  const id = await lane.call<string>('idAt', path);
  return (await dispatch('read', { ids: [id] })).nodes[0];
};
const native = async () => JSON.parse(await lane.call<string>('serialize'));

const BORDERS = { top: {}, left: {}, right: {}, bottom: {}, horizontal: {}, vertical: {} };
const para = (text: string, format: Record<string, unknown> = {}) => ({
  paragraphFormat: { borders: BORDERS, listFormat: {}, ...format },
  characterFormat: {},
  inlines: [{ characterFormat: {}, text }]
});
const page = (extra: Record<string, unknown> = {}) => ({ pageWidth: 612, pageHeight: 792, leftMargin: 72, rightMargin: 72, topMargin: 72, bottomMargin: 72, ...extra });
const doc = (sections: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ sections, ...extra });

describe('writes the editor re-encodes land', () => {
  it('a write elsewhere lands after the person set a paragraph line spacing by shortcut', async () => {
    await lane.call('open', doc([{ sectionFormat: page(), blocks: [para('Total'), para('Loss Payee / Additional Interest:'), para('Last')], headersFooters: {} }]));
    await lane.call('userLineSpacing', '0;1;0', 1);
    expect((await native()).sections[0].blocks[1].paragraphFormat.lineSpacingType).toBeUndefined();

    const last = await lane.call<string>('idAt', ['sections', 0, 'blocks', 2]);
    const sectionId = await lane.call<string>('idAt', ['sections', 0]);
    const { shape } = (await dispatch('read', { ids: [sectionId], children: 'stubs' })).nodes[0];
    const write = await dispatch('write', { intent: 'add a line', scope: { ids: [last] }, changes: [{ kind: 'insert_after', anchor: last, container: shape, node: { kind: 'paragraph', inlines: [{ kind: 'run', text: 'New paragraph' }] } }] });

    expect(write).toMatchObject({ ok: true, committed: true });
  });

  it.each([
    ['its style', { styles: [
      { name: 'Normal', type: 'Paragraph', paragraphFormat: { borders: BORDERS, listFormat: {} }, characterFormat: {}, next: 'Normal' },
      { name: 'Fixed', type: 'Paragraph', paragraphFormat: { borders: BORDERS, listFormat: {}, lineSpacing: 14, lineSpacingType: 'Exactly' }, characterFormat: {}, basedOn: 'Normal', next: 'Fixed' }
    ] }, 'Fixed'],
    ['the document default', { paragraphFormat: { lineSpacing: 14, lineSpacingType: 'AtLeast' } }, undefined]
  ])('a shortcut line spacing over %s spacing type lands a write elsewhere', async (_label, extra, styleName) => {
    await lane.call('open', doc([{ sectionFormat: page(), blocks: [para('Total'), para('Loss Payee', styleName ? { styleName } : {}), para('Last')], headersFooters: {} }], extra));
    await lane.call('userLineSpacing', '0;1;0', 1);
    expect((await native()).sections[0].blocks[1].paragraphFormat.lineSpacingType).toBeUndefined();

    const last = await lane.call<string>('idAt', ['sections', 0, 'blocks', 2]);
    const sectionId = await lane.call<string>('idAt', ['sections', 0]);
    const { shape } = (await dispatch('read', { ids: [sectionId], children: 'stubs' })).nodes[0];
    const write = await dispatch('write', { intent: 'add a line', scope: { ids: [last] }, changes: [{ kind: 'insert_after', anchor: last, container: shape, node: { kind: 'paragraph', inlines: [{ kind: 'run', text: 'New paragraph' }] } }] });

    expect(write).toMatchObject({ ok: true, committed: true });
    expect((await native()).sections[0].blocks[1].paragraphFormat.lineSpacingType).toBe('Multiple');
  });

  it('turning off a section page numbering restart lands', async () => {
    await lane.call('open', doc([
      { sectionFormat: page(), blocks: [para('Cover')], headersFooters: {} },
      { sectionFormat: page({ restartPageNumbering: true, pageStartingNumber: 1 }), blocks: [para('Contents')], headersFooters: {} }
    ]));
    const section = await nodeAt(['sections', 1]);

    const write = await dispatch('write', { intent: 'continue numbering', scope: { ids: [section.id] }, changes: [{ kind: 'set', target: { ids: [section.id], shape: { [section.id]: section.shape } }, props: { restartPageNumbering: false } }] });

    expect(write).toMatchObject({ ok: true, committed: true });
    expect((await native()).sections[1].sectionFormat.restartPageNumbering).toBeFalsy();
  });

  it('a text edit lands in a List Paragraph that takes its bullet from its style', async () => {
    await lane.call('open', doc([{ sectionFormat: page(), blocks: [para('Named Insured'), para('THE WATERCREST GROUP LLC', { styleName: 'List Paragraph' }), para('')], headersFooters: {} }], {
      styles: [
        { name: 'Normal', type: 'Paragraph', paragraphFormat: { borders: BORDERS, listFormat: {} }, characterFormat: {}, next: 'Normal' },
        { name: 'List Paragraph', type: 'Paragraph', paragraphFormat: { borders: BORDERS, listFormat: { listId: 7, nsid: 223178203 } }, characterFormat: {}, basedOn: 'Normal', next: 'List Paragraph' }
      ],
      lists: [{ abstractListId: 0, levelOverrides: [], listId: 7, nsid: 223178203 }],
      abstractLists: [{ abstractListId: 0, levels: [{ characterFormat: { fontFamily: 'Symbol' }, followCharacter: 'Tab', listLevelPattern: 'Bullet', numberFormat: '', paragraphFormat: { leftIndent: 36, firstLineIndent: -18 }, restartLevel: 0, startAt: 0 }] }]
    }));
    const run = (await nodeAt(['sections', 0, 'blocks', 1])).inlines[0];

    const write = await dispatch('write', { intent: 'proper case', scope: { ids: [run.id] }, changes: [{ kind: 'replace', id: run.id, base: run.base, node: { id: run.id, kind: 'run', style: run.style, text: 'The Watercrest Group LLC' } }] });

    expect(write).toMatchObject({ ok: true, committed: true });
  });
});
