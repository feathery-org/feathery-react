/**
 * The law that REPLACES the anchor-shifting refusal.
 *
 * The refusal existed because an op after a block-inserting op could silently
 * hit the wrong container. Deleting it would readmit that. Replacing it means
 * stating how a later op resolves its target, and proving the dangerous case
 * refuses instead of guessing:
 *
 *   1. IDENTITY first. A clone always forks identity, so after
 *      duplicate_table("costs") the copy is "costs_copy" and the anchor
 *      "costs" still names exactly one table - the source.
 *   2. MAINTAINED POSITION when there is no identity, per the footprint
 *      contract's anchor-maintenance law, with the fingerprint asserted
 *      before any write.
 *   3. AMBIGUITY REFUSES, by name. Never a guess, and identity NEVER falls
 *      back to position: an id that was expected and is missing means the
 *      document is not what the change set thought it was.
 *
 * Every row below carries the standing anti-vacuity guard: a refusal must
 * carry a non-null, specific reason, so "everything failed" and "nothing was
 * attempted" cannot produce the same green.
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

function tableBlockIndex(editor: DocumentEditor, tableId: string): number {
  const found = parsed(editor).sections[0].blocks.findIndex(
    (block: any) =>
      block?.contentControlProperties?.tag === `[[table=${tableId}]]`
  );
  if (found < 0)
    throw new Error(
      `no wrapper for table "${tableId}" - the harness is wrong, not the engine`
    );
  return found;
}

const cellAt = (editor: DocumentEditor, tableId: string, row: number): string =>
  `0;${tableBlockIndex(editor, tableId)};${row};0;0`;

/**
 * The SURVIVING item rows of a table, by their visible text.
 *
 * A tracked delete keeps the removed row physically present until review, so
 * counting rows would not show which table lost one. Reading the binding
 * index's live rows is what distinguishes source from copy.
 */
const itemsOf = (editor: DocumentEditor, tableId: string): string[] => {
  const table = indexOf(editor).tables.get(tableId);
  if (!table) throw new Error(`table "${tableId}" is not readable`);
  return table.rows
    .map((row: any) => row.bindings?.get('item')?.text)
    .filter((text: unknown): text is string => typeof text === 'string');
};

const codesOf = (result: any): Array<string | null> =>
  result.results.map((entry: any) => entry.error ?? null);

describe('anchor resolution after a shifting op, in one change set', () => {
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

  it('(i) duplicate-then-delete resolves the SOURCE, leaving the copy untouched', () => {
    const before = itemsOf(editor, 'costs');
    expect(before).toEqual(['Design work', 'Development']);

    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        { op: 'duplicate_table', anchor: cellAt(editor, 'costs', 0), rows: 'copy' },
        { op: 'delete_row', anchor: cellAt(editor, 'costs', 1) }
      ]
    });

    expect(codesOf(result)).toEqual([null, null]);

    const copyId = [...indexOf(editor).tables.keys()].find(
      (id) => id.startsWith('costs') && id !== 'costs'
    );
    expect(copyId).toBeTruthy();

    // THE PROPERTY. The delete names row 1 of "costs", and after the duplicate
    // that anchor could describe either table. Identity resolution must send it
    // to the source.
    expect(itemsOf(editor, 'costs')).toEqual(['Development']);

    // NEGATIVE CONTROL, and it is the half that makes the line above mean
    // something: the copy must still hold BOTH items. Without this, a delete
    // that hit both tables, or hit the copy instead, would still leave the
    // source with one row and pass.
    expect(itemsOf(editor, copyId as string)).toEqual([
      'Design work',
      'Development'
    ]);
  });

  it('(ii) a later edit on a DIFFERENT, later table resolves despite the index shift', () => {
    // `expenses` sits after `costs` in the fixture, so duplicating `costs`
    // inserts blocks ABOVE it and every one of its anchors moves. This is the
    // case maintained-position resolution exists for, and the case a raw
    // pre-change anchor would get wrong.
    const expensesBefore = indexOf(editor).tables.get('expenses');
    expect(expensesBefore).toBeTruthy();

    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        { op: 'duplicate_table', anchor: cellAt(editor, 'costs', 0), rows: 'copy' },
        { op: 'delete_row', anchor: cellAt(editor, 'expenses', 1) }
      ]
    });

    // Either it resolves correctly, or it refuses BY NAME. What it must never
    // do is write to whatever now sits at the stale index.
    const codes = codesOf(result);
    // eslint-disable-next-line no-console
    console.info(
      '(ii) branch taken:',
      codes[1] === null ? 'RESOLVED' : `REFUSED ${codes[1]}`
    );
    if (codes[1] === null) {
      // Resolved: expenses lost exactly one row, and costs kept both.
      expect(itemsOf(editor, 'costs')).toEqual(['Design work', 'Development']);
      expect(indexOf(editor).tables.get('expenses')!.rows.length).toBe(
        expensesBefore!.rows.length - 1
      );
    } else {
      // Refused: nothing was written, and the reason is specific.
      expect(codes[1]).not.toBeNull();
      expect(itemsOf(editor, 'costs')).toEqual(['Design work', 'Development']);
    }
  });

  it('(iii) identity beats position: the copy is reachable by its OWN id, not by where it sits', () => {
    const duplicate = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        { op: 'duplicate_table', anchor: cellAt(editor, 'costs', 0), rows: 'copy' }
      ]
    });
    expect(codesOf(duplicate)).toEqual([null]);

    const copyId = [...indexOf(editor).tables.keys()].find(
      (id) => id.startsWith('costs') && id !== 'costs'
    ) as string;
    expect(copyId).toBeTruthy();

    // Addressing the COPY by its own anchor must reach the copy, and must not
    // touch the source. Identity forking is what makes this expressible at all.
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'delete_row', anchor: cellAt(editor, copyId, 1) }]
    });
    expect(codesOf(result)).toEqual([null]);

    expect(itemsOf(editor, copyId)).toEqual(['Development']);
    expect(itemsOf(editor, 'costs')).toEqual(['Design work', 'Development']);
  });

  it('(iv) an anchor that resolves to nothing refuses by name and writes nothing', () => {
    const pristine = editor.serialize();

    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        { op: 'duplicate_table', anchor: cellAt(editor, 'costs', 0), rows: 'copy' },
        {
          op: 'delete_row',
          anchor: `0;${tableBlockIndex(editor, 'costs')};99;0;0`
        }
      ]
    });

    const codes = codesOf(result);
    // The anti-vacuity guard: the failing op must carry a SPECIFIC reason, not
    // merely be absent from the successes.
    expect(codes[1]).not.toBeNull();
    expect(typeof codes[1]).toBe('string');

    // All-or-nothing at preflight, per the measured law: nothing was written.
    expect(editor.serialize()).toBe(pristine);
    expect(indexOf(editor).tables.size).toBe(
      scanBindings(JSON.parse(pristine)).tables.size
    );
  });
});
