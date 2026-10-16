import {
  HeadlessSession,
  startHeadless
} from '../../../../../assistant/tools/docx/tests/headless/headlessSession';
import { applyHunks, diffSession, trackedAuthorKeys } from './index';

const TITLE = 'Commercial Combined Insurance Proposal';
const NEW_TITLE = 'Commercial Combined Insurance Quote';

// A cover page whose title sits in a text box, as in Hilb's proposals.
const proposal = () =>
  JSON.stringify({
    sections: [
      {
        sectionFormat: { pageWidth: 612, pageHeight: 792 },
        blocks: [
          { inlines: [{ text: 'Prepared for Hilb Group' }] },
          {
            inlines: [
              {
                shapeId: 'cover-title-frame',
                name: 'Cover title frame',
                visible: true,
                width: 460,
                height: 72,
                widthScale: 100,
                heightScale: 100,
                verticalPosition: 96,
                verticalOrigin: 'Page',
                horizontalPosition: 72,
                horizontalOrigin: 'Page',
                zOrderPosition: 0,
                allowOverlap: true,
                textWrappingStyle: 'Square',
                textWrappingType: 'Both',
                autoShapeType: 'Rectangle',
                fillFormat: { color: '#FFFFFF', fill: true },
                lineFormat: { line: true, color: '#000000', weight: 1 },
                textFrame: {
                  textVerticalAlignment: 'Top',
                  blocks: [
                    { inlines: [{ text: 'Hilb Group' }] },
                    {
                      inlines: [
                        { characterFormat: { fontSize: 20 }, text: TITLE }
                      ]
                    }
                  ]
                }
              }
            ]
          },
          { inlines: [{ text: 'Prepared by Tyler Marlow' }] }
        ]
      }
    ]
  });

describe('version history for text box edits in the real engine', () => {
  let session: HeadlessSession;
  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);
  afterAll(async () => {
    await session?.close();
  });

  it.each([
    ['a person', false, 'you'],
    ['Robin', true, 'robin']
  ])(
    'records %s editing a text box and highlights it inside the box',
    async (_who, tracked, author) => {
      await session.call('open', proposal());
      const start = JSON.parse(await session.call<string>('serialize'));
      await session.call('setTrackChanges', tracked);
      const applied = await session.call<any>(
        'replaceIndexed',
        TITLE,
        NEW_TITLE,
        'frame-title'
      );
      expect(applied.outcomes).toEqual(['ok']);
      const final = JSON.parse(await session.call<string>('serialize'));

      const changes = diffSession(start, [{ sfdt: final, author }], 'session');

      expect(changes.changeCount).toBeGreaterThan(0);
      expect(changes.authors).toEqual([author]);
      const display = applyHunks(final, changes);
      expect(trackedAuthorKeys(display)).toContain(author);

      // The engine opens the highlighted version and keeps the highlights.
      await session.call('open', JSON.stringify(display));
      const reopened = await session.call<any>('snapshot');
      expect(reopened.revisions).toBeGreaterThan(0);
      expect(reopened.serialized).toContain('Quote');
    },
    120000
  );
});
