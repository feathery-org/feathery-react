import { CcLane, startCcLane } from './headless/ccStackLane';

let lane: CcLane;
beforeAll(async () => {
  lane = await startCcLane();
}, 600000);
afterAll(async () => {
  await lane?.close();
});

const cc = (tag: string, text: string) => ({
  contentControlProperties: {
    lockContentControl: true,
    lockContents: false,
    tag,
    title: tag,
    type: 'Text',
    hasPlaceHolderText: false,
    multiline: false,
    isTemporary: false,
    color: '#00000000',
    appearance: 'BoundingBox'
  },
  inlines: [{ text }]
});
const p = (inlines: any[]) => ({
  paragraphFormat: {},
  characterFormat: {},
  inlines
});
const words = (count: number) =>
  Array.from({ length: count }, (_, i) => `word${i}`).join(' ');
const doc = (
  blocks: any[] = [
    p([{ text: 'Before ' }, cc('f:alpha', 'Alpha'), { text: ' after' }]),
    p([{ text: 'Plain paragraph' }])
  ]
) =>
  JSON.stringify({
    sections: [
      {
        sectionFormat: {
          pageWidth: 612,
          pageHeight: 792,
          leftMargin: 72,
          rightMargin: 72,
          topMargin: 72,
          bottomMargin: 72
        },
        blocks,
        headersFooters: { header: { blocks: [p([{ text: 'Header text' }])] } }
      }
    ]
  });
const fieldDoc = (tag: string) =>
  doc([
    p([{ text: 'Before ' }, cc(tag, 'Alpha'), { text: ' after' }]),
    p([{ text: 'Plain paragraph' }])
  ]);

const act = (name: string, ...args: any[]) => lane.call('act', name, args);
const probe = () => lane.call('probe');
const selectAcrossFieldEnd = async () => {
  const start = await lane.call<string>('findStart', 'Alpha');
  const parts = start.split(';');
  const at = Number(parts[parts.length - 1]);
  const shifted = (by: number) => [...parts.slice(0, -1), at + by].join(';');
  return act('select', shifted(2), shifted(9));
};
const expectWhole = (output: any) => {
  expect(output.stack).toBe(0);
  expect(output.hollow).toBe(0);
  expect(output.headerHollow).toBe(false);
  expect(output.text).toContain('Before');
  expect(output.text).toContain('Plain paragraph');
  expect(output.text).toContain('Header text');
};

describe('export content-control recovery', () => {
  it('leaves a healthy document byte-identical', async () => {
    await lane.call('open', doc());
    const plain = await lane.call<string>('serialize');
    await lane.call('open', doc(), { recovery: true });
    expect(await lane.call<string>('serialize')).toBe(plain);
  });

  it('leaves a field that runs onto the next page intact', async () => {
    const longField = doc([
      p([{ text: words(450) }, cc('f:long', words(440)), { text: ' end' }])
    ]);
    await lane.call('open', longField);
    expect(await lane.call<number>('pageCount')).toBeGreaterThan(1);
    const plain = await lane.call<string>('serialize');
    await lane.call('open', longField, { recovery: true });
    expect(await lane.call<string>('serialize')).toBe(plain);
  });

  it('ignores a stale open control left by an earlier export', async () => {
    await lane.call('open', doc(), { recovery: true });
    await lane.call('pushStale');
    expectWhole(await probe());
  });

  it('keeps every save whole after a tracked delete across a field end', async () => {
    await lane.call('open', doc(), { recovery: true });
    await act('trackOn');
    expect(await selectAcrossFieldEnd()).toBe('pha af');
    await act('delete');
    for (let i = 0; i < 3; i++) expectWhole(await probe());
    expect(await lane.call<number>('docx')).toBeGreaterThan(0);
  });

  it('keeps every save whole after accepting that delete with the product override', async () => {
    await lane.call('open', fieldDoc('[[name=alpha]]'), {
      bindings: true,
      recovery: true
    });
    await lane.call('frame');
    await act('trackOn');
    expect(await selectAcrossFieldEnd()).toBe('pha af');
    await act('delete');
    await act('acceptAll');
    expectWhole(await probe());
    await act('undo');
    expectWhole(await probe());
  });
});
