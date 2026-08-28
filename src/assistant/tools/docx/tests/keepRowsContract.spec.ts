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

/**
 * REPRO FIRST: keepRows against an UNBOUND table.
 *
 * `deriveTableStructure` states its own unbound fallback (tableStructure.ts):
 * a table with no row-scoped bindings has no evidence to separate data rows
 * from decoration, so EVERY non-header row is classified `item`. `keepRows`
 * then protects only non-item rows - so on such a table the role check has
 * nothing to refuse, and the promise that "headers and totals ride
 * automatically" is one the engine cannot keep.
 *
 * This row demonstrates the actual behaviour BEFORE the fix, so the fix is
 * shown to change something real rather than asserted to.
 */
describe('REPRO: keepRows on a table whose roles cannot be proven', () => {
  let editor: DocumentEditor;
  let attached: AttachedBindings;

  const buildWithUnbound = (): DocumentEditor => {
    const doc = buildCostsFixture();
    const strip = (node: any): any => {
      if (Array.isArray(node)) return node.map(strip);
      if (!node || typeof node !== 'object') return node;
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node)) {
        if (key === 'contentControlProperties') continue;
        out[key] = strip(value);
      }
      return out;
    };
    const wrapper: any = doc.sections[0].blocks.find((block: any) =>
      JSON.stringify(block ?? {}).includes('[[table=costs]]')
    );
    const inner = (wrapper.blocks ?? []).find((block: any) => block?.rows);
    doc.sections[0].blocks.push(strip(inner));
    // A trailing paragraph, because a table that is the document's LAST block
    // trips `document_tail_table_last_row` - an unrelated guard that refuses
    // before the keepRows path is reached at all. The first version of this
    // repro measured that refusal instead of the behaviour under test.
    doc.sections[0].blocks.push({ inlines: [{ text: 'tail' }] } as any);

    const host = document.createElement('div');
    host.style.width = '900px';
    host.style.height = '700px';
    document.body.appendChild(host);
    const made = new DocumentEditor({
      isReadOnly: false,
      enableEditor: true,
      enableSelection: true,
      enableImageResizer: true,
      enableSearch: true,
      enableSfdtExport: true,
      enableEditorHistory: true,
      documentEditorSettings: { optimizeSfdt: false }
    });
    made.appendTo(host);
    made.open(JSON.stringify(doc));
    return made;
  };

  beforeEach(() => {
    editor = buildWithUnbound();
    attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: false
    });
  });

  afterEach(() => {
    attached.dispose();
    destroy(editor);
  });

  it('states what actually happens today, whatever that is', () => {
    const blocks = parsed(editor).sections[0].blocks;
    const unboundIndex = blocks.findIndex(
      (block: any) => block?.rows && !block?.contentControlProperties
    );
    // The fixture must really carry an unbound table, or this proves nothing.
    expect(unboundIndex).toBeGreaterThan(-1);
    const rowsBefore = blocks[unboundIndex].rows.length;
    expect(rowsBefore).toBe(6);

    const before = editor.serialize();
    const result: any = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'duplicate_table',
          anchor: `0;${unboundIndex};0;0;0`,
          rows: 'copy',
          keepRows: [1, 2]
        } as any
      ]
    });

    const after = parsed(editor).sections[0].blocks;
    const tables = after
      .map((block: any, index: number) => ({ block, index }))
      .filter((entry: any) => entry.block?.rows && !entry.block?.contentControlProperties)
      .map((entry: any) => entry.block.rows.length);

    // MEASURED BEFORE THE FIX, and it corrected the diagnosis rather than
    // confirming it. The reported defect was "roles are unprovable so a total
    // gets silently dropped". The actual behaviour was different and milder:
    // `keepRows` was SILENTLY IGNORED. An unbound table has no binding route,
    // so the op fell through to the editor handler, which knows nothing about
    // keepRows - a keepRows of [1,2] against this six-row table produced a
    // SIX-row copy and reported ok:true. No data was lost; a filter the caller
    // asked for simply did not happen.
    //
    // The fix is the same either way, for a reason that survives the
    // correction: a parameter that is silently ignored is never acceptable, and
    // filtering on the unbound fallback would be worse than refusing, because
    // that fallback calls every non-header row an item and would let a caller
    // drop a total while the engine believed it had protected one.
    expect(result.results[0].ok).toBe(false);
    expect(result.results[0].error).toBe('keep_rows_roles_not_derivable');
    // Nothing written, and the anti-vacuity guard: the refusal carries a
    // reason, so "refused" and "never attempted" cannot read the same.
    expect(editor.serialize()).toBe(before);
    expect(tables).toEqual([rowsBefore]);
    expect(result.results[0].error).not.toBeNull();
  });
});

/**
 * The over-reach control for `keep_rows_roles_not_derivable`.
 *
 * The refusal is placed on the unbound branch of the routing fork, so the
 * mirror risk is that it swallowed the LEGITIMATE case with it: duplicating an
 * unbound table plainly, with no keepRows, must still work through the editor
 * route exactly as it always did. A refusal that also blocks that has removed a
 * capability rather than closed a gap.
 */
describe('the roles-not-derivable refusal does not over-reach', () => {
  let editor: DocumentEditor;
  let attached: AttachedBindings;

  const buildWithUnbound = (): DocumentEditor => {
    const doc = buildCostsFixture();
    const strip = (node: any): any => {
      if (Array.isArray(node)) return node.map(strip);
      if (!node || typeof node !== 'object') return node;
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node)) {
        if (key === 'contentControlProperties') continue;
        out[key] = strip(value);
      }
      return out;
    };
    const wrapper: any = doc.sections[0].blocks.find((block: any) =>
      JSON.stringify(block ?? {}).includes('[[table=costs]]')
    );
    const inner = (wrapper.blocks ?? []).find((block: any) => block?.rows);
    doc.sections[0].blocks.push(strip(inner));
    doc.sections[0].blocks.push({ inlines: [{ text: 'tail' }] } as any);

    const host = document.createElement('div');
    host.style.width = '900px';
    host.style.height = '700px';
    document.body.appendChild(host);
    const made = new DocumentEditor({
      isReadOnly: false,
      enableEditor: true,
      enableSelection: true,
      enableImageResizer: true,
      enableSearch: true,
      enableSfdtExport: true,
      enableEditorHistory: true,
      documentEditorSettings: { optimizeSfdt: false }
    });
    made.appendTo(host);
    made.open(JSON.stringify(doc));
    return made;
  };

  beforeEach(() => {
    editor = buildWithUnbound();
    attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: false
    });
  });

  afterEach(() => {
    attached.dispose();
    destroy(editor);
  });

  it('plain unbound duplicate_table, with NO keepRows, still works via the editor route', () => {
    const blocks = parsed(editor).sections[0].blocks;
    const unboundIndex = blocks.findIndex(
      (block: any) => block?.rows && !block?.contentControlProperties
    );
    // Pre-state asserted explicitly: the fixture really carries ONE unbound
    // table of six rows. A control must never be satisfiable by the fixture's
    // own construction.
    expect(unboundIndex).toBeGreaterThan(-1);
    expect(blocks[unboundIndex].rows.length).toBe(6);
    const unboundTablesBefore = blocks.filter(
      (block: any) => block?.rows && !block?.contentControlProperties
    ).length;
    expect(unboundTablesBefore).toBe(1);

    const result: any = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'duplicate_table',
          anchor: `0;${unboundIndex};0;0;0`,
          rows: 'copy'
        } as any
      ]
    });

    expect(result.results[0].ok).toBe(true);
    expect(result.results[0].error ?? null).toBeNull();

    // The capability is intact: there are now TWO unbound tables, and the copy
    // kept every row, which is what "no keepRows" means.
    const after = parsed(editor).sections[0].blocks.filter(
      (block: any) => block?.rows && !block?.contentControlProperties
    );
    expect(after).toHaveLength(2);
    expect(after.map((block: any) => block.rows.length)).toEqual([6, 6]);
  });
});
