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

    // MEASURED: it RESOLVES. Asserted definitely rather than as an
    // either-way branch, which would pass without recording which happened.
    //
    // NOTE ON WHAT THIS DOES AND DOES NOT PROVE: `expenses` is BOUND, so it
    // resolved through clause 1, identity - not through position maintenance.
    // Row (ii-b) is the one that exercises clause 2.
    expect(codesOf(result)).toEqual([null, null]);
    expect(itemsOf(editor, 'costs')).toEqual(['Design work', 'Development']);
    expect(indexOf(editor).tables.get('expenses')!.rows.length).toBe(
      expensesBefore!.rows.length - 1
    );
  });

  it('(ii-b) CLAUSE 2 EVIDENCE: an UNBOUND later table after the shift', () => {
    // The hole spec (ii) does not close. `expenses` is BOUND, so it resolved by
    // identity - clause 1 - and said nothing about clause 2. The lifted gate,
    // however, admits ANY follower after a duplicate, including one that can
    // only resolve by POSITION. This row measures that case directly, because
    // admitting it with no evidence is exactly what the refusal existed to stop.
    //
    // An unbound table has no id to resolve by, so a write aimed at it must
    // survive the two blocks the duplicate inserts ABOVE it, or refuse.
    // Built from a REAL table rather than by hand. A hand-written minimal table
    // block did not survive the editor's round-trip at all - its text was not
    // findable afterwards - so this clones the fixture's own second table and
    // strips every content control, which is exactly what "unbound" means and
    // guarantees a structurally valid table.
    const doc = buildCostsFixture();
    const stripControls = (node: any, depth = 0): any => {
      if (Array.isArray(node)) return node.map((n) => stripControls(n, depth));
      if (!node || typeof node !== 'object') return node;
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node)) {
        if (key === 'contentControlProperties') continue;
        if (key === 'text') {
          out[key] = `UNBOUND-${String(value).slice(0, 6)}`;
          continue;
        }
        out[key] = stripControls(value, depth + 1);
      }
      return out;
    };
    const expensesWrapper: any = doc.sections[0].blocks.find((block: any) =>
      JSON.stringify(block ?? {}).includes('[[table=expenses]]')
    );
    expect(expensesWrapper).toBeTruthy();
    // The INNER table, not the wrapper. The wrapper is a block content control
    // whose `blocks` hold the table; appending the stripped wrapper appends a
    // container the editor flattens into plain paragraphs, which is what the
    // first attempt did - the document came back with three paragraphs and no
    // table at all.
    const innerTable = (expensesWrapper.blocks ?? []).find(
      (block: any) => block?.rows
    );
    expect(innerTable).toBeTruthy();
    doc.sections[0].blocks.push(stripControls(innerTable) as any);

    attached.dispose();
    destroy(editor);
    const host = document.createElement('div');
    host.style.width = '900px';
    host.style.height = '700px';
    document.body.appendChild(host);
    editor = new DocumentEditor({
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
    editor.open(JSON.stringify(doc));
    attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: false
    });

    const blocks = parsed(editor).sections[0].blocks;
    const unboundIndex = blocks.findIndex((block: any) =>
      JSON.stringify(block ?? {}).includes('UNBOUND-')
    );
    // The unbound table must actually BE a table and sit after the one being
    // duplicated, or this row proves nothing. Both earlier attempts at this
    // fixture failed here rather than silently measuring the wrong thing.
    expect(blocks[unboundIndex]?.rows).toBeTruthy();
    expect(unboundIndex).toBeGreaterThan(tableBlockIndex(editor, 'costs'));

    // The anchor is computed BEFORE the change set, which is the realistic
    // case: the model reads the document, then sends the batch.
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'duplicate_table',
          anchor: cellAt(editor, 'costs', 0),
          rows: 'copy'
        },
        {
          op: 'set_cell_text',
          anchor: `0;${unboundIndex};1;0;0`,
          text: 'WROTE-HERE'
        }
      ]
    });

    const codes = codesOf(result);
    const afterBlocks = parsed(editor).sections[0].blocks;
    const landedInUnbound = JSON.stringify(
      afterBlocks.find((block: any) =>
        JSON.stringify(block ?? {}).includes('UNBOUND-')
      ) ?? {}
    ).includes('WROTE-HERE');

    // MEASURED, 2026-08-28: position maintenance RESOLVES IT CORRECTLY. Both
    // ops succeed and the write lands in the unbound table even though the
    // duplicate inserted blocks above it. This is clause 2's first evidence,
    // and it is what makes the lifted gate's admitted set equal to the proven
    // set rather than wider than it.
    //
    // Asserted definitely rather than as a branch. An earlier draft accepted
    // "resolved OR refused by name", which would have passed either way and
    // recorded nothing - the same vacuity this file's sibling probe was
    // rewritten to avoid.
    expect(codes).toEqual([null, null]);
    expect(landedInUnbound).toBe(true);

    // NEGATIVE CONTROL: the text must appear EXACTLY once in the document, so a
    // write that landed in the unbound table AND somewhere else - the stale
    // index the original refusal feared - fails here rather than passing on the
    // strength of the first check alone.
    const occurrences = JSON.stringify(afterBlocks).split('WROTE-HERE').length - 1;
    expect(occurrences).toBe(1);
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
