import { deriveSectionPattern } from '../syncfusionDocumentOps';

const paragraph = (
  text: string,
  styleName = 'Normal',
  options: {
    level?: number;
    bold?: boolean;
    fontSize?: number;
    beforeSpacing?: number;
    afterSpacing?: number;
    keepWithNext?: boolean;
  } = {}
) => ({
  paragraphFormat: {
    styleName,
    ...(options.level != null ? { outlineLevel: `Level${options.level}` } : {}),
    ...(options.beforeSpacing != null
      ? { beforeSpacing: options.beforeSpacing }
      : {}),
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

const lobSection = (
  name: string,
  options: {
    intro?: boolean;
    extraTable?: boolean;
  } = {}
) => [
  paragraph(name, 'Heading 1', { level: 1, bold: true, fontSize: 16 }),
  ...(options.intro
    ? [paragraph(`Intro for ${name}`, 'Body Text', { fontSize: 11 })]
    : []),
  paragraph('Policy Information', 'Heading 2', {
    level: 2,
    bold: true,
    fontSize: 13
  }),
  table(['Coverage', 'Limit'], { banded: true }),
  paragraph('Named Insured', 'Heading 2', {
    level: 2,
    bold: true,
    fontSize: 13
  }),
  table(['Name', 'Address'], { banded: true }),
  ...(options.extraTable
    ? [
        paragraph('Vehicles', 'Heading 2', {
          level: 2,
          bold: true,
          fontSize: 13
        }),
        table(['Vehicle', 'VIN'], { banded: true })
      ]
    : [])
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
      // The sibling without a subsection belongs to a different family.
      sampled: 3,
      recurring: 3
    });
    expect(result.pattern.sectionLevel).toEqual({
      value: 1,
      confidence: { matches: 3, sampled: 3, level: 'high' }
    });
    expect(
      result.pattern.sequence.map(({ role, level, count, confidence }) => ({
        role,
        level,
        count,
        matches: confidence.matches
      }))
    ).toEqual([
      { role: 'section_heading', level: 1, count: 1, matches: 3 },
      { role: 'intro_paragraph', level: undefined, count: 1, matches: 3 },
      { role: 'subsection_heading', level: 2, count: 1, matches: 3 },
      { role: 'table', level: undefined, count: 1, matches: 3 }
    ]);

    const tablePattern = result.pattern.tables[0];
    expect(tablePattern.columns).toMatchObject({
      value: 3,
      confidence: { matches: 3, sampled: 3 }
    });
    expect(tablePattern.headerRow).toMatchObject({
      value: true,
      confidence: { matches: 3, sampled: 3 }
    });
    expect(tablePattern.banding).toMatchObject({
      value: {
        headerRows: 1,
        period: 2,
        cycle: ['#D9E2F3', '#FFFFFF']
      },
      confidence: { matches: 3, sampled: 3 }
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
        confidence: { matches: 3, sampled: 3 }
      },
      intro_paragraph: {
        styleName: 'Body Text',
        characterFormat: { fontSize: 11 },
        paragraphFormat: { afterSpacing: 6 },
        confidence: { matches: 3, sampled: 3 }
      },
      subsection_heading: {
        styleName: 'Heading 2',
        characterFormat: { bold: true, fontSize: 13 },
        confidence: { matches: 3, sampled: 3 }
      },
      table_header: {
        characterFormat: { bold: true, fontSize: 10 },
        confidence: { matches: 3, sampled: 3 }
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

  it('returns a usable one-section family for a small heterogeneous document', () => {
    const editor = editorFor([
      paragraph('Narrative', 'Heading 1', { level: 1 }),
      paragraph('A body paragraph', 'Normal'),
      paragraph('Schedule', 'Heading 1', { level: 1 }),
      paragraph('Details', 'Heading 2', { level: 2 }),
      table(['Item', 'Value'], { banded: true })
    ]);

    const result = deriveSectionPattern(editor as any);

    expect(result.sample).toMatchObject({
      available: 2,
      sampled: 1,
      recurring: 1
    });
    expect(result.pattern.sequence.map((element) => element.role)).toEqual([
      'section_heading',
      'intro_paragraph'
    ]);
    expect(result.pattern.sectionLevel?.confidence.level).toBe('low');
    expect(result.note).toMatch(/^Low confidence:/);
  });

  it('derives tables from the dominant structurally similar section family', () => {
    const editor = editorFor([
      paragraph('Proposal', 'Heading 1', { level: 1, bold: true }),
      paragraph('Contents', 'Heading 1', { level: 1, bold: true }),
      paragraph('Automobile ........ 3', 'Normal'),
      paragraph('Property ........ 7', 'Normal'),
      ...lobSection('Maryland Automobile'),
      ...lobSection('Virginia Automobile', { intro: true }),
      ...lobSection('Maryland Property', {
        extraTable: true
      })
    ]);

    const result = deriveSectionPattern(editor as any);

    expect(result.sample).toMatchObject({
      available: 5,
      sampled: 3,
      recurring: 3
    });
    expect(
      result.pattern.sequence.map(({ role, count }) => ({ role, count }))
    ).toEqual([
      { role: 'section_heading', count: 1 },
      { role: 'subsection_heading', count: 1 },
      { role: 'table', count: 1 },
      { role: 'subsection_heading', count: 1 },
      { role: 'table', count: 1 }
    ]);
    expect(result.pattern.tables[0]).toMatchObject({
      columns: { value: 2, confidence: { matches: 3, sampled: 3 } },
      headerRow: { value: true, confidence: { matches: 3, sampled: 3 } },
      banding: {
        value: {
          headerRows: 1,
          period: 2,
          cycle: ['#D9E2F3', '#FFFFFF']
        },
        confidence: { matches: 3, sampled: 3 }
      }
    });
  });

  it('prefers the structural family nearest the requested anchor', () => {
    const editor = editorFor([
      paragraph('Insert here', 'Normal'),
      ...lobSection('Maryland Automobile'),
      ...lobSection('Virginia Automobile', { intro: true }),
      ...recurringSection('Summary A', ['Item', 'Value']),
      ...recurringSection('Summary B', ['Item', 'Value']),
      ...recurringSection('Summary C', ['Item', 'Value'])
    ]);

    const adjacent = deriveSectionPattern(editor as any, { near: '0;0' });
    const inside = deriveSectionPattern(editor as any, { near: '0;1' });
    const insideVariant = deriveSectionPattern(editor as any, { near: '0;6' });

    for (const result of [adjacent, inside, insideVariant]) {
      expect(result.sample).toMatchObject({ sampled: 2, recurring: 2 });
      expect(result.pattern.sequence.map((element) => element.role)).toEqual([
        'section_heading',
        'subsection_heading',
        'table',
        'subsection_heading',
        'table'
      ]);
    }
  });

  it('reports the recurring blank-paragraph and paragraph-spacing boundary convention', () => {
    const section = (name: string) => [
      paragraph(name, 'Heading 1', {
        level: 1,
        beforeSpacing: 12
      }),
      paragraph(`${name} body`, 'Body Text', { afterSpacing: 6 })
    ];
    const editor = editorFor([
      ...section('North'),
      paragraph(''),
      ...section('South'),
      paragraph(''),
      ...section('East')
    ]);

    expect(deriveSectionPattern(editor as any).pattern.boundary).toEqual({
      separator: {
        value: ['empty_paragraph'],
        confidence: { matches: 2, sampled: 2, level: 'medium' }
      },
      headingBeforeSpacing: {
        value: 12,
        confidence: { matches: 3, sampled: 3, level: 'high' }
      },
      endingParagraphAfterSpacing: {
        value: 6,
        confidence: { matches: 3, sampled: 3, level: 'high' }
      }
    });
  });

  it('reports direct sibling adjacency instead of inventing a separator', () => {
    const section = (name: string) => [
      paragraph(name, 'Heading 1', { level: 1 }),
      paragraph(`${name} body`)
    ];
    const editor = editorFor([
      ...section('North'),
      ...section('South'),
      ...section('East')
    ]);

    expect(
      deriveSectionPattern(editor as any).pattern.boundary?.separator
    ).toEqual({
      value: [],
      confidence: { matches: 2, sampled: 2, level: 'medium' }
    });
  });

  it('reports page-break separators as the observed boundary mechanism', () => {
    const section = (name: string) => [
      paragraph(name, 'Heading 1', { level: 1 }),
      paragraph(`${name} body`)
    ];
    const editor = editorFor([
      ...section('North'),
      paragraph('\f'),
      ...section('South'),
      paragraph('\f'),
      ...section('East')
    ]);

    expect(
      deriveSectionPattern(editor as any).pattern.boundary?.separator
    ).toEqual({
      value: ['page_break'],
      confidence: { matches: 2, sampled: 2, level: 'medium' }
    });
  });
});
