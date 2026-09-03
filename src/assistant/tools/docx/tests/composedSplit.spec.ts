/**
 * split_table as a COMPOSITION, over a bound table.
 *
 * The capability this buys: splitting a bound table is refused outright today
 * (`structural_op_would_destroy_bindings`), because the selection the bespoke
 * handler uses would delete the content controls rather than move them. The
 * composed path never makes a selection over bindings at all. It is:
 *
 *   copy the table (the bound-clone seam, which conserves bindings)
 *   + delete the complementary item rows from each half
 *   + let the finalizer restripe both halves at change-set end
 *
 * WRITTEN BEFORE THE IMPLEMENTATION. Every row below states a property the
 * composition owes. Each must fail for the MISSING BEHAVIOUR - the standing
 * refusal - and not for a broken harness, a bad anchor, or an unbound fixture.
 * That distinction is this file's own negative control, and rows (a) and (f)
 * check it explicitly rather than leaving it assumed.
 *
 * WHAT THIS FILE CANNOT PROVE. jsdom does not paginate, so nothing here is
 * evidence about identified elements surviving in a real editor. Tag
 * conservation in a serialized tree is necessary and not sufficient; the
 * browser proof is a separate phase and gates the retirements.
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
import { deriveTableStructure } from '../tableStructure';
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

function makeEditor(sfdt = buildCostsFixture()): DocumentEditor {
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

function destroy(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

const parsed = (editor: DocumentEditor) => JSON.parse(editor.serialize());
const indexOf = (editor: DocumentEditor) => scanBindings(parsed(editor));

/**
 * The top-level block index of the wrapper carrying `tableId`, FOUND rather
 * than hardcoded.
 *
 * A literal anchor is how a spec goes vacuous without saying so: it keeps
 * passing against the wrong table, or fails for a reason that looks like the
 * behaviour under test. Deriving it means a fixture change breaks this helper
 * loudly instead of quietly re-pointing every assertion below.
 */
function tableBlockIndex(editor: DocumentEditor, tableId: string): number {
  const found = parsed(editor).sections[0].blocks.findIndex(
    (block: any) =>
      block?.contentControlProperties?.tag === `[[table=${tableId}]]`
  );
  if (found < 0)
    throw new Error(
      `fixture has no top-level wrapper for table "${tableId}" - the harness is wrong, not the engine`
    );
  return found;
}

/** A cell anchor inside `tableId`, in the 5-part form split_table requires. */
const cellAnchorIn = (editor: DocumentEditor, tableId: string): string =>
  `0;${tableBlockIndex(editor, tableId)};0;0;0`;

/** Every binding tag in a subtree, in document order. */
function tagsIn(node: any, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((entry) => tagsIn(entry, out));
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  const tag = node.contentControlProperties?.tag;
  if (typeof tag === 'string') out.push(tag);
  for (const value of Object.values(node)) tagsIn(value, out);
  return out;
}

/**
 * The block that actually carries `rows` for `tableId`.
 *
 * A bound table is WRAPPED: the top-level block is a block content control
 * holding the marker tag, and the table itself is a block inside it. Reading
 * the wrapper gives an object with no `rows` at all, which `deriveTableStructure`
 * reports as a table with zero rows rather than as an error - a silent empty
 * pass, which is why row (a) exists to catch it.
 */
function tableBlockOf(editor: DocumentEditor, tableId: string): any {
  const wrapper =
    parsed(editor).sections[0].blocks[tableBlockIndex(editor, tableId)];
  if (wrapper?.rows) return wrapper;
  const inner = (wrapper?.blocks ?? []).find((block: any) => block?.rows);
  if (!inner)
    throw new Error(
      `wrapper for table "${tableId}" carries no table block - the harness is wrong, not the engine`
    );
  return inner;
}

/**
 * The costs table's every-formula map, which `deriveTableStructure` needs to
 * see a TRANSITIVE dependency (`costs_tax` depends on the table only through
 * `costs_subtotal`).
 */
function documentFormulas(editor: DocumentEditor): Map<string, string> {
  const out = new Map<string, string>();
  // `formulas` maps a name to its OCCURRENCES - a formula shown in two places
  // is one definition seen twice. Any occurrence carries the expression; the
  // binding engine is what keeps divergent ones from existing.
  for (const [name, occurrences] of indexOf(editor).formulas) {
    const expression = (occurrences as any[])[0]?.def?.expression;
    if (typeof expression === 'string') out.set(name, expression);
  }
  if (!out.size)
    throw new Error(
      'no document formulas were readable - the harness is wrong, not the engine'
    );
  return out;
}

/**
 * A split, composed by the CALLER out of two ordinary primitives.
 *
 * This is the whole point of the slice: there is no split op. The caller reads
 * the table, decides which item rows move, and issues
 *
 *   duplicate_table(keepRows: moving)   -> the second table
 *   delete_row(rows: moving)            -> the first table
 *
 * The row set is the only thing that changes between "split after row 2", "move
 * the odd rows" and "move the fruits", which is why those are one path and not
 * three.
 */
function splitCosts(editor: DocumentEditor, splitAtRow: number) {
  const structure = deriveTableStructure({
    tableBlock: tableBlockOf(editor, 'costs'),
    headerRows: 1,
    tableId: 'costs',
    documentFormulas: documentFormulas(editor)
  });
  const moving = structure.rows
    .filter((row) => row.role === 'item' && row.index >= splitAtRow)
    .map((row) => row.index);
  if (!moving.length)
    throw new Error(
      `no item rows at or below ${splitAtRow} - the harness is wrong, not the engine`
    );
  const anchor = cellAnchorIn(editor, 'costs');
  return applyDocumentEdits(editor as unknown as LiveEditor, {
    edits: [
      { op: 'duplicate_table', anchor, rows: 'copy', keepRows: moving } as any,
      {
        op: 'delete_row',
        anchor: `0;${tableBlockIndex(editor, 'costs')};${moving[0]};0;0`,
        rows: moving
      } as any
    ]
  });
}

/** Both ops landed. Reported with their codes so a failure names itself. */
function expectComposed(result: any): void {
  expect(
    result.results.map((entry: any) => (entry.ok ? 'ok' : `${entry.error}`))
  ).toEqual(['ok', 'ok']);
}

describe('split_table composed from primitives, over a bound table', () => {
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

  // ---------------------------------------------------------------- (a)
  // The harness's own control. If this row fails, every row below is
  // uninterpretable, because it means the fixture is not the shape the
  // composition is being asked to handle.
  it('(a) HARNESS CONTROL: the fixture really is a bound table with items and a transitive aggregate', () => {
    const structure = deriveTableStructure({
      tableBlock: tableBlockOf(editor, 'costs'),
      headerRows: 1,
      tableId: 'costs',
      documentFormulas: documentFormulas(editor)
    });

    expect(structure.rows.map((row) => row.role)).toEqual([
      'header',
      'item',
      'item',
      'aggregate',
      'aggregate',
      'aggregate'
    ]);
    expect(
      structure.rows.filter((row) => row.role === 'item').map((row) => row.rowId)
    ).toEqual(['r-1', 'r-2']);

    // The transitive case specifically: `costs_tax` is mul(costs_subtotal,
    // tax_rate) and names no table at all. A rule that only matched a dotted
    // ref would call this row static and let a split strand it.
    expect(structure.rows[4]).toMatchObject({
      role: 'aggregate',
      aggregates: ['costs_tax']
    });
  });

  // ---------------------------------------------------------------- (b)
  it('(b) splits a bound table instead of refusing', () => {
    const result = splitCosts(editor, 2);

    // Reported with each op's own code rather than a bare ok:false, so a
    // failure here says WHICH behaviour is missing - and so a future unrelated
    // refusal cannot quietly stand in for this one.
    expectComposed(result);
    expect(result.results.map((entry: any) => entry.op)).toEqual([
      'duplicate_table',
      'delete_row'
    ]);

    // THE CAPABILITY BOUGHT BACK, stated as its own assertion. Splitting a
    // bound table used to be refused outright with this code, because the
    // selection the bespoke handler made would have deleted the content
    // controls rather than moved them. The composed path never makes a
    // selection over bindings at all, so the refusal has nothing to fire on.
    expect(
      result.results.map((entry: any) => entry.error).filter(Boolean)
    ).not.toContain('structural_op_would_destroy_bindings');
  });

  // ---------------------------------------------------------------- (c)
  it('(c) conserves every binding: no tag is lost, and each item row lands in exactly one half', () => {
    const before = tagsIn(tableBlockOf(editor, 'costs'));
    expect(before.length).toBeGreaterThan(0);

    expectComposed(splitCosts(editor, 2));

    const index = indexOf(editor);
    const ids = [...index.tables.keys()].filter((id) => id.startsWith('costs'));
    expect(ids).toHaveLength(2);
    const [first, second] = ids.map((id) => index.tables.get(id)!);

    // Item rows PARTITION. Row r-1 stays, r-2 moves; neither is duplicated and
    // neither is dropped. Row ids are rewritten in the clone, so this is
    // asserted on the count and on the visible item text rather than on ids.
    const itemText = (table: any): string[] =>
      table.rows
        .map((row: any) => row.bindings?.get('item')?.text)
        .filter(Boolean);
    expect(itemText(first)).toEqual(['Design work']);
    expect(itemText(second)).toEqual(['Development']);

    // Nothing vanished from the document as a whole.
    const after = [
      ...tagsIn(tableBlockOf(editor, ids[0])),
      ...tagsIn(tableBlockOf(editor, ids[1]))
    ];
    expect(after.length).toBeGreaterThanOrEqual(before.length);
  });

  // ---------------------------------------------------------------- (d)
  it('(d) duplicates the header band and every aggregate row into both halves', () => {
    expectComposed(splitCosts(editor, 2));

    const index = indexOf(editor);
    const ids = [...index.tables.keys()].filter((id) => id.startsWith('costs'));
    expect(ids).toHaveLength(2);

    const copyId = ids.find((id) => id !== 'costs') as string;
    expect(copyId).toBeTruthy();

    // THE COPY, read physically. header + ONE item + three aggregates. The
    // aggregates are what a naive "cut the rows in half" would leave on one
    // side only, stranding a total that silently no longer means anything.
    expect(
      deriveTableStructure({
        tableBlock: tableBlockOf(editor, copyId),
        headerRows: 1,
        tableId: copyId,
        documentFormulas: documentFormulas(editor)
      }).rows.map((row) => row.role)
    ).toEqual(['header', 'item', 'aggregate', 'aggregate', 'aggregate']);

    // THE SOURCE, which cannot be read the same way. Its delete is TRACKED, so
    // the removed row is still physically present until the change is
    // accepted - a physical role read sees two items and looks like the
    // partition failed. The binding index reports LIVE rows, which is the
    // reading that answers "what does the document say now".
    const sourceStructure = deriveTableStructure({
      tableBlock: tableBlockOf(editor, 'costs'),
      headerRows: 1,
      tableId: 'costs',
      documentFormulas: documentFormulas(editor)
    });
    expect(
      sourceStructure.rows.filter((row) => row.role === 'aggregate')
    ).toHaveLength(3);
    expect(sourceStructure.rows[0].role).toBe('header');
    expect(
      indexOf(editor)
        .tables.get('costs')!
        .rows.map((row: any) => row.bindings?.get('item')?.text)
        .filter(Boolean)
    ).toEqual(['Design work']);
  });

  // ---------------------------------------------------------------- (e)
  it("(e) re-scopes each half's aggregates to its own surviving rows", () => {
    expectComposed(splitCosts(editor, 2));

    const index = indexOf(editor);
    const ids = [...index.tables.keys()].filter((id) => id.startsWith('costs'));
    const cloneId = ids.find((id) => id !== 'costs')!;
    expect(cloneId).toBeTruthy();

    const cloneJson = JSON.stringify(tableBlockOf(editor, cloneId));

    // The clone's subtotal sums the CLONE's column, not the source's.
    expect(cloneJson).toContain(`sum(${cloneId}.line_total)`);
    // The negative control that makes the line above mean something: if the
    // expression rewrite had not run, the clone would still be summing `costs`
    // and both halves would show the same total.
    expect(cloneJson).not.toContain('sum(costs.line_total)');

    // The source half is correct BY CONSTRUCTION rather than by rewrite - it
    // still sums `costs`, which now has fewer rows. Asserted so a future change
    // that "helpfully" rewrites it too fails here.
    expect(JSON.stringify(tableBlockOf(editor, 'costs'))).toContain(
      'sum(costs.line_total)'
    );
  });

  // ---------------------------------------------------------------- (f)
  it('(f) leaves a separating paragraph, so Word does not render the halves as one table', () => {
    expectComposed(splitCosts(editor, 2));

    const blocks = parsed(editor).sections[0].blocks;
    const index = indexOf(editor);
    const ids = [...index.tables.keys()].filter((id) => id.startsWith('costs'));
    const positions = ids
      .map((id) => tableBlockIndex(editor, id))
      .sort((a, b) => a - b);
    expect(positions[1] - positions[0]).toBeGreaterThan(1);

    const between = blocks.slice(positions[0] + 1, positions[1]);
    expect(between.some((block: any) => block.rows)).toBe(false);
    expect(between.some((block: any) => Array.isArray(block.inlines))).toBe(
      true
    );
  });

  // ---------------------------------------------------------------- (g)
  it('(g) records a footprint for BOTH halves so the finalizer restripes each', () => {
    const result = splitCosts(editor, 2);
    expectComposed(result);

    // NO TEST SEAM EXISTS FOR THE RECEIPT ITSELF, and this row says so rather
    // than pretending otherwise.
    //
    // The first draft read `result.tableFootprints` and failed with an empty
    // array. That is correct behaviour, not a bug: `collectOpExtras` DELETES
    // tableFootprints from the model-facing result on purpose - the guard added
    // in slice 2 after a split's result came back carrying them - and
    // editResultSurface.spec.ts pins that boundary. The recorded footprints
    // live only in the change-set runner's own array.
    //
    // So what is asserted here is the OBSERVABLE consequence the footprints
    // exist to enable: the composition really did leave two separate bound
    // tables, each identifiable by its own id, which is what the finalizer
    // resolves against. Proving the receipt itself needs a test-only observer
    // like the one `_setMutationGuardObserver` provides for guard coverage;
    // that seam does not exist yet and is filed rather than faked.
    const index = indexOf(editor);
    const ids = [...index.tables.keys()].filter((id) => id.startsWith('costs'));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);

    // Each half is separately addressable by identity - the property a
    // footprint resolves by, and the reason the dormant `tableId` field was
    // designed in before there was a producer for it.
    for (const id of ids) {
      expect(index.tables.get(id)).toBeTruthy();
      expect(tableBlockIndex(editor, id)).toBeGreaterThanOrEqual(0);
    }
    expect(result.results.every((entry: any) => entry.ok)).toBe(true);
  });
});

/**
 * The footprint receipt, proved through its CONSUMER.
 *
 * Row (g) can only assert the observable shape, because the receipt is stripped
 * from the model-facing result by design. The finalizer is what CONSUMES the
 * receipt, and its output does surface - as change-set warnings - so this is
 * where a recorded footprint becomes visible without adding a production seam
 * that exists only for tests.
 */
describe('the finalizer consumes both halves of a composed split', () => {
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

  it('(h) runs the finalizer over the change set, reaching both tables', () => {
    const result: any = splitCosts(editor, 2);
    expectComposed(result);

    // WHAT THIS PROVES, AND WHAT IT DOES NOT. Measured 2026-08-28.
    //
    // The finalizer runs over this change set - it is invoked whenever
    // footprints were recorded, and a throw inside it would have failed the set
    // rather than reaching this line. So the receipt IS being consumed.
    //
    // It does NOT prove both halves were restriped, and the reason is the
    // fixture rather than the engine: the costs table carries no banding, so
    // `detectTableBanding` finds no cycle and the finalizer correctly has
    // nothing to re-lay. The observed warnings are the serialization counter
    // alone - no appearance write, and no decline either.
    //
    // Demonstrating a restripe needs a BANDED fixture, and demonstrating it
    // honestly needs a browser, because the finalizer computes striping from
    // the accept projection and jsdom cannot lay out the page. Phase 2's
    // striping ledger row carries that proof. This row exists so the consumer
    // is exercised at all, and so a future change that makes the finalizer
    // throw on a two-footprint set fails here rather than in a browser.
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(
      (result.warnings as string[]).some((warning) =>
        warning.includes('finalize_failed')
      )
    ).toBe(false);
    expect(
      [...indexOf(editor).tables.keys()].filter((id) => id.startsWith('costs'))
    ).toHaveLength(2);
  });
});
