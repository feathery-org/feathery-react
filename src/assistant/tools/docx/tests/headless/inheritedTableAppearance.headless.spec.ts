import { HeadlessSession, startHeadless } from './headlessSession';

// A proposal-style sibling table: percent-width table AND percent-width columns,
// a filled header row whose cells draw an accent bottom edge, and thin grey
// table-level horizontal rules between body rows.
const border = (lineStyle = 'None', lineWidth = 0, color?: string) => ({
  hasNoneStyle: lineStyle === 'None',
  lineStyle,
  lineWidth,
  shadow: false,
  space: 0,
  ...(color ? { color } : {})
});
const noBorders = () => ({
  top: border(),
  left: border(),
  right: border(),
  bottom: border(),
  horizontal: border(),
  vertical: border()
});
const RULE = border('Single', 0.5, '#BFBFBFFF');
const ACCENT = border('Single', 1.5, '#A9B533FF');
const WIDTHS = [18, 22, 26, 18, 16];

function cell(
  text: string,
  width: number,
  fill: string,
  borders: Record<string, unknown>
): any {
  return {
    blocks: [{ inlines: text ? [{ text }] : [] }],
    cellFormat: {
      borders,
      shading: {
        backgroundColor: fill,
        foregroundColor: 'empty',
        texture: 'TextureNone'
      },
      preferredWidth: width,
      preferredWidthType: 'Percent',
      columnSpan: 1,
      rowSpan: 1,
      verticalAlignment: 'Top'
    }
  };
}

function siblingTable(): any {
  const tableBorders = {
    ...noBorders(),
    bottom: RULE,
    horizontal: RULE
  };
  return {
    rows: [
      {
        rowFormat: { isHeader: true, borders: { ...tableBorders } },
        cells: ['Policy Number', 'Carrier', 'Insurer', 'Term', 'Premium'].map(
          (text, index) =>
            cell(text, WIDTHS[index], '#001B49FF', {
              ...noBorders(),
              bottom: ACCENT
            })
        )
      },
      {
        rowFormat: { isHeader: false, borders: { ...tableBorders } },
        cells: ['AU-100', 'Chubb', 'Federal', '2026 - 2027', '$1,200'].map(
          (text, index) => cell(text, WIDTHS[index], '#FFFFFFFF', noBorders())
        )
      }
    ],
    grid: WIDTHS.map((width) => width * 4.68),
    tableFormat: {
      borders: tableBorders,
      leftIndent: 0,
      tableAlignment: 'Left',
      preferredWidth: 100,
      preferredWidthType: 'Percent',
      allowAutoFit: true,
      leftMargin: 7,
      rightMargin: 7
    },
    columnCount: 5
  };
}

function proposalDocument(): string {
  return JSON.stringify({
    optimizeSfdt: false,
    sections: [
      {
        sectionFormat: { pageWidth: 612, pageHeight: 792 },
        blocks: [
          { inlines: [{ text: 'Automobile' }] },
          siblingTable(),
          { inlines: [{ text: '' }] },
          { inlines: [{ text: 'Collectibles' }] },
          { inlines: [{ text: 'End of proposal' }] }
        ]
      }
    ]
  });
}

const insertPolicyTable = {
  op: 'insert_table',
  group: 'g01-add-policy',
  anchor: '0;4',
  position: 'before',
  rows: 2,
  columns: 5,
  initialCells: [
    [
      'Policy Number',
      'Parent Company',
      'Issuing Company',
      'Policy Term',
      'Total Policy Premium'
    ],
    ['VA-1', '', 'Berkley', '06/16/2026 - 06/16/2027', '$700']
  ],
  inheritFormatFrom: '0;1;0;0;0'
};

describe('insert_table inherits a sibling look', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  it.each([false, true])(
    'lands a percent-grid table with an accent header edge (track changes %s)',
    async (track) => {
      await session.call('open', proposalDocument());
      await session.call('setTrackChanges', track);
      const result = await session.call<any>(
        'applyEdits',
        [insertPolicyTable],
        'add-policy'
      );
      expect(result.outcomes).toEqual(['ok']);
      expect(result.warnings).not.toEqual(
        expect.arrayContaining([
          expect.stringMatching(/appearance_not_fully_inherited/)
        ])
      );

      const sfdt = JSON.parse(await session.call<string>('serialize'));
      const table = sfdt.sections[0].blocks.filter(
        (block: any) => block.rows
      )[1];
      const header = table.rows[0].cells;
      expect(
        header.map((entry: any) => entry.cellFormat.preferredWidthType)
      ).toEqual(WIDTHS.map(() => 'Percent'));
      expect(
        header.map((entry: any) => entry.cellFormat.preferredWidth)
      ).toEqual(WIDTHS);
      for (const entry of header)
        expect(entry.cellFormat.borders.bottom).toMatchObject({
          lineStyle: 'Single',
          lineWidth: 1.5,
          color: '#A9B533FF'
        });
      // The body row keeps the sibling's thin interior rule, not the accent.
      const sibling = sfdt.sections[0].blocks.filter(
        (block: any) => block.rows
      )[0];
      expect(table.rows[1].rowFormat.borders.bottom).toMatchObject({
        lineStyle: sibling.rows[1].rowFormat.borders.bottom.lineStyle,
        lineWidth: sibling.rows[1].rowFormat.borders.bottom.lineWidth,
        color: sibling.rows[1].rowFormat.borders.bottom.color
      });
      for (const entry of table.rows[1].cells)
        expect(entry.cellFormat.borders?.bottom?.lineWidth ?? 0).not.toBe(1.5);
    },
    120000
  );
});
