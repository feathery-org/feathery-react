import { HeadlessSession, startHeadless } from './headlessSession';

const run = (text: string) => ({
  characterFormat: { bold: true, fontColor: '#001B49FF' },
  text
});
const cell = (text: string) => ({
  blocks: [{ inlines: [run(text)] }],
  cellFormat: { preferredWidth: 120, preferredWidthType: 'Point' }
});
const para = (text: string) => ({ inlines: [{ text }] });

// The proposal templates' shape: the document default names the theme's minor
// font and the Normal style names Arial, so text is Arial only via the chain.
function proposal(): string {
  return JSON.stringify({
    optimizeSfdt: false,
    characterFormat: {
      fontSize: 11,
      fontFamily: 'Arial',
      fontFamilyAscii: 'minorHAnsi',
      fontFamilyNonFarEast: 'minorHAnsi',
      fontFamilyFarEast: 'minorHAnsi'
    },
    themes: {
      fontScheme: {
        fontSchemeName: 'Custom',
        majorFontScheme: {
          fontSchemeList: [
            { name: 'latin', typeface: 'Arial' },
            { name: 'ea' },
            { name: 'cs' }
          ],
          fontTypeface: {}
        },
        minorFontScheme: {
          fontSchemeList: [
            { name: 'latin', typeface: 'Arial' },
            { name: 'ea' },
            { name: 'cs' }
          ],
          fontTypeface: {}
        }
      }
    },
    styles: [
      {
        name: 'Normal',
        type: 'Paragraph',
        next: 'Normal',
        characterFormat: {
          fontFamily: 'Arial',
          fontFamilyAscii: 'Arial',
          fontFamilyNonFarEast: 'Arial'
        }
      },
      { name: 'Default Paragraph Font', type: 'Character', characterFormat: {} }
    ],
    sections: [
      {
        sectionFormat: { pageWidth: 612, pageHeight: 792 },
        blocks: [
          para('Options'),
          {
            rows: [
              {
                rowFormat: { isHeader: true },
                cells: ['Coverage', 'Recommended', 'Alternative 2'].map(
                  (text) => cell(text)
                )
              },
              {
                rowFormat: { isHeader: false },
                cells: ['Total Annual Premium', '$9,719.00', '$700.00'].map(
                  (text) => cell(text)
                )
              }
            ],
            grid: [120, 120, 120],
            tableFormat: { preferredWidthType: 'Auto' },
            columnCount: 3
          },
          ...['(700)', '($1,234.00)', '-$700', '$1,234', '700', '$700.00'].map(
            para
          ),
          para('End')
        ]
      }
    ]
  });
}

describe('a value bound into a cell that already shows it', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  it('keeps the font, weight and size of the text it replaces, tracked', async () => {
    await session.call('open', proposal());
    await session.call('setTrackChanges', true);
    const table = await session.call<string>(
      'tableAnchorContaining',
      'Alternative 2'
    );
    const sibling = await session.call<any>('resolvedRunLook', '$9,719.00');
    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'create_binding',
          group: 'g01-bind-premium',
          anchor: `${table};1;2;0`,
          kind: 'input',
          name: 'OptionPremium',
          valueType: 'currency:USD:2'
        }
      ],
      'bind-premium'
    );

    expect(result.outcomes).toEqual(['ok']);
    expect(sibling.fontFamily).toBe('Arial');
    expect(await session.call<any>('resolvedRunLook', '$700.00')).toEqual(
      sibling
    );
  }, 120000);

  it.each(['(700)', '($1,234.00)', '-$700', '$1,234', '700', '$700.00'])(
    'adopts %s as written, sign included',
    async (text) => {
      await session.call('open', proposal());
      const anchor = (await session.call<any[]>('inventory')).find(
        (entry) => entry.text === text
      ).anchor;
      const result = await session.call<any>(
        'applyEdits',
        [
          {
            op: 'create_binding',
            group: 'g01-bind',
            anchor,
            kind: 'input',
            name: 'Amount',
            valueType: 'currency:USD:2'
          }
        ],
        'bind-amount'
      );
      expect(result.outcomes).toEqual(['ok']);
    },
    120000
  );
});
