// The document-tail table deletion SyncFusion cannot accept.
//
// One SyncFusion defect: accepting a tracked deletion that removes the LAST ROW
// of a table which is the LAST BLOCK of the document throws part-way through
// `acceptAll`, after the deletion has already applied. The card looks applied and
// the review pane breaks when the user accepts it.
//
// `delete_row` shipped with no guard for this, so it answered `ok: true` over a
// document whose accept would crash. `move_section` / `swap_sections` already
// refused the RANGE-shaped instance of the same rule. They are two shapes of one
// precondition, so one predicate owns the fact and each op only decides whether
// its own extent covers it - which is what this spec pins, in both directions.
//
// Nothing here asserts an exception MESSAGE from SyncFusion: the same
// precondition surfaces as 'paragraph' (inside deleteTrackedContents),
// 'childWidgets' (inside retrieveCharacterFormat) or 'nextSplitWidget' depending
// only on where the selection sits, so a test keyed to one of them would pass
// while the defect moved. The property asserted is that accept THROWS without the
// guard and that the guard refuses before writing anything.
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
  flattenSfdt,
  EditOp,
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

const para = (text: string, styleName?: string) => ({
  inlines: text ? [{ text }] : [],
  ...(styleName ? { paragraphFormat: { styleName } } : {})
});

const cell = (text: string) => ({
  cellFormat: {},
  blocks: [{ inlines: [{ text }] }]
});

const headingStyles = () => [
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
    paragraphFormat: { outlineLevel: 'Level1', beforeSpacing: 12 }
  }
];

/** `dataRows` data rows under one header row. */
const scheduleTable = (dataRows: number) => ({
  tableFormat: { allowAutoFit: true },
  rows: [
    { rowFormat: { isHeader: true }, cells: [cell('Line'), cell('Carrier')] },
    ...Array.from({ length: dataRows }, (_, index) => ({
      rowFormat: {},
      cells: [cell(`Line ${index}`), cell(`Carrier ${index}`)]
    }))
  ]
});

/** The table is the document's LAST block - the precondition's shape. */
const tailTableFixture = (dataRows = 3) => ({
  sections: [
    {
      blocks: [
        para('Coverage Schedule', 'Heading 1'), // 0;0
        para('All lines are listed below.'), // 0;1
        scheduleTable(dataRows) // 0;2 - the document tail
      ]
    }
  ],
  styles: headingStyles()
});

/** The same document with a paragraph after the table: the control. */
const trailingParagraphFixture = (dataRows = 3) => ({
  sections: [
    {
      blocks: [
        para('Coverage Schedule', 'Heading 1'), // 0;0
        para('All lines are listed below.'), // 0;1
        scheduleTable(dataRows), // 0;2
        para('Confirm by Friday.') // 0;3
      ]
    }
  ],
  styles: headingStyles()
});

/** Two sections, the second ending with the document-tail table. */
const twoSectionTailFixture = () => ({
  sections: [
    {
      blocks: [
        para('About Hilb Group', 'Heading 1'), // 0;0
        para('Hilb Group is a national broker.'), // 0;1
        para('Coverage Schedule', 'Heading 1'), // 0;2
        para('All lines are listed below.'), // 0;3
        scheduleTable(3) // 0;4 - the document tail
      ]
    }
  ],
  styles: headingStyles()
});

const apply = (editor: DocumentEditor, edits: EditOp[], changeSetId: string) =>
  applyDocumentEdits(editor as unknown as LiveEditor, { edits, changeSetId });

/** Every row of every table, as "anchor[cell|cell]", in document order. */
const rowTexts = (editor: DocumentEditor): string[] => {
  const byRow = new Map<string, string[]>();
  for (const block of flattenSfdt(JSON.parse(editor.serialize())).filter(
    (candidate) => candidate.kind === 'table_cell'
  )) {
    const key = block.anchor.split(';').slice(0, 3).join(';');
    byRow.set(key, [...(byRow.get(key) ?? []), block.text]);
  }
  return Array.from(byRow.entries()).map(
    ([key, texts]) => `${key}[${texts.join('|')}]`
  );
};

/** The last data row index of the table at `tableAnchor`. */
const lastRowOf = (editor: DocumentEditor, tableAnchor: string): number =>
  Math.max(
    ...flattenSfdt(JSON.parse(editor.serialize()))
      .filter((block) => block.anchor.startsWith(`${tableAnchor};`))
      .map((block) => Number(block.anchor.split(';')[2]))
  );

describe('the SyncFusion defect this guard exists for', () => {
  // Principle 9: a guard that has never been shown to prevent a real failure is
  // not a proven guard. This drives SyncFusion directly, bypassing the engine, so
  // the crash the refusal replaces is demonstrated rather than asserted.
  it('accepting the deletion of a tail table last row throws, untracked by any guard', () => {
    const editor = makeEditor(tailTableFixture());
    try {
      editor.enableTrackChanges = true;
      const row = lastRowOf(editor, '0;2');
      editor.selection.select(`0;2;${row};0;0;0`, `0;2;${row};0;0;0`);
      (editor.editor as any).deleteRow();
      expect(() => editor.revisions.acceptAll()).toThrow();
    } finally {
      destroyEditor(editor);
    }
  });

  it('the same deletion REJECTS cleanly, so the defect is accept-only', () => {
    const editor = makeEditor(tailTableFixture());
    try {
      const before = editor.serialize();
      editor.enableTrackChanges = true;
      const row = lastRowOf(editor, '0;2');
      editor.selection.select(`0;2;${row};0;0;0`, `0;2;${row};0;0;0`);
      (editor.editor as any).deleteRow();
      editor.revisions.rejectAll();
      editor.enableTrackChanges = false;
      expect(editor.serialize()).toBe(before);
    } finally {
      destroyEditor(editor);
    }
  });

  // The two controls that make the precondition precise rather than "tables at
  // the end of documents are risky". Both of these must keep working, or the
  // guard is too broad and ordinary edits start getting refused.
  it.each([
    [
      'a NON-last row of the tail table',
      tailTableFixture,
      (editor: DocumentEditor) => `0;2;1;0;0`
    ],
    [
      'the last row of a table a paragraph follows',
      trailingParagraphFixture,
      (editor: DocumentEditor) => `0;2;${lastRowOf(editor, '0;2')};0;0`
    ]
  ])('accepts cleanly when the deletion is %s', (_label, fixture, anchorOf) => {
    const editor = makeEditor(fixture());
    try {
      const result = apply(
        editor,
        [{ op: 'delete_row', anchor: anchorOf(editor) }],
        'tail-control'
      );
      expect(result.results[0]).toMatchObject({ ok: true, op: 'delete_row' });
      expect(() => editor.revisions.acceptAll()).not.toThrow();
      expect(editor.revisions.length).toBe(0);
    } finally {
      destroyEditor(editor);
    }
  });
});

describe('delete_row refuses the deletion instead of applying it', () => {
  it('refuses, names the reason, and writes nothing', () => {
    const editor = makeEditor(tailTableFixture());
    try {
      const before = editor.serialize();
      const row = lastRowOf(editor, '0;2');
      const result = apply(
        editor,
        [{ op: 'delete_row', anchor: `0;2;${row};0;0` }],
        'tail-refusal'
      );
      expect(result.results[0]).toMatchObject({
        ok: false,
        op: 'delete_row',
        error: 'document_tail_table_last_row'
      });
      // The reason has to reach the model, or it retries the same edit.
      expect(result.results[0].message).toContain('last row');
      expect(result.results[0].message).toContain('last block of the document');
      // Nothing written, nothing to accept, nothing to reject.
      expect(editor.serialize()).toBe(before);
      expect(editor.revisions.length).toBe(0);
      expect(rowTexts(editor)).toHaveLength(row + 1);
    } finally {
      destroyEditor(editor);
    }
  });

  // The refusal is derived from the table's real last row, not from a literal
  // index: a table of a different height must be refused at ITS last row and
  // allowed one row above it.
  it.each([1, 4])(
    'derives the refused row from the table itself (%i data rows)',
    (dataRows) => {
      const editor = makeEditor(tailTableFixture(dataRows));
      try {
        const last = lastRowOf(editor, '0;2');
        expect(last).toBe(dataRows);
        const refused = apply(
          editor,
          [{ op: 'delete_row', anchor: `0;2;${last};0;0` }],
          `tail-derived-${dataRows}`
        );
        expect(refused.results[0]).toMatchObject({
          ok: false,
          error: 'document_tail_table_last_row'
        });
        const allowed = apply(
          editor,
          [{ op: 'delete_row', anchor: `0;2;${last - 1};0;0` }],
          `tail-derived-ok-${dataRows}`
        );
        expect(allowed.results[0]).toMatchObject({ ok: true });
        expect(() => editor.revisions.acceptAll()).not.toThrow();
      } finally {
        destroyEditor(editor);
      }
    }
  );
});

describe('one rule, two shapes', () => {
  // The range-shaped instance, still refused - a relocation whose source range
  // ends the document at a table necessarily covers that table's last row, which
  // is why it is the same rule rather than a neighbouring one.
  it('move_section still refuses the document-tail section', () => {
    const editor = makeEditor(twoSectionTailFixture());
    try {
      const before = editor.serialize();
      const result = apply(
        editor,
        [{ op: 'move_section', anchor: '0;2', targetAnchor: '0;0' }],
        'tail-range'
      );
      expect(result.results[0]).toMatchObject({
        ok: false,
        op: 'move_section',
        error: 'relocation_document_tail_table'
      });
      expect(editor.serialize()).toBe(before);
      expect(editor.revisions.length).toBe(0);
    } finally {
      destroyEditor(editor);
    }
  });

  // Both refusals must name the same underlying SyncFusion reason, or the two
  // shapes have drifted into two explanations of one defect - the failure this
  // consolidation exists to prevent.
  it('both refusals give the same reason for the same defect', () => {
    const rowEditor = makeEditor(tailTableFixture());
    const rangeEditor = makeEditor(twoSectionTailFixture());
    try {
      const rowRefusal = apply(
        rowEditor,
        [
          {
            op: 'delete_row',
            anchor: `0;2;${lastRowOf(rowEditor, '0;2')};0;0`
          }
        ],
        'reason-row'
      ).results[0];
      const rangeRefusal = apply(
        rangeEditor,
        [{ op: 'move_section', anchor: '0;2', targetAnchor: '0;0' }],
        'reason-range'
      ).results[0];
      const reason =
        'SyncFusion cannot accept the revision that would produce: `acceptAll` throws part-way through, after the deletion has already applied';
      expect(rowRefusal.message).toContain(reason);
      expect(rangeRefusal.message).toContain(reason);
      // And each still names its OWN remedy, because the remedies differ.
      expect(String(rowRefusal.details?.join(' '))).toContain('Any other row');
      expect(String(rangeRefusal.details?.join(' '))).toContain('targetAnchor');
    } finally {
      destroyEditor(rowEditor);
      destroyEditor(rangeEditor);
    }
  });

  // A document that does not end with a table has no such row at all, so neither
  // shape may refuse anything in it.
  it('neither shape refuses when the document does not end with a table', () => {
    const editor = makeEditor(trailingParagraphFixture());
    try {
      const result = apply(
        editor,
        [{ op: 'delete_row', anchor: `0;2;${lastRowOf(editor, '0;2')};0;0` }],
        'no-tail-table'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
    } finally {
      destroyEditor(editor);
    }
  });
});
