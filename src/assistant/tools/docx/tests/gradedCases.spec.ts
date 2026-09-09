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
  it('case 1 (BOUND): a positional split of the flagship inventory table LANDS', () => {
    // THE HEADLINE CASE, and for two slices it could not run: splitting a bound
    // table was refused outright, because the native op captures the table
    // through a selection and that paste drops content controls - measured in a
    // browser destroying ten of eleven binding tags on accept.
    //
    // The engine now COMPILES a bound split into duplicate_table with keepRows
    // plus delete_row of the same rows (compileTableSplit), both of which route
    // through the binding engine, so the refusal has nothing left to protect
    // here. This row is the real case 1 at last.
    //
    // No targetAnchor: placement is engine-owned for a split. The row below
    // pins what happens when one is supplied anyway.
    const live = open();
    const anchor = cellAnchorContaining('Gala apples');
    expect(anchor).not.toBeNull();
    const before = editor.serialize();
    const result = apply(
      live,
      [{ op: 'split_table', anchor, splitAtRow: 8, group: 'g' }],
      'graded-case-1'
    );
    // ONE result under the op the model sent, not the two children it compiled
    // into - the collapse is part of the contract, because a split is one card.
    expect(result.results).toHaveLength(1);
    expect([result.results[0].ok, result.results[0].op]).toEqual([
      true,
      'split_table'
    ]);
    expect(editor.serialize()).not.toBe(before);
    // NOTHING WAS DESTROYED, counted by binding NAME rather than by tag text:
    // the moved rows arrive under fresh row ids and a reference that named the
    // shrinking aggregate is rewritten, so tag strings legitimately change
    // while no name may go missing.
    const census = (sfdt: string): Map<string, number> => {
      const out = new Map<string, number>();
      for (const hit of sfdt.matchAll(/\[\[name=([^|\]]+)/g)) {
        const name = hit[1];
        out.set(name, (out.get(name) ?? 0) + 1);
      }
      return out;
    };
    const was = census(before);
    const now = census(editor.serialize());
    expect(
      [...was].filter(([name, count]) => (now.get(name) ?? 0) < count)
    ).toEqual([]);
  });

  // THE WIRE SHAPE, and the nondeterminism it caused.
  //
  // ai-services' tool schema asks the model for
  // `{anchor, splitAtRow, targetAnchor, position}` (documentTools.ts
  // OP_DESCRIPTIONS.split_table), so a real split ALWAYS arrives carrying a
  // targetAnchor. Which block it names varies run to run - the table itself, a
  // cell in it, or the block after it - and all three describe the one place a
  // composed split can put the copy. Demanding exact equality with "the block
  // after the source" refused about one prompt in four on the captain's own
  // document, reported to him as "the editor wouldn't accept the Property
  // Premium Detail table as the target".
  //
  // Each spelling gets its own row rather than a loop: when one regresses, the
  // name of the failing test says which spelling broke.
  const splitWith = (extra: Record<string, unknown>, id: string) => {
    const live = open();
    const anchor = cellAnchorContaining('Gala apples');
    expect(anchor).not.toBeNull();
    const tableAnchor = String(anchor).split(';').slice(0, 2).join(';');
    const after = `0;${Number(tableAnchor.split(';')[1]) + 1}`;
    const result = apply(
      live,
      [{ op: 'split_table', anchor, splitAtRow: 8, group: 'g', ...extra }],
      id
    );
    return { result, anchor: String(anchor), tableAnchor, after };
  };

  it('case 1b (TARGET, the table itself): the split proceeds', () => {
    const live = open();
    const anchor = cellAnchorContaining('Gala apples');
    const tableAnchor = String(anchor).split(';').slice(0, 2).join(';');
    const result = apply(
      live,
      [
        {
          op: 'split_table',
          anchor,
          splitAtRow: 8,
          targetAnchor: tableAnchor,
          position: 'after',
          group: 'g'
        }
      ],
      'graded-case-1b'
    );
    expect([result.results[0].ok, result.results[0].error]).toEqual([
      true,
      undefined
    ]);
  });

  it('case 1c (TARGET, a cell inside the table): the split proceeds', () => {
    const { result } = splitWith(
      { targetAnchor: cellAnchorContaining('Gala apples'), position: 'after' },
      'graded-case-1c'
    );
    expect(result.results[0].ok).toBe(true);
  });

  it('case 1d (TARGET, the block after the table): the split proceeds', () => {
    const live = open();
    const anchor = cellAnchorContaining('Gala apples');
    const block = Number(String(anchor).split(';')[1]);
    const result = apply(
      live,
      [
        {
          op: 'split_table',
          anchor,
          splitAtRow: 8,
          targetAnchor: `0;${block + 1}`,
          position: 'after',
          group: 'g'
        }
      ],
      'graded-case-1d'
    );
    expect(result.results[0].ok).toBe(true);
  });

  it('case 1e (TARGET, a DIFFERENT table): refused, naming what it resolved to', () => {
    // The case that must still fail: the model meant a placement, and the
    // composed split cannot honour one. Aimed at the unbound regional table.
    const live = open();
    const anchor = cellAnchorContaining('Gala apples');
    const elsewhere = cellAnchorContaining('North');
    expect(elsewhere).not.toBeNull();
    const before = editor.serialize();
    const result = apply(
      live,
      [
        {
          op: 'split_table',
          anchor,
          splitAtRow: 8,
          targetAnchor: String(elsewhere).split(';').slice(0, 2).join(';'),
          position: 'after',
          group: 'g'
        }
      ],
      'graded-case-1e'
    );
    expect(result.results[0].ok).toBe(false);
    expect(result.results[0].error).toBe('split_table_target_elsewhere');
    // It has to say what the anchor actually hit, or the model cannot correct.
    expect(result.results[0].message).toContain('a different table at');
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

  it('case 2 control: a CONTIGUOUS request on the same table SUCCEEDS', () => {
    // A real control, not a restatement. The previous version of this row sent
    // the same unsayable request as case 2 and asserted the same refusal, which
    // proved nothing case 2 had not already proved.
    //
    // What needs ruling out is that case 2's refusal comes from the table, the
    // anchor, or the document rather than from the missing vocabulary. So this
    // sends a request the op CAN express - a contiguous cut at one point, on the
    // same table, through the same anchor - and requires it to succeed. Case 2
    // refuses and this one does not, so the difference is the request.
    const live = open();
    const anchor = cellAnchorContaining('North');
    const contiguous = apply(
      live,
      [
        {
          op: 'split_table',
          anchor,
          splitAtRow: 3,
          // A real paragraph, not '0;0' - that one lands inside a table and the
          // op refuses with relocation_target_in_table. Worth recording: case 2
          // never reached that check, because a missing row selection fails
          // first. Its error is the FIRST refusal, not the only one.
          targetAnchor: '0;9',
          position: 'before',
          group: 'g'
        } as any
      ],
      'graded-case-2-control'
    );
    expect(contiguous.results[0].ok).toBe(true);
  });
});
