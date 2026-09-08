/**
 * THE LAW: splitting a table changes presentation, never document totals.
 *
 * MEASURED IN A REAL BROWSER, on a real client document, 2026-09-08. The
 * flagship proposal carries a Premium Summary table whose lines reference the
 * schedules' aggregate bindings: Property $22,054.40 + Liability $20,005.40 +
 * Motor Fleet $33,607.55 = $75,667.35, tax $6,431.72, payable $82,099.07. The
 * assistant split the Property schedule after "Contents" into fragments of
 * $11,008.00 and $11,046.40 - and the pending change set rewrote the summary as
 * if the premium were ONLY the first fragment: total $64,620.95, payable
 * $70,113.73. Reproduced twice; a Liability split gave $74,300.80. Whole-row
 * deletes recompute correctly, because there the money really did leave the
 * document. The split path is the defect: the money only MOVED.
 *
 * THE MECHANISM, pinned below at the engine. An aggregate is a document-level
 * formula whose expression reaches a table by a dotted ref
 * (`sum(schedule.line_total)`), directly or through another formula. A split is
 * composed as `duplicate_table` with `keepRows` plus `delete_row` of the
 * complement, and `duplicate_table` mints FRESH names for everything it copies
 * (`schedule_subtotal` -> `schedule_copy_subtotal`) while rewriting only the
 * CLONE's expressions. So after the split the original aggregate survives in
 * fragment one and correctly recomputes to fragment one's rows, the copy's
 * aggregate is a new binding nobody outside references, and every formula
 * OUTSIDE the table still names the original - which now means half.
 *
 * That asymmetry is deliberate for a COPY (copyFidelity.spec.ts: "a copy must
 * never steal references that pointed at its source") and it is the whole
 * defect for a SPLIT. A copy leaves the source whole; a split does not.
 *
 * WHAT THE FIX OWES, as the skipped rows below state it: every formula outside
 * the split table that references one of its aggregates is rewritten, in the
 * SAME tracked change set, to the sum of the corresponding aggregates of ALL
 * fragments. Per-fragment subtotals rescope to their own items. Accept leaves
 * the summary showing the original figures; reject unwinds the rewrite with the
 * rest of the card.
 *
 * HOW IT IS EXPRESSED, since the transport the split already used could not
 * carry it. `diffBindingCommands` emitted `set-value` only for FIELD bindings
 * and carried a whole SFDT block only for a table being added or removed, so an
 * expression change to a formula in an EXISTING control produced no command at
 * all and was dropped between the in-memory projection and the live document.
 * It now emits `set-expression`, diffed by NAME because the tag is what
 * changed, and the controller applies it as a `retag-control` structural
 * mutation - the one mutation that moves no content, because an expression
 * lives in a tag and SyncFusion revisions content rather than tags.
 *
 * That is also why the rewrite owes an inverse, and why the inverse asks the
 * DOCUMENT rather than the outcome: per the TRIGGER row an unresolved reference
 * is not a soft failure, it renders the cell as an ellipsis and blocks save
 * outright. `ExpressionRestore` carries the binding the rewrite was made to
 * reach, and one idempotent sweep - bound to the revision group, re-run after
 * every history step - serves reject, multi-press undo, redo and a rolled-back
 * change set alike.
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
import {
  BANDED_PROPOSAL_EXPECTED,
  buildBandedProposalFixture
} from '../../../../elements/components/DocxEditor/bindings/core/tests/fixtures/bandedProposalFixture';
import {
  attachBindings,
  AttachedBindings
} from '../../../../elements/components/DocxEditor/bindings/attachBindings';
import { SyncfusionEditorLike } from '../../../../elements/components/DocxEditor/bindings/editorAdapter';
import { scanBindings } from '../../../../elements/components/DocxEditor/bindings/core/sfdtAdapter';
import { applyRules } from '../../../../elements/components/DocxEditor/bindings/core/engine';
import {
  listRevisionGroups,
  resolveLiveRevisionGroupsAsOneUndo
} from '../../../../utils/documentEditorPrimitives';

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

function makeEditor(sfdt: any): DocumentEditor {
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

const parsed = (editor: DocumentEditor) => JSON.parse(editor.serialize());
const indexOf = (editor: DocumentEditor) => scanBindings(parsed(editor));

/** Every document-level formula's rendered text, by name. */
function formulaValues(editor: DocumentEditor): Record<string, string> {
  const out: Record<string, string> = {};
  for (const occurrence of indexOf(editor).occurrences)
    if (occurrence.def.kind === 'formula') out[occurrence.name] = occurrence.text;
  if (!Object.keys(out).length)
    throw new Error(
      'no formulas were readable - the harness is wrong, not the engine'
    );
  return out;
}

function documentFormulas(editor: DocumentEditor): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, occurrences] of indexOf(editor).formulas) {
    const expression = (occurrences as any[])[0]?.def?.expression;
    if (typeof expression === 'string') out.set(name, expression);
  }
  return out;
}

/** The top-level block holding the schedule's marker; the anchor's block index. */
function scheduleBlockIndex(editor: DocumentEditor): number {
  const found = parsed(editor).sections[0].blocks.findIndex((block: any) =>
    JSON.stringify(block).includes('[[table=schedule]]')
  );
  if (found < 0)
    throw new Error(
      'fixture has no schedule marker - the harness is wrong, not the engine'
    );
  return found;
}

/** The schedule's table node, reached by its indexed path in either dialect. */
function scheduleTableBlock(editor: DocumentEditor): any {
  const path = indexOf(editor).tables.get('schedule')?.tablePath;
  if (!path)
    throw new Error(
      'fixture has no bound schedule table - the harness is wrong, not the engine'
    );
  let node: any = parsed(editor);
  for (const segment of path) node = node?.[segment as any];
  if (!Array.isArray(node?.rows))
    throw new Error(
      'the schedule path does not reach a table - the harness is wrong, not the engine'
    );
  return node;
}

/** The banded schedule's group header plus its column header. */
const SCHEDULE_HEADER_ROWS = 2;

function scheduleStructure(editor: DocumentEditor) {
  return deriveTableStructure({
    tableBlock: scheduleTableBlock(editor),
    headerRows: SCHEDULE_HEADER_ROWS,
    tableId: 'schedule',
    documentFormulas: documentFormulas(editor)
  });
}

/** The composition the assistant issues for a split: no split op exists. */
function splitSchedule(editor: DocumentEditor, splitAtRow: number) {
  const moving = scheduleStructure(editor)
    .rows.filter((row) => row.role === 'item' && row.index >= splitAtRow)
    .map((row) => row.index);
  if (!moving.length)
    throw new Error(
      `no item rows at or below ${splitAtRow} - the harness is wrong, not the engine`
    );
  const blockIndex = scheduleBlockIndex(editor);
  return applyDocumentEdits(editor as unknown as LiveEditor, {
    edits: [
      {
        op: 'duplicate_table',
        anchor: `0;${blockIndex};0;0;0`,
        rows: 'copy',
        keepRows: moving
      } as any,
      {
        op: 'delete_row',
        anchor: `0;${blockIndex};${moving[0]};0;0`,
        rows: moving
      } as any
    ]
  });
}

const cardGroups = (editor: DocumentEditor) =>
  listRevisionGroups(editor as any).map((view: any) => ({
    changeSetId: view.changeSetId,
    group: view.group,
    untagged: view.untagged
  }));

/** Each op's outcome, by code, so a harness failure names itself. */
const outcomes = (result: any): string[] =>
  result.results.map((entry: any) => (entry.ok ? 'ok' : entry.error));

/**
 * Split after the fourth item, so both fragments are non-trivial and the
 * arithmetic is checkable by hand: rows 2-4 keep items 0-2, rows 5-7 move items
 * 3-5. The oracle below is the fixture's own generator, never a literal.
 */
const SPLIT_AT = 5;
const KEPT_ITEMS = [0, 1, 2];
const MOVED_ITEMS = [3, 4, 5];

const WHOLE = {
  subtotal: BANDED_PROPOSAL_EXPECTED.scheduleSubtotal,
  tax: BANDED_PROPOSAL_EXPECTED.scheduleTax,
  total: BANDED_PROPOSAL_EXPECTED.scheduleTotal
};
const FIRST_FRAGMENT = BANDED_PROPOSAL_EXPECTED.subtotalWithout(MOVED_ITEMS);
const SECOND_FRAGMENT = BANDED_PROPOSAL_EXPECTED.subtotalWithout(KEPT_ITEMS);

describe('a table split conserves the document totals', () => {
  let editor: DocumentEditor;
  let attached: AttachedBindings;

  beforeEach(() => {
    editor = makeEditor(buildBandedProposalFixture());
    attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: false
    });
  });

  afterEach(() => {
    attached.dispose();
    const element = editor.element;
    editor.destroy();
    element?.remove();
  });

  // ------------------------------------------------------------------ control
  // The harness's own negative control. If this fails, nothing below is
  // interpretable: it would mean the fixture is not the shape that broke.
  it('CONTROL: the summary reads the schedule, and the schedule is splittable', () => {
    expect(scheduleStructure(editor).rows.map((row) => row.role)).toEqual([
      'header',
      'header',
      'item',
      'item',
      'item',
      'item',
      'item',
      'item',
      'aggregate',
      'aggregate',
      'aggregate'
    ]);
    // Three summary lines outside the table, all reaching schedule_subtotal:
    // one by a bare reference, one through a multiplication, one through
    // another summary line.
    expect(documentFormulas(editor).get('summary_property')).toBe(
      'schedule_subtotal'
    );
    expect(formulaValues(editor)).toMatchObject({
      schedule_subtotal: WHOLE.subtotal,
      summary_property: WHOLE.subtotal,
      summary_tax: WHOLE.tax,
      summary_total: WHOLE.total
    });
  });

  // ---------------------------------------------------------- the mechanism
  it('TRIGGER, pinned at the engine: the copy is a new binding, and a dangling reference is fatal', () => {
    expect(outcomes(splitSchedule(editor, SPLIT_AT))).toEqual(['ok', 'ok']);

    // The copy's aggregate exists under a FRESH name that nothing outside the
    // table would have named on its own - the mechanism the law has to work
    // around - and the outside formula now names both fragments.
    const expressions = documentFormulas(editor);
    expect(expressions.get('schedule_copy_subtotal')).toBe(
      'sum(schedule_copy.line_total)'
    );
    expect(expressions.get('summary_property')).toBe(
      'sum(schedule_subtotal,schedule_copy_subtotal)'
    );

    // And rewriting it is not a free move: a reference the document cannot
    // resolve is a BLOCKING evaluation error that renders the cell as an
    // ellipsis, not a term that quietly contributes nothing. This is why the
    // rewrite owes an inverse bound to the card rather than being allowed to
    // survive a reject that removes the copy.
    const dangling = JSON.parse(JSON.stringify(buildBandedProposalFixture()));
    const retarget = (node: any): void => {
      if (Array.isArray(node)) return node.forEach(retarget);
      if (!node || typeof node !== 'object') return;
      const tag = node.contentControlProperties?.tag;
      if (typeof tag === 'string' && tag.includes('name=summary_property|'))
        node.contentControlProperties = {
          ...node.contentControlProperties,
          tag: tag.replace(
            /expr=[^|\]]*/,
            'expr=sum(schedule_subtotal,schedule_copy_subtotal)'
          )
        };
      for (const key of Object.keys(node)) retarget(node[key]);
    };
    retarget(dangling);
    const settled = applyRules(dangling);
    expect(
      settled.diagnostics.map((entry: any) => entry.severity + '/' + entry.code)
    ).toContain('error/evaluation-failed');
  });

  // ----------------------------------------------- the arithmetic, measured
  /**
   * The defect this file was opened for, now stated as the law it became. It
   * replaces the pinned `DEFECT` row rather than joining it: that row asserted
   * the summary drops to the first fragment, which is the thing being fixed,
   * and the repo's convention retires a defect pin with its fix.
   *
   * This is the captain's document at the fixture's scale. The two fragments
   * still add up to the whole, because nothing left the document - and every
   * figure outside the table still reads the whole, because the money only
   * moved.
   */
  it('LAW: the money only moved - the fragments add up and the summary is unmoved', () => {
    const before = formulaValues(editor);
    expect(outcomes(splitSchedule(editor, SPLIT_AT))).toEqual(['ok', 'ok']);
    const after = formulaValues(editor);

    expect(after.schedule_subtotal).toBe(FIRST_FRAGMENT);
    expect(after.schedule_copy_subtotal).toBe(SECOND_FRAGMENT);
    expect(
      Number(FIRST_FRAGMENT.replace(/[$,]/g, '')) +
        Number(SECOND_FRAGMENT.replace(/[$,]/g, ''))
    ).toBeCloseTo(Number(WHOLE.subtotal.replace(/[$,]/g, '')), 2);

    expect(before.summary_property).toBe(WHOLE.subtotal);
    expect(after.summary_property).toBe(WHOLE.subtotal);
    expect(after.summary_tax).toBe(WHOLE.tax);
    expect(after.summary_total).toBe(WHOLE.total);
  });

  // ---------------------------------------------------------------- the law
  it('LAW: the pending change set leaves every outside total at its pre-split figure', () => {
    const before = formulaValues(editor);
    expect(outcomes(splitSchedule(editor, SPLIT_AT))).toEqual(['ok', 'ok']);
    const after = formulaValues(editor);

    expect(after.summary_property).toBe(before.summary_property);
    expect(after.summary_tax).toBe(before.summary_tax);
    expect(after.summary_total).toBe(before.summary_total);
  });

  // Already true, and pinned so it stays true: the half of the law the split
  // gets right today is the half the rewrite must not disturb.
  it('LAW: each fragment subtotals its own items', () => {
    expect(outcomes(splitSchedule(editor, SPLIT_AT))).toEqual(['ok', 'ok']);
    const after = formulaValues(editor);

    expect(after.schedule_subtotal).toBe(FIRST_FRAGMENT);
    expect(after.schedule_copy_subtotal).toBe(SECOND_FRAGMENT);
  });

  it('LAW: the rewrite is part of the card - accept leaves the original figures standing', () => {
    const before = formulaValues(editor);
    expect(outcomes(splitSchedule(editor, SPLIT_AT))).toEqual(['ok', 'ok']);

    resolveLiveRevisionGroupsAsOneUndo(editor as any, cardGroups(editor), true);

    expect(editor.revisions.length).toBe(0);
    const after = formulaValues(editor);
    expect(after.summary_property).toBe(before.summary_property);
    expect(after.summary_tax).toBe(before.summary_tax);
    expect(after.summary_total).toBe(before.summary_total);
    // Every outside reference now reaches BOTH fragments, so a later edit to
    // either one keeps the summary right. That is the durable half of the law.
    expect(documentFormulas(editor).get('summary_property')).toContain(
      'schedule_copy_subtotal'
    );
  });

  /**
   * Already true, and the load-bearing tripwire for the work still owed.
   *
   * Reject restores the split byte for byte today, because today nothing
   * outside the table is touched. The moment the rewrite lands without an
   * inverse bound to the card, this row goes red - and it is the ONLY row that
   * would, because a value-only comparison cannot see a left-behind expression.
   * A left-behind `schedule_copy_subtotal` after the copy is gone is not a
   * cosmetic residue: per the TRIGGER row it renders the summary as an ellipsis
   * and blocks save on a client's document.
   */
  /**
   * The other way a pending card goes away, and the one no revision resolution
   * ever sees: nothing is accepted or rejected, the history simply walks the
   * copy back out of the document. A rewrite left standing after the copy is
   * gone is the fatal case - per the TRIGGER row an unresolved reference blocks
   * save - so the inverse cannot be hung off accept and reject alone.
   *
   * Asserted as an INVARIANT at every press rather than only at the end, which
   * is both stronger and the only reading this SDK permits here. Multi-press is
   * the real shape (a split is deliberately not one grouped undo entry; see the
   * note at `applyDocumentEdits`), and measured on 34.1.31 under jsdom the
   * SDK's own `revert` of the inserted fragment throws inside `reLayout`
   * (`getSplitWidgets` of undefined) after 13 presses, with the fragment still
   * in the document - an SDK limitation that predates and is untouched by the
   * expression rewrite, which authors no history entry of its own. So the walk
   * is pinned step by step, and the terminal state - copy gone, expression
   * back, byte for byte - is pinned by the reject row below, which reaches it.
   */
  it('LAW: the expression names the copy at every undo press, and only while the copy is there', () => {
    expect(documentFormulas(editor).get('summary_property')).toBe(
      'schedule_subtotal'
    );
    expect(outcomes(splitSchedule(editor, SPLIT_AT))).toEqual(['ok', 'ok']);

    const agrees = () => {
      const formulas = documentFormulas(editor);
      const summary = formulas.get('summary_property') ?? '';
      // The fatal state stated positively: an expression may name the copied
      // fragment only while the copied fragment is there to be named.
      return (
        summary.includes('schedule_copy_subtotal') ===
        formulas.has('schedule_copy_subtotal')
      );
    };
    expect(agrees()).toBe(true);

    let presses = 0;
    for (; presses < 40 && editor.revisions.length; presses++) {
      try {
        editor.editorHistory.undo();
      } catch {
        // The SDK gave out mid-revert; the state it left must still agree.
        break;
      }
      expect(agrees()).toBe(true);
    }
    // Non-vacuous: the walk really did press, and really did unwind revisions.
    expect(presses).toBeGreaterThan(1);
    expect(editor.revisions.length).toBeLessThan(9);
    expect(agrees()).toBe(true);
  });

  /**
   * The one case the law cannot answer, and so refuses rather than guesses.
   *
   * Rewriting an outside reference to the sum of the fragments is only correct
   * when the thing referenced is a TOTAL. Here the summary reads one item's own
   * figure - a document-level binding sitting in an item row - and the split
   * moves that row into the copy, where it is renamed. There is no total to add
   * up in its place and no honest guess about what the author meant, so the
   * whole change set is refused and the document is left exactly as it was.
   */
  it('LAW: a split that moves an item an outside total reads is refused, not guessed', () => {
    attached.dispose();
    editor.destroy();
    editor.element?.remove();

    const fixture = JSON.parse(JSON.stringify(buildBandedProposalFixture()));
    // The last item row's own label control becomes a document-level figure the
    // summary reads directly. Nothing else references `item`, so every oracle
    // above still holds.
    const itemControls: any[] = [];
    const visit = (node: any): void => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== 'object') return;
      const tag = node.contentControlProperties?.tag;
      if (typeof tag === 'string' && tag.includes('name=item|'))
        itemControls.push(node);
      for (const key of Object.keys(node)) visit(node[key]);
    };
    visit(fixture);
    expect(itemControls.length).toBeGreaterThan(MOVED_ITEMS[0]);
    const moved = itemControls[itemControls.length - 1];
    moved.contentControlProperties = {
      ...moved.contentControlProperties,
      tag: '[[name=flagship_item|type=currency|default=500]]'
    };
    const retarget = (node: any): void => {
      if (Array.isArray(node)) return node.forEach(retarget);
      if (!node || typeof node !== 'object') return;
      const tag = node.contentControlProperties?.tag;
      if (typeof tag === 'string' && tag.includes('name=summary_property|'))
        node.contentControlProperties = {
          ...node.contentControlProperties,
          tag: tag.replace(
            /expr=[^|\]]*/,
            'expr=sum(schedule_subtotal,flagship_item)'
          )
        };
      for (const key of Object.keys(node)) retarget(node[key]);
    };
    retarget(fixture);

    editor = makeEditor(fixture);
    attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: false
    });
    expect(documentFormulas(editor).get('summary_property')).toBe(
      'sum(schedule_subtotal,flagship_item)'
    );

    const before = editor.serialize();
    const results = splitSchedule(editor, SPLIT_AT);
    expect(outcomes(results)[0]).toBe('split_moves_referenced_item');
    // A refusal is plain language about the captain's document, and it names
    // both the total that would break and the item that moved.
    const message = String(results.results[0].message ?? '');
    expect(message).toContain('summary_property');
    expect(message).toContain('flagship_item');
    expect(message).not.toMatch(/undefined|\[object|scanBindings/);
    // And the document is exactly as it was: no fragment, no rewrite.
    expect(editor.serialize()).toBe(before);
    expect(documentFormulas(editor).get('summary_property')).toBe(
      'sum(schedule_subtotal,flagship_item)'
    );
  });

  it('LAW: reject restores the document byte for byte, expressions included', () => {
    const before = editor.serialize();
    expect(outcomes(splitSchedule(editor, SPLIT_AT))).toEqual(['ok', 'ok']);

    resolveLiveRevisionGroupsAsOneUndo(editor as any, cardGroups(editor), false);

    expect(editor.revisions.length).toBe(0);
    expect(editor.serialize()).toBe(before);
  });
});
