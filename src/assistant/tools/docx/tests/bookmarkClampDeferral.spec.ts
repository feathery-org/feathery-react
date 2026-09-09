// The bookmark clamp law: a clamp is an irreversible live-widget move, so it
// may only happen once the whole change set is committed-safe - at ACCEPT of
// the deleting card, never at pending time. Every path where the change set
// dies (a late refusal, an engine apply failure, a group rollback, a reject,
// an undo) must leave the bookmark exactly where it was.
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
import { rebindRevisionGroups } from '../../../../utils/documentEditorPrimitives';
import {
  attachBindings,
  AttachedBindings
} from '../../../../elements/components/DocxEditor/bindings/attachBindings';
import { SyncfusionEditorLike } from '../../../../elements/components/DocxEditor/bindings/editorAdapter';
import {
  buildBandedProposalFixture,
  SPANNING_BOOKMARK
} from '../../../../elements/components/DocxEditor/bindings/core/tests/fixtures/bandedProposalFixture';

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

/** Which physical rows of the table at `blockIndex` hold `name`'s start and end */
function bookmarkRows(
  editor: DocumentEditor,
  blockIndex: number,
  name: string
): { start?: number; end?: number } {
  const wrapper = parsed(editor).sections[0].blocks[blockIndex];
  const table = wrapper.rows
    ? wrapper
    : wrapper.blocks.find((b: any) => b.rows);
  const span: { start?: number; end?: number } = {};
  table.rows.forEach((row: any, index: number) => {
    const text = JSON.stringify(row);
    if (text.includes(`"bookmarkType":0,"name":"${name}"`)) span.start = index;
    if (text.includes(`"bookmarkType":1,"name":"${name}"`)) span.end = index;
  });
  return span;
}

const okCodes = (result: any) =>
  result.results.map((entry: any) => (entry.ok ? 'ok' : entry.error));
const detailsOf = (result: any): string[] =>
  result.results.flatMap((entry: any) => entry.details ?? []);
const tableRowCount = (editor: DocumentEditor, blockIndex: number): number => {
  const wrapper = parsed(editor).sections[0].blocks[blockIndex];
  const table = wrapper.rows
    ? wrapper
    : wrapper.blocks.find((b: any) => b.rows);
  return table.rows.length;
};

const para = (text: string, marks: unknown[] = []) => ({
  paragraphFormat: {},
  characterFormat: {},
  inlines: [
    ...marks.filter((m: any) => m.bookmarkType === 0),
    { characterFormat: {}, text },
    ...marks.filter((m: any) => m.bookmarkType === 1)
  ]
});
const cell = (text: string, marks: unknown[] = []) => ({
  blocks: [para(text, marks)],
  cellFormat: { columnSpan: 1, rowSpan: 1 }
});
const START = { bookmarkType: 0, name: 'terms' };
const END = { bookmarkType: 1, name: 'terms' };
const unboundDocument = () => ({
  sections: [
    {
      sectionFormat: { pageWidth: 612, pageHeight: 792 },
      blocks: [
        para('Terms'),
        {
          rows: [
            { rowFormat: {}, cells: [cell('Clause'), cell('Text')] },
            { rowFormat: {}, cells: [cell('1'), cell('First')] },
            { rowFormat: {}, cells: [cell('2', [START]), cell('Second')] },
            { rowFormat: {}, cells: [cell('3'), cell('Third')] },
            { rowFormat: {}, cells: [cell('4'), cell('Fourth', [END])] },
            { rowFormat: {}, cells: [cell('5'), cell('Fifth')] }
          ]
        },
        para('After')
      ]
    }
  ]
});

describe('the clamp waits for the change set to be committed-safe (editor route)', () => {
  it('a split refused late, at target resolution, leaves the bookmark untouched', () => {
    const editor = open(unboundDocument());
    try {
      // A targetAnchor inside a table cell is refused by the target
      // resolution itself - the refusal fires at resolveRelocationTarget,
      // AFTER the point where the clamp used to run.
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'clamp-late-refusal',
        edits: [
          {
            op: 'split_table',
            anchor: '0;1;0;0;0',
            splitAtRow: 4,
            targetAnchor: '0;1;1;0;0',
            position: 'before',
            group: 'g'
          } as any
        ]
      }) as any;
      expect(okCodes(result)).toEqual(['relocation_anchor_in_table']);
      expect(bookmarkRows(editor, 1, 'terms')).toEqual({ start: 2, end: 4 });
      // "Nothing was written" holds even through a full accept sweep.
      editor.revisions.acceptAll();
      expect(bookmarkRows(editor, 1, 'terms')).toEqual({ start: 2, end: 4 });
    } finally {
      close(editor);
    }
  });

  it('rejecting the delete card restores the rows AND the bookmark span', () => {
    const editor = open(unboundDocument());
    try {
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'clamp-reject',
        edits: [
          {
            op: 'delete_row',
            anchor: '0;1;4;0;0',
            rows: [4],
            group: 'g'
          } as any
        ]
      }) as any;
      expect(okCodes(result)).toEqual(['ok']);
      expect(detailsOf(result)).toContain(
        'bookmark "terms" clamped to rows 2-3'
      );
      editor.revisions.rejectAll();
      expect(tableRowCount(editor, 1)).toBe(6);
      expect(bookmarkRows(editor, 1, 'terms')).toEqual({ start: 2, end: 4 });
    } finally {
      close(editor);
    }
  });

  it('a group rolled back after a clamping delete leaves the bookmark untouched', () => {
    const editor = open(unboundDocument());
    try {
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'clamp-group-rollback',
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
      expect(tableRowCount(editor, 1)).toBe(6);
      expect(bookmarkRows(editor, 1, 'terms')).toEqual({ start: 2, end: 4 });
    } finally {
      close(editor);
    }
  });

  it('undo after the batch leaves the bookmark untouched', () => {
    const editor = open(unboundDocument());
    try {
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'clamp-undo',
        edits: [
          {
            op: 'delete_row',
            anchor: '0;1;4;0;0',
            rows: [4],
            group: 'g'
          } as any
        ]
      }) as any;
      expect(okCodes(result)).toEqual(['ok']);
      editor.editorHistory.undo();
      expect(editor.revisions.length).toBe(0);
      expect(bookmarkRows(editor, 1, 'terms')).toEqual({ start: 2, end: 4 });
    } finally {
      close(editor);
    }
  });

  it('accept after a reload still clamps: the intent survives on the revision tag', () => {
    const editor = open(unboundDocument());
    try {
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'clamp-reload',
        edits: [
          {
            op: 'delete_row',
            anchor: '0;1;4;0;0',
            rows: [4],
            group: 'g'
          } as any
        ]
      }) as any;
      expect(okCodes(result)).toEqual(['ok']);
      const bytes = editor.serialize();
      const reloaded = open(JSON.parse(bytes));
      try {
        expect(
          rebindRevisionGroups(reloaded as unknown as LiveEditor)
        ).toBeGreaterThan(0);
        reloaded.revisions.acceptAll();
        expect(bookmarkRows(reloaded, 1, 'terms')).toEqual({
          start: 2,
          end: 3
        });
      } finally {
        close(reloaded);
      }
    } finally {
      close(editor);
    }
  });
});

describe('the clamp waits for the engine transaction to land (bound route)', () => {
  it('an engine apply failure leaves the bookmark untouched', () => {
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
      expect(bookmarkRows(editor, block, SPANNING_BOOKMARK)).toEqual({
        start: 2,
        end: 4
      });
      // A native refusal mid-command: the structural adapter reports the
      // mutation failed and the controller emits `native-mutation-failed`.
      module.deleteRow = () => {
        throw new Error('deleteRow refused (sabotaged for this spec)');
      };
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'clamp-engine-failure',
        edits: [
          {
            op: 'delete_row',
            anchor: `0;${block};4;0;0`,
            rows: [4],
            group: 'g'
          } as any
        ]
      }) as any;
      module.deleteRow = originalDeleteRow;
      expect(okCodes(result)).toEqual(['engine_apply_failed']);
      expect(result.changeSet.status).toBe('failed');
      expect(bookmarkRows(editor, block, SPANNING_BOOKMARK)).toEqual({
        start: 2,
        end: 4
      });
      editor.revisions.acceptAll();
      expect(bookmarkRows(editor, block, SPANNING_BOOKMARK)).toEqual({
        start: 2,
        end: 4
      });
    } finally {
      module.deleteRow = originalDeleteRow;
      attached.dispose();
      close(editor);
    }
  });

  it('rejecting the bound delete card restores rows and bookmark alike', () => {
    const editor = open(buildBandedProposalFixture());
    const attached: AttachedBindings = attachBindings(
      editor as unknown as SyncfusionEditorLike,
      { convertTokensOnOpen: false }
    );
    try {
      attached.controller.flush({ mode: 'self-heal' });
      const block = parsed(editor).sections[0].blocks.findIndex(
        (b: any) => b.contentControlProperties?.tag === '[[table=schedule]]'
      );
      const rowsBefore = tableRowCount(editor, block);
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'clamp-bound-reject',
        edits: [
          {
            op: 'delete_row',
            anchor: `0;${block};4;0;0`,
            rows: [4],
            group: 'g'
          } as any
        ]
      }) as any;
      expect(okCodes(result)).toEqual(['ok']);
      editor.revisions.rejectAll();
      expect(tableRowCount(editor, block)).toBe(rowsBefore);
      expect(bookmarkRows(editor, block, SPANNING_BOOKMARK)).toEqual({
        start: 2,
        end: 4
      });
    } finally {
      attached.dispose();
      close(editor);
    }
  });
});
