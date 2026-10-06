import { HeadlessSession, startHeadless } from './headlessSession';

const para = (text: string, styleName = 'Normal') => ({
  paragraphFormat: { styleName },
  inlines: [{ text }]
});
const table = (header: string) => ({
  rows: [header, `${header} value`].map((text, row) => ({
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
  para(''),
  para('Deductibles', 'Heading 2'),
  table('Type')
];

// Sections are separated by a page-break paragraph, but the first one is
// preceded by blank lines instead, so the siblings disagree on a convention.
function proposal(): string {
  return JSON.stringify({
    optimizeSfdt: false,
    sections: [
      {
        sectionFormat: { pageWidth: 612, pageHeight: 792 },
        blocks: [
          para('About Us', 'Title'),
          para('We place cover with carriers we trust.'),
          para(''),
          para(''),
          ...policy('Home Policy'),
          para('\f'),
          ...policy('Auto Policy'),
          para('\f'),
          para('Premium Summary', 'Title'),
          para('Totals follow.')
        ]
      }
    ],
    styles: [
      { name: 'Normal', type: 'Paragraph', next: 'Normal' },
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
        basedOn: 'Normal',
        next: 'Normal',
        paragraphFormat: { outlineLevel: 'Level1' },
        characterFormat: { fontSize: 20, bold: true }
      }
    ]
  });
}

const flat = (node: any): string =>
  Array.isArray(node)
    ? node.map(flat).join('')
    : !node || typeof node !== 'object'
    ? ''
    : (typeof node.text === 'string' ? node.text : '') +
      Object.entries(node)
        .filter(([key]) => key !== 'revisions')
        .map(([, value]) => flat(value))
        .join('');

describe('an inserted section is bracketed like its siblings', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  it('adds the separator the gap lacks and leaves no blank heading', async () => {
    await session.call('open', proposal());
    const anchor = (await session.call<any[]>('inventory')).find(
      (entry) => entry.text === 'Premium Summary'
    ).anchor;
    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'insert_section',
          group: 'g01-add-policy',
          anchor,
          position: 'before',
          sectionSpec: {
            title: 'Collectibles Policy',
            blocks: [
              { role: 'heading', level: 2, text: 'Policy Information' },
              {
                role: 'table',
                table: { columnHeaders: ['Policy Number'], rows: [['VA-1']] }
              },
              { role: 'heading', level: 2, text: 'Forms' },
              {
                role: 'table',
                table: { columnHeaders: ['Form'], rows: [['F-1']] }
              }
            ]
          }
        }
      ],
      'add-policy'
    );
    expect(result.outcomes).toEqual(['ok']);
    await session.call('resolveGroups', true);

    const blocks: any[] = JSON.parse(await session.call<string>('serialize'))
      .sections[0].blocks;
    const shape = blocks.map((block) =>
      block.rows
        ? 'table'
        : `${block.paragraphFormat?.styleName ?? 'Normal'}:${flat(
            block.inlines
          )}`
    );
    const title = shape.indexOf('Title:Collectibles Policy');
    const summary = shape.indexOf('Title:Premium Summary');
    expect(shape[title - 1]).toBe('Normal:\f');
    expect(shape.slice(summary - 2, summary)).toEqual(['table', 'Normal:\f']);
    expect(shape.filter((entry) => /^(Title|Heading 2):$/.test(entry))).toEqual(
      []
    );
  }, 120000);
});
