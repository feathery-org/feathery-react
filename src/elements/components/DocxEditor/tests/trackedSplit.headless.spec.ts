import { revisionGroupTag } from '../../../../utils/documentEditorPrimitives';
import { CcLane, startCcLane } from './headless/ccStackLane';

let lane: CcLane;
beforeAll(async () => {
  lane = await startCcLane();
}, 600000);
afterAll(async () => {
  await lane?.close();
});

const CARD_TAG = revisionGroupTag('card-1', 'card-1');

const pendingCardDoc = () =>
  JSON.stringify({
    sections: [
      {
        sectionFormat: { pageWidth: 612, pageHeight: 792 },
        blocks: [
          {
            paragraphFormat: {},
            characterFormat: {},
            inlines: [
              { text: '•  Total premium is up 2%', revisionIds: ['ins-1'] }
            ]
          }
        ]
      }
    ],
    revisions: [
      {
        revisionId: 'ins-1',
        revisionType: 'Insertion',
        author: 'Robin',
        date: '2026-11-11T14:39:00Z',
        customData: CARD_TAG
      }
    ]
  });

const danglingRevisionIds = (sfdt: string): string[] => {
  const doc = JSON.parse(sfdt);
  const defined = new Set((doc.revisions ?? []).map((r: any) => r.revisionId));
  const dangling: string[] = [];
  const visit = (value: any) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    for (const id of value.revisionIds ?? [])
      if (!defined.has(id)) dangling.push(id);
    for (const [key, child] of Object.entries(value))
      if (key !== 'revisions') visit(child);
  };
  visit(doc.sections);
  return dangling;
};

const act = (name: string, ...args: any[]) => lane.call('act', name, args);

describe('a pending card split by the person', () => {
  it('keeps both halves in the card so the document still saves', async () => {
    await lane.call('open', pendingCardDoc(), { isolation: true });
    const start = await lane.call<string>('findStart', 'Total');
    await act('select', start, start);
    await act('enter');
    await act('select', '0;0;0', '0;0;3');
    await act('delete');

    const sfdt = await lane.call<string>('serialize');
    expect(danglingRevisionIds(sfdt)).toEqual([]);
    const { revisions } = JSON.parse(sfdt);
    expect(revisions.map((r: any) => r.customData)).toEqual(
      revisions.map(() => CARD_TAG)
    );
    await expect(lane.call<number>('docx')).resolves.toBeGreaterThan(0);
  });
});
