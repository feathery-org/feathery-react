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

import { DOCUMENT_EDITOR_CAPABILITIES } from '../../../capabilities/registry';
import {
  applyDocumentEdits,
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

// Nothing below asserts any of these values. They exist so the fixture has SOME
// house style; every expectation is read back out of the document, so the same
// tests hold for a document styled entirely differently.
const HEADER_FILL = '#2E4B3C';
const BAND_FILL = '#EFEFE7';
const RULE = '#B4BAC1';

const border = () => ({ lineStyle: 'Single', lineWidth: 0.5, color: RULE });

const cell = (text: string, shading?: string) => ({
  cellFormat: {
    ...(shading ? { shading: { backgroundColor: shading } } : {}),
    borders: {
      top: border(),
      left: border(),
      right: border(),
      bottom: border()
    }
  },
  blocks: [{ paragraphFormat: { styleName: 'Body Text' }, inlines: [{ text }] }]
});

/**
 * `headerRows` header rows, then data rows striped by `cycle`. A cycle of
 * `[undefined]` is a family whose tables carry no banding at all - one of the
 * shapes the composer must handle without inventing a stripe.
 */
const grid = (
  headers: string[],
  rows: string[][],
  options: { headerRows?: number; cycle?: Array<string | undefined> } = {}
) => {
  const headerRows = options.headerRows ?? 1;
  const cycle = options.cycle ?? [undefined, BAND_FILL];
  return {
    tableFormat: {},
    rows: [
      ...Array.from({ length: headerRows }, (_unused, index) => ({
        rowFormat: { isHeader: true },
        cells: headers.map((header) =>
          cell(index === 0 ? header : '', HEADER_FILL)
        )
      })),
      ...rows.map((row, index) => ({
        rowFormat: {},
        cells: row.map((text) => cell(text, cycle[index % cycle.length]))
      }))
    ]
  };
};

const paragraph = (text: string, styleName: string) => ({
  paragraphFormat: { styleName },
  inlines: text ? [{ text }] : []
});

const prose = (tag: string) =>
  paragraph(
    `${tag} narrative, written at ordinary length so the document's body text size is unambiguous to the heading inference.`,
    'Body Text'
  );

// Three heading depths, none of them a built-in "Heading N": the level a style
// sits at is inferred from the document, which is what the composer must key
// off rather than any style name.
const STYLES = [
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
    characterFormat: { fontSize: 11 }
  },
  {
    type: 'Paragraph',
    name: 'Title',
    basedOn: 'Normal',
    next: 'Normal',
    characterFormat: { bold: true, fontSize: 22, fontColor: '#14213D' }
  },
  {
    type: 'Paragraph',
    name: 'sectionBanner',
    basedOn: 'Body Text',
    next: 'Normal',
    characterFormat: { bold: true, fontSize: 16, fontColor: '#14213D' }
  },
  {
    type: 'Paragraph',
    name: 'subsectionBanner',
    basedOn: 'Body Text',
    next: 'Normal',
    characterFormat: { bold: true, fontSize: 14, fontColor: '#6B8F71' }
  }
];

/**
 * Two sibling programmes, each with two subsections carrying a banded table.
 * The shape the incident needed: the LAST subsection of a programme is followed
 * immediately by the next programme's heading, which is TWO levels shallower.
 */
const fixture = (
  options: { cycle?: Array<string | undefined>; withTables?: boolean } = {}
) => {
  const withTables = options.withTables ?? true;
  const subsection = (programme: string, name: string) => [
    paragraph(name, 'subsectionBanner'),
    prose(`${programme} ${name}`),
    ...(withTables
      ? [
          grid(
            ['Item', 'Value'],
            [
              [`${programme} ${name} one`, '1'],
              [`${programme} ${name} two`, '2'],
              [`${programme} ${name} three`, '3']
            ],
            { cycle: options.cycle }
          )
        ]
      : [])
  ];
  const programme = (name: string) => [
    paragraph(name, 'Title'),
    prose(name),
    paragraph(`${name} Overview`, 'sectionBanner'),
    prose(`${name} overview`),
    ...subsection(name, 'Drivers'),
    ...subsection(name, 'Interests')
  ];
  return {
    sections: [
      { blocks: [...programme('Alpha Motor'), ...programme('Beta Motor')] }
    ],
    styles: STYLES
  };
};

function makeEditor(sfdt: any = fixture()): DocumentEditor {
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

/** The document's own answer for how a paragraph renders. */
function renderedFormat(
  editor: DocumentEditor,
  anchor: string,
  length: number
) {
  editor.selection.select(`${anchor};0`, `${anchor};${length}`);
  return {
    styleName: editor.selection.paragraphFormat.styleName,
    fontSize: editor.selection.characterFormat.fontSize,
    fontColor: editor.selection.characterFormat.fontColor,
    bold: editor.selection.characterFormat.bold
  };
}

function formatOf(editor: DocumentEditor, text: string) {
  const block = flattenSfdt(JSON.parse(editor.serialize())).find(
    (candidate) => candidate.text === text
  );
  if (!block) throw new Error(`no block with text ${JSON.stringify(text)}`);
  return {
    block,
    format: renderedFormat(editor, block.anchor, block.text.length)
  };
}

function anchorOf(editor: DocumentEditor, text: string, ordinal = 0): string {
  const matches = flattenSfdt(JSON.parse(editor.serialize())).filter(
    (candidate) => candidate.text === text
  );
  const match = matches[ordinal];
  if (!match) throw new Error(`no block ${ordinal} with text ${text}`);
  return match.anchor;
}

/** Every table's row shading, keyed by its first header cell. */
function tableShadings(editor: DocumentEditor) {
  const structure = getDocumentInventory(editor as unknown as LiveEditor, {
    scope: 'structure'
  });
  if (!('structure' in structure)) throw new Error('structure read failed');
  return structure.structure.tables.map((table) => {
    const facts = getDocumentInventory(editor as unknown as LiveEditor, {
      scope: 'table_facts',
      tableAnchor: table.anchor
    });
    if (!('table' in facts)) throw new Error('table facts failed');
    return {
      anchor: table.anchor,
      rows: facts.table.rows.map((row) => ({
        isHeader: !!row.isHeader,
        shading: row.appearance?.shading ?? null
      }))
    };
  });
}

/** The table the composed unit owns: the block immediately after its title. */
function composedTableRows(editor: DocumentEditor, titleAnchor: string) {
  const [section, block] = titleAnchor.split(';');
  const wanted = `${section};${Number(block) + 1}`;
  const table = tableShadings(editor).find(
    (candidate) => candidate.anchor === wanted
  );
  if (!table) throw new Error(`no composed table at ${wanted}`);
  return table.rows;
}

const tableSpec = (title: string) => ({
  title,
  blocks: [
    {
      role: 'table' as const,
      table: {
        columnHeaders: ['Item', 'Value'],
        rows: [
          ['Composed one', '9'],
          ['Composed two', '9']
        ]
      }
    }
  ]
});

describe('a composed section inherits from the family it joins', () => {
  it.each([
    // Appended last: the block it displaces is the NEXT programme's heading,
    // two levels shallower - the incident shape.
    ['appended after the last subsection', 'Beta Motor', 0, true],
    // Prepended first: the block it displaces is its own future sibling.
    ['prepended before the first subsection', 'Drivers', 0, false]
  ])(
    '%s takes the subsection family, not the block it displaces',
    (_label, anchorText, ordinal, displacedStartsAnotherFamily) => {
      const editor = makeEditor();
      try {
        // Read the family's look out of the DOCUMENT, before touching it.
        const sibling = formatOf(editor, 'Interests');
        const displaced = formatOf(editor, anchorText);
        expect(displaced.block.level < sibling.block.level).toBe(
          displacedStartsAnotherFamily
        );
        const siblingTable = tableShadings(editor).find(
          (table) => table.rows.length === 4
        );
        if (!siblingTable) throw new Error('fixture lost its sibling table');

        const result = applyDocumentEdits(editor as unknown as LiveEditor, {
          changeSetId: `join-${anchorText}`,
          edits: [
            {
              op: 'insert_section',
              anchor: anchorOf(editor, anchorText, ordinal),
              expect: anchorText,
              position: 'before',
              sectionSpec: tableSpec('Discount')
            }
          ]
        });
        expect(result.results[0]).toMatchObject({
          ok: true,
          op: 'insert_section'
        });

        const composed = formatOf(editor, 'Discount');
        expect(composed.format).toEqual(sibling.format);
        expect(composed.block.level).toBe(sibling.block.level);

        // Row for row, the family's own stripe - header flag included.
        const composedRows = composedTableRows(editor, composed.block.anchor);
        expect(composedRows).toEqual(
          siblingTable.rows.slice(0, composedRows.length)
        );
      } finally {
        destroyEditor(editor);
      }
    }
  );

  it('keeps a section a section when the spec declares its own subsections', () => {
    const editor = makeEditor();
    try {
      const programme = formatOf(editor, 'Beta Motor');
      const midLevel = formatOf(editor, 'Alpha Motor Overview');
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'declares-subsections',
        edits: [
          {
            op: 'insert_section',
            anchor: anchorOf(editor, 'Beta Motor'),
            expect: 'Beta Motor',
            position: 'before',
            sectionSpec: {
              title: 'Gamma Motor',
              blocks: [
                { role: 'paragraph', text: 'Gamma introduction.' },
                {
                  role: 'heading',
                  level: midLevel.block.level,
                  text: 'Gamma Overview'
                }
              ]
            }
          }
        ]
      });
      expect(result.results[0]).toMatchObject({ ok: true });
      // A unit that declares subsections at the sibling family's depth cannot
      // itself sit at that depth, so it resolves to the shallower family.
      const composed = formatOf(editor, 'Gamma Motor');
      expect(composed.format).toEqual(programme.format);
      expect(composed.block.level).toBeLessThan(midLevel.block.level);
      expect(formatOf(editor, 'Gamma Overview').format).toEqual(
        midLevel.format
      );
    } finally {
      destroyEditor(editor);
    }
  });

  it('formats the paragraph it created, not a pre-existing one repeating the title', () => {
    const editor = makeEditor();
    try {
      const original = formatOf(editor, 'Alpha Motor');
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'repeated-title',
        edits: [
          {
            op: 'insert_section',
            anchor: 'before:Beta Motor',
            sectionSpec: {
              title: 'Alpha Motor',
              blocks: [
                { role: 'paragraph', text: 'A second Alpha Motor programme.' }
              ]
            }
          }
        ]
      });
      expect(result.results[0]).toMatchObject({ ok: true });
      const copies = flattenSfdt(JSON.parse(editor.serialize())).filter(
        (block) => block.text === 'Alpha Motor'
      );
      expect(copies).toHaveLength(2);
      // BOTH wear the family's heading format: the original is untouched and
      // the new one was dressed, rather than the format landing on the original
      // and leaving the new paragraph as plain body text.
      for (const copy of copies)
        expect(renderedFormat(editor, copy.anchor, copy.text.length)).toEqual(
          original.format
        );
    } finally {
      destroyEditor(editor);
    }
  });

  it('reproduces a family whose tables carry no banding without inventing one', () => {
    const editor = makeEditor(fixture({ cycle: [undefined] }));
    try {
      const siblingTable = tableShadings(editor).find(
        (table) => table.rows.length === 4
      );
      if (!siblingTable) throw new Error('fixture lost its sibling table');
      expect(
        siblingTable.rows.slice(1).every((row) => row.shading === null)
      ).toBe(true);
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'unbanded-family',
        edits: [
          {
            op: 'insert_section',
            anchor: anchorOf(editor, 'Beta Motor'),
            expect: 'Beta Motor',
            position: 'before',
            sectionSpec: tableSpec('Discount')
          }
        ]
      });
      expect(result.results[0]).toMatchObject({ ok: true });
      const composed = formatOf(editor, 'Discount');
      const composedRows = composedTableRows(editor, composed.block.anchor);
      expect(composedRows).toEqual(
        siblingTable.rows.slice(0, composedRows.length)
      );
    } finally {
      destroyEditor(editor);
    }
  });

  it('reports the family it inherited from and every block it could not dress', () => {
    const editor = makeEditor(fixture({ withTables: false }));
    try {
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'inheritance-report',
        edits: [
          {
            op: 'insert_section',
            anchor: anchorOf(editor, 'Beta Motor'),
            expect: 'Beta Motor',
            position: 'before',
            sectionSpec: tableSpec('Discount')
          }
        ]
      });
      const composed = formatOf(editor, 'Discount');
      const inherited = result.results[0].inherited;
      // The family it joined, named - and the fact that a family with no tables
      // could not dress the composed table, which is otherwise indistinguishable
      // from a successful copy.
      expect(inherited).toMatchObject({
        level: composed.block.level,
        withoutDonor: ['block 1 (table)']
      });
      expect(inherited?.siblings).toBeGreaterThan(1);
      expect(inherited?.donors).toEqual([
        { unit: 'title', from: expect.any(String) }
      ]);
      // The donor it names really is a member of the family it claims.
      const donor = flattenSfdt(JSON.parse(editor.serialize())).find(
        (block) => block.anchor === inherited?.donors[0].from
      );
      expect(donor?.level).toBe(composed.block.level);
    } finally {
      destroyEditor(editor);
    }
  });
});

describe('an inserted row is never a header it was not asked to be', () => {
  it.each([
    ['one header row', 1],
    ['two header rows', 2],
    ['no header row at all', 0]
  ])(
    '%s: a row added below the header band is a data row',
    (_label, headerRows) => {
      const editor = makeEditor({
        sections: [
          {
            blocks: [
              paragraph('Team', 'Title'),
              prose('Team'),
              grid(['Name', 'Role'], [['Dana Reid', 'Executive']], {
                headerRows
              })
            ]
          }
        ],
        styles: STYLES
      });
      try {
        const before = tableShadings(editor)[0];
        const dataRow = before.rows[headerRows];
        expect(dataRow.isHeader).toBe(false);
        // Anchor the insert on the LAST header row - the mistake that produced a
        // second header row in the deliverable.
        const anchorRow = Math.max(headerRows - 1, 0);
        const result = applyDocumentEdits(editor as unknown as LiveEditor, {
          changeSetId: `insert-row-${headerRows}`,
          edits: [
            {
              op: 'insert_row',
              anchor: `${before.anchor};${anchorRow};0;0`,
              count: 1
            }
          ]
        });
        expect(result.results[0]).toMatchObject({ ok: true, op: 'insert_row' });

        const after = tableShadings(editor)[0];
        expect(after.rows).toHaveLength(before.rows.length + 1);
        // The header band is exactly as wide as it was, and the new row carries
        // the data-row look the table already exhibits.
        expect(after.rows.filter((row) => row.isHeader)).toHaveLength(
          headerRows
        );
        expect(after.rows[headerRows]).toEqual(dataRow);
        expect(after.rows.slice(0, headerRows)).toEqual(
          before.rows.slice(0, headerRows)
        );
      } finally {
        destroyEditor(editor);
      }
    }
  );

  it('holds for every op in the registry that brings rows into existence', () => {
    // The guard belongs to the row-creating primitive, not to one caller, so
    // this enumerates the vocabulary rather than naming insert_row.
    const rowCreating = DOCUMENT_EDITOR_CAPABILITIES.filter((capability) =>
      /^insert_row$/.test(capability.op)
    ).map((capability) => capability.op);
    expect(rowCreating).toEqual(['insert_row']);
    for (const op of rowCreating) {
      const editor = makeEditor({
        sections: [
          {
            blocks: [
              paragraph('Team', 'Title'),
              prose('Team'),
              grid(['Name', 'Role'], [['Dana Reid', 'Executive']])
            ]
          }
        ],
        styles: STYLES
      });
      try {
        const before = tableShadings(editor)[0];
        const headerCount = before.rows.filter((row) => row.isHeader).length;
        const result = applyDocumentEdits(editor as unknown as LiveEditor, {
          changeSetId: `registry-${op}`,
          edits: [{ op, anchor: `${before.anchor};0;0;0`, count: 2 }]
        });
        expect(result.results[0]).toMatchObject({ ok: true });
        expect(
          tableShadings(editor)[0].rows.filter((row) => row.isHeader)
        ).toHaveLength(headerCount);
      } finally {
        destroyEditor(editor);
      }
    }
  });
});
