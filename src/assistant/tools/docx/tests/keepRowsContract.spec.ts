/**
 * The `keepRows` contract on duplicate_table.
 *
 * `keepRows` is what lets the model express a partition without a bespoke split
 * op: duplicate the table keeping some data rows, then delete the complement
 * from the source. Two calls, existing primitives, no new mechanism.
 *
 * THE INDEX SPACE IS ABSOLUTE TABLE ROW INDICES. Not item ordinals. Every other
 * row-addressing op speaks absolute rows, and a second index space for one
 * parameter is how off-by-one defects arrive in a form nobody can see in review.
 *
 * ROLE-BEARING ROWS ARE NOT FILTERABLE. The header band and every aggregate row
 * belong to BOTH halves of any partition, decided by the schema from evidence
 * rather than by the caller. This is the caller-facing half of that law, and it
 * is what makes the same filter safe one tier up, where the equivalent mistake
 * would behead a section rather than a table.
 *
 * The costs fixture, for reference throughout:
 *   row 0  header
 *   row 1  item   r-1  "Design work"
 *   row 2  item   r-2  "Development"
 *   row 3  aggregate   costs_subtotal = sum(costs.line_total)
 *   row 4  aggregate   costs_tax      = mul(costs_subtotal, tax_rate)
 *   row 5  aggregate   grand_total    = sum(costs_subtotal, costs_tax)
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

const copyIdOf = (editor: DocumentEditor): string | undefined =>
  [...indexOf(editor).tables.keys()].find(
    (id) => id.startsWith('costs') && id !== 'costs'
  );

const itemsOf = (editor: DocumentEditor, tableId: string): string[] => {
  const table = indexOf(editor).tables.get(tableId);
  if (!table) throw new Error(`table "${tableId}" is not readable`);
  return table.rows
    .map((row: any) => row.bindings?.get('item')?.text)
    .filter((text: unknown): text is string => typeof text === 'string');
};

/** The physical row count of a table block, wrapper or not. */
function physicalRows(editor: DocumentEditor, tableId: string): number {
  const wrapper = parsed(editor).sections[0].blocks[
    tableBlockIndex(editor, tableId)
  ];
  const table = wrapper?.rows
    ? wrapper
    : (wrapper?.blocks ?? []).find((block: any) => block?.rows);
  return table?.rows?.length ?? -1;
}

const duplicateKeeping = (editor: DocumentEditor, keepRows: unknown) =>
  applyDocumentEdits(editor as unknown as LiveEditor, {
    edits: [
      {
        op: 'duplicate_table',
        anchor: cellAt(editor, 'costs', 0),
        rows: 'copy',
        keepRows
      } as any
    ]
  });

describe('duplicate_table keepRows', () => {
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

  it('keeps only the named item rows, and every role row comes along on its own', () => {
    const result = duplicateKeeping(editor, [1]);
    expect(result.results[0]).toMatchObject({ ok: true });

    const copyId = copyIdOf(editor);
    expect(copyId).toBeTruthy();

    // The copy keeps ONE item, the one named.
    expect(itemsOf(editor, copyId as string)).toEqual(['Design work']);
    // And it is still a whole table: header + 1 item + 3 aggregates.
    expect(physicalRows(editor, copyId as string)).toBe(5);

    // NEGATIVE CONTROL: the source is untouched. Without this, a `keepRows`
    // that filtered the SOURCE instead of the copy would pass every line above.
    expect(itemsOf(editor, 'costs')).toEqual(['Design work', 'Development']);
    expect(physicalRows(editor, 'costs')).toBe(6);
  });

  it('accepts an EMPTY selection: header and totals, and no data rows', () => {
    // Ruled legitimate rather than refused. This is the natural end state of
    // "move all the items into a new table", and an empty aggregate recomputes
    // to zero rather than erroring. Refusing it would force the model to
    // special-case the partition that is easiest to ask for.
    const result = duplicateKeeping(editor, []);
    // Reported with its code rather than as a bare ok:false, so a failure here
    // says WHICH behaviour is missing.
    expect(
      result.results[0].ok
        ? 'ok'
        : `refused: ${(result.results[0] as any).error}`
    ).toBe('ok');

    const copyId = copyIdOf(editor);
    expect(copyId).toBeTruthy();
    expect(itemsOf(editor, copyId as string)).toEqual([]);
    // header + 3 aggregates, still a readable table.
    expect(physicalRows(editor, copyId as string)).toBe(4);
    expect(itemsOf(editor, 'costs')).toEqual(['Design work', 'Development']);
  });

  it('refuses BY NAME when keepRows names a header row, and writes nothing', () => {
    const pristine = editor.serialize();
    const result = duplicateKeeping(editor, [0, 1]);

    expect(result.results[0]).toMatchObject({
      ok: false,
      error: 'keep_rows_names_role_row'
    });
    expect(editor.serialize()).toBe(pristine);
    expect(copyIdOf(editor)).toBeUndefined();
  });

  it('refuses BY NAME when keepRows names an aggregate row, and writes nothing', () => {
    const pristine = editor.serialize();
    // Row 3 is the subtotal. A caller naming it has misunderstood the
    // primitive - totals are never filtered - and being told so is more useful
    // than being quietly obeyed.
    const result = duplicateKeeping(editor, [1, 3]);

    expect(result.results[0]).toMatchObject({
      ok: false,
      error: 'keep_rows_names_role_row'
    });
    expect(editor.serialize()).toBe(pristine);
    expect(copyIdOf(editor)).toBeUndefined();
  });

  it('refuses BY NAME when keepRows names a row the table does not have', () => {
    const pristine = editor.serialize();
    const result = duplicateKeeping(editor, [1, 99]);

    expect(result.results[0]).toMatchObject({
      ok: false,
      error: 'keep_rows_row_not_found'
    });
    expect(editor.serialize()).toBe(pristine);
    expect(copyIdOf(editor)).toBeUndefined();
  });

  it('LAW C: removing rows does NOT rewrite the survivors\' expressions', () => {
    // The asymmetry, asserted in one place so it cannot be "fixed" by someone
    // reading the two halves side by side and taking them for an oversight:
    //
    //   a CLONE rewrites its expressions, through the table id map (law A)
    //   a REMOVAL does not; the value simply recomputes over the survivors
    //
    // This is what makes the source half of a composed split correct BY
    // CONSTRUCTION rather than needing a second rewrite.
    const before = JSON.stringify(
      parsed(editor).sections[0].blocks[tableBlockIndex(editor, 'costs')]
    );
    expect(before).toContain('sum(costs.line_total)');

    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'delete_row', anchor: cellAt(editor, 'costs', 1) }]
    });
    expect(result.results[0]).toMatchObject({ ok: true });

    // The expression is UNCHANGED after a row is removed.
    expect(
      JSON.stringify(
        parsed(editor).sections[0].blocks[tableBlockIndex(editor, 'costs')]
      )
    ).toContain('sum(costs.line_total)');
    // And the row really did go, so this is not passing on a no-op delete.
    expect(itemsOf(editor, 'costs')).toEqual(['Development']);
  });
});

/**
 * What insert_row does against an ITEMLESS bound table.
 *
 * Not a corner case: "move ALL the items into a new table" leaves the SOURCE
 * itemless, so this state is reachable by an ordinary request. An itemless
 * bound table has no prototype data row, and insert_row patterns a new row on
 * one - so this measures whether the absence is handled or merely unencountered.
 *
 * The rule being applied is the same one that governed the anchor-shifting
 * lift: the admitted set must equal the proven set. If this behaves sanely the
 * evidence is recorded; if it corrupts or throws raw, that is a refusal to add
 * rather than a surprise to leave in place.
 */
describe('insert_row against an itemless bound table', () => {
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

  it('either inserts a usable row or refuses by name, never corrupting', () => {
    // Make an itemless copy, then aim insert_row at it.
    expect(duplicateKeeping(editor, []).results[0].ok).toBe(true);
    const copyId = copyIdOf(editor);
    expect(copyId).toBeTruthy();
    expect(itemsOf(editor, copyId as string)).toEqual([]);

    const before = editor.serialize();
    const rowsBefore = physicalRows(editor, copyId as string);

    let threw: string | null = null;
    let result: any = null;
    try {
      result = applyDocumentEdits(editor as unknown as LiveEditor, {
        edits: [
          {
            op: 'insert_row',
            anchor: cellAt(editor, copyId as string, 1),
            count: 1
          } as any
        ]
      });
    } catch (err) {
      threw = String((err as Error)?.message ?? err);
    }

    const outcome = {
      threwRaw: threw,
      code: result?.results?.[0]?.ok ? null : result?.results?.[0]?.error ?? null,
      ok: result?.results?.[0]?.ok ?? false,
      rowsBefore,
      rowsAfter: physicalRows(editor, copyId as string),
      pristine: editor.serialize() === before
    };
    // eslint-disable-next-line no-console
    console.info('ITEMLESS insert_row:', JSON.stringify(outcome, null, 2));

    // An UNCAUGHT throw is never acceptable: the engine's contract is that a
    // refusal is a named result, not an exception escaping to the caller.
    expect(outcome.threwRaw).toBeNull();

    if (outcome.ok) {
      // Sane: a row really was added.
      expect(outcome.rowsAfter).toBeGreaterThan(outcome.rowsBefore);
    } else {
      // Refused: by name, and with nothing written.
      expect(outcome.code).not.toBeNull();
      expect(outcome.pristine).toBe(true);
    }
  });
});
