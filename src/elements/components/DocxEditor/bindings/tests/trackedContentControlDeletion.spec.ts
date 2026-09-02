// Tracked row deletion keeps content-control identity, on the real 34.1.31
// engine, through Delete Row and the keyboard's Delete alike
import 'jest-canvas-mock';
import { readFileSync } from 'fs';
import { DocumentEditor, Editor } from '@syncfusion/ej2-documenteditor';
import { installTrackedContentControlDeletion } from '../../../../../utils/documentEditorPrimitives';
import { EJ2_VERSION } from '../../constants';
import { buildCostsFixture } from '../core/tests/fixtures/costsFixture';
import { scanBindings } from '../core/sfdtAdapter';
import { SfdtDocument } from '../core/sfdtTypes';
import { isContentControlAttached } from '../editorAdapter';
import {
  cellText,
  collectTags,
  destroyRealDocumentEditor,
  docWith,
  makeRealDocumentEditor,
  row,
  table
} from './realEditorHarness';

const R1 = /row=r-1/;
const QUANTITY_R1 = '[[name=quantity|type=integer|row=r-1]]';

const parsed = (editor: DocumentEditor) =>
  JSON.parse(editor.serialize()) as SfdtDocument;
const tagsOf = (editor: DocumentEditor) => collectTags(parsed(editor));
const r1TagsOf = (editor: DocumentEditor) =>
  tagsOf(editor).filter((tag) => R1.test(tag));
const textIn = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(textIn).join('');
  if (!node || typeof node !== 'object') return '';
  const record = node as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  return textIn(record.inlines ?? record.blocks ?? []);
};
/** Every row of the costs table as cell texts, pending-deleted rows included */
const costsRowTextsOf = (editor: DocumentEditor): string[][] => {
  const wrapper = parsed(editor).sections[0].blocks.find((block) =>
    JSON.stringify(block).includes('table=costs')
  ) as any;
  const rows = wrapper.rows ?? wrapper.blocks[0].rows;
  return rows.map((r: any) => r.cells.map((c: any) => textIn(c.blocks)));
};
const acceptedRowIdsOf = (editor: DocumentEditor) =>
  (scanBindings(parsed(editor)).tables.get('costs')?.rows ?? []).map(
    (r) => r.rowId
  );
const R1_TEXTS = ['Design work', '12', '$150.00', '$1,800.00'];

const liveRevisions = (editor: DocumentEditor) =>
  Array.from({ length: editor.revisions.length }, (_, index) =>
    editor.revisions.get(index)
  );
const acceptAll = (editor: DocumentEditor) => {
  for (const revision of liveRevisions(editor).reverse()) revision.accept();
};
const rejectAll = (editor: DocumentEditor) => {
  for (const revision of liveRevisions(editor).reverse()) revision.reject();
};

const undoDepth = (editor: DocumentEditor): number => {
  const history = (editor as any).editorHistoryModule ?? editor.editorHistory;
  const stack = history.undoStackIn ?? history.undoStack;
  return Array.isArray(stack) ? stack.length : 0;
};

function controlForTag(editor: DocumentEditor, tag: string) {
  const collection = (editor as any).documentHelper.contentControlCollection;
  return collection.find(
    (candidate: any) =>
      candidate?.contentControlProperties?.tag === tag &&
      isContentControlAttached(candidate)
  );
}

type EntryPath = 'deleteRow' | 'delete';

/** Both ways a user removes a row, driven as the UI drives them */
function deleteSelectedRow(editor: DocumentEditor, path: EntryPath): void {
  const module = (editor as any).editorModule;
  if (path === 'deleteRow') {
    module.deleteRow();
    return;
  }
  editor.selection.selectRow();
  module.delete();
}

function deleteBoundRowTracked(editor: DocumentEditor, path: EntryPath): void {
  const control = controlForTag(editor, QUANTITY_R1);
  if (!control) throw new Error('no control for r-1 quantity');
  editor.enableTrackChanges = true;
  try {
    (editor as any).selection.selectContentControl(control);
    deleteSelectedRow(editor, path);
  } finally {
    editor.enableTrackChanges = false;
  }
}

function openBoundEditor(options: { patched: boolean }): DocumentEditor {
  const editor = makeRealDocumentEditor(buildCostsFixture());
  if (options.patched) installTrackedContentControlDeletion(editor as any);
  return editor;
}

const ENTRY_PATHS: EntryPath[] = ['deleteRow', 'delete'];

describe('the defect, pinned: the stock SDK strips content controls on a tracked row delete', () => {
  // Negative control, a green run here means the SDK changed underneath us
  it.each(ENTRY_PATHS)(
    'without the override, %s loses every r-1 tag and reject does not bring them back',
    (path) => {
      const editor = openBoundEditor({ patched: false });
      try {
        const before = r1TagsOf(editor);
        expect(before).toHaveLength(4);

        deleteBoundRowTracked(editor, path);
        expect(r1TagsOf(editor)).toHaveLength(0);

        rejectAll(editor);
        expect(r1TagsOf(editor)).toHaveLength(0);
        expect(acceptedRowIdsOf(editor)).toEqual(['r-2']);
      } finally {
        destroyRealDocumentEditor(editor);
      }
    }
  );
});

describe('with the override, a tracked row delete keeps binding identity', () => {
  describe.each(ENTRY_PATHS)('via %s', (path) => {
    it('marks the row deleted with every tag still serialized, and reject restores text and tags', () => {
      const editor = openBoundEditor({ patched: true });
      try {
        const tagsBefore = tagsOf(editor);
        const rowsBefore = costsRowTextsOf(editor);
        const undoBefore = undoDepth(editor);
        expect(rowsBefore[1]).toEqual(R1_TEXTS);
        expect(acceptedRowIdsOf(editor)).toEqual(['r-1', 'r-2']);

        deleteBoundRowTracked(editor, path);

        // Pending: the deletion is a revision, nothing has left the document
        expect(editor.revisions.length).toBeGreaterThan(0);
        expect(tagsOf(editor)).toEqual(tagsBefore);
        expect(costsRowTextsOf(editor)).toEqual(rowsBefore);
        // A row deletion leaves the control to its row's revision, a content deletion marks it
        expect(controlForTag(editor, QUANTITY_R1).revisionLength).toBe(
          path === 'deleteRow' ? 0 : 1
        );

        rejectAll(editor);
        expect(editor.revisions.length).toBe(0);
        expect(tagsOf(editor)).toEqual(tagsBefore);
        expect(costsRowTextsOf(editor)).toEqual(rowsBefore);
        expect(acceptedRowIdsOf(editor)).toEqual(['r-1', 'r-2']);
        expect(controlForTag(editor, QUANTITY_R1).revisionLength).toBe(0);

        // Undo is one step and lands on the untouched document
        expect(undoDepth(editor)).toBeGreaterThan(undoBefore);
      } finally {
        destroyRealDocumentEditor(editor);
      }
    });

    // Delete Row removes the row, the keyboard's Delete clears its cells and keeps it
    it('accept completes the deletion, leaving every other tag untouched', () => {
      const editor = openBoundEditor({ patched: true });
      try {
        const tagsBefore = tagsOf(editor);
        const rowsBefore = costsRowTextsOf(editor);
        deleteBoundRowTracked(editor, path);

        acceptAll(editor);

        expect(editor.revisions.length).toBe(0);
        expect(acceptedRowIdsOf(editor)).toEqual(['r-2']);
        expect(r1TagsOf(editor)).toHaveLength(0);
        expect(tagsOf(editor)).toEqual(
          tagsBefore.filter((tag) => !R1.test(tag))
        );
        expect(costsRowTextsOf(editor)).toEqual(
          path === 'deleteRow'
            ? [rowsBefore[0], ...rowsBefore.slice(2)]
            : [rowsBefore[0], ['', '', '', ''], ...rowsBefore.slice(2)]
        );
      } finally {
        destroyRealDocumentEditor(editor);
      }
    });

    it('undo after the tracked delete restores the document, tags included', () => {
      const editor = openBoundEditor({ patched: true });
      try {
        const tagsBefore = tagsOf(editor);
        const rowsBefore = costsRowTextsOf(editor);
        deleteBoundRowTracked(editor, path);

        editor.editorHistory.undo();

        expect(editor.revisions.length).toBe(0);
        expect(tagsOf(editor)).toEqual(tagsBefore);
        expect(costsRowTextsOf(editor)).toEqual(rowsBefore);
      } finally {
        destroyRealDocumentEditor(editor);
      }
    });
  });

  it('installs once per editor', () => {
    const editor = openBoundEditor({ patched: true });
    try {
      const patched = (editor as any).editorModule.handleDeleteTracking;
      installTrackedContentControlDeletion(editor as any);
      expect((editor as any).editorModule.handleDeleteTracking).toBe(patched);
    } finally {
      destroyRealDocumentEditor(editor);
    }
  });
});

describe('unbound rows are untouched by the override', () => {
  const plainRows = (editor: DocumentEditor) =>
    (parsed(editor).sections[0].blocks[0] as any).rows.map((r: any) =>
      r.cells.map((c: any) =>
        c.blocks[0].inlines.map((i: any) => i.text).join('')
      )
    );

  function deletePlainRowTracked(editor: DocumentEditor, path: EntryPath) {
    editor.enableTrackChanges = true;
    try {
      editor.selection.select('0;0;1;0;0;0', '0;0;1;0;0;0');
      deleteSelectedRow(editor, path);
    } finally {
      editor.enableTrackChanges = false;
    }
  }

  const fixture = () =>
    docWith(
      table(
        row(cellText('Item'), cellText('Qty')),
        row(cellText('Design'), cellText('12')),
        row(cellText('Build'), cellText('30'))
      )
    );

  it.each(ENTRY_PATHS)(
    'via %s: pending keeps the row, reject restores it, accept removes it, same as stock',
    (path) => {
      const outcomes = [false, true].map((patched) => {
        const editor = makeRealDocumentEditor(fixture());
        if (patched) installTrackedContentControlDeletion(editor as any);
        try {
          deletePlainRowTracked(editor, path);
          const pending = plainRows(editor);
          const pendingRevisions = editor.revisions.length;
          rejectAll(editor);
          const rejected = plainRows(editor);
          deletePlainRowTracked(editor, path);
          acceptAll(editor);
          const accepted = plainRows(editor);
          return { pending, pendingRevisions, rejected, accepted };
        } finally {
          destroyRealDocumentEditor(editor);
        }
      });
      expect(outcomes[1]).toEqual(outcomes[0]);
      expect(outcomes[1].pendingRevisions).toBeGreaterThan(0);
      expect(outcomes[1].pending).toEqual([
        ['Item', 'Qty'],
        ['Design', '12'],
        ['Build', '30']
      ]);
      expect(outcomes[1].rejected).toEqual(outcomes[1].pending);
      expect(outcomes[1].accepted).toEqual(
        path === 'deleteRow'
          ? [
              ['Item', 'Qty'],
              ['Build', '30']
            ]
          : [
              ['Item', 'Qty'],
              ['', ''],
              ['Build', '30']
            ]
      );
    }
  );
});

describe('version tripwire', () => {
  // An SDK upgrade must re-read handleDeleteTracking before this pin moves
  it('pins the SDK and the shape of the method being overridden', () => {
    expect(EJ2_VERSION).toBe('34.1.31');
    expect(require('@syncfusion/ej2-documenteditor/package.json').version).toBe(
      '34.1.31'
    );
    const editorSource = readFileSync(
      require.resolve(
        '@syncfusion/ej2-documenteditor/src/document-editor/implementation/editor/editor.js'
      ),
      'utf8'
    );
    const start = editorSource.indexOf(
      'Editor.prototype.handleDeleteTracking = function'
    );
    expect(start).toBeGreaterThan(-1);
    const source = editorSource.slice(start, start + 3000);
    expect(source).toContain(
      'if (isTrackingEnabled && elementBox instanceof BookmarkElementBox) {'
    );
    expect(source).toContain(
      'elementBox.line.children.splice(elementBox.indexInOwner, 1);'
    );
    for (const helper of [
      'canHandleDeletion',
      'skipTracking',
      'checkToCombineRevisionsInSides',
      'insertRevision',
      'updateLastDeletedRevision'
    ])
      expect(typeof (Editor.prototype as any)[helper]).toBe('function');
  });
});
