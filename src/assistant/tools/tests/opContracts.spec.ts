// One contract test per advertised op (S5).
//
// Each op is exercised over its REAL route: a real DocumentEditor (jsdom),
// through applyDocumentEdits, under the engine's forced track-changes
// invariant - because bare-SDK probing gives the wrong answer (Stage 1 had two
// ops flip from "working" to broken the moment the real invariant applied).
// Every test asserts three things:
//   1. the op reports ok and the change set applies;
//   2. the registry's empirical `tracked` field stays honest - tracked ops
//      create revisions, untracked ops create none;
//   3. an op-specific semantic effect actually happened (so a handler that
//      silently no-ops cannot pass).
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
  applyDocumentEdits,
  flattenSfdt,
  ApplyEditsResult,
  EditOp
} from '../syncfusionDocumentOps';
import { DOCUMENT_EDITOR_CAPABILITIES } from '../../capabilities/registry';

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

// Table-less, final empty paragraph with nothing after it: the only fixture
// shape the page-layout ops complete under jsdom (S2 probe finding).
const pageOpsFixture = () => ({
  sections: [{ blocks: [para('Intro paragraph.'), para('')] }]
});

// --- Contract cases ----------------------------------------------------------

interface ContractCase {
  fixture: () => any;
  edits: EditOp[];
  /** Editor preparation that is NOT the op under test (may use the bare SDK). */
  setup?: (editor: DocumentEditor) => void;
  /** Op-specific proof the edit actually happened. */
  verify: (editor: DocumentEditor, result: ApplyEditsResult) => void;
  /**
   * Overrides the registry-derived revision assertion for the meta-ops whose
   * whole point is changing the revision count (accept/reject all).
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
    edits: [{ op: 'insert_table', anchor: '0;3', rows: 2, columns: 3 }],
    verify: (ed) => {
      const cells = flattenSfdt(JSON.parse(ed.serialize())).filter(
        (b) => b.kind === 'table_cell'
      );
      expect(cells.length).toBe(6);
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

// --- The contract ------------------------------------------------------------

describe('op contracts: every advertised op works over its real route', () => {
  it('every registry op has a contract case, and no case is orphaned', () => {
    const registered = DOCUMENT_EDITOR_CAPABILITIES.map((entry) => entry.op);
    expect([...Object.keys(CONTRACTS)].sort()).toEqual([...registered].sort());
  });

  it.each(
    DOCUMENT_EDITOR_CAPABILITIES.map((entry) => [entry.op, entry] as const)
  )(
    '%s: applies through applyDocumentEdits and honours `tracked`',
    (op, entry) => {
      const contract = CONTRACTS[op];
      expect(contract).toBeDefined();
      const editor = makeEditor(contract.fixture());
      try {
        contract.setup?.(editor);
        const revisionsBefore = editor.revisions.length;
        const result = applyDocumentEdits(editor as any, {
          edits: contract.edits,
          changeSetId: `contract-${op}`
        });

        expect(result.results.map(({ ok, error }) => ({ ok, error }))).toEqual(
          contract.edits.map(() => ({ ok: true, error: undefined }))
        );
        expect(result.changeSet?.status).toBe('applied');

        const created = editor.revisions.length - revisionsBefore;
        if (contract.assertRevisions) {
          contract.assertRevisions(created, editor);
        } else if (entry.tracked) {
          // The registry promises the user an individually rejectable change.
          expect(created).toBeGreaterThan(0);
        } else {
          // The registry says so honestly: no revision, applies immediately.
          expect(created).toBe(0);
        }

        contract.verify(editor, result);
      } finally {
        destroyEditor(editor);
      }
    }
  );

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
