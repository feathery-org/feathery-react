// Structural row/table ops aimed at a CONFIGURED table route through the binding
// engine: the engine owns the row identity, so inserting or deleting rows behind
// its back would leave a table whose markers no longer describe it.
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
  LiveEditor
} from '../syncfusionDocumentOps';
import { buildCostsFixture } from '../../../../elements/components/DocxEditor/bindings/core/tests/fixtures/costsFixture';
import {
  attachBindings,
  AttachedBindings
} from '../../../../elements/components/DocxEditor/bindings/attachBindings';
import { SyncfusionEditorLike } from '../../../../elements/components/DocxEditor/bindings/editorAdapter';
import { scanBindings } from '../../../../elements/components/DocxEditor/bindings/core/sfdtAdapter';

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

function makeEditor(): DocumentEditor {
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
  editor.open(JSON.stringify(buildCostsFixture()));
  return editor;
}

function destroy(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

const parsed = (editor: DocumentEditor) => JSON.parse(editor.serialize());

const textAt = (editor: DocumentEditor, anchor: string): string | undefined =>
  flattenSfdt(parsed(editor)).find((block) => block.anchor === anchor)?.text;

const indexOf = (editor: DocumentEditor) => scanBindings(parsed(editor));

const rowIdsOf = (editor: DocumentEditor, tableId: string): string[] =>
  (indexOf(editor).tables.get(tableId)?.rows ?? []).map((row) => row.rowId);

const rejectAllRevisions = (editor: DocumentEditor): void => {
  const pending = Array.from({ length: editor.revisions.length }, (_, index) =>
    editor.revisions.get(index)
  );
  for (const revision of pending.reverse()) revision.reject();
};

// Row 2 is the last DATA row of the costs table; rows 3-5 are the summary band.
const LAST_DATA_CELL = '0;2;2;0;0';
const FIRST_DATA_CELL = '0;2;1;0;0';

describe('structural ops on a bound table', () => {
  let editor: DocumentEditor;
  let attached: AttachedBindings;

  beforeEach(() => {
    editor = makeEditor();
    attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: false
    });
  });

  afterEach(() => {
    attached.dispose();
    destroy(editor);
  });

  it('routes insert_row through the engine and mints a bound line item', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'insert_row', anchor: LAST_DATA_CELL }]
    });

    expect(result.results[0]).toMatchObject({
      ok: true,
      op: 'insert_row',
      route: 'engine'
    });
    const rowIds = rowIdsOf(editor, 'costs');
    expect(rowIds.slice(0, 2)).toEqual(['r-1', 'r-2']);
    expect(rowIds).toHaveLength(3);
    // A new line item, not a copy: the inputs are empty and its row formula
    // evaluates over them rather than over the row it was cloned from.
    expect(textAt(editor, '0;2;3;0;0')).toBe('');
    expect(textAt(editor, '0;2;3;3;0')).toBe('$0.00');
    expect(textAt(editor, '0;2;4;1;0')).toBe('$7,800.00');
  });

  it('creates a rejectable revision for a bound row insert', () => {
    const before = editor.serialize();
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'bound-row-review',
      edits: [{ op: 'insert_row', anchor: LAST_DATA_CELL }]
    });

    expect(result.results[0]).toMatchObject({ ok: true, route: 'engine' });
    expect(editor.revisions.length).toBeGreaterThan(0);
    expect(rowIdsOf(editor, 'costs')).toHaveLength(3);

    rejectAllRevisions(editor);
    attached.controller.flush({ mode: 'self-heal' });

    expect(editor.revisions.length).toBe(0);
    expect(rowIdsOf(editor, 'costs')).toEqual(['r-1', 'r-2']);
    expect(editor.serialize()).toBe(before);
  });

  it('fills a row inserted earlier in the same change set', () => {
    // The new row's anchor does not exist until the engine transaction runs, and
    // engine plans are deferred to the end of the batch - so the preflight hands
    // these writes over with no resolved target and they must still find the row
    // the insert is about to create, never the row that holds index 3 today.
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        { op: 'insert_row', anchor: LAST_DATA_CELL },
        { op: 'set_cell_text', anchor: '0;2;3;0;0', text: 'Hosting' },
        {
          op: 'set_cell_text',
          anchor: '0;2;3;1;0',
          text: '4',
          literal: true
        },
        {
          op: 'set_cell_text',
          anchor: '0;2;3;2;0',
          text: '$25.00',
          literal: true
        }
      ]
    });
    expect(result.results.map((entry) => entry.ok)).toEqual([
      true,
      true,
      true,
      true
    ]);
    expect(result.results.map((entry) => entry.route)).toEqual([
      'engine',
      'engine',
      'engine',
      'engine'
    ]);
    expect(textAt(editor, '0;2;3;0;0')).toBe('Hosting');
    expect(textAt(editor, '0;2;3;1;0')).toBe('4');
    expect(textAt(editor, '0;2;3;2;0')).toBe('$25.00');
    expect(textAt(editor, '0;2;3;3;0')).toBe('$100.00');
    // Subtotal, tax and both downstream prose totals follow.
    expect(textAt(editor, '0;2;4;1;0')).toBe('$7,900.00');
    expect(textAt(editor, '0;4')).toBe(
      'Amount due for Website relaunch: $7,900.00.'
    );
    // The pre-existing data rows are untouched; nothing was written into the row
    // that held index 3 before the insert.
    expect(textAt(editor, '0;2;1;0;0')).toBe('Design work');
    expect(textAt(editor, '0;2;2;0;0')).toBe('Development');
  });

  it('inserts a bound row after another engine write in the same batch', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'set_cell_text',
          anchor: '0;2;1;1;0',
          text: '13',
          literal: true
        },
        { op: 'insert_row', anchor: LAST_DATA_CELL }
      ]
    });

    expect(result.results).toMatchObject([
      { ok: true, route: 'engine' },
      { ok: true, route: 'engine', op: 'insert_row' }
    ]);
    expect(rowIdsOf(editor, 'costs')).toHaveLength(3);
    expect(textAt(editor, '0;2;3;0;0')).toBe('');
  });

  it('inserts a bound row in a later batch without using the engine write caret', () => {
    const write = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'set_cell_text',
          anchor: '0;2;1;1;0',
          text: '13',
          literal: true
        }
      ]
    });
    expect(write.results[0]).toMatchObject({ ok: true, route: 'engine' });

    const inserted = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'insert_row', anchor: LAST_DATA_CELL }]
    });

    expect(inserted.results[0]).toMatchObject({
      ok: true,
      route: 'engine',
      op: 'insert_row'
    });
    expect(rowIdsOf(editor, 'costs')).toHaveLength(3);
  });

  it('appends a table from its anchor after a bound write in the same batch', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'set_cell_text',
          anchor: '0;2;1;0;0',
          text: 'Software'
        },
        {
          op: 'insert_table',
          anchor: '0;9',
          position: 'after',
          rows: 2,
          columns: 2,
          initialCells: [
            ['Region', 'Owner'],
            ['North', 'Alex']
          ]
        }
      ]
    });
    expect(result.results).toMatchObject([
      { ok: true, route: 'engine' },
      { ok: true, route: 'editor', op: 'insert_table' }
    ]);
    expect(textAt(editor, '0;10;0;0;0')).toBe('Region');
    expect(textAt(editor, '0;10;1;1;0')).toBe('Alex');
  });

  it('appends a table in a later batch without using the engine write caret', () => {
    const write = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'set_cell_text',
          anchor: '0;2;1;0;0',
          text: 'Software'
        }
      ]
    });
    expect(write.results[0]).toMatchObject({ ok: true, route: 'engine' });

    const inserted = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'insert_table',
          anchor: '0;9',
          position: 'after',
          rows: 2,
          columns: 2,
          initialCells: [
            ['Region', 'Owner'],
            ['North', 'Alex']
          ]
        }
      ]
    });
    expect(inserted.results[0]).toMatchObject({
      ok: true,
      route: 'editor',
      op: 'insert_table'
    });
    expect(textAt(editor, '0;10;0;0;0')).toBe('Region');
    expect(textAt(editor, '0;10;1;1;0')).toBe('Alex');
  });

  it('refuses `expect` on a row this same batch has not created yet', () => {
    const before = editor.serialize();
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        { op: 'insert_row', anchor: LAST_DATA_CELL },
        {
          op: 'set_cell_text',
          anchor: '0;2;3;0;0',
          expect: 'Subtotal',
          text: 'Hosting'
        }
      ]
    });

    expect(result.results[1]).toMatchObject({
      ok: false,
      route: 'engine',
      error: 'expect_on_created_row'
    });
    expect(editor.serialize()).toBe(before);
  });

  it('refuses the same user-stated figure twice across engine-routed writes', () => {
    const before = editor.serialize();
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        { op: 'set_cell_text', anchor: '0;2;1;1;0', text: '7', literal: true },
        { op: 'set_cell_text', anchor: '0;2;2;1;0', text: '7', literal: true }
      ]
    });

    expect(result.results[1]).toMatchObject({
      ok: false,
      route: 'engine',
      error: 'user_stated_figure_reused',
      retry: 'never'
    });
    // Nothing landed: an engine write authors no revision, so the refusal has to
    // stop the transaction rather than be reported over a write that already went in.
    expect(editor.serialize()).toBe(before);
  });

  it('routes delete_row through the engine and recomputes the aggregates', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'delete_row', anchor: FIRST_DATA_CELL }]
    });

    expect(result.results[0]).toMatchObject({
      ok: true,
      op: 'delete_row',
      route: 'engine'
    });
    expect(rowIdsOf(editor, 'costs')).toEqual(['r-2']);
    // A tracked deletion keeps the old row in raw SFDT until review, so the
    // retained row keeps its physical row anchor until the deletion is accepted.
    expect(textAt(editor, '0;2;2;0;0')).toBe('Development');
    expect(textAt(editor, '0;2;3;1;0')).toBe('$6,000.00');
    expect(textAt(editor, '0;4')).toBe(
      'Amount due for Website relaunch: $6,000.00.'
    );
  });

  it('creates a rejectable revision for a bound row delete', () => {
    const before = editor.serialize();
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'bound-row-delete-review',
      edits: [{ op: 'delete_row', anchor: FIRST_DATA_CELL }]
    });

    expect(result.results[0]).toMatchObject({ ok: true, route: 'engine' });
    const revisions = Array.from(
      { length: editor.revisions.length },
      (_, index) => editor.revisions.get(index)
    );
    expect(revisions).toHaveLength(9);
    expect(
      revisions.filter((revision) => revision.revisionType === 'Deletion')
    ).toHaveLength(5);
    expect(
      revisions.filter((revision) => revision.revisionType === 'Insertion')
    ).toHaveLength(4);
    expect(revisions.every((revision) => revision.author === 'Robin')).toBe(
      true
    );
    expect(new Set(revisions.map((revision) => revision.customData)).size).toBe(
      1
    );
    expect(rowIdsOf(editor, 'costs')).toEqual(['r-2']);

    rejectAllRevisions(editor);
    attached.controller.flush({ mode: 'self-heal' });

    expect(editor.revisions.length).toBe(0);
    expect(rowIdsOf(editor, 'costs')).toEqual(['r-1', 'r-2']);
    expect(editor.serialize()).toBe(before);
  });

  it('refuses delete_row on a summary row that carries no row binding', () => {
    const before = editor.serialize();
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'delete_row', anchor: '0;2;3;0;0' }]
    });

    expect(result.results[0]).toMatchObject({
      ok: false,
      op: 'delete_row',
      route: 'engine',
      error: 'bound_row_not_found'
    });
    expect(editor.serialize()).toBe(before);
  });

  it('routes delete_table through the engine, marker and all', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'delete_table', anchor: '0;6;1;0;0' }]
    });

    expect(result.results[0]).toMatchObject({
      ok: true,
      op: 'delete_table',
      route: 'engine'
    });
    const index = indexOf(editor);
    expect(index.tables.has('expenses')).toBe(false);
    expect(index.tables.has('costs')).toBe(true);
    // The marker remains only as rejectable deleted content until review.
    expect(editor.serialize()).toContain('[[table=expenses]]');
  });

  it('creates a rejectable revision for a bound table delete', () => {
    const before = editor.serialize();
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'bound-table-delete-review',
      edits: [{ op: 'delete_table', anchor: '0;6;1;0;0' }]
    });

    expect(result.results[0]).toMatchObject({ ok: true, route: 'engine' });
    expect(editor.revisions.length).toBe(1);
    expect(editor.revisions.get(0).revisionType).toBe('Deletion');
    expect(indexOf(editor).tables.has('expenses')).toBe(false);

    rejectAllRevisions(editor);
    attached.controller.flush({ mode: 'self-heal' });

    expect(editor.revisions.length).toBe(0);
    expect(indexOf(editor).tables.has('expenses')).toBe(true);
    expect(editor.serialize()).toBe(before);
  });
});
