// Two rollback behaviors that had no spec: a native-mutation failure inside
// the binding-engine transaction fails the WHOLE change set and rolls back the
// editor-routed revisions that already landed (engine_apply_failed), and a
// group rollback that cannot restore withdrawn pending-insertion rows says so
// (group_rollback_incomplete).
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
import { applyDocumentEdits, LiveEditor } from '../syncfusionDocumentOps';
import {
  attachBindings,
  AttachedBindings
} from '../../../../elements/components/DocxEditor/bindings/attachBindings';
import { SyncfusionEditorLike } from '../../../../elements/components/DocxEditor/bindings/editorAdapter';
import { buildBandedProposalFixture } from '../../../../elements/components/DocxEditor/bindings/core/tests/fixtures/bandedProposalFixture';

DocumentEditor.Inject(
  Editor,
  Selection,
  SfdtExport,
  EditorHistory,
  ImageResizer,
  Search
);
if (!window.crypto?.getRandomValues)
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: (a: Uint8Array) => require('crypto').randomFillSync(a)
    }
  });
if (!(window.SVGElement.prototype as any).getBBox)
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);

function open(sfdt: unknown): DocumentEditor {
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
    documentEditorSettings: { optimizeSfdt: false }
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(sfdt));
  return editor;
}
function close(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

const parsed = (editor: DocumentEditor) => JSON.parse(editor.serialize());
const okCodes = (result: any) =>
  result.results.map((entry: any) => (entry.ok ? 'ok' : entry.error));

const para = (text: string) => ({
  paragraphFormat: {},
  characterFormat: {},
  inlines: [{ characterFormat: {}, text }]
});
const cell = (text: string) => ({
  blocks: [para(text)],
  cellFormat: { columnSpan: 1, rowSpan: 1 }
});
const plainDocument = () => ({
  sections: [
    {
      sectionFormat: { pageWidth: 612, pageHeight: 792 },
      blocks: [
        para('Terms'),
        {
          rows: [
            { rowFormat: {}, cells: [cell('Clause'), cell('Text')] },
            { rowFormat: {}, cells: [cell('1'), cell('First')] },
            { rowFormat: {}, cells: [cell('2'), cell('Second')] },
            { rowFormat: {}, cells: [cell('3'), cell('Third')] }
          ]
        },
        para('After')
      ]
    }
  ]
});
const tableRows = (editor: DocumentEditor, blockIndex: number): any[] => {
  const wrapper = parsed(editor).sections[0].blocks[blockIndex];
  const table = wrapper.rows
    ? wrapper
    : wrapper.blocks.find((b: any) => b.rows);
  return table.rows;
};

describe('engine_apply_failed: a native-mutation failure fails the change set', () => {
  it('rolls back the editor-routed revisions that already landed', () => {
    const editor = open(buildBandedProposalFixture());
    const attached: AttachedBindings = attachBindings(
      editor as unknown as SyncfusionEditorLike,
      { convertTokensOnOpen: false }
    );
    const module = (editor as any).editorModule;
    const originalDeleteRow = module.deleteRow;
    try {
      attached.controller.flush({ mode: 'self-heal' });
      const block = parsed(editor).sections[0].blocks.findIndex(
        (b: any) => b.contentControlProperties?.tag === '[[table=schedule]]'
      );
      const textBefore = JSON.stringify(parsed(editor).sections[0].blocks[0]);
      const rowsBefore = tableRows(editor, block).length;
      // A native refusal mid-command: the structural adapter reports the
      // mutation failed and the controller emits `native-mutation-failed`.
      module.deleteRow = () => {
        throw new Error('deleteRow refused (sabotaged for this spec)');
      };
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'engine-fail-rollback',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;0',
            find: 'Commercial Insurance Proposal',
            replace: 'Amended Insurance Proposal',
            group: 'g'
          } as any,
          {
            op: 'delete_row',
            anchor: `0;${block};4;0;0`,
            rows: [4],
            group: 'g'
          } as any
        ]
      }) as any;
      module.deleteRow = originalDeleteRow;
      expect(okCodes(result)).toEqual([
        'change_set_failed',
        'engine_apply_failed'
      ]);
      expect(result.changeSet.status).toBe('failed');
      expect(
        result.warnings.some((warning: string) =>
          warning.startsWith('binding_engine_transaction_failed')
        )
      ).toBe(true);
      // The editor-routed replace landed first and must be rolled back whole:
      // no pending revisions left, and the paragraph reads as it did.
      expect(editor.revisions.length).toBe(0);
      const blocks = parsed(editor).sections[0].blocks;
      expect(JSON.stringify(blocks[0])).toBe(textBefore);
      expect(JSON.stringify(blocks[0])).toContain(
        'Commercial Insurance Proposal'
      );
      // And the bound table kept every row: nothing was deleted.
      expect(tableRows(editor, block)).toHaveLength(rowsBefore);
    } finally {
      module.deleteRow = originalDeleteRow;
      attached.dispose();
      close(editor);
    }
  });
});

describe('group_rollback_incomplete: withdrawn rows cannot come back', () => {
  it('is warned when a rolled-back group withdrew pending-insertion rows', () => {
    const editor = open(plainDocument());
    try {
      // Change set 1 leaves a PENDING inserted row at index 4.
      const seeded = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'seed-insert',
        edits: [
          { op: 'insert_row', anchor: '0;1;3;0;0', group: 'seed' } as any
        ]
      }) as any;
      expect(okCodes(seeded)).toEqual(['ok']);
      expect(tableRows(editor, 1)).toHaveLength(5);

      // Change set 2, one group: deleting the pending row WITHDRAWS it (a
      // physical removal, not a tracked mark), then a sibling fails, so the
      // group rolls back - and the withdrawal cannot be restored.
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'withdraw-then-fail',
        edits: [
          {
            op: 'delete_row',
            anchor: '0;1;4;0;0',
            rows: [4],
            group: 'g'
          } as any,
          {
            op: 'delete_row',
            anchor: '0;1;0;0;0',
            rows: [99],
            group: 'g'
          } as any
        ]
      }) as any;
      expect(okCodes(result)).toEqual(['change_set_failed', 'row_not_found']);
      const warning = result.warnings.find((entry: string) =>
        entry.startsWith('group_rollback_incomplete')
      );
      expect(warning).toBeDefined();
      expect(warning).toContain(
        '1 row(s) removed from a pending insertion cannot be restored'
      );
      // The withdrawn row is gone for good; the original rows all survive.
      expect(tableRows(editor, 1)).toHaveLength(4);
    } finally {
      close(editor);
    }
  });
});
