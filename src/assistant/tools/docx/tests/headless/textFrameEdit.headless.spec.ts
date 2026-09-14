import fs from 'fs';
import { HeadlessSession, shoot, startHeadless } from './headlessSession';

const TITLE = 'Commercial Combined Insurance Proposal';
const NEW_TITLE = 'Commercial Combined Insurance Quote';
const HEADING = 'Section 1 - Property';

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
                verticalAlignment: 'None',
                verticalRelativePercent: 0,
                horizontalPosition: 72,
                horizontalOrigin: 'Page',
                horizontalAlignment: 'None',
                horizontalRelativePercent: 0,
                zOrderPosition: 0,
                allowOverlap: true,
                textWrappingStyle: 'Square',
                textWrappingType: 'Both',
                isBelowText: false,
                layoutInCell: false,
                lockAnchor: false,
                autoShapeType: 'Rectangle',
                fillFormat: { color: '#FFFFFF', fill: true },
                lineFormat: {
                  line: true,
                  lineFormatType: 'Solid',
                  color: '#000000',
                  weight: 1,
                  lineStyle: 'Single'
                },
                textFrame: {
                  textVerticalAlignment: 'Top',
                  leftMargin: 0,
                  rightMargin: 0,
                  topMargin: 0,
                  bottomMargin: 0,
                  blocks: [
                    { inlines: [{ text: 'Hilb Group' }] },
                    {
                      characterFormat: { fontSize: 20, bold: true },
                      inlines: [
                        {
                          characterFormat: { fontSize: 20, bold: true },
                          text: TITLE
                        }
                      ]
                    }
                  ]
                }
              }
            ]
          },
          { inlines: [{ text: 'Prepared by Tyler Marlow' }] }
        ]
      },
      {
        sectionFormat: { pageWidth: 612, pageHeight: 792 },
        blocks: [
          {
            paragraphFormat: { styleName: 'Heading 1' },
            inlines: [{ text: HEADING }]
          }
        ]
      }
    ]
  });

describe('text and formatting edits on a laid-out page', () => {
  let session: HeadlessSession;
  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);
  afterAll(async () => {
    await session?.close();
  });

  it('lands one tracked, reviewable change that accepts and rejects cleanly', async () => {
    await session.call('open', proposal());
    expect(await session.call<number>('pageCount')).toBeGreaterThan(0);

    const baseline = await session.call<any>('snapshot');

    // The engine's own read: the title is in the inventory, marked as frame
    // content, at the public frame anchor.
    const indexed = (
      await session.call<{ anchor: string; kind: string; text: string }[]>(
        'inventory'
      )
    ).find((entry) => entry.text.includes(TITLE));
    expect(indexed).toBeDefined();
    expect(indexed!.kind).toBe('text_frame');
    expect(indexed!.anchor).toContain(';S;');

    expect(await session.call<boolean>('setTrackChanges', true)).toBe(true);
    const applied = await session.call<any>(
      'replaceIndexed',
      TITLE,
      NEW_TITLE,
      'frame-title'
    );
    expect(applied.outcomes).toEqual(['ok']);
    expect(applied.status).toBe('applied');
    expect(applied.anchor).toBe(indexed!.anchor);

    // Tracked, inside the frame, and offered to the human as ONE card.
    const pending = await session.call<any>('snapshot');
    expect(pending.revisions).toBeGreaterThan(0);
    const groups = await session.call<any[]>('groups');
    expect(groups).toHaveLength(1);
    expect(groups[0].changeSetId).toBe('frame-title');

    // Accept: the frame reads the new title, nothing pending, and the shot is
    // of the laid-out page rather than of the serialized document.
    await session.call('resolveGroups', true);
    const accepted = await session.call<any>('snapshot');
    expect(accepted.revisions).toBe(0);
    const acceptedInventory = await session.call<
      { anchor: string; kind: string; text: string }[]
    >('inventory');
    expect(
      acceptedInventory.find((entry) => entry.anchor === indexed!.anchor)?.text
    ).toBe(NEW_TITLE);
    expect(acceptedInventory.some((entry) => entry.text.includes(TITLE))).toBe(
      false
    );
    const shot = await shoot(session, 'text-frame-title-accepted', NEW_TITLE);
    expect(fs.existsSync(shot)).toBe(true);

    // Reject the same edit on a fresh open: byte-identical to the baseline.
    await session.call('open', proposal());
    expect(await session.call<boolean>('setTrackChanges', true)).toBe(true);
    const again = await session.call<any>(
      'replaceIndexed',
      TITLE,
      NEW_TITLE,
      'frame-title-reject'
    );
    expect(again.outcomes).toEqual(['ok']);
    await session.call('resolveGroups', false);
    const rejected = await session.call<any>('snapshot');
    expect(rejected.revisions).toBe(0);
    expect(rejected.serialized).toBe(baseline.serialized);

    // eslint-disable-next-line no-console
    console.log(
      'TEXT_FRAME_EDIT ' +
        JSON.stringify(
          {
            anchor: indexed!.anchor,
            kind: indexed!.kind,
            outcomes: applied.outcomes,
            cards: groups.length,
            baselineLen: baseline.len,
            pendingRevisions: pending.revisions,
            acceptedRevisions: accepted.revisions,
            acceptedTitle: NEW_TITLE,
            rejectedByteIdentical: rejected.serialized === baseline.serialized,
            shot
          },
          null,
          1
        )
    );
  }, 180000);

  it.each([
    ['a Heading 1 paragraph', HEADING],
    ['the title inside a text box', TITLE]
  ])(
    'applies an immediate color change to %s and rejects invalid colors',
    async (name, find) => {
      await session.call('open', proposal());
      const baseline = await session.call<any>('snapshot');
      const colorBefore = await session.call<string>('resolvedFontColor', find);
      expect(colorBefore).not.toMatch(/^#ff0000/i);

      expect(await session.call<boolean>('setTrackChanges', true)).toBe(true);
      const applied = await session.call<any>(
        'formatIndexed',
        find,
        'red',
        'heading-red'
      );
      expect(applied.outcomes).toEqual(['ok']);
      expect(applied.status).toBe('applied');
      const colorAfter = await session.call<string>('resolvedFontColor', find);
      expect(colorAfter).toMatch(/^#ff0000/i);

      const pending = await session.call<any>('snapshot');
      const groups = await session.call<any[]>('groups');
      expect(pending.revisions).toBe(0);
      expect(groups).toHaveLength(0);
      const shot = await shoot(session, `format-red-${applied.kind}`, find);

      await session.call('resolveGroups', true);
      expect(await session.call<string>('resolvedFontColor', find)).toMatch(
        /^#ff0000/i
      );
      await session.call('open', proposal());
      expect(await session.call<boolean>('setTrackChanges', true)).toBe(true);
      expect(
        (await session.call<any>('formatIndexed', find, 'red', 'red-reject'))
          .outcomes
      ).toEqual(['ok']);
      await session.call('resolveGroups', false);
      const afterReject = await session.call<string>('resolvedFontColor', find);
      expect(afterReject).toMatch(/^#ff0000/i);

      await session.call('open', proposal());
      expect(await session.call<boolean>('setTrackChanges', true)).toBe(true);
      const refused = await session.call<any>(
        'formatIndexed',
        find,
        'reddish',
        'heading-bogus'
      );
      expect(refused.outcomes).toEqual(['invalid_color']);
      expect(refused.status).toBe('failed');
      expect(await session.call<string>('resolvedFontColor', find)).toBe(
        colorBefore
      );

      // eslint-disable-next-line no-console
      console.log(
        'FORMAT_COLOR ' +
          JSON.stringify(
            {
              case: name,
              anchor: applied.anchor,
              kind: applied.kind,
              outcomes: applied.outcomes,
              colorBefore,
              colorAfter,
              pendingRevisions: pending.revisions,
              cards: groups.length,
              baselineLen: baseline.len,
              afterAccept: '#FF0000',
              afterReject,
              refused: refused.outcomes,
              shot
            },
            null,
            1
          )
      );
    },
    240000
  );
});
