import { HeadlessSession, startHeadless } from './headlessSession';

const NAVY = '#001B49FF';
const para = (text: string, styleName = 'Normal') => ({
  paragraphFormat: { styleName },
  inlines: [{ text }]
});
const cell = (text: string, fill?: string) => ({
  blocks: [{ inlines: text ? [{ text }] : [] }],
  cellFormat: {
    preferredWidth: 200,
    preferredWidthType: 'Point',
    ...(fill
      ? {
          shading: {
            texture: 'TextureNone',
            backgroundColor: fill,
            foregroundColor: 'empty'
          }
        }
      : {})
  }
});
// A comparison table whose header corner cell is blank, as proposal grids are.
const comparison = (option: string) => ({
  rows: [
    {
      rowFormat: { isHeader: true },
      cells: [cell('', NAVY), cell(option, NAVY)]
    },
    { rowFormat: { isHeader: false }, cells: [cell('Carrier'), cell('Chubb')] }
  ],
  grid: [200, 200],
  tableFormat: { preferredWidthType: 'Auto' },
  columnCount: 2
});

function proposal(): string {
  return JSON.stringify({
    optimizeSfdt: false,
    sections: [
      {
        sectionFormat: { pageWidth: 612, pageHeight: 792 },
        blocks: [
          para('Home Policy', 'Heading 1'),
          comparison('Recommended'),
          para(''),
          para('Auto Policy', 'Heading 1'),
          comparison('Alternative 1'),
          para(''),
          para('Summary', 'Heading 1')
        ]
      }
    ]
  });
}

describe('a section whose sibling table has a blank corner cell', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  it('still inherits that table look instead of refusing the section', async () => {
    await session.call('open', proposal());
    const anchor = (await session.call<any[]>('inventory')).find(
      (entry) => entry.text === 'Summary'
    ).anchor;
    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'insert_section',
          group: 'g01-add-option',
          anchor,
          position: 'before',
          sectionSpec: {
            title: 'Cyber Policy',
            blocks: [
              {
                role: 'table',
                table: {
                  columnHeaders: ['', 'Alternative 2'],
                  rows: [['Carrier', 'Cincinnati']]
                }
              }
            ]
          }
        }
      ],
      'add-option'
    );

    expect(result.outcomes).toEqual(['ok']);
    const table = await session.call<string>(
      'tableAnchorContaining',
      'Cincinnati'
    );
    expect(
      (await session.call<Array<string | null>>('rowShadingAt', table))[0]
    ).toBe(NAVY);
  }, 120000);
});
