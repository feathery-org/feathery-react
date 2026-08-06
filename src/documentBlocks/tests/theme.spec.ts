import { componentsSfdt, extractTheme } from '../theme';
import { EMPTY_THEME } from '../types';

describe('theme', () => {
  it('round-trips: an untouched components doc extracts the theme it was built from', () => {
    const theme = {
      ...EMPTY_THEME,
      h1: {
        characterFormat: { fontSize: 28, bold: true },
        paragraphFormat: { textAlignment: 'Center' }
      }
    };
    const extracted = extractTheme(componentsSfdt(theme));
    expect(extracted.h1.characterFormat).toMatchObject({
      fontSize: 28,
      bold: true
    });
    expect(extracted.h1.paragraphFormat).toMatchObject({
      textAlignment: 'Center'
    });
    expect(extracted.h1.paragraphFormat?.styleName).toBeUndefined();
  });

  it('extracts an edited character format from a sample', () => {
    const doc = JSON.parse(componentsSfdt(EMPTY_THEME));
    // simulate the user bolding the h2 sample in the editor
    for (const block of doc.sections[0].blocks) {
      const names = (block.inlines ?? [])
        .map((i: any) => i.name)
        .filter(Boolean);
      if (names.includes('cmp_h2')) {
        for (const inline of block.inlines) {
          if (typeof inline.text === 'string') {
            inline.characterFormat = {
              ...inline.characterFormat,
              bold: true,
              fontColor: '#336699'
            };
          }
        }
      }
    }
    const extracted = extractTheme(JSON.stringify(doc));
    expect(extracted.h2.characterFormat).toMatchObject({
      bold: true,
      fontColor: '#336699'
    });
  });

  it('extracts table header and body formats separately', () => {
    const theme = {
      ...EMPTY_THEME,
      table: {
        tableFormat: { preferredWidthType: 'Percent' },
        headerRow: {
          characterFormat: { bold: true },
          cellFormat: { shading: { backgroundColor: '#eeeeee' } }
        },
        body: { characterFormat: {} }
      }
    };
    const extracted = extractTheme(componentsSfdt(theme));
    expect(extracted.table.tableFormat).toMatchObject({
      preferredWidthType: 'Percent'
    });
    expect(extracted.table.headerRow.characterFormat).toMatchObject({
      bold: true
    });
    expect(extracted.table.headerRow.cellFormat).toMatchObject({
      shading: { backgroundColor: '#eeeeee' }
    });
  });

  it('leaves theme entries empty when a sample is missing', () => {
    const doc = JSON.parse(componentsSfdt(EMPTY_THEME));
    doc.sections[0].blocks = doc.sections[0].blocks.filter((b: any) => {
      const text = JSON.stringify(b);
      return !text.includes('cmp_h3');
    });
    const extracted = extractTheme(JSON.stringify(doc));
    expect(extracted.h3).toEqual({});
  });
});
