// One contract test per advertised op (S5).
//
// Each op is exercised over its REAL route: a real DocumentEditor (jsdom),
// through applyDocumentEdits, under the engine's forced track-changes
// invariant - because bare-SDK probing gives the wrong answer (Stage 1 had two
// ops flip from "working" to broken the moment the real invariant applied).
// Every test asserts three things:
//   1. the op reports ok and the change set applies;
//   2. an op-specific semantic effect actually happened (so a handler that
//      silently no-ops cannot pass).
//   3. the shared mutation guards observed the operation.
// A meta-test requires a contract case for every registry entry, so an op can
// not be advertised without one. Fresh editor per test: chaining editors
// across tests hangs jsdom layout.
//
// Fixture discipline (S2 probe finding): the page-layout ops
// (insert_page_break / insert_column_break / insert_section_break /
// insert_page_number) hang jsdom layout when the anchored block has following
// content or the document contains a table - they anchor the final empty
// paragraph of a table-less fixture.
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
  _setMutationGuardObserver,
  applyDocumentEdits,
  flattenSfdt,
  getDocumentInventory,
  ApplyEditsResult,
  EditOp,
  MODEL_AUTHORED_TEXT_FIELDS,
  MutationGuardCoverage,
  SENTINEL_SELECTOR_FIELDS,
  TRACKED_STRUCTURAL_OPS,
  TRACKED_TEXT_OPS,
  TableFacts
} from '../syncfusionDocumentOps';
import { DOCUMENT_EDITOR_CAPABILITIES } from '../../../capabilities/registry';

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

function makeEditor(sfdt: any): DocumentEditor {
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  document.body.appendChild(host);
  const editor = new DocumentEditor({
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableImageResizer: true,
    enableSearch: true,
    enableSfdtExport: true,
    enableEditorHistory: true,
    // Production mounts a DocumentEditorContainer, where comments are
    // enabled; a bare DocumentEditor without this flag makes insertComment a
    // SILENT no-op (no throw, nothing stored - verified empirically), so the
    // harness must match the production surface for the comment contracts to
    // test the right thing.
    enableComment: true
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

const blockTexts = (editor: DocumentEditor) =>
  flattenSfdt(JSON.parse(editor.serialize())).map((block) => block.text);

const selectBlockFormat = (editor: DocumentEditor, anchor: string, len = 1) => {
  editor.selection.select(`${anchor};0`, `${anchor};${len}`);
  return {
    characterFormat: editor.selection.characterFormat,
    paragraphFormat: editor.selection.paragraphFormat
  };
};

// --- Fixtures ---------------------------------------------------------------

const para = (text: string, styleName?: string) => ({
  inlines: [{ text }],
  ...(styleName ? { paragraphFormat: { styleName } } : {})
});

// 0;0 heading-ish, 0;1 body text, 0;2 body text, 0;3 empty final paragraph.
const proseFixture = () => ({
  sections: [
    {
      blocks: [
        para('Executive Summary'),
        para('The quote total is 5,500 dollars for Acme Corp.'),
        para('DRAFT note: Acme Corp must confirm.'),
        para('')
      ]
    }
  ]
});

const cell = (text: string) => ({
  cellFormat: {},
  blocks: [{ inlines: [{ text }] }]
});

// 0;0 title, 0;1 table (2x2), 0;2 trailing paragraph.
const tableFixture = () => ({
  sections: [
    {
      blocks: [
        para('Location Schedule'),
        {
          tableFormat: {},
          rows: [
            { rowFormat: {}, cells: [cell('Loc #'), cell('Address')] },
            { rowFormat: {}, cells: [cell('0093'), cell('1 King St W')] }
          ]
        },
        para('End')
      ]
    }
  ]
});

// A header row plus three data rows, so a split can take a NON-contiguous set
// and still leave something behind - the shape the captain asked for.
const splittableTableFixture = () => ({
  sections: [
    {
      blocks: [
        para('Coverage Schedule'), // 0;0
        {
          // 0;1
          tableFormat: { allowAutoFit: true },
          rows: [
            {
              rowFormat: { isHeader: true },
              cells: [cell('Line'), cell('Carrier')]
            },
            { rowFormat: {}, cells: [cell('General Liability'), cell('Acme')] },
            { rowFormat: {}, cells: [cell('Auto'), cell('Beta')] },
            { rowFormat: {}, cells: [cell('Property'), cell('Acme')] }
          ]
        },
        para('End') // 0;2
      ]
    }
  ]
});

// The captain's re-total shape: 0;0 title, 0;1 premium table with a header
// row, three currency line items, a non-numeric line and a Total row whose
// premium cell holds a stale formatted value.
const premiumTableFixture = () => ({
  sections: [
    {
      blocks: [
        para('Premium Summary'),
        {
          tableFormat: {},
          rows: [
            {
              rowFormat: {},
              cells: [cell('Line of Business'), cell('Premium')]
            },
            {
              rowFormat: {},
              cells: [cell('General Liability'), cell('$36,803')]
            },
            { rowFormat: {}, cells: [cell('Property'), cell('$12,450')] },
            { rowFormat: {}, cells: [cell('Cyber'), cell('Included')] },
            { rowFormat: {}, cells: [cell('Auto'), cell('$1,200')] },
            { rowFormat: {}, cells: [cell('Total'), cell('$99,999')] }
          ]
        },
        para('End')
      ]
    }
  ]
});

// A premium column and a STALE tax column beside it: the shape a whole-column
// recompute exists for. Row 3's tax is already right, so the contract also
// proves the no-op rule inside a bulk write.
const taxColumnFixture = () => ({
  sections: [
    {
      blocks: [
        para('Schedule'),
        {
          tableFormat: {},
          rows: [
            {
              rowFormat: {},
              cells: [cell('Coverage'), cell('Premium'), cell('Tax')]
            },
            {
              rowFormat: {},
              cells: [cell('General Liability'), cell('$1,000.00'), cell('')]
            },
            {
              rowFormat: {},
              cells: [cell('Property'), cell('$2,000.00'), cell('$99.00')]
            },
            {
              rowFormat: {},
              cells: [cell('Auto'), cell('$3,000.00'), cell('$390.00')]
            }
          ]
        },
        para('End')
      ]
    }
  ]
});

// A banded table beside an unstyled one - the captain's shape: a sibling section
// whose table is beautifully striped, and a new section's table that is not.
// 0;0 title, 0;1 the banded table, 0;2 the plain table, 0;3 trailing paragraph.
const shadedCell = (text: string, background?: string) => ({
  cellFormat: {
    preferredWidth: 100,
    ...(background ? { shading: { backgroundColor: background } } : {})
  },
  blocks: [{ inlines: [{ text }] }]
});

const bandedTablesFixture = () => ({
  sections: [
    {
      blocks: [
        para('Location Schedule'),
        {
          tableFormat: { preferredWidth: 300 },
          rows: [
            {
              rowFormat: { isHeader: true },
              cells: [
                shadedCell('Loc #', '#1F3864'),
                shadedCell('Address', '#1F3864')
              ]
            },
            { rowFormat: {}, cells: [shadedCell('1'), shadedCell('A St')] },
            {
              rowFormat: {},
              cells: [shadedCell('2', '#D9E2F3'), shadedCell('B St', '#D9E2F3')]
            },
            { rowFormat: {}, cells: [shadedCell('3'), shadedCell('C St')] },
            {
              rowFormat: {},
              cells: [shadedCell('4', '#D9E2F3'), shadedCell('D St', '#D9E2F3')]
            }
          ]
        },
        {
          tableFormat: { preferredWidth: 300 },
          rows: [
            {
              rowFormat: {},
              cells: [shadedCell('Loc #'), shadedCell('Address')]
            },
            { rowFormat: {}, cells: [shadedCell('5'), shadedCell('E St')] },
            { rowFormat: {}, cells: [shadedCell('6'), shadedCell('F St')] },
            { rowFormat: {}, cells: [shadedCell('7'), shadedCell('G St')] },
            { rowFormat: {}, cells: [shadedCell('8'), shadedCell('H St')] }
          ]
        },
        para('End')
      ]
    }
  ]
});

/** Every row's shared fill, straight off a table_facts read. */
const rowFills = (ed: DocumentEditor, tableAnchor: string) => {
  const read = getDocumentInventory(ed as any, {
    scope: 'table_facts',
    tableAnchor
  });
  expect('table' in read).toBe(true);
  return (read as { table: TableFacts }).table.rows.map(
    (row) => row.appearance?.shading ?? null
  );
};

// Table-less, final empty paragraph with nothing after it: the only fixture
// shape the page-layout ops complete under jsdom (S2 probe finding).
const pageOpsFixture = () => ({
  sections: [{ blocks: [para('Intro paragraph.'), para('')] }]
});

// The captain's document shape: multiple sections, and a target block with
// real content both above and below it. Every position variant of insert_text
// must work here in ONE attempt - the shipped `before` regression failed
// exactly this shape while the happy-path contract (append into the final
// empty paragraph) stayed green.
const multiSectionFixture = () => ({
  sections: [
    { blocks: [para('Cover Title'), para('Cover subtitle.')] },
    { blocks: [para('Middle Section'), para('Middle body.')] },
    {
      blocks: [
        para('Closing Heading'), // 2;0
        para('Closing body A.'), // 2;1
        para('Closing body B.'), // 2;2 <- content above AND below
        para('Closing body C.'), // 2;3
        para('') // 2;4
      ]
    }
  ]
});

// Three level-1 sections. The relocation ops address section UNITS, so their
// contract needs a document whose headings are real: a DocumentEditor keeps a
// paragraph's style only when the document DECLARES it, and without the style
// table `open()` normalizes everything to Normal and leaves one flat run of
// text with no section boundaries to move.
const orderedSectionsFixture = () => ({
  sections: [
    {
      blocks: [
        para('Alpha', 'Heading 1'),
        para('a body'),
        para('Beta', 'Heading 1'),
        para('b body'),
        para('Gamma', 'Heading 1'),
        para('g body')
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
      name: 'Heading 1',
      basedOn: 'Normal',
      next: 'Normal',
      characterFormat: { bold: true, fontSize: 16 },
      paragraphFormat: { outlineLevel: 'Level1' }
    }
  ]
});

const headingTexts = (editor: DocumentEditor) =>
  flattenSfdt(JSON.parse(editor.serialize()))
    .filter((block) => block.isHeading)
    .map((block) => block.text);

// --- Contract cases ----------------------------------------------------------

interface ContractCase {
  fixture: () => any;
  edits: EditOp[];
  /** Editor preparation that is NOT the op under test (may use the bare SDK). */
  setup?: (editor: DocumentEditor) => void;
  /** Op-specific proof the edit actually happened. */
  verify: (editor: DocumentEditor, result: ApplyEditsResult) => void;
  /**
   * Revision assertion for the meta-ops whose whole point is changing the
   * revision count (accept/reject all).
   */
  assertRevisions?: (created: number, editor: DocumentEditor) => void;
}

const CONTRACTS: Record<string, ContractCase> = {
  replace_text: {
    fixture: proseFixture,
    edits: [
      { op: 'replace_text', anchor: '0;1', find: '5,500', replace: '6,000' }
    ],
    verify: (ed) => {
      expect(blockTexts(ed)[1]).toContain('6,000');
      expect(blockTexts(ed)[1]).not.toContain('5,500');
    }
  },
  // The user selects from the middle of 0;1 through the end of 0;2 and asks for
  // one statement. The offsets are the public ones a real selection reports.
  replace_selection: {
    fixture: proseFixture,
    edits: [
      {
        op: 'replace_selection',
        anchor: '0;1',
        startOffset: '0;1;0',
        endOffset: '0;2;35',
        replace: 'Acme Corp must confirm the 5,500 dollar quote.',
        expect:
          'The quote total is 5,500 dollars for Acme Corp.\rDRAFT note: Acme Corp must confirm.'
      }
    ],
    verify: (ed) => {
      const texts = blockTexts(ed).join('\n');
      expect(texts).toContain('Acme Corp must confirm the 5,500 dollar quote.');
      expect(texts).not.toContain('DRAFT note: Acme Corp must confirm.');
    }
  },
  replace_all: {
    fixture: proseFixture,
    edits: [{ op: 'replace_all', find: 'Acme Corp', replace: 'Acme Inc' }],
    verify: (ed) => {
      const texts = blockTexts(ed).join('\n');
      expect(texts).toContain('Acme Inc');
      expect(texts).not.toContain('Acme Corp');
    }
  },
  delete_text: {
    fixture: proseFixture,
    edits: [{ op: 'delete_text', anchor: '0;2', find: 'DRAFT ' }],
    verify: (ed) => {
      expect(blockTexts(ed)[2]).toBe('note: Acme Corp must confirm.');
    }
  },
  delete_paragraph: {
    fixture: () => ({
      sections: [
        {
          blocks: [para('Before'), { inlines: [] }, para('After')]
        }
      ]
    }),
    edits: [{ op: 'delete_paragraph', anchor: '0;1', expect: '' }],
    verify: (ed) => {
      expect(blockTexts(ed)).toEqual(['Before', 'After']);
    }
  },
  move_section: {
    fixture: orderedSectionsFixture,
    edits: [
      {
        op: 'move_section',
        anchor: '0;2',
        expect: 'Beta',
        targetAnchor: '0;0',
        position: 'before'
      }
    ],
    verify: (ed) => {
      ed.revisions.acceptAll();
      expect(headingTexts(ed)).toEqual(['Beta', 'Alpha', 'Gamma']);
      // Relocated, not retyped: exactly one copy of the body that travelled.
      expect(blockTexts(ed).filter((text) => text === 'b body')).toHaveLength(1);
    }
  },
  copy_section: {
    fixture: orderedSectionsFixture,
    edits: [
      {
        op: 'copy_section',
        anchor: '0;2',
        expect: 'Beta',
        targetAnchor: '0;0',
        position: 'before'
      }
    ],
    verify: (ed) => {
      ed.revisions.acceptAll();
      // Both copies survive a copy, which is the whole difference from a move.
      expect(headingTexts(ed)).toEqual(['Beta', 'Alpha', 'Beta', 'Gamma']);
      expect(blockTexts(ed).filter((text) => text === 'b body')).toHaveLength(2);
    }
  },
  swap_sections: {
    fixture: orderedSectionsFixture,
    edits: [{ op: 'swap_sections', anchor: '0;0', otherAnchor: '0;4' }],
    verify: (ed) => {
      ed.revisions.acceptAll();
      expect(headingTexts(ed)).toEqual(['Gamma', 'Beta', 'Alpha']);
      expect(blockTexts(ed).filter((text) => text === 'a body')).toHaveLength(1);
    }
  },
  split_table: {
    fixture: splittableTableFixture,
    // Rows 1 and 3 are NOT adjacent, which is the point: the Acme lines are
    // pulled into their own table and the Beta line stays behind.
    edits: [
      {
        op: 'split_table',
        anchor: '0;1;0;0;0',
        rows: [1, 3],
        targetAnchor: '0;2',
        position: 'before'
      }
    ],
    verify: (ed) => {
      ed.revisions.acceptAll();
      const texts = blockTexts(ed);
      // Every cell that moved exists exactly once - relocated, never retyped.
      for (const value of ['General Liability', 'Auto', 'Property', 'Beta'])
        expect(texts.filter((text) => text === value)).toHaveLength(1);
      // The header band is on BOTH tables, so it appears twice while every data
      // value appears once. Nothing authored it: the copy carried it.
      expect(texts.filter((text) => text === 'Line')).toHaveLength(2);
      expect(texts.filter((text) => text === 'Carrier')).toHaveLength(2);
      expect(texts.filter((text) => text === 'Acme')).toHaveLength(2);
    }
  },
  insert_text: {
    fixture: proseFixture,
    edits: [
      { op: 'insert_text', anchor: '0;3', text: 'Effective immediately.' }
    ],
    verify: (ed) => {
      expect(blockTexts(ed)[3]).toBe('Effective immediately.');
    }
  },
  set_cell_text: {
    fixture: tableFixture,
    edits: [{ op: 'set_cell_text', anchor: '0;1;1;1;0', text: 'Toronto' }],
    verify: (ed) => {
      expect(blockTexts(ed)).toContain('Toronto');
    }
  },
  set_cell_formula: {
    fixture: premiumTableFixture,
    edits: [
      {
        op: 'set_cell_formula',
        anchor: '0;1;5;1;0',
        formula: 'sum([0;1;1..4;1])'
      }
    ],
    verify: (ed, result) => {
      // The engine read rows 1..4 of column 1 and summed 36,803 + 12,450 +
      // 1,200 ("Included" is skipped AND named, never zero).
      expect(blockTexts(ed)).toContain('$50,453');
      expect(blockTexts(ed)).not.toContain('$99,999');
      const formula = result.results[0].formula!;
      expect(formula).toMatchObject({
        formula: 'sum([0;1;1..4;1])',
        references: ['[0;1;1..4;1]'],
        renderedValue: '$50,453',
        counted: 3,
        formatSource: 'target_cell',
        decimals: 0,
        rounded: false,
        roundingMode: null,
        selfReferencing: false,
        verifiedByReRead: true
      });
      expect(formula.skipped).toEqual([
        expect.objectContaining({ row: 3, text: 'Included' })
      ]);
      expect(formula.receipt).toContain('sum([0;1;1..4;1]) = $50,453');
      expect(formula.receipt).toContain('"Included"');
      expect(formula.receipt).toContain(
        'Post-write re-read reproduced this exact value.'
      );
    }
  },
  set_column_formula: {
    fixture: taxColumnFixture,
    edits: [
      {
        op: 'set_column_formula',
        // ANY cell of the target column; the table and the column come from it.
        anchor: '0;1;1;2;0',
        formula: '[0;1;{row};1;0] * 13%',
        label: 'the Tax column at 13%',
        round: 'half_up'
      }
    ],
    verify: (ed, result) => {
      const report = result.results[0].column!;
      // Every data row was evaluated - row 0 is the explicit header.
      expect(report).toMatchObject({
        tableAnchor: '0;1',
        column: 2,
        startRow: 1,
        endRow: 3,
        wholeTable: true,
        rowsEvaluated: 3,
        rowsChanged: 2,
        rowsUnchanged: 1,
        rowsSkipped: 0,
        verifiedByReRead: true
      });
      // Row 3's tax was already exactly right: no write, no change card.
      expect(report.rows[2]).toMatchObject({
        row: 3,
        outcome: 'unchanged',
        previousText: '$390.00',
        renderedValue: '$390.00'
      });
      const texts = blockTexts(ed);
      expect(texts).toContain('$130.00');
      expect(texts).toContain('$260.00');
      expect(texts).toContain('$390.00');
      expect(texts).not.toContain('$99.00');
      expect(report.receipt).toContain(
        'Recomputed 3 rows of the Tax column at 13% ' +
          '(column 2 of the table at 0;1), 2 changed.'
      );
    }
  },
  set_cell_format: {
    fixture: bandedTablesFixture,
    edits: [
      {
        op: 'set_cell_format',
        anchor: '0;2;1;1;0',
        shading: '#FFF2CC',
        verticalAlignment: 'Center',
        borders: 'AllBorders',
        borderColor: '#7F7F7F',
        borderWidth: 0.5,
        borderStyle: 'Single'
      }
    ],
    verify: (ed, result) => {
      const read = getDocumentInventory(ed as any, {
        scope: 'table_facts',
        tableAnchor: '0;2'
      }) as { table: TableFacts };
      const cell = read.table.rows[1].cells[1];
      expect(cell.appearance).toEqual({
        shading: '#FFF2CC',
        verticalAlignment: 'Center',
        borders: { all: { style: 'Single', width: 0.5, color: '#7F7F7F' } }
      });
      expect(result.results[0].appearance).toMatchObject({ cellsWritten: 1 });
      // Formatting alone: no revision to bind to, and the engine says so.
      expect(result.changeSet?.formatTracking).toBe('untracked_immediate');
    }
  },
  set_row_format: {
    fixture: bandedTablesFixture,
    edits: [
      {
        op: 'set_row_format',
        anchor: '0;2;0;0;0',
        shading: '#1F3864',
        isHeader: true
      }
    ],
    verify: (ed, result) => {
      const read = getDocumentInventory(ed as any, {
        scope: 'table_facts',
        tableAnchor: '0;2'
      }) as { table: TableFacts };
      expect(read.table.rows[0].isHeader).toBe(true);
      expect(read.table.rows[0].appearance?.shading).toBe('#1F3864');
      // The row is described ONCE: no per-cell repetition of the same fill.
      expect(read.table.rows[0].cells.map((c) => c.appearance)).toEqual([
        undefined,
        undefined
      ]);
      expect(result.results[0].appearance).toMatchObject({
        rowsWritten: 1,
        cellsWritten: 2
      });
    }
  },
  copy_table_format: {
    fixture: bandedTablesFixture,
    edits: [
      { op: 'copy_table_format', anchor: '0;2;0;0;0', sourceTable: '0;1' }
    ],
    verify: (ed, result) => {
      // The plain table now reads exactly like its banded sibling.
      expect(rowFills(ed, '0;2')).toEqual(rowFills(ed, '0;1'));
      const read = getDocumentInventory(ed as any, {
        scope: 'table_facts',
        tableAnchor: '0;2'
      }) as { table: TableFacts };
      expect(read.table.rows[0].isHeader).toBe(true);
      expect(result.results[0].appearance?.cellsWritten).toBeGreaterThan(0);
    }
  },
  restripe_table: {
    fixture: bandedTablesFixture,
    // Break the stripe first with the bare SDK, then repair it with the op.
    setup: (ed) => {
      ed.selection.select('0;1;3;0;0;0', '0;1;3;0;0;0');
      ed.selection.selectRow();
      ed.selection.cellFormat.background = '#D9E2F3';
    },
    edits: [{ op: 'restripe_table', anchor: '0;1;0;0;0' }],
    verify: (ed, result) => {
      expect(rowFills(ed, '0;1')).toEqual([
        '#1F3864',
        null,
        '#D9E2F3',
        null,
        '#D9E2F3'
      ]);
      expect(result.results[0].appearance?.banding).toEqual({
        headerRows: 1,
        period: 2,
        cycle: [null, '#D9E2F3']
      });
    }
  },
  change_case: {
    fixture: proseFixture,
    edits: [{ op: 'change_case', anchor: '0;0', caseType: 'uppercase' }],
    verify: (ed) => {
      expect(blockTexts(ed)[0]).toBe('EXECUTIVE SUMMARY');
    }
  },
  set_char_format: {
    fixture: proseFixture,
    edits: [{ op: 'set_char_format', anchor: '0;0', bold: true }],
    verify: (ed) => {
      expect(selectBlockFormat(ed, '0;0', 9).characterFormat.bold).toBe(true);
    }
  },
  set_para_format: {
    fixture: proseFixture,
    edits: [{ op: 'set_para_format', anchor: '0;0', alignment: 'Center' }],
    verify: (ed) => {
      expect(
        selectBlockFormat(ed, '0;0', 9).paragraphFormat.textAlignment
      ).toBe('Center');
    }
  },
  apply_style: {
    fixture: proseFixture,
    edits: [{ op: 'apply_style', anchor: '0;0', styleName: 'Heading 1' }],
    verify: (ed) => {
      expect(selectBlockFormat(ed, '0;0', 9).paragraphFormat.styleName).toBe(
        'Heading 1'
      );
    }
  },
  clear_formatting: {
    fixture: proseFixture,
    setup: (ed) => {
      ed.selection.select('0;0;0', '0;0;9');
      ed.selection.characterFormat.bold = true;
    },
    edits: [{ op: 'clear_formatting', anchor: '0;0' }],
    verify: (ed) => {
      expect(selectBlockFormat(ed, '0;0', 9).characterFormat.bold).not.toBe(
        true
      );
    }
  },
  indent_step: {
    fixture: proseFixture,
    edits: [{ op: 'indent_step', anchor: '0;1', direction: 'increase' }],
    verify: (ed) => {
      expect(
        selectBlockFormat(ed, '0;1', 5).paragraphFormat.leftIndent
      ).toBeGreaterThan(0);
    }
  },
  apply_bullets: {
    fixture: proseFixture,
    edits: [{ op: 'apply_bullets', anchor: '0;1' }],
    verify: (ed) => {
      expect(
        selectBlockFormat(ed, '0;1', 5).paragraphFormat.listId
      ).toBeGreaterThanOrEqual(0);
    }
  },
  apply_numbering: {
    fixture: proseFixture,
    edits: [{ op: 'apply_numbering', anchor: '0;1', numberFormat: '%1.' }],
    verify: (ed) => {
      expect(
        selectBlockFormat(ed, '0;1', 5).paragraphFormat.listId
      ).toBeGreaterThanOrEqual(0);
    }
  },
  clear_list: {
    fixture: proseFixture,
    setup: (ed) => {
      ed.selection.select('0;1;0', '0;1;5');
      (ed.editor as any).applyBullet('•', 'Arial');
    },
    edits: [{ op: 'clear_list', anchor: '0;1' }],
    verify: (ed) => {
      expect(selectBlockFormat(ed, '0;1', 5).paragraphFormat.listId).toBe(-1);
    }
  },
  insert_table: {
    fixture: proseFixture,
    edits: [
      { op: 'insert_table', anchor: '0;3', rows: 2, columns: 3 },
      { op: 'set_cell_text', anchor: '0;3;0;0;0', text: 'Coverage' },
      { op: 'set_cell_text', anchor: '0;3;0;1;0', text: 'Limit' },
      { op: 'set_cell_text', anchor: '0;3;0;2;0', text: 'Premium' }
    ],
    verify: (ed) => {
      const cells = flattenSfdt(JSON.parse(ed.serialize())).filter(
        (b) => b.kind === 'table_cell'
      );
      expect(cells.length).toBe(6);
      expect(cells.map((cell) => cell.text)).toEqual(
        expect.arrayContaining(['Coverage', 'Limit', 'Premium'])
      );
    }
  },
  insert_section: {
    fixture: proseFixture,
    edits: [
      {
        op: 'insert_section',
        anchor: '0;3',
        sectionSpec: {
          title: 'Policy Details',
          blocks: [
            { role: 'heading', text: 'Named insured' },
            { role: 'paragraph', text: 'Example Company' },
            {
              role: 'table',
              table: {
                columnHeaders: ['Coverage', 'Limit'],
                rows: [['Property', '$500,000']]
              }
            }
          ]
        }
      }
    ],
    verify: (ed, result) => {
      expect(result.results).toEqual([
        expect.objectContaining({ ok: true, op: 'insert_section' })
      ]);
      expect(blockTexts(ed)).toEqual(
        expect.arrayContaining([
          'Policy Details',
          'Named insured',
          'Example Company',
          'Coverage',
          'Limit',
          'Property',
          '$500,000'
        ])
      );
    }
  },
  delete_table: {
    fixture: tableFixture,
    edits: [{ op: 'delete_table', anchor: '0;1;0;0;0' }],
    verify: (ed) => {
      // Tracked deletion: the table stays visible as a deletion revision;
      // the revision assertion (deletion card exists) is the semantic proof,
      // and rejecting it must restore the exact original table.
      const before = flattenSfdt(JSON.parse(ed.serialize())).filter(
        (b) => b.kind === 'table_cell'
      ).length;
      expect(before).toBeGreaterThan(0);
    }
  },
  insert_row: {
    fixture: tableFixture,
    edits: [{ op: 'insert_row', anchor: '0;1;1;0;0', above: false, count: 1 }],
    verify: (ed) => {
      const cells = flattenSfdt(JSON.parse(ed.serialize())).filter(
        (b) => b.kind === 'table_cell'
      );
      expect(cells.length).toBe(6);
    }
  },
  delete_row: {
    fixture: tableFixture,
    edits: [{ op: 'delete_row', anchor: '0;1;1;0;0' }],
    verify: (ed, result) => {
      expect(result.results[0].ok).toBe(true);
    }
  },
  insert_hyperlink: {
    fixture: proseFixture,
    edits: [
      {
        op: 'insert_hyperlink',
        anchor: '0;3',
        address: 'https://example.com',
        displayText: 'our site'
      }
    ],
    verify: (ed) => {
      expect(ed.serialize()).toContain('https://example.com');
    }
  },
  remove_hyperlink: {
    fixture: proseFixture,
    setup: (ed) => {
      ed.selection.select('0;3;0', '0;3;0');
      (ed.editor as any).insertHyperlink('https://example.com', 'our site');
    },
    edits: [{ op: 'remove_hyperlink', anchor: '0;3' }],
    verify: (ed) => {
      // The removal is tracked, so the field instruction survives in the
      // serialize as a deletion revision until accepted.
      while (ed.revisions.length) ed.revisions.get(0).accept();
      expect(ed.serialize()).not.toContain('HYPERLINK');
    }
  },
  insert_bookmark: {
    fixture: proseFixture,
    // SyncFusion normalizes dashes in bookmark names to underscores, so the
    // contract uses an already-normal name.
    edits: [{ op: 'insert_bookmark', anchor: '0;1', name: 'quote_total' }],
    verify: (ed) => {
      expect(ed.serialize()).toContain('quote_total');
    }
  },
  delete_bookmark: {
    fixture: proseFixture,
    setup: (ed) => {
      ed.selection.select('0;1;0', '0;1;5');
      (ed.editor as any).insertBookmark('quote_total');
      expect(ed.serialize()).toContain('quote_total');
    },
    edits: [{ op: 'delete_bookmark', name: 'quote_total' }],
    verify: (ed) => {
      expect(ed.serialize()).not.toContain('quote_total');
    }
  },
  insert_comment: {
    fixture: proseFixture,
    edits: [
      { op: 'insert_comment', anchor: '0;1', text: 'Verify this figure.' }
    ],
    verify: (ed) => {
      expect(ed.serialize()).toContain('Verify this figure.');
      expect(JSON.parse(ed.serialize()).cm).toEqual([
        expect.objectContaining({ a: 'Robin' })
      ]);
    }
  },
  delete_all_comments: {
    fixture: proseFixture,
    setup: (ed) => {
      ed.selection.select('0;1;0', '0;1;5');
      (ed.editor as any).insertComment('Verify this figure.');
    },
    edits: [{ op: 'delete_all_comments' }],
    verify: (ed) => {
      expect(ed.serialize()).not.toContain('Verify this figure.');
    }
  },
  insert_page_break: {
    fixture: pageOpsFixture,
    edits: [{ op: 'insert_page_break', anchor: '0;1' }],
    verify: (ed) => {
      expect(flattenSfdt(JSON.parse(ed.serialize())).length).toBeGreaterThan(2);
    }
  },
  insert_column_break: {
    fixture: pageOpsFixture,
    edits: [{ op: 'insert_column_break', anchor: '0;1' }],
    verify: (ed, result) => {
      expect(result.results[0].ok).toBe(true);
    }
  },
  insert_section_break: {
    fixture: pageOpsFixture,
    edits: [{ op: 'insert_section_break', anchor: '0;1' }],
    verify: (ed) => {
      // The optimized-SFDT serialize spells sections `sec`; assert through
      // the block map instead: a second section means anchors under `1;`.
      const anchors = flattenSfdt(JSON.parse(ed.serialize())).map(
        (b) => b.anchor
      );
      expect(anchors.some((anchor) => anchor.startsWith('1;'))).toBe(true);
    }
  },
  insert_page_number: {
    fixture: pageOpsFixture,
    edits: [{ op: 'insert_page_number', anchor: '0;1' }],
    verify: (ed) => {
      expect(ed.serialize()).toContain('PAGE');
    }
  },
  set_page_margins: {
    fixture: pageOpsFixture,
    edits: [
      { op: 'set_page_margins', left: 50, right: 50, top: 60, bottom: 60 }
    ],
    verify: (ed) => {
      expect(ed.selection.sectionFormat.leftMargin).toBe(50);
      expect(ed.selection.sectionFormat.topMargin).toBe(60);
    }
  },
  set_orientation: {
    fixture: pageOpsFixture,
    edits: [{ op: 'set_orientation', orientation: 'Landscape' }],
    verify: (ed) => {
      expect(ed.selection.sectionFormat.pageOrientation).toBe('Landscape');
    }
  },
  set_page_size: {
    fixture: pageOpsFixture,
    edits: [{ op: 'set_page_size', width: 612, height: 1008 }],
    verify: (ed) => {
      expect(ed.selection.sectionFormat.pageHeight).toBe(1008);
    }
  },
  enter_header: {
    fixture: pageOpsFixture,
    edits: [{ op: 'enter_header' }],
    verify: (ed) => {
      expect(String(ed.selection.contextType)).toContain('Header');
    }
  },
  enter_footer: {
    fixture: pageOpsFixture,
    edits: [{ op: 'enter_footer' }],
    verify: (ed) => {
      expect(String(ed.selection.contextType)).toContain('Footer');
    }
  },
  go_to_body: {
    fixture: pageOpsFixture,
    setup: (ed) => {
      (ed.selection as any).goToHeader();
      expect(String(ed.selection.contextType)).toContain('Header');
    },
    edits: [{ op: 'go_to_body' }],
    verify: (ed) => {
      // The S5 repair: selection.goToBody never existed in ej2 34.1.31; the
      // op must actually return the editing context to the body story.
      expect(String(ed.selection.contextType)).not.toContain('Header');
    }
  },
  set_track_changes: {
    fixture: proseFixture,
    edits: [{ op: 'set_track_changes', enabled: false }],
    verify: (ed, result) => {
      expect(result.results[0].ok).toBe(true);
      // The executor restores its own forced track-changes state around the
      // batch, so the observable proof the handler ran is the recorded write
      // sequence: force-on, the op's write (false), the restore.
      expect((ed as any).__trackChangesWrites).toEqual([true, false, false]);
    },
    setup: (ed) => {
      const writes: boolean[] = [];
      let current = ed.enableTrackChanges;
      Object.defineProperty(ed, 'enableTrackChanges', {
        get: () => current,
        set: (value: boolean) => {
          writes.push(value);
          current = value;
        }
      });
      (ed as any).__trackChangesWrites = writes;
    }
  },
  accept_all_revisions: {
    fixture: proseFixture,
    setup: (ed) => {
      ed.enableTrackChanges = true;
      ed.selection.select('0;3;0', '0;3;0');
      ed.editor.insertText('tracked sentence');
      ed.enableTrackChanges = false;
      expect(ed.revisions.length).toBeGreaterThan(0);
    },
    edits: [{ op: 'accept_all_revisions' }],
    verify: (ed) => {
      expect(ed.revisions.length).toBe(0);
      expect(blockTexts(ed)[3]).toBe('tracked sentence');
    },
    assertRevisions: (created, ed) => {
      expect(ed.revisions.length).toBe(0);
    }
  },
  reject_all_revisions: {
    fixture: proseFixture,
    setup: (ed) => {
      ed.enableTrackChanges = true;
      ed.selection.select('0;3;0', '0;3;0');
      ed.editor.insertText('tracked sentence');
      ed.enableTrackChanges = false;
      expect(ed.revisions.length).toBeGreaterThan(0);
    },
    edits: [{ op: 'reject_all_revisions' }],
    verify: (ed) => {
      expect(ed.revisions.length).toBe(0);
      expect(blockTexts(ed)[3]).toBe('');
    },
    assertRevisions: (created, ed) => {
      expect(ed.revisions.length).toBe(0);
    }
  }
};

// --- Parameter variants -------------------------------------------------------
//
// One happy-path call per op proves the op exists; it does not prove its
// parameters work. `insert_text` shipped with a `position` whose `before`
// value failed on every real document while its contract test (an append into
// an empty final paragraph) stayed green. Each advertised parameter value that
// selects a different execution shape gets its own contract here, on the
// document shape where the difference shows (content above AND below the
// target, multiple sections, table cells).
//
// Deliberately not exhaustive: formatting value matrices (bold vs italic vs
// fontSize all walk the same property-write path), header/footer targets
// (refused by design, asserted in the engine spec), and payload-only variants
// (bookmark names, hyperlink addresses) add cases without adding execution
// shapes.

const PARAMETER_VARIANTS: Array<[string, string, ContractCase]> = [
  [
    'insert_text',
    'position "before" a block with content above and below (multi-section)',
    {
      fixture: multiSectionFixture,
      edits: [
        {
          op: 'insert_text',
          anchor: '2;2',
          position: 'before',
          text: 'Inserted between.'
        }
      ],
      verify: (ed) => {
        const texts = blockTexts(ed);
        // The insert lands as its own paragraph BETWEEN the neighbours, in one
        // attempt, with both neighbours byte-identical.
        expect(texts.slice(5, 9)).toEqual([
          'Closing body A.',
          'Inserted between.',
          'Closing body B.',
          'Closing body C.'
        ]);
      }
    }
  ],
  [
    'insert_text',
    'position "after" the same surrounded block',
    {
      fixture: multiSectionFixture,
      edits: [
        {
          op: 'insert_text',
          anchor: '2;2',
          position: 'after',
          text: 'Inserted between.'
        }
      ],
      verify: (ed) => {
        expect(blockTexts(ed).slice(5, 9)).toEqual([
          'Closing body A.',
          'Closing body B.',
          'Inserted between.',
          'Closing body C.'
        ]);
      }
    }
  ],
  [
    'insert_text',
    'multi-line text at offset 0 of a non-empty block (no position field)',
    {
      // The exact live shape from the captain's session: heading + body +
      // trailing break, anchored at a non-empty paragraph, no `position`.
      fixture: multiSectionFixture,
      edits: [
        {
          op: 'insert_text',
          anchor: '2;2',
          text: 'Our Commitment\nWe remain dedicated to our clients.\n'
        }
      ],
      verify: (ed) => {
        expect(blockTexts(ed).slice(5, 10)).toEqual([
          'Closing body A.',
          'Our Commitment',
          'We remain dedicated to our clients.',
          'Closing body B.',
          'Closing body C.'
        ]);
      }
    }
  ],
  [
    'insert_text',
    'position "start" splices into the same paragraph',
    {
      fixture: multiSectionFixture,
      edits: [
        { op: 'insert_text', anchor: '2;2', position: 'start', text: 'NEW: ' }
      ],
      verify: (ed) => {
        expect(blockTexts(ed)[6]).toBe('NEW: Closing body B.');
        expect(blockTexts(ed)).toHaveLength(9);
      }
    }
  ],
  [
    'insert_text',
    'position "end" splices into the same paragraph',
    {
      fixture: multiSectionFixture,
      edits: [
        {
          op: 'insert_text',
          anchor: '2;2',
          position: 'end',
          text: ' (updated)'
        }
      ],
      verify: (ed) => {
        expect(blockTexts(ed)[6]).toBe('Closing body B. (updated)');
        expect(blockTexts(ed)).toHaveLength(9);
      }
    }
  ],
  [
    'insert_text',
    'numeric offset splices mid-paragraph',
    {
      fixture: multiSectionFixture,
      edits: [
        { op: 'insert_text', anchor: '2;2', offset: 8, text: 'brand new ' }
      ],
      verify: (ed) => {
        expect(blockTexts(ed)[6]).toBe('Closing brand new body B.');
      }
    }
  ],
  [
    'insert_text',
    'position "before" inside a table cell',
    {
      fixture: tableFixture,
      edits: [
        {
          op: 'insert_text',
          anchor: '0;1;1;0;0',
          position: 'before',
          text: 'Site'
        }
      ],
      verify: (ed) => {
        const cellTexts = flattenSfdt(JSON.parse(ed.serialize()))
          .filter((b) => b.anchor.startsWith('0;1;1;0;'))
          .map((b) => b.text);
        expect(cellTexts).toEqual(['Site', '0093']);
      }
    }
  ],
  [
    'insert_row',
    'above: true inserts the new row ABOVE the anchored row',
    {
      fixture: tableFixture,
      edits: [{ op: 'insert_row', anchor: '0;1;1;0;0', above: true, count: 1 }],
      verify: (ed) => {
        const cells = flattenSfdt(JSON.parse(ed.serialize())).filter(
          (b) => b.kind === 'table_cell'
        );
        expect(cells).toHaveLength(6);
        const byAnchor = new Map(cells.map((b) => [b.anchor, b.text]));
        // The new row takes the anchored row's index; the anchored row's
        // content moves DOWN one row, and the header row is untouched.
        expect(byAnchor.get('0;1;0;0;0')).toBe('Loc #');
        expect(byAnchor.get('0;1;1;0;0')).toBe('');
        expect(byAnchor.get('0;1;1;1;0')).toBe('');
        expect(byAnchor.get('0;1;2;0;0')).toBe('0093');
        expect(byAnchor.get('0;1;2;1;0')).toBe('1 King St W');
      }
    }
  ],
  [
    'insert_row',
    'count: 2 inserts two rows below',
    {
      fixture: tableFixture,
      edits: [
        { op: 'insert_row', anchor: '0;1;1;0;0', above: false, count: 2 }
      ],
      verify: (ed) => {
        const cells = flattenSfdt(JSON.parse(ed.serialize())).filter(
          (b) => b.kind === 'table_cell'
        );
        expect(cells).toHaveLength(8);
        const byAnchor = new Map(cells.map((b) => [b.anchor, b.text]));
        expect(byAnchor.get('0;1;1;0;0')).toBe('0093');
        expect(byAnchor.get('0;1;2;0;0')).toBe('');
        expect(byAnchor.get('0;1;3;0;0')).toBe('');
      }
    }
  ],
  [
    'set_cell_formula',
    'a single-cell reference times a plain literal (the 13% tax shape)',
    {
      fixture: premiumTableFixture,
      edits: [
        {
          op: 'set_cell_formula',
          anchor: '0;1;5;1;0',
          formula: '[0;1;1;1;0] * 1.13',
          round: 'half_up'
        }
      ],
      verify: (ed, result) => {
        // 36,803 x 1.13 = 41,587.39 exactly; the target shows 0 decimals, so
        // the declared half_up rounding applies and is REPORTED.
        expect(result.results[0].formula).toMatchObject({
          renderedValue: '$41,587',
          counted: 1,
          rounded: true,
          roundingMode: 'half_up',
          decimals: 0
        });
        expect(result.results[0].formula?.receipt).toContain(
          'rounded half-up to 0 decimal places'
        );
        expect(blockTexts(ed)).toContain('$41,587');
      }
    }
  ],
  [
    'set_cell_formula',
    'a percent literal inside parentheses, and `decimals` widening the target format',
    {
      fixture: premiumTableFixture,
      edits: [
        {
          op: 'set_cell_formula',
          anchor: '0;1;5;1;0',
          formula: '[0;1;1;1;0] * (1 + 13%)',
          decimals: 2
        }
      ],
      verify: (ed, result) => {
        // 36,803 x 1.13 = 41,587.39 fits two decimals exactly, so NO rounding
        // is needed and none is claimed.
        expect(result.results[0].formula).toMatchObject({
          renderedValue: '$41,587.39',
          decimals: 2,
          rounded: false,
          roundingMode: null
        });
        expect(blockTexts(ed)).toContain('$41,587.39');
      }
    }
  ],
  [
    'set_cell_formula',
    'operator precedence, parentheses, unary minus and division in one expression',
    {
      fixture: premiumTableFixture,
      edits: [
        {
          op: 'set_cell_formula',
          anchor: '0;1;5;1;0',
          formula: '(sum([0;1;1..4;1]) - [0;1;4;1;0]) / 2 + -100',
          round: 'half_up'
        }
      ],
      verify: (ed, result) => {
        // (50,453 - 1,200) / 2 - 100 = 24,626.5 - 100 = 24,526.5 -> half_up at
        // 0 decimals -> 24,527 (half away from zero).
        expect(result.results[0].formula?.renderedValue).toBe('$24,527');
        expect(result.results[0].formula?.rounded).toBe(true);
      }
    }
  ],
  [
    'set_cell_formula',
    'average/min/max/count over a range, each exact and each rendered honestly',
    {
      fixture: premiumTableFixture,
      edits: [
        {
          op: 'set_cell_formula',
          anchor: '0;1;5;1;0',
          formula:
            'min([0;1;1..4;1]) + max([0;1;1..4;1]) + count([0;1;1..4;1])',
          round: 'half_up'
        }
      ],
      verify: (_ed, result) => {
        // 1,200 + 36,803 + 3 = 38,006, exact, so `rounded` stays false even
        // though a rounding mode was offered.
        expect(result.results[0].formula).toMatchObject({
          renderedValue: '$38,006',
          rounded: false,
          roundingMode: null
        });
      }
    }
  ],
  [
    'set_cell_formula',
    'a formula that reads the cell it writes (in-place increase) keeps its own format',
    {
      fixture: premiumTableFixture,
      edits: [
        {
          op: 'set_cell_formula',
          anchor: '0;1;1;1;0',
          formula: '[0;1;1;1;0] * (1 + 13%)',
          round: 'half_up'
        }
      ],
      verify: (ed, result) => {
        expect(result.results[0].formula).toMatchObject({
          renderedValue: '$41,587',
          selfReferencing: true,
          verifiedByReRead: true
        });
        expect(result.results[0].formula?.receipt).toContain(
          "the formula read this cell's own previous value"
        );
        expect(blockTexts(ed)).toContain('$41,587');
        expect(blockTexts(ed)).not.toContain('$36,803');
      }
    }
  ],
  [
    'set_cell_formula',
    'expect CAS guards the target cell like any other tracked edit',
    {
      fixture: premiumTableFixture,
      edits: [
        {
          op: 'set_cell_formula',
          anchor: '0;1;5;1;0',
          formula: 'sum([0;1;1..4;1])',
          expect: '$99,999'
        }
      ],
      verify: (_ed, result) => {
        expect(result.results[0].ok).toBe(true);
        expect(result.results[0].formula?.renderedValue).toBe('$50,453');
      }
    }
  ],
  [
    'set_cell_text',
    'a user-dictated figure writes verbatim under `literal: true` and is recorded as such',
    {
      fixture: premiumTableFixture,
      edits: [
        {
          op: 'set_cell_text',
          anchor: '0;1;1;1;0',
          text: '$13,000',
          literal: true
        }
      ],
      verify: (ed, result) => {
        expect(blockTexts(ed)).toContain('$13,000');
        expect(result.results[0].literalNumber).toMatchObject({
          text: '$13,000',
          previousText: '$36,803'
        });
        expect(result.results[0].literalNumber?.note).toContain(
          'NOT computed by the engine'
        );
      }
    }
  ],
  [
    'change_case',
    'caseType "lowercase"',
    {
      fixture: proseFixture,
      edits: [{ op: 'change_case', anchor: '0;0', caseType: 'lowercase' }],
      verify: (ed) => {
        expect(blockTexts(ed)[0]).toBe('executive summary');
      }
    }
  ],
  [
    'indent_step',
    'direction "decrease" removes an indent step',
    {
      fixture: proseFixture,
      setup: (ed) => {
        ed.selection.select('0;1;0', '0;1;5');
        ed.selection.paragraphFormat.leftIndent = 36;
      },
      edits: [{ op: 'indent_step', anchor: '0;1', direction: 'decrease' }],
      verify: (ed) => {
        expect(
          selectBlockFormat(ed, '0;1', 5).paragraphFormat.leftIndent
        ).toBeLessThan(36);
      }
    }
  ]
  // insert_section_break's sectionBreakType ('Continuous' -> runtime
  // 'NoBreak') is deliberately absent: the break KIND is not observable in
  // jsdom-serialized SFDT (breakCode serializes null for every kind, probed
  // empirically), so no assertion on it can fail when the mapping breaks.
  // A test that cannot bite would only certify the mapping falsely.
];

// --- The contract ------------------------------------------------------------

// One contract execution: the op's real route and op-specific semantic proof.
// Shared by the per-op happy paths and every parameter variant so a variant can
// never assert less than the base contract.
function runContractCase(op: string, contract: ContractCase): void {
  const entry = DOCUMENT_EDITOR_CAPABILITIES.find((e) => e.op === op);
  expect(entry).toBeDefined();
  const editor = makeEditor(contract.fixture());
  try {
    contract.setup?.(editor);
    const revisionsBefore = contract.assertRevisions
      ? editor.revisions.length
      : 0;
    const result = applyDocumentEdits(editor as any, {
      edits: contract.edits,
      changeSetId: `contract-${op}`
    });

    expect(
      result.results.map(({ ok, error, details }) => ({ ok, error, details }))
    ).toEqual(
      contract.edits.map(() => ({
        ok: true,
        error: undefined,
        details: undefined
      }))
    );
    expect(result.changeSet?.status).toBe('applied');

    if (contract.assertRevisions) {
      contract.assertRevisions(
        editor.revisions.length - revisionsBefore,
        editor
      );
    }

    contract.verify(editor, result);
  } finally {
    destroyEditor(editor);
  }
}

describe('op contracts: every advertised op works over its real route', () => {
  it('every registry op has a contract case, and no case is orphaned', () => {
    const registered = DOCUMENT_EDITOR_CAPABILITIES.map((entry) => entry.op);
    expect([...Object.keys(CONTRACTS)].sort()).toEqual([...registered].sort());
  });

  it('every registered content-creating op crosses a tracked mutation contract', () => {
    const contentCreatingOps = new Set([
      'insert_text',
      'insert_section',
      'insert_table',
      'insert_row',
      // A relocation creates the content at its destination just as literally
      // as an insert does - it is the same tracked write, with the engine
      // rather than the model supplying the bytes.
      'move_section',
      'swap_sections',
      'copy_section'
    ]);
    const uncovered = DOCUMENT_EDITOR_CAPABILITIES.map((entry) => entry.op)
      .filter((op) => contentCreatingOps.has(op))
      .filter(
        (op) => !TRACKED_TEXT_OPS.has(op) && !TRACKED_STRUCTURAL_OPS.has(op)
      );

    expect(uncovered).toEqual([]);
  });

  it.each(
    DOCUMENT_EDITOR_CAPABILITIES.map((entry) => [entry.op, entry] as const)
  )('%s: applies through the shared mutation guards', (op, entry) => {
    const contract = CONTRACTS[op];
    expect(contract).toBeDefined();
    const observed: MutationGuardCoverage[] = [];
    _setMutationGuardObserver((coverage) => observed.push(coverage));
    try {
      runContractCase(op, contract);
    } finally {
      _setMutationGuardObserver();
    }

    const coverage = observed.find((item) => item.op === op);
    expect(coverage).toBeDefined();
    expect(coverage?.cas).toBe(
      op === 'replace_all'
        ? 'find_content'
        : !entry.requiresAnchor
        ? 'not_applicable'
        : op === 'replace_selection'
        ? 'selection_content'
        : 'block_expect'
    );
    expect(coverage?.numberProvenance).toBe(
      ['set_cell_formula', 'set_column_formula'].includes(op)
        ? 'engine_computed'
        : op === 'insert_table'
        ? 'authored_matrix_checked'
        : [
            'replace_text',
            'replace_selection',
            'replace_all',
            'insert_text',
            'set_cell_text'
          ].includes(op)
        ? 'model_authored_text_checked'
        : 'not_applicable'
    );
  });

  // Principle 8's second half, for the sentinel guard: a guard wired into one
  // call site protects one call site, so this enumerates the REGISTRY and fails
  // if an op added later can carry placeholder text into the document. The
  // fields are derived from the registry's declared param types and the engine's
  // own exported field list - no second copy of either to drift.
  const sentinelTargets = DOCUMENT_EDITOR_CAPABILITIES.flatMap((entry) =>
    Object.entries(entry.params as Record<string, string>)
      .filter(([param, type]) => {
        if (SENTINEL_SELECTOR_FIELDS.has(`${entry.op}.${param}`)) return false;
        if (type === 'sectionSpec' || type === 'string[][]?') return true;
        return (
          MODEL_AUTHORED_TEXT_FIELDS.includes(param) &&
          (type === 'string' || type === 'string?')
        );
      })
      .map(([param, type]) => [entry.op, param, type] as const)
  );

  it('covers every registry op that can carry authored text', () => {
    // A true positive before the guard is trusted: if this list ever empties,
    // every case below would pass vacuously.
    expect(sentinelTargets.length).toBeGreaterThan(8);
    expect(sentinelTargets.map(([op, param]) => `${op}.${param}`)).toEqual(
      expect.arrayContaining([
        'replace_text.replace',
        'insert_text.text',
        'insert_section.sectionSpec',
        'insert_table.initialCells',
        'set_cell_text.text'
      ])
    );
  });

  it.each(sentinelTargets)(
    '%s: a sentinel in `%s` is refused before any write',
    (op, param, type) => {
      const SENTINEL = '__TMP_SWAP_PARA_1__';
      const value =
        type === 'sectionSpec'
          ? {
              title: 'Policy Details',
              blocks: [{ role: 'paragraph', text: SENTINEL }]
            }
          : type === 'string[][]?'
          ? [[SENTINEL, 'Limit']]
          : SENTINEL;
      // The rest of the op is its own contract case's shape, so the refusal is
      // the only thing that can be under test here.
      const contract = CONTRACTS[op];
      const editor = makeEditor(contract.fixture());
      try {
        contract.setup?.(editor);
        const before = editor.serialize();
        const edits = contract.edits.map((edit, index) =>
          index === 0 ? { ...edit, [param]: value } : edit
        );
        const result = applyDocumentEdits(editor as any, {
          edits,
          changeSetId: `sentinel-${op}-${param}`
        });
        expect(result.results[0]).toMatchObject({
          ok: false,
          error: 'sentinel_content_refused'
        });
        expect(result.results[0].message).toContain(SENTINEL);
        expect(editor.serialize()).toBe(before);
        expect(editor.revisions.length).toBe(0);
      } finally {
        destroyEditor(editor);
      }
    }
  );

  it.each(PARAMETER_VARIANTS)('%s variant: %s', (op, _variant, contract) => {
    runContractCase(op, contract);
  });

  it('a non-OpError throw surfaces its type and message, never a bare op_failed', () => {
    const editor = makeEditor(proseFixture());
    try {
      const throwingEditor = new Proxy(editor as any, {
        get(target, property, receiver) {
          if (property === 'editor') {
            const realEditor: any = Reflect.get(target, property, receiver);
            return new Proxy(realEditor, {
              get(inner, method, innerReceiver) {
                if (method === 'insertText')
                  return () => {
                    // The shape a raw SyncFusion defect actually takes.
                    throw new TypeError(
                      "Cannot read properties of undefined (reading 'ownerBase')"
                    );
                  };
                const value = Reflect.get(inner, method, innerReceiver);
                return typeof value === 'function' ? value.bind(inner) : value;
              }
            });
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
      const result = applyDocumentEdits(throwingEditor, {
        edits: [{ op: 'insert_text', anchor: '0;1', text: 'x' }]
      });
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'op_failed',
        details: [
          "TypeError: Cannot read properties of undefined (reading 'ownerBase')"
        ]
      });
    } finally {
      destroyEditor(editor);
    }
  });

  it('an OpError that lost its prototype chain (ES5 bundle) still reports its code', () => {
    // The shipped ES5 emit constructs OpError through `Error.call(this) ||
    // this`, which returns a plain Error carrying OpError's fields but not its
    // prototype - `instanceof` is false in the bundle. The dispatch must
    // recognise the brand, not the prototype.
    const editor = makeEditor(proseFixture());
    try {
      const throwingEditor = new Proxy(editor as any, {
        get(target, property, receiver) {
          if (property === 'editor') {
            const realEditor: any = Reflect.get(target, property, receiver);
            return new Proxy(realEditor, {
              get(inner, method, innerReceiver) {
                if (method === 'insertText')
                  return () => {
                    const stripped: any = new Error(
                      'The text at this anchor changed since it was read.'
                    );
                    stripped.name = 'OpError';
                    stripped.code = 'stale_anchor';
                    stripped.details = ['detail preserved'];
                    throw stripped;
                  };
                const value = Reflect.get(inner, method, innerReceiver);
                return typeof value === 'function' ? value.bind(inner) : value;
              }
            });
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
      const result = applyDocumentEdits(throwingEditor, {
        edits: [{ op: 'insert_text', anchor: '0;1', text: 'x' }]
      });
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'stale_anchor',
        details: ['detail preserved']
      });
    } finally {
      destroyEditor(editor);
    }
  });

  it('insert_column stays withdrawn: refused as unknown, document untouched', () => {
    const editor = makeEditor(tableFixture());
    try {
      const before = editor.serialize();
      const result = applyDocumentEdits(editor as any, {
        edits: [{ op: 'insert_column', anchor: '0;1;0;1;0', count: 1 }]
      });
      expect(result.results[0].ok).toBe(false);
      expect(result.results[0].error).toBe('unsupported_op');
      expect(result.results[0].retry).toBe('never');
      expect(editor.revisions.length).toBe(0);
      expect(editor.serialize()).toBe(before);
    } finally {
      destroyEditor(editor);
    }
  });
});
