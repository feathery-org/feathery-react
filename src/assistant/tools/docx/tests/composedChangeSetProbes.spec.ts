/**
 * PROBES for the two properties that decide whether planner-side composition
 * is a viable shape for split. Run BEFORE the implementation, deliberately.
 *
 * The design under review replaces `split_table` with two model-issued calls,
 * `duplicate_table` + `delete_row`. That is only safe if a multi-op change set
 * behaves as one unit in two specific ways, and neither is currently asserted
 * anywhere:
 *
 *   1. GROUPING - the pair reads as ONE review card, and rejecting it unwinds
 *      both ops with no orphan table left behind.
 *   2. PARTIAL FAILURE - when op 1 lands and op 2 is refused, the change set
 *      does not leave a coherent-but-wrong document (a copy with no removal).
 *
 * These use the EXISTING primitives, unchanged. No `keepRows` yet, and no new
 * engine code: the point is to measure what the machinery already does before
 * committing to a shape that depends on it.
 *
 * WHAT JSDOM CANNOT SETTLE, stated because our own history turns on it. The
 * undo-grouping wrapper was reverted after grouped replay threw in
 * `getSplitWidgets` and stranded documents IN THE BROWSER, while jsdom was
 * perfectly happy - jsdom has no layout to throw from. So a green run here is
 * necessary and NOT sufficient, and the browser ledger rows are what actually
 * license the shape.
 */
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
const indexOf = (editor: DocumentEditor) => scanBindings(parsed(editor));

/** Table ids currently readable, so an orphan copy is visible by count. */
const costsTableIds = (editor: DocumentEditor): string[] =>
  [...indexOf(editor).tables.keys()].filter((id) => id.startsWith('costs'));

function tableBlockIndex(editor: DocumentEditor, tableId: string): number {
  const found = parsed(editor).sections[0].blocks.findIndex(
    (block: any) =>
      block?.contentControlProperties?.tag === `[[table=${tableId}]]`
  );
  if (found < 0) throw new Error(`no wrapper for table "${tableId}"`);
  return found;
}

/** A 5-part cell anchor at `row` of the costs table. */
const cellAt = (editor: DocumentEditor, row: number): string =>
  `0;${tableBlockIndex(editor, 'costs')};${row};0;0`;

const rejectAll = (editor: DocumentEditor): void => {
  const pending = Array.from({ length: editor.revisions.length }, (_, i) =>
    editor.revisions.get(i)
  );
  for (const revision of pending.reverse()) revision.reject();
};

const undoDepth = (editor: DocumentEditor): number =>
  (editor.editorHistory as any)?.undoStack?.length ?? -1;

describe('PROBE: does a two-op change set behave as one unit?', () => {
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

  it('PROBE 1: grouping - reject unwinds both ops, leaving no orphan table', () => {
    const pristine = editor.serialize();
    expect(costsTableIds(editor)).toEqual(['costs']);

    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        { op: 'duplicate_table', anchor: cellAt(editor, 0), rows: 'copy' },
        { op: 'delete_row', anchor: cellAt(editor, 1) }
      ]
    });

    // MEASUREMENT, not assertion: report what the machinery actually did, so a
    // surprise here is legible rather than a bare red.
    const outcome = {
      results: result.results.map((entry: any) => ({
        op: entry.op,
        ok: entry.ok,
        error: entry.error ?? null
      })),
      tablesAfter: costsTableIds(editor),
      revisions: editor.revisions.length,
      undoDepth: undoDepth(editor)
    };
    // eslint-disable-next-line no-console
    console.info('PROBE 1 outcome:', JSON.stringify(outcome, null, 2));

    // THE FINDING, and it decides slice 3's sequencing rather than its shape.
    //
    // The composition is REFUSED outright. `duplicate_table` belongs to the
    // anchor-shifting family, and `detectAnchorShiftingNotLast` rejects any
    // change set where such an op is followed by another anchored edit - so
    // `duplicate_table` + `delete_row`, which IS the planner-side split, cannot
    // currently be expressed at all. Neither op runs; the document is
    // untouched.
    //
    // This is not a surprise the design failed to anticipate. It is the exact
    // refusal the footprint contract was built to make safe to lift: the
    // dormant `tableId`, the anchor-maintenance law and the dedupe rule all
    // exist so that removing it does not readmit the corruption it prevents.
    // Tracked as the backlog's anchor-shifting item.
    //
    // This assertion flips when that refusal is lifted, and it is written to
    // fail loudly at that moment rather than to be quietly deleted.
    expect(outcome.results.map((entry) => entry.error)).toEqual([
      'duplicate_table_must_end_change_set',
      'duplicate_table_must_end_change_set'
    ]);
    expect(outcome.tablesAfter).toEqual(['costs']);
    expect(editor.serialize()).toBe(pristine);
    expect(outcome.revisions).toBe(0);
  });

  it('PROBE 2: partial failure - a refused second op must not leave the first standing', () => {
    const pristine = editor.serialize();

    // TWO DELETES, not duplicate-then-delete. The obvious phrasing of this
    // probe used `duplicate_table` for op 1 and passed - but only because the
    // anchor-shifting refusal above killed the whole change set before either
    // op ran, so "the document is pristine" was true for a reason that had
    // nothing to do with partial failure. That is a vacuous pass, and it is the
    // failure mode this file is meant to catch rather than commit.
    //
    // `delete_row` is not anchor-shifting, so this pair genuinely reaches the
    // path under test: op 1 is applicable, op 2 names row 99 and is refused.
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        { op: 'delete_row', anchor: cellAt(editor, 1) },
        {
          op: 'delete_row',
          anchor: `0;${tableBlockIndex(editor, 'costs')};99;0;0`
        }
      ]
    });

    const outcome = {
      results: result.results.map((entry: any) => ({
        op: entry.op,
        ok: entry.ok,
        code: entry.error ?? null
      })),
      byteEqualToPristine: editor.serialize() === pristine,
      revisions: editor.revisions.length,
      rowIds: [...indexOf(editor).tables.get('costs')!.rows].map(
        (row: any) => row.rowId
      )
    };
    // eslint-disable-next-line no-console
    console.info('PROBE 2 outcome:', JSON.stringify(outcome, null, 2));

    // Deliberately NOT asserting which law holds - this reports which one the
    // engine already implements, and the ruling picks the law from evidence.
    // The guard is only that the answer is one of the two COHERENT ones rather
    // than a silent half-write with no error to tell the model about it.
    const allOrNothing =
      outcome.byteEqualToPristine &&
      outcome.results.every((entry) => !entry.ok);
    const partialWithClearError =
      outcome.results[0].ok === true &&
      outcome.results[1].ok === false &&
      outcome.results[1].code !== null;

    expect(allOrNothing || partialWithClearError).toBe(true);
    // The vacuous-pass guard: whichever law holds, op 2 must carry a REASON.
    // Without this, "everything failed" and "nothing was attempted" are the
    // same green.
    expect(outcome.results[1].code).not.toBeNull();
  });
});
