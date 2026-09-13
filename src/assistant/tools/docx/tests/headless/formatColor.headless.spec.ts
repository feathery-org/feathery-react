/**
 * "CHANGE THE HEADING COLOR TO RED", IN THE REAL ENGINE.
 *
 * The jsdom pair (`directFormatIsProven.spec.ts`) proves the law on the
 * serialized document: a colour word now lands or the op fails with a code, at
 * both anchor shapes used by the formatting path. jsdom never lays out,
 * so it cannot say what the human actually sees, nor what the review surface
 * offers for a formatting change.
 *
 * This is that row. It also settles, in the real engine rather than by
 * assumption, the question the fix had to answer: whether a character-format
 * change under track changes produces a revision the rail can show. It does
 * not - SyncFusion has no Formatting revision type - so the honest surface is a
 * change set that reports no revisions rather than a card a reviewer cannot
 * reject, and that is asserted here so a future SyncFusion that starts
 * authoring one fails this row loudly.
 */
import {
  HeadlessSession,
  shoot,
  startHeadless
} from './headlessSession';

const HEADING = 'Section 1 - Property';
const TITLE = 'Commercial Combined Insurance Proposal';

/**
 * A cover page whose title lives in a text box, plus a Heading 1 in a second
 * Word section, covering both supported target shapes.
 */
const proposal = () =>
  JSON.stringify({
    sections: [
      {
        sectionFormat: { pageWidth: 612, pageHeight: 792 },
        blocks: [
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
                    {
                      characterFormat: { fontSize: 26, bold: true },
                      inlines: [
                        {
                          characterFormat: { fontSize: 26, bold: true },
                          text: TITLE
                        }
                      ]
                    }
                  ]
                }
              }
            ]
          },
          { inlines: [{ text: 'Prepared for a grocery distribution client' }] }
        ]
      },
      {
        sectionFormat: { pageWidth: 612, pageHeight: 792 },
        blocks: [
          {
            paragraphFormat: { styleName: 'Heading 1' },
            inlines: [{ text: HEADING }]
          },
          {
            inlines: [
              { text: 'Limit of indemnity $2,500,000 each and every claim.' }
            ]
          }
        ]
      }
    ]
  });

describe('a formatting change on a laid-out page', () => {
  let session: HeadlessSession;
  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);
  afterAll(async () => {
    await session?.close();
  });

  it.each([
    ['a Heading 1 paragraph', HEADING],
    ['the title inside a text box', TITLE]
  ])(
    'the colour word the assistant sends lands on %s, and reports honestly',
    async (name, find) => {
      await session.call('open', proposal());
      expect(await session.call<number>('pageCount')).toBeGreaterThan(0);
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

      // THE LIVE FAILURE, in the engine that served it: this reported ok and
      // changed nothing at all.
      expect(applied.outcomes).toEqual(['ok']);
      expect(applied.status).toBe('applied');
      const colorAfter = await session.call<string>('resolvedFontColor', find);
      expect(colorAfter).toMatch(/^#ff0000/i);

      // What the review surface can honestly offer. Measured, not assumed:
      // SyncFusion authors no revision for a format change, so there is nothing
      // to accept or reject and the change set must not pretend otherwise.
      const pending = await session.call<any>('snapshot');
      const groups = await session.call<any[]>('groups');
      expect(pending.revisions).toBe(0);
      expect(groups).toHaveLength(0);
      const shot = await shoot(session, `format-red-${applied.kind}`, find);

      // The consequence of having no revision, stated out loud because it is
      // the surprising half: accept and REJECT both leave the colour red, since
      // there is no card for either verb to act on. A formatting change is a
      // real, immediate edit to this document - not a reviewable proposal - and
      // the assistant must describe it that way rather than offering to undo it
      // from the Changes pane.
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

      // A colour SyncFusion cannot resolve must fail with a code instead, and
      // leave the colour where it was.
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
