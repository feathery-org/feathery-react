import { deriveSectionPattern } from '../syncfusionDocumentOps';

const paragraph = (
  text: string,
  styleName = 'Normal',
  options: {
    level?: number;
    bold?: boolean;
    fontSize?: number;
    afterSpacing?: number;
    keepWithNext?: boolean;
  } = {}
) => ({
  paragraphFormat: {
    styleName,
    ...(options.level != null ? { outlineLevel: `Level${options.level}` } : {}),
    ...(options.afterSpacing != null
      ? { afterSpacing: options.afterSpacing }
      : {}),
    ...(options.keepWithNext != null
      ? { keepWithNext: options.keepWithNext }
      : {})
  },
  inlines: [
    {
      text,
      characterFormat: {
        ...(options.bold != null ? { bold: options.bold } : {}),
        ...(options.fontSize != null ? { fontSize: options.fontSize } : {})
      }
    }
  ]
});

const table = (
  headers: string[],
  options: { banded?: boolean; header?: boolean } = {}
) => {
  const header = options.header !== false;
  const data = Array.from({ length: options.banded ? 4 : 2 }, (_, row) =>
    headers.map((_heading, column) => `${row + 1}-${column + 1}`)
  );
  return {
    tableFormat: {
      styleName: header ? 'Grid Table 4 - Accent 1' : 'Table Grid'
    },
    rows: [headers, ...data].map((values, row) => ({
      ...(row === 0 && header ? { rowFormat: { isHeader: true } } : {}),
      cells: values.map((value) => ({
        cellFormat: {
          ...(row === 0 && header
            ? { shading: { backgroundColor: '#4472C4' } }
            : options.banded && row > 0
            ? {
                shading: {
                  backgroundColor: row % 2 === 1 ? '#D9E2F3' : '#FFFFFF'
                }
              }
            : {})
        },
        blocks: [
          paragraph(value, 'Normal', {
            bold: row === 0 && header,
            fontSize: 10
          })
        ]
      }))
    }))
  };
};

const recurringSection = (name: string, headers: string[]) => [
  paragraph(name, 'Heading 1', {
    level: 1,
    bold: true,
    fontSize: 16,
    keepWithNext: true
  }),
  paragraph(`Intro for ${name}`, 'Body Text', {
    fontSize: 11,
    afterSpacing: 6
  }),
  paragraph('Schedule', 'Heading 2', {
    level: 2,
    bold: true,
    fontSize: 13
  }),
  table(headers, { banded: true })
];

const editorFor = (blocks: any[]) => ({
  serialize: () => JSON.stringify({ sections: [{ blocks }] })
});

describe('deriveSectionPattern', () => {
  it('returns the recurring majority shape with sibling confidence and observed header variants', () => {
    const editor = editorFor([
      ...recurringSection('North', ['Item', 'Value', 'Notes']),
      ...recurringSection('South', ['Item', 'Amount', 'Notes']),
      ...recurringSection('East', ['Item', 'Value', 'Comment']),
      // Same top-level sibling family, deliberately divergent.
      paragraph('West', 'Heading 1', { level: 1, bold: true, fontSize: 16 }),
      paragraph('A different short section', 'Body Text', { fontSize: 11 }),
      table(['Label', 'Result'], { header: false })
    ]);

    const result = deriveSectionPattern(editor as any);

    expect(result.ok).toBe(true);
    expect(result.sample).toMatchObject({
      available: 4,
      sampled: 4,
      recurring: 3
    });
    expect(result.pattern.sectionLevel).toEqual({
      value: 1,
      confidence: { matches: 4, sampled: 4, level: 'high' }
    });
    expect(
      result.pattern.sequence.map(({ role, level, count, confidence }) => ({
        role,
        level,
        count,
        matches: confidence.matches
      }))
    ).toEqual([
      { role: 'section_heading', level: 1, count: 1, matches: 4 },
      { role: 'intro_paragraph', level: undefined, count: 1, matches: 4 },
      { role: 'subsection_heading', level: 2, count: 1, matches: 3 },
      { role: 'table', level: undefined, count: 1, matches: 3 }
    ]);

    const tablePattern = result.pattern.tables[0];
    expect(tablePattern.columns).toMatchObject({
      value: 3,
      confidence: { matches: 3, sampled: 4 }
    });
    expect(tablePattern.headerRow).toMatchObject({
      value: true,
      confidence: { matches: 3, sampled: 4 }
    });
    expect(tablePattern.banding).toMatchObject({
      value: {
        headerRows: 1,
        period: 2,
        cycle: ['#D9E2F3', '#FFFFFF']
      },
      confidence: { matches: 3, sampled: 4 }
    });
    expect(tablePattern.columnHeaders.variants).toEqual(
      expect.arrayContaining([
        { texts: ['Item', 'Value', 'Notes'], observed: 1 },
        { texts: ['Item', 'Amount', 'Notes'], observed: 1 },
        { texts: ['Item', 'Value', 'Comment'], observed: 1 }
      ])
    );
    expect(result.pattern.roles).toMatchObject({
      section_heading: {
        styleName: 'Heading 1',
        characterFormat: { bold: true, fontSize: 16 },
        paragraphFormat: { keepWithNext: true, outlineLevel: 'Level1' },
        confidence: { matches: 3, sampled: 4 }
      },
      intro_paragraph: {
        styleName: 'Body Text',
        characterFormat: { fontSize: 11 },
        paragraphFormat: { afterSpacing: 6 },
        confidence: { matches: 3, sampled: 4 }
      },
      subsection_heading: {
        styleName: 'Heading 2',
        characterFormat: { bold: true, fontSize: 13 },
        confidence: { matches: 3, sampled: 4 }
      },
      table_header: {
        characterFormat: { bold: true, fontSize: 10 },
        confidence: { matches: 3, sampled: 4 }
      }
    });
    expect(JSON.stringify(result).length).toBeLessThan(4096);
  });

  it('returns an honest low-confidence minimal pattern when no section repeats', () => {
    const editor = editorFor([
      paragraph('Only section', 'Heading 1', {
        level: 1,
        bold: true,
        fontSize: 16
      }),
      paragraph('One body paragraph', 'Normal', { fontSize: 11 })
    ]);

    const result = deriveSectionPattern(editor as any, { near: '0;1' });

    expect(result).toMatchObject({
      ok: true,
      sample: { available: 1, sampled: 1, recurring: 1, near: '0;1' },
      pattern: {
        sectionLevel: {
          value: 1,
          confidence: { matches: 1, sampled: 1, level: 'low' }
        }
      }
    });
    expect(result.pattern.sequence.map((element) => element.role)).toEqual([
      'section_heading',
      'intro_paragraph'
    ]);
    expect(result.note).toMatch(/^Low confidence:/);
  });
});
