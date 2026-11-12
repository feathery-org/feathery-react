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

  it('a new list paragraph format lands (Hilb 7c02c3c8)', async () => {
    await lane.call('open', doc([{ sectionFormat: page(), blocks: [para('Items Needed to Bind'), para('Existing bullet', { styleName: 'List Paragraph', listFormat: { listId: 1, listLevelNumber: 0 } })], headersFooters: {} }], {
      styles: [
        { name: 'Normal', type: 'Paragraph', paragraphFormat: { borders: BORDERS, listFormat: {} }, characterFormat: {}, next: 'Normal' },
        { name: 'List Paragraph', type: 'Paragraph', paragraphFormat: { borders: BORDERS, listFormat: {} }, characterFormat: {}, basedOn: 'Normal', next: 'List Paragraph' }
      ],
      lists: [{ abstractListId: 0, levelOverrides: [], listId: 1, nsid: -126 }],
      abstractLists: [{ abstractListId: 0, levels: [{ characterFormat: { fontFamily: 'Symbol' }, followCharacter: 'Tab', listLevelPattern: 'Bullet', numberFormat: '', paragraphFormat: { leftIndent: 36, firstLineIndent: -18 }, restartLevel: 0, startAt: 0 }] }]
    }));
    const heading = await nodeAt(['sections', 0, 'blocks', 0]);
    const { shape } = await nodeAt(['sections', 0]);
    const bullet = (id: string, text: string) => ({ kind: 'insert_after', anchor: heading.id, container: shape, node: { id, kind: 'paragraph', style: 'tmp:bul', inlines: [{ kind: 'run', text }] } });

    const write = await dispatch('write', { intent: 'bullets', scope: { ids: [heading.id] }, formats: { 'tmp:bul': { styleName: 'List Paragraph', listFormat: { listId: 1, listLevelNumber: 0 } } }, changes: [bullet('tmp:b1', 'Completed Acord application'), bullet('tmp:b2', 'Completed TRIA form')] });

    expect(write).toMatchObject({ ok: true, committed: true });
  });

  it('a write result names the format ids the editor kept, so the next write can use them', async () => {
    await lane.call('open', doc([{ sectionFormat: page(), blocks: [para('Items Needed to Bind'), para('Existing bullet', { styleName: 'List Paragraph', listFormat: { listId: 1, listLevelNumber: 0 } })], headersFooters: {} }], {
      styles: [
        { name: 'Normal', type: 'Paragraph', paragraphFormat: { borders: BORDERS, listFormat: {} }, characterFormat: {}, next: 'Normal' },
        { name: 'List Paragraph', type: 'Paragraph', paragraphFormat: { borders: BORDERS, listFormat: {} }, characterFormat: {}, basedOn: 'Normal', next: 'List Paragraph' }
      ],
      lists: [{ abstractListId: 0, levelOverrides: [], listId: 1, nsid: -126 }],
      abstractLists: [{ abstractListId: 0, levels: [{ characterFormat: { fontFamily: 'Symbol' }, followCharacter: 'Tab', listLevelPattern: 'Bullet', numberFormat: '', paragraphFormat: { leftIndent: 36, firstLineIndent: -18 }, restartLevel: 0, startAt: 0 }] }]
    }));
    const heading = await nodeAt(['sections', 0, 'blocks', 0]);
    const { shape } = await nodeAt(['sections', 0]);
    const first = await dispatch('write', { intent: 'bullet', scope: { ids: [heading.id] }, formats: { 'tmp:bul': { styleName: 'List Paragraph', listFormat: { listId: 1, listLevelNumber: 0 } } }, changes: [{ kind: 'insert_after', anchor: heading.id, container: shape, node: { id: 'tmp:b1', kind: 'paragraph', style: 'tmp:bul', inlines: [{ kind: 'run', text: 'Completed Acord application' }] } }] });
    const { shape: sectionShape } = await nodeAt(['sections', 0]);
    const second = await dispatch('write', { intent: 'another', scope: { ids: [heading.id] }, changes: [{ kind: 'insert_after', anchor: heading.id, container: sectionShape, node: { id: 'tmp:b2', kind: 'paragraph', style: first.mapping['tmp:bul'], inlines: [{ kind: 'run', text: 'Completed TRIA form' }] } }] });

    expect(second).toMatchObject({ ok: true, committed: true });
  });

  it('a font size set with its bidi size lands', async () => {
    await lane.call('open', doc([{ sectionFormat: page(), blocks: [para('Coverage'), para('Last')], headersFooters: {} }], { characterFormat: { fontSize: 11, fontSizeBidi: 11 } }));
    const run = (await nodeAt(['sections', 0, 'blocks', 0])).inlines[0];

    const write = await dispatch('write', { intent: 'smaller', scope: { ids: [run.id] }, changes: [{ kind: 'set', target: { ids: [run.id], shape: { [run.id]: run.shape } }, props: { fontSize: 9, fontSizeBidi: 9 } }] });

    expect(write).toMatchObject({ ok: true, committed: true });
    expect((await native()).sections[0].blocks[0].inlines[0].characterFormat).toMatchObject({ fontSize: 9, fontSizeBidi: 9 });
  });

  it('a line spacing tighter than single lands, which the editor cannot set itself (Hilb 2cb00732)', async () => {
    await lane.call('open', doc([{ sectionFormat: page(), blocks: [para('Named Insured'), para('Last')], headersFooters: {} }]));
    const paragraph = await nodeAt(['sections', 0, 'blocks', 0]);

    const write = await dispatch('write', { intent: 'tighter', scope: { ids: [paragraph.id] }, changes: [{ kind: 'set', target: { ids: [paragraph.id], shape: { [paragraph.id]: paragraph.shape } }, props: { lineSpacing: 0.93, lineSpacingType: 'Multiple' } }] });

    expect(write).toMatchObject({ ok: true, committed: true });
    expect((await native()).sections[0].blocks[0].paragraphFormat).toMatchObject({ lineSpacing: 0.93, lineSpacingType: 'Multiple' });
  });
});
