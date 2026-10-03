import { buildCostsFixture } from '../../../../../elements/components/DocxEditor/bindings/core/tests/fixtures/costsFixture';
import { HeadlessSession, startHeadless } from './headlessSession';

const para = (text: string, styleName = 'Normal') => ({
  paragraphFormat: { styleName },
  inlines: [{ text }]
});
const table = (header: string, value: string) => ({
  rows: [header, value].map((text, row) => ({
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

// Policy sections, then a closing disclaimer as the document's last content.
function proposal(): string {
  return JSON.stringify({
    optimizeSfdt: false,
    sections: [
      {
        sectionFormat: { pageWidth: 612, pageHeight: 792 },
        blocks: [
          para('Home Policy', 'Heading 1'),
          para('Policy Information', 'Heading 2'),
          table('Policy Number', 'HO-1'),
          para(''),
          para('Auto Policy', 'Heading 1'),
          para('Policy Information', 'Heading 2'),
          table('Policy Number', 'PA-1'),
          para(''),
          para('Summary Disclaimer', 'Heading 1'),
          para('This summary is for reference only.'),
          para('')
        ]
      }
    ]
  });
}

describe('a section inserted after the last block of the document', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  it('lands every unit in order, tables included', async () => {
    await session.call('open', proposal());
    const baseline = await session.call<string>('serialize');
    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'insert_section',
          group: 'g01-add-policy',
          anchor: '0;9',
          position: 'after',
          sectionSpec: {
            title: 'Collectibles Policy',
            blocks: [
              { role: 'heading', level: 2, text: 'Policy Information' },
              {
                role: 'table',
                table: {
                  columnHeaders: ['Policy Number', 'Premium'],
                  rows: [['VA-1', 'Included']]
                }
              },
              { role: 'paragraph', text: 'Jewelry is scheduled.' },
              {
                role: 'table',
                table: {
                  columnHeaders: ['Class', 'Limit'],
                  rows: [['Jewelry', 'Blanket']]
                }
              }
            ]
          }
        }
      ],
      'add-tail-policy'
    );

    expect(result.outcomes).toEqual(['ok']);
    const texts = (await session.call<any[]>('inventory'))
      .map((entry) => entry.text)
      .filter((text) => text.trim());
    const at = (text: string) => texts.indexOf(text);
    expect(at('This summary is for reference only.')).toBeLessThan(
      at('Collectibles Policy')
    );
    expect(at('Collectibles Policy')).toBeLessThan(at('VA-1'));
    expect(at('VA-1')).toBeLessThan(at('Jewelry is scheduled.'));
    expect(at('Jewelry is scheduled.')).toBeLessThan(at('Jewelry'));

    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);

  it('lands after a live table with an existing table still to follow', async () => {
    // After-mode composes in reverse; each table must still be found where it
    // lands, between a live sibling table and the table that follows.
    await session.call('open', JSON.stringify(buildCostsFixture()));
    const amountDue = (await session.call<any[]>('inventory')).find((entry) =>
      entry.text.startsWith('Amount due for')
    ).anchor;
    const expensesBefore = await session.call<string[]>(
      'tableRowTexts',
      'expenses'
    );
    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'insert_section',
          group: 'g01-add-notes',
          anchor: amountDue,
          position: 'after',
          sectionSpec: {
            title: 'Assumptions',
            blocks: [
              {
                role: 'table',
                table: {
                  columnHeaders: ['Assumption', 'Owner'],
                  rows: [['Hosting is included', 'Vendor']]
                }
              }
            ]
          }
        }
      ],
      'add-notes'
    );

    expect(result.outcomes).toEqual(['ok']);
    const texts = (await session.call<any[]>('inventory')).map(
      (entry) => entry.text
    );
    expect(texts.indexOf('Assumptions')).toBeGreaterThan(
      texts.findIndex((text) => text.startsWith('Amount due for'))
    );
    expect(texts.indexOf('Hosting is included')).toBeLessThan(
      texts.indexOf('Expenses')
    );
    expect(await session.call<string[]>('tableRowTexts', 'expenses')).toEqual(
      expensesBefore
    );
  }, 120000);
});
