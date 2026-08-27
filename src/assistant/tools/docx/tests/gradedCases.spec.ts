/**
 * The graded case catalog, wired only as far as today's engine reaches.
 *
 * From data/docx-flagship-testdoc-spec.md. Case zero is the role spec in
 * tableStructure.spec.ts. The cases below are CHARACTERIZATION: each asserts
 * what the engine does TODAY and says in its comment what it must do once the
 * composer exists. They are deliberately not written as permanently-red tests -
 * a red suite teaches people to ignore red - so each one FAILS the day the
 * behaviour changes, which is the signal to come back and rewrite it.
 */
import 'jest-canvas-mock';
import * as fs from 'fs';
import * as path from 'path';
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
import {
  attachBindings,
  AttachedBindings
} from '../../../../elements/components/DocxEditor/bindings/attachBindings';
import { SyncfusionEditorLike } from '../../../../elements/components/DocxEditor/bindings/editorAdapter';

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

const flagship = fs.readFileSync(
  path.join(__dirname, 'corpus', 'flagship-proposal.sfdt.json'),
  'utf8'
);

let editor: DocumentEditor;
let attached: AttachedBindings | null = null;

afterEach(() => {
  attached?.dispose();
  attached = null;
});

/**
 * The binding engine must be ATTACHED or every op on a bound document refuses
 * with `binding_engine_unavailable` - which passes an `ok === false` assertion
 * for a reason that has nothing to do with the property under test. The first
 * version of both rows below did exactly that.
 */
const open = (): LiveEditor => {
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  document.body.appendChild(host);
  editor = new DocumentEditor({
    enableEditor: true,
    enableSfdtExport: true,
    enableSelection: true,
    enableEditorHistory: true,
    isReadOnly: false
  });
  editor.appendTo(host);
  editor.open(flagship);
  attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
    convertTokensOnOpen: false
  });
  return editor as unknown as LiveEditor;
};

/**
 * A CELL anchor whose text contains `text`, or null.
 *
 * The cell part is enforced, not hoped for. A paragraph anchor has two parts
 * and a cell anchor has five (`section;block;row;cell;paragraph`), and
 * split_table refuses anything else with `split_table_requires_cell_anchor` -
 * which is an `ok === false` that passes a careless assertion for entirely the
 * wrong reason. That happened here: searching for "North" matched the prose
 * "Northwind Grocers" at `0;3` long before the table cell at `0;10;1;0;0`, so
 * the row was measuring a bad anchor rather than the property it claimed.
 */
const cellAnchorContaining = (text: string): string | null => {
  const blocks = flattenSfdt(JSON.parse(editor.serialize())) as any[];
  const hit = blocks.find(
    (b) =>
      String(b.text ?? '').includes(text) &&
      String(b.anchor ?? '').split(';').length === 5
  );
  return hit?.anchor ?? null;
};

const apply = (live: LiveEditor, edits: any[], id: string) =>
  applyDocumentEdits(live, { changeSetId: id, edits }) as any;

describe('graded cases - what the engine reaches today', () => {
  it('case 1 (BOUND): a positional split of the flagship inventory table is REFUSED', () => {
    // The flagship's inventory table is bound in every cell, and slice 1
    // deliberately KEPT the refusal on splitting a bound table rather than
    // retiring it: browser measurement showed the underlying defect is still
    // live, destroying ten of eleven binding tags on accept.
    //
    // So the headline positional case cannot run on the document built for it,
    // and that is the honest state of the world rather than a gap in the test.
    // When the composer routes bound content through the binding-aware clone
    // path, this refusal goes and this row becomes the real case 1.
    const live = open();
    const anchor = cellAnchorContaining('Gala apples');
    expect(anchor).not.toBeNull();
    const before = editor.serialize();
    const result = apply(
      live,
      [
        {
          op: 'split_table',
          anchor,
          splitAtRow: 8,
          targetAnchor: '0;0',
          position: 'after',
          group: 'g'
        }
      ],
      'graded-case-1'
    );
    expect(result.results[0].ok).toBe(false);
    // The SPECIFIC refusal, not merely "not ok". The first version of this row
    // asserted only ok === false and passed on `binding_engine_unavailable`,
    // because the harness had not attached the binding engine - green for a
    // reason with nothing to do with the property.
    expect(result.results[0].error).toBe(
      'structural_op_would_destroy_bindings'
    );
    // Nothing was written: a refusal that half-edits is worse than no refusal.
    expect(editor.serialize()).toBe(before);
  });

  it('case 2 (PARITY PARTITION): has no representation in the op surface at all', () => {
    // "Move all the odd rows into a second table, keep the even ones here."
    //
    // This is not refused - it cannot be ASKED. split_table takes a single
    // `splitAtRow` number, so the only thing it can express is a contiguous cut
    // at one point. A parity partition names a non-contiguous SET of rows and
    // there is no parameter that carries one.
    //
    // Aimed at the UNBOUND regional table on purpose. Aimed at the bound
    // inventory table it was refused with structural_op_would_destroy_bindings,
    // which is a true refusal for an entirely different reason and proved
    // nothing about the vocabulary. An unbound table takes the bindings guard
    // out of the answer.
    //
    // That is the whole argument for the copy-then-delete-complements
    // decomposition: the capability is missing because the vocabulary cannot
    // say it, not because the implementation is incomplete. This row fails the
    // day the op grows a row selector - which is when the case becomes writable.
    const live = open();
    const anchor = cellAnchorContaining('North');
    expect(anchor).not.toBeNull();
    const before = editor.serialize();
    const result = apply(
      live,
      [
        {
          op: 'split_table',
          anchor,
          // The shape a parity partition would need. It is not part of the op.
          extractRows: [1, 3, 5],
          targetAnchor: '0;0',
          position: 'after',
          group: 'g'
        } as any
      ],
      'graded-case-2'
    );
    expect(result.results[0].ok).toBe(false);
    // The EXACT refusal, and it is the one that proves the claim:
    // `split_table_no_rows` means the op found no row selection at all. It did
    // not partially understand `extractRows` and it did not fall back to a
    // contiguous cut - the key is simply not part of the vocabulary, so the
    // request selected nothing. The day this reads anything else, the op has
    // grown a row selector and this case becomes writable for real.
    expect(result.results[0].error).toBe('split_table_no_rows');
    // And nothing was written: a contiguous split must never silently stand in
    // for a partition nobody could express.
    expect(editor.serialize()).toBe(before);
  });

  it('case 2 control: the op surface carries no non-contiguous row selector', () => {
    // The structural half of the same claim, independent of any document: a
    // contiguous cut point is the only row vocabulary split_table has. If this
    // ever reads false, the decomposition has started landing.
    const live = open();
    const anchor = cellAnchorContaining('North');
    const contiguousOnly = apply(
      live,
      [
        {
          op: 'split_table',
          anchor,
          extractRows: [1, 3, 5],
          targetAnchor: '0;0',
          position: 'after',
          group: 'g'
        } as any
      ],
      'graded-case-2-control'
    );
    // No splitAtRow was supplied, and extractRows means nothing to the op, so
    // the request cannot succeed by accident.
    expect(contiguousOnly.results[0].ok).toBe(false);
    expect(contiguousOnly.results[0].error).toBe('split_table_no_rows');
  });
});
