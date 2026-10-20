import { HeadlessSession, startHeadless } from './headlessSession';

// Sibling policy sections hold headings and tables but no body paragraph, so
// a composed paragraph has no sibling donor; the document's only body text is
// an intro paragraph under a Title-styled heading.
const para = (text: string, styleName: string) => ({
  paragraphFormat: { styleName },
  inlines: [{ text }]
});
const table = (label: string) => ({
  rows: [label, 'Value'].map((text, row) => ({
    rowFormat: { isHeader: row === 0 },
    cells: [text, `${text} detail`].map((cellText) => ({
      blocks: [{ inlines: [{ text: cellText }] }],
      cellFormat: { preferredWidth: 200, preferredWidthType: 'Point' }
    }))
  })),
  grid: [200, 200],
  tableFormat: { preferredWidthType: 'Auto' },
  columnCount: 2
});
const policy = (name: string) => [
  para(name, 'Title'),
  para('Policy Information', 'Heading 2'),
  table('Policy Number'),
  para('', 'Normal')
];

function proposal(): string {
  return JSON.stringify({
    optimizeSfdt: false,
    sections: [
      {
        sectionFormat: { pageWidth: 612, pageHeight: 792 },
        blocks: [
          para('About Us', 'Title'),
          para('We place cover with carriers we trust.', 'Normal'),
          ...policy('Home Policy'),
          ...policy('Auto Policy')
        ]
      }
    ],
    styles: [
      { name: 'Normal', type: 'Paragraph', next: 'Normal' },
      {
        name: 'Heading 1',
        type: 'Paragraph',
        basedOn: 'Normal',
        next: 'Normal',
        paragraphFormat: { outlineLevel: 'Level1' },
        characterFormat: { fontSize: 14 }
      },
      {
        name: 'Heading 2',
        type: 'Paragraph',
        basedOn: 'Normal',
        next: 'Normal',
        paragraphFormat: { outlineLevel: 'Level2' },
        characterFormat: { bold: true }
      },
      {
        name: 'Title',
        type: 'Paragraph',
        basedOn: 'Heading 1',
        next: 'Normal',
        characterFormat: { fontSize: 20, bold: true }
      }
    ]
  });
}

const paragraphNamed = (sfdt: any, text: string): any =>
  sfdt.sections[0].blocks.find(
    (block: any) =>
      block.inlines?.map((inline: any) => inline.text).join('') === text
  );

describe('section composer donors', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  it('dresses an unmatched paragraph as body text and keeps headings with what follows', async () => {
    await session.call('open', proposal());
    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'insert_section',
          group: 'g01-add-policy',
          anchor: '0;6',
          position: 'before',
          sectionSpec: {
            title: 'Collectibles Policy',
            blocks: [
              { role: 'heading', level: 2, text: 'Discounts' },
              { role: 'paragraph', text: 'Central alarm; multi-policy.' },
              { role: 'heading', level: 2, text: 'Forms' },
              {
                role: 'table',
                table: {
                  columnHeaders: ['Form', 'Description'],
                  rows: [['F-1', 'Notice']]
                }
              }
            ]
          }
        }
      ],
      'add-policy'
    );

    expect(result.outcomes).toEqual(['ok']);
    const sfdt = JSON.parse(await session.call<string>('serialize'));
    expect(
      paragraphNamed(sfdt, 'Central alarm; multi-policy.').paragraphFormat
        .styleName ?? 'Normal'
    ).toBe(
      paragraphNamed(sfdt, 'We place cover with carriers we trust.')
        .paragraphFormat.styleName ?? 'Normal'
    );
    for (const heading of ['Collectibles Policy', 'Discounts', 'Forms'])
      expect(paragraphNamed(sfdt, heading).paragraphFormat.keepWithNext).toBe(
        true
      );
  }, 120000);
});
