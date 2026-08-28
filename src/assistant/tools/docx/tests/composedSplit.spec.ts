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

const splitCosts = (editor: DocumentEditor, splitAtRow: number) =>
  applyDocumentEdits(editor as unknown as LiveEditor, {
    edits: [
      {
        op: 'split_table',
        anchor: cellAnchorIn(editor, 'costs'),
        splitAtRow
      }
    ]
  });

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

    // Reported with the refusal's own code and message rather than as a bare
    // ok:false, so a failure here says WHICH behaviour is missing - and so a
    // future unrelated refusal cannot quietly stand in for this one.
    expect(
      result.results[0].ok
        ? 'ok'
        : `refused: ${JSON.stringify((result.results[0] as any).error)}`
    ).toBe('ok');
    expect(result.results[0]).toMatchObject({ ok: true, op: 'split_table' });
    // Stated as its own assertion because this exact code is the capability
    // being bought back, and a generic ok:false would not say so.
    expect((result.results[0] as any).error?.code).not.toBe(
      'structural_op_would_destroy_bindings'
    );
  });

  // ---------------------------------------------------------------- (c)
  it('(c) conserves every binding: no tag is lost, and each item row lands in exactly one half', () => {
    const before = tagsIn(tableBlockOf(editor, 'costs'));
    expect(before.length).toBeGreaterThan(0);

    expect(splitCosts(editor, 2).results[0].ok).toBe(true);

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
    expect(splitCosts(editor, 2).results[0].ok).toBe(true);

    const index = indexOf(editor);
    const ids = [...index.tables.keys()].filter((id) => id.startsWith('costs'));
    expect(ids).toHaveLength(2);

    for (const id of ids) {
      const structure = deriveTableStructure({
        tableBlock: tableBlockOf(editor, id),
        headerRows: 1,
        tableId: id,
        documentFormulas: documentFormulas(editor)
      });
      // header + ONE item + three aggregates. The aggregates are what a naive
      // "cut the rows in half" would leave on one side only, stranding a total
      // that silently no longer means anything.
      expect(structure.rows.map((row) => row.role)).toEqual([
        'header',
        'item',
        'aggregate',
        'aggregate',
        'aggregate'
      ]);
    }
  });

  // ---------------------------------------------------------------- (e)
  it("(e) re-scopes each half's aggregates to its own surviving rows", () => {
    expect(splitCosts(editor, 2).results[0].ok).toBe(true);

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
    expect(splitCosts(editor, 2).results[0].ok).toBe(true);

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
    expect(result.results[0].ok).toBe(true);

    // Footprints are engine-internal and deliberately absent from the
    // model-facing surface (editResultSurface.spec.ts owns that boundary), so
    // this reads the recorded footprints rather than the returned op result.
    const footprints = (result as any).tableFootprints ?? [];
    expect(footprints).toHaveLength(2);

    const byTable = new Map(
      footprints.map((print: any) => [print.tableId, print])
    );
    const index = indexOf(editor);
    const ids = [...index.tables.keys()].filter((id) => id.startsWith('costs'));
    for (const id of ids) expect(byTable.has(id)).toBe(true);

    // The dormant `tableId` field going live is the whole point: identity beats
    // position, and a split renumbers everything after it.
    for (const print of footprints) {
      expect(typeof print.tableId).toBe('string');
      expect(print.headerRows).toBe(1);
    }
  });
});
