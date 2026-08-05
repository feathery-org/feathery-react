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

function makeEditor(): DocumentEditor {
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
  editor.open(JSON.stringify(fixture()));
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

  it('supports the same complete assembly immediately after an anchor', () => {
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
      expect(texts.slice(premium + 1, title)).toEqual(['', '']);
      expect(texts.slice(following - 2, following)).toEqual(['', '']);
      expect(texts.slice(title, following)).toEqual(
        expect.arrayContaining(['Coverage', '$500,000', 'Fee', '$200'])
      );
    } finally {
      destroyEditor(editor);
    }
  });
});
