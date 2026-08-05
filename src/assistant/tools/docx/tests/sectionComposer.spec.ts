import 'jest-canvas-mock';
import {
  DocumentEditor,
  Editor,
  EditorHistory,
  ImageResizer,
  Search,
  Selection,
  SfdtExport
} from '@syncfusion/ej2-documenteditor';

import {
  applyDocumentEdits,
  deriveSectionPattern,
  flattenSfdt,
  getDocumentInventory,
  LiveEditor
} from '../syncfusionDocumentOps';

DocumentEditor.Inject(
  Editor,
  Selection,
  SfdtExport,
  EditorHistory,
  ImageResizer,
  Search
);

if (!window.crypto?.getRandomValues) {
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: (array: Uint8Array) =>
        require('crypto').randomFillSync(array)
    }
  });
}
if (!(window.SVGElement.prototype as any).getBBox) {
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
}

const border = (color: string) => ({
  lineStyle: 'Single',
  lineWidth: 0.5,
  color
});

const cell = (text: string, shading?: string) => ({
  cellFormat: {
    ...(shading ? { shading: { backgroundColor: shading } } : {}),
    borders: {
      top: border('#7F8C8D'),
      left: border('#7F8C8D'),
      right: border('#7F8C8D'),
      bottom: border('#7F8C8D')
    }
  },
  blocks: [{ inlines: [{ text }] }]
});

const table = (
  headers: string[],
  prefix: string,
  headerFill: string,
  stripeFill: string
) => ({
  tableFormat: {},
  rows: [
    {
      rowFormat: { isHeader: true },
      cells: headers.map((header) => cell(header, headerFill))
    },
    ...Array.from({ length: 4 }, (_, row) => ({
      rowFormat: {},
      cells: headers.map((_, column) =>
        cell(
          `${prefix}-${row + 1}-${column + 1}`,
          row % 2 ? undefined : stripeFill
        )
      )
    }))
  ]
});

const paragraph = (text: string, styleName?: string) => ({
  ...(styleName ? { paragraphFormat: { styleName } } : {}),
  inlines: [{ text }]
});

const sibling = (name: string) => [
  paragraph(name, 'Heading 1'),
  paragraph(`${name} introduction`, 'Body Text'),
  paragraph('Coverage Details', 'Heading 2'),
  paragraph(`${name} coverage narrative`, 'Body Text'),
  table(['Coverage', 'Limit'], `${name}-coverage`, '#1F4E78', '#D9E2F3'),
  paragraph('Fee Schedule', 'Heading 2'),
  paragraph(`${name} fee narrative`, 'Body Text'),
  table(['Fee', 'Amount'], `${name}-fee`, '#375623', '#E2F0D9')
];

const fixture = () => ({
  sections: [
    {
      blocks: [
        ...sibling('Policy A'),
        paragraph(''),
        paragraph(''),
        ...sibling('Policy B'),
        paragraph(''),
        paragraph(''),
        ...sibling('Policy C'),
        paragraph(''),
        paragraph(''),
        paragraph('Premium Summary', 'Heading 1'),
        paragraph('Existing premium content', 'Body Text')
      ]
    }
  ],
  styles: [
    {
      type: 'Paragraph',
      name: 'Normal',
      next: 'Normal',
      characterFormat: { fontSize: 11 }
    },
    {
      type: 'Paragraph',
      name: 'Body Text',
      basedOn: 'Normal',
      next: 'Body Text',
      characterFormat: { fontSize: 10 },
      paragraphFormat: { afterSpacing: 6 }
    },
    {
      type: 'Paragraph',
      name: 'Heading 1',
      basedOn: 'Normal',
      next: 'Body Text',
      characterFormat: { bold: true, fontSize: 16 },
      paragraphFormat: { outlineLevel: 'Level1', beforeSpacing: 12 }
    },
    {
      type: 'Paragraph',
      name: 'Heading 2',
      basedOn: 'Normal',
      next: 'Body Text',
      characterFormat: { bold: true, fontSize: 13 },
      paragraphFormat: { outlineLevel: 'Level2', beforeSpacing: 8 }
    }
  ]
});

function makeEditor(sfdt = fixture()): DocumentEditor {
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  document.body.appendChild(host);
  const editor = new DocumentEditor({
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableSearch: true,
    enableSfdtExport: true,
    enableEditorHistory: true
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(sfdt));
  return editor;
}

function destroyEditor(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

function targetAnchor(editor: DocumentEditor): string {
  const target = flattenSfdt(JSON.parse(editor.serialize())).find(
    (block) => block.text === 'Premium Summary'
  );
  if (!target) throw new Error('fixture lost Premium Summary');
  return target.anchor;
}

const sectionSpec = {
  title: 'New Policy Section',
  blocks: [
    { role: 'paragraph' as const, text: 'Extracted policy introduction' },
    { role: 'heading' as const, level: 2, text: 'Coverage Details' },
    {
      role: 'table' as const,
      table: {
        columnHeaders: ['Coverage', 'Limit'],
        columnRoles: ['coverage', 'limit'],
        rows: [
          ['Property', '$500,000'],
          ['Liability', '$1,000,000'],
          ['Cyber', '$250,000']
        ]
      }
    },
    { role: 'heading' as const, level: 2, text: 'Fee Schedule' },
    {
      role: 'table' as const,
      table: {
        columnHeaders: ['Fee', 'Amount'],
        columnRoles: ['fee', 'amount'],
        rows: [
          ['Policy fee', '$125'],
          ['Inspection', '$75'],
          ['Total fees', '$200']
        ]
      }
    }
  ]
};

const repeatedBoundarySpec = {
  ...sectionSpec,
  blocks: [
    ...sectionSpec.blocks,
    { role: 'heading' as const, level: 2, text: 'Premium Summary' },
    {
      role: 'table' as const,
      table: {
        columnHeaders: ['Type', 'Amount'],
        columnRoles: ['premium_type', 'premium_amount'],
        rows: [['Total premium', '$1,200']]
      }
    }
  ]
};

function tableFactsByHeader(editor: DocumentEditor, header: string) {
  const structure = getDocumentInventory(editor as unknown as LiveEditor, {
    scope: 'structure'
  });
  if (!('structure' in structure)) throw new Error('structure read failed');
  const match = structure.structure.tables
    .filter((candidate) => candidate.firstRowCells[0] === header)
    .pop();
  if (!match) throw new Error(`table ${header} not found`);
  const facts = getDocumentInventory(editor as unknown as LiveEditor, {
    scope: 'table_facts',
    tableAnchor: match.anchor
  });
  if (!('table' in facts)) throw new Error(`table facts ${header} failed`);
  return facts.table;
}

describe('insert_section deterministic composer', () => {
  it('assembles five semantic blocks including two populated tables as one sibling-shaped group', () => {
    const editor = makeEditor();
    try {
      const anchor = targetAnchor(editor);
      expect(
        deriveSectionPattern(editor as unknown as LiveEditor, { near: anchor })
          .pattern.roles.section_heading?.styleName
      ).toBe('Heading 1');
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'complete-policy-section',
        edits: [
          {
            op: 'insert_section',
            anchor,
            expect: 'Premium Summary',
            position: 'before',
            sectionSpec
          }
        ]
      });

      expect(result.results).toEqual([
        expect.objectContaining({
          ok: true,
          op: 'insert_section'
        })
      ]);
      expect(result.changeSet).toMatchObject({
        status: 'applied',
        groups: [
          expect.objectContaining({
            opIndices: [0],
            revisionCount: expect.any(Number),
            restoresAppearance: true
          })
        ],
        formatTracking: 'grouped_with_revision_cards'
      });
      expect(result.changeSet?.groups[0].revisionCount).toBeGreaterThan(0);

      const flattened = flattenSfdt(JSON.parse(editor.serialize()));
      const texts = flattened.map((block) => block.text);
      for (const expected of [
        'New Policy Section',
        'Extracted policy introduction',
        'Coverage',
        'Limit',
        'Property',
        '$500,000',
        'Liability',
        '$1,000,000',
        'Cyber',
        '$250,000',
        'Fee',
        'Amount',
        'Policy fee',
        '$125',
        'Inspection',
        '$75',
        'Total fees',
        '$200'
      ])
        expect(texts).toContain(expected);

      const titleIndex = texts.indexOf('New Policy Section');
      const premiumIndex = texts.indexOf('Premium Summary');
      const title = flattened.find(
        (block) => block.text === 'New Policy Section'
      );
      const headings = flattened.filter(
        (block) =>
          block.text === 'Coverage Details' || block.text === 'Fee Schedule'
      );
      if (!title) throw new Error('inserted title not found');
      editor.selection.select(
        `${title.anchor};0`,
        `${title.anchor};${title.text.length}`
      );
      expect(editor.selection.paragraphFormat.styleName).toBe('Heading 1');
      const insertedHeadings = headings.filter((block) => {
        const index = flattened.indexOf(block);
        return index > titleIndex && index < premiumIndex;
      });
      expect(insertedHeadings).toHaveLength(2);
      for (const heading of insertedHeadings) {
        editor.selection.select(
          `${heading.anchor};0`,
          `${heading.anchor};${heading.text.length}`
        );
        expect(editor.selection.paragraphFormat.styleName).toBe('Heading 2');
      }

      const coverage = tableFactsByHeader(editor, 'Coverage');
      expect(coverage.rows[0]).toMatchObject({
        isHeader: true,
        appearance: { shading: '#1F4E78' }
      });
      expect(
        coverage.rows.slice(1).map((row) => row.appearance?.shading ?? null)
      ).toEqual(['#D9E2F3', null, '#D9E2F3']);
      const fees = tableFactsByHeader(editor, 'Fee');
      expect(fees.rows[0]).toMatchObject({
        isHeader: true,
        appearance: { shading: '#375623' }
      });
      expect(
        fees.rows.slice(1).map((row) => row.appearance?.shading ?? null)
      ).toEqual(['#E2F0D9', null, '#E2F0D9']);

      expect(texts.slice(titleIndex - 2, titleIndex)).toEqual(['', '']);
      expect(texts.slice(premiumIndex - 2, premiumIndex)).toEqual(['', '']);
    } finally {
      destroyEditor(editor);
    }
  });

  it('rolls the whole group back and names the failing semantic block', () => {
    const editor = makeEditor();
    try {
      const before = editor.serialize();
      const anchor = targetAnchor(editor);
      let insertedTables = 0;
      const failing = new Proxy(editor as any, {
        get(target, property, receiver) {
          if (property === 'editor') {
            const liveEditor = Reflect.get(target, property, receiver);
            return new Proxy(liveEditor, {
              get(inner, method, innerReceiver) {
                const value = Reflect.get(inner, method, innerReceiver);
                if (method === 'insertTable')
                  return (...args: any[]) => {
                    insertedTables++;
                    if (insertedTables === 2)
                      throw new Error('injected second-table failure');
                    return value.apply(inner, args);
                  };
                return typeof value === 'function' ? value.bind(inner) : value;
              }
            });
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });

      const result = applyDocumentEdits(failing as LiveEditor, {
        changeSetId: 'section-failure-rollback',
        edits: [
          {
            op: 'insert_section',
            anchor,
            expect: 'Premium Summary',
            sectionSpec
          }
        ]
      });

      expect(result.results[0]).toMatchObject({
        ok: false,
        op: 'insert_section',
        error: 'op_failed',
        message: expect.stringContaining('block 5 (table)'),
        details: expect.arrayContaining([
          'failing section component: block 5 (table)',
          'injected second-table failure'
        ])
      });
      expect(result.changeSet).toMatchObject({ status: 'failed' });
      expect(editor.revisions.length).toBe(0);
      expect(editor.serialize()).toBe(before);
    } finally {
      destroyEditor(editor);
    }
  });

  it('resolves after a heading at the named section boundary, not below the heading', () => {
    const editor = makeEditor();
    try {
      const anchor = targetAnchor(editor);
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'complete-policy-section-after',
        edits: [
          {
            op: 'insert_section',
            anchor,
            expect: 'Premium Summary',
            position: 'after',
            sectionSpec
          }
        ]
      });

      expect(result.results).toEqual([
        expect.objectContaining({ ok: true, op: 'insert_section' })
      ]);
      const texts = flattenSfdt(JSON.parse(editor.serialize())).map(
        (block) => block.text
      );
      const premium = texts.indexOf('Premium Summary');
      const title = texts.indexOf('New Policy Section');
      const following = texts.indexOf('Existing premium content');
      expect(premium).toBeLessThan(following);
      expect(following).toBeLessThan(title);
      expect(texts.slice(title)).toEqual(
        expect.arrayContaining(['Coverage', '$500,000', 'Fee', '$200'])
      );
    } finally {
      destroyEditor(editor);
    }
  });

  it('keeps the captured boundary deterministic when the new section repeats its text', () => {
    const editor = makeEditor();
    try {
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'repeated-boundary-heading',
        edits: [
          {
            op: 'insert_section',
            anchor: targetAnchor(editor),
            position: 'before',
            sectionSpec: repeatedBoundarySpec
          }
        ]
      });

      expect(result.results).toEqual([
        expect.objectContaining({ ok: true, op: 'insert_section' })
      ]);
      const flattened = flattenSfdt(JSON.parse(editor.serialize()));
      const premiumHeadings = flattened.filter(
        (block) => block.text === 'Premium Summary'
      );
      expect(premiumHeadings).toHaveLength(2);
      expect(tableFactsByHeader(editor, 'Type').rows[1].cells).toEqual([
        expect.objectContaining({ text: 'Total premium' }),
        expect.objectContaining({ text: '$1,200' })
      ]);
    } finally {
      destroyEditor(editor);
    }
  });

  it('resolves before:<name> from the heading section map', () => {
    const editor = makeEditor();
    try {
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'named-section-before',
        edits: [
          {
            op: 'insert_section',
            anchor: 'before:premium summary',
            sectionSpec
          }
        ]
      });

      expect(result.results).toEqual([
        expect.objectContaining({ ok: true, op: 'insert_section' })
      ]);
      const texts = flattenSfdt(JSON.parse(editor.serialize())).map(
        (block) => block.text
      );
      expect(texts.indexOf('Policy C-fee-4-2')).toBeLessThan(
        texts.indexOf('New Policy Section')
      );
      expect(texts.indexOf('New Policy Section')).toBeLessThan(
        texts.indexOf('Premium Summary')
      );
    } finally {
      destroyEditor(editor);
    }
  });

  it.each([
    ['保险责任', '保险责任'],
    ['Policy 保费 Summary', 'policy 保费 summary']
  ])('resolves the Unicode section name %s', (heading, requested) => {
    const sfdt = fixture();
    const premium = sfdt.sections[0].blocks.find(
      (block: any) => block.inlines?.[0]?.text === 'Premium Summary'
    ) as any;
    premium.inlines[0].text = heading;
    const editor = makeEditor(sfdt);
    try {
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: `unicode-section-${heading}`,
        edits: [
          {
            op: 'insert_section',
            anchor: `before:${requested}`,
            sectionSpec
          }
        ]
      });

      expect(result.results[0]).toMatchObject({
        ok: true,
        op: 'insert_section'
      });
      const texts = flattenSfdt(JSON.parse(editor.serialize())).map(
        (block) => block.text
      );
      expect(texts.indexOf('New Policy Section')).toBeLessThan(
        texts.indexOf(heading)
      );
    } finally {
      destroyEditor(editor);
    }
  });

  it('does not treat a punctuation-only heading as a named section', () => {
    const sfdt = fixture();
    sfdt.sections[0].blocks.push(paragraph('!!!', 'Heading 1'));
    const editor = makeEditor(sfdt);
    try {
      const before = editor.serialize();
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'punctuation-only-section',
        edits: [
          {
            op: 'insert_section',
            anchor: 'before:!!!',
            sectionSpec
          }
        ]
      });

      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'section_target_not_found'
      });
      expect(editor.serialize()).toBe(before);
    } finally {
      destroyEditor(editor);
    }
  });

  it('skips empty-normalized headings for an unrelated English request', () => {
    const sfdt = fixture();
    sfdt.sections[0].blocks.push(paragraph('!!!', 'Heading 1'));
    const editor = makeEditor(sfdt);
    try {
      const before = editor.serialize();
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'empty-normalized-candidate',
        edits: [
          {
            op: 'insert_section',
            anchor: 'before:Unrelated English Section',
            sectionSpec
          }
        ]
      });

      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'section_target_not_found'
      });
      expect(editor.serialize()).toBe(before);
    } finally {
      destroyEditor(editor);
    }
  });

  it('resolves after:<name> after the section last content', () => {
    const editor = makeEditor();
    try {
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'named-section-after',
        edits: [
          {
            op: 'insert_section',
            anchor: 'after:Policy A section',
            sectionSpec
          }
        ]
      });

      expect(result.results).toEqual([
        expect.objectContaining({ ok: true, op: 'insert_section' })
      ]);
      const texts = flattenSfdt(JSON.parse(editor.serialize())).map(
        (block) => block.text
      );
      expect(texts.indexOf('Policy A-fee-4-2')).toBeLessThan(
        texts.indexOf('New Policy Section')
      );
      expect(texts.indexOf('New Policy Section')).toBeLessThan(
        texts.indexOf('Policy B')
      );
    } finally {
      destroyEditor(editor);
    }
  });

  it('returns one concrete candidate question for an ambiguous section name', () => {
    const sfdt = fixture();
    sfdt.sections[0].blocks.push(
      paragraph('Premium Summary', 'Heading 1'),
      paragraph('Second premium content', 'Body Text')
    );
    const editor = makeEditor(sfdt);
    try {
      const before = editor.serialize();
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'ambiguous-named-section',
        edits: [
          {
            op: 'insert_section',
            anchor: 'before:Premium Summary',
            sectionSpec
          }
        ]
      });

      expect(result.results).toEqual([
        expect.objectContaining({
          ok: false,
          op: 'insert_section',
          error: 'section_target_ambiguous',
          message: expect.stringContaining('Ask one question'),
          details: expect.arrayContaining([
            expect.stringMatching(/"Premium Summary" at 0;\d+/),
            expect.stringMatching(/"Premium Summary" at 0;\d+/)
          ])
        })
      ]);
      expect(result.results[0].message).not.toContain('click');
      expect(editor.revisions.length).toBe(0);
      expect(editor.serialize()).toBe(before);
    } finally {
      destroyEditor(editor);
    }
  });

  it('uses a blank body boundary by topology instead of ambiguous text matching', () => {
    const editor = makeEditor();
    try {
      const flattened = flattenSfdt(JSON.parse(editor.serialize()));
      const premiumIndex = flattened.findIndex(
        (block) => block.text === 'Premium Summary'
      );
      const blank = [...flattened.slice(0, premiumIndex)]
        .reverse()
        .find((block) => block.kind !== 'table_cell' && !block.text);
      if (!blank) throw new Error('fixture lost blank insertion boundary');

      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'blank-section-boundary',
        edits: [
          {
            op: 'insert_section',
            anchor: blank.anchor,
            expect: 'stale placeholder text',
            position: 'before',
            sectionSpec
          }
        ]
      });

      expect(result.results).toEqual([
        expect.objectContaining({ ok: true, op: 'insert_section' })
      ]);
      expect(result.changeSet).toMatchObject({
        status: 'applied',
        groups: [expect.objectContaining({ opIndices: [0] })]
      });
      const texts = flattenSfdt(JSON.parse(editor.serialize())).map(
        (block) => block.text
      );
      expect(texts.indexOf('New Policy Section')).toBeLessThan(
        texts.indexOf('Premium Summary')
      );
    } finally {
      destroyEditor(editor);
    }
  });

  it('manufactures a body insertion boundary beside a table-cell anchor', () => {
    const editor = makeEditor();
    try {
      const cellAnchor = flattenSfdt(JSON.parse(editor.serialize())).find(
        (block) => block.text === 'Policy C-fee-4-2'
      )?.anchor;
      if (!cellAnchor) throw new Error('fixture lost the final sibling table');

      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'table-interior-section-boundary',
        edits: [
          {
            op: 'insert_section',
            anchor: cellAnchor,
            expect: 'Policy C-fee-4-2',
            position: 'after',
            sectionSpec
          }
        ]
      });

      expect(result.results).toEqual([
        expect.objectContaining({
          ok: true,
          op: 'insert_section',
          anchor: cellAnchor
        })
      ]);
      const texts = flattenSfdt(JSON.parse(editor.serialize())).map(
        (block) => block.text
      );
      expect(texts.indexOf('Policy C-fee-4-2')).toBeLessThan(
        texts.indexOf('New Policy Section')
      );
      expect(texts.indexOf('New Policy Section')).toBeLessThan(
        texts.indexOf('Premium Summary')
      );
    } finally {
      destroyEditor(editor);
    }
  });

  it('inherits recurring blank padding between sibling subsections', () => {
    const sfdt = fixture();
    const blocks = sfdt.sections[0].blocks;
    for (let index = blocks.length - 1; index > 0; index--) {
      if (
        blocks[index]?.inlines?.[0]?.text === 'Fee Schedule' &&
        blocks[index - 1]?.rows
      )
        blocks.splice(index, 0, paragraph(''));
    }
    const editor = makeEditor(sfdt);
    try {
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'subsection-padding',
        edits: [
          {
            op: 'insert_section',
            anchor: targetAnchor(editor),
            position: 'before',
            sectionSpec
          }
        ]
      });
      expect(result.results).toEqual([
        expect.objectContaining({ ok: true, op: 'insert_section' })
      ]);

      const flattened = flattenSfdt(JSON.parse(editor.serialize()));
      const title = flattened.findIndex(
        (block) => block.text === 'New Policy Section'
      );
      const premium = flattened.findIndex(
        (block) => block.text === 'Premium Summary'
      );
      const inserted = flattened.slice(title, premium);
      const coverageTableEnd = inserted
        .map((block) => block.text)
        .lastIndexOf('$250,000');
      const feeHeading = inserted.findIndex(
        (block) => block.text === 'Fee Schedule'
      );
      expect(
        inserted
          .slice(coverageTableEnd + 1, feeHeading)
          .some(
            (block) => block.anchor.split(';').length === 2 && block.text === ''
          )
      ).toBe(true);
    } finally {
      destroyEditor(editor);
    }
  });

  it('skips empty sibling headings when choosing appearance donors', () => {
    const sfdt = fixture();
    sfdt.sections[0].blocks[2] = paragraph('', 'Heading 2');
    const editor = makeEditor(sfdt);
    try {
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'non-empty-appearance-donor',
        edits: [
          {
            op: 'insert_section',
            anchor: targetAnchor(editor),
            position: 'before',
            sectionSpec
          }
        ]
      });

      expect(result.results).toEqual([
        expect.objectContaining({ ok: true, op: 'insert_section' })
      ]);
      expect(result.warnings).not.toEqual(
        expect.arrayContaining([
          expect.stringContaining('inherit_source_empty')
        ])
      );
    } finally {
      destroyEditor(editor);
    }
  });

  it('restores the exact document when a late table in the section fails', () => {
    const editor = makeEditor();
    try {
      const before = editor.serialize();
      let insertedTables = 0;
      const failing = new Proxy(editor as any, {
        get(target, property, receiver) {
          if (property === 'editor') {
            const liveEditor = Reflect.get(target, property, receiver);
            return new Proxy(liveEditor, {
              get(inner, method, innerReceiver) {
                const value = Reflect.get(inner, method, innerReceiver);
                if (method === 'insertTable')
                  return (...args: any[]) => {
                    insertedTables++;
                    if (insertedTables === 6)
                      throw new Error('injected sixth-table failure');
                    return value.apply(inner, args);
                  };
                return typeof value === 'function' ? value.bind(inner) : value;
              }
            });
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
      const blocks = Array.from({ length: 6 }, (_, index) => [
        {
          role: 'heading' as const,
          level: 2,
          text: `Detail ${index + 1}`
        },
        {
          role: 'table' as const,
          table: {
            columnHeaders: ['Item', 'Value'],
            rows: [[`Fact ${index + 1}`, `Value ${index + 1}`]]
          }
        }
      ]).flat();

      const result = applyDocumentEdits(failing as LiveEditor, {
        changeSetId: 'late-section-failure',
        edits: [
          {
            op: 'insert_section',
            anchor: targetAnchor(editor),
            position: 'before',
            sectionSpec: { title: 'New Policy Section', blocks }
          }
        ]
      });

      expect(result.results[0]).toMatchObject({
        ok: false,
        op: 'insert_section',
        message: expect.stringContaining('block 12 (table)'),
        details: expect.arrayContaining(['injected sixth-table failure'])
      });
      expect(result.changeSet).toMatchObject({ status: 'failed' });
      expect(editor.revisions.length).toBe(0);
      expect(editor.serialize()).toBe(before);
    } finally {
      destroyEditor(editor);
    }
  });
});
