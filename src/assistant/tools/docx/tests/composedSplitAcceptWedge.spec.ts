/**
 * WEDGE-REPRO: the composed bound-table split whose group accept applies a
 * PREFIX of the card and then goes inert, silently.
 *
 * MEASURED IN A REAL BROWSER, on a real client document, 2026-09-08. One review
 * card: a composed split (duplicate_table with keepRows, plus delete_row of the
 * complement, and the summary formulas it re-expresses), 48 pending edits over 13
 * revisions, tracked. Clicking Accept applied 14 of the 49 and stopped at 35
 * pending. Every later accept path was INERT - the card's Accept again, accept
 * all with fresh element refs, per-edit "Accept this edit" - with no spinner and
 * no console error, for three minutes. Rejecting the remaining 35 then processed
 * 34 and left exactly ONE "Deletion" revision that refuses BOTH accept and
 * reject, over a document with 12 binding tags destroyed and the summary
 * corrupted. 14 + 34 + 1 = 49: ONE poisoned revision, sitting fifteenth in
 * document order, and the group abandoned around it in both directions.
 *
 * WHAT THIS FILE PINS, AND WHAT IT CANNOT.
 *
 * The poisoning of that single revision is layout-dependent and jsdom cannot
 * reach it - the same limitation the document-tail-table refusal in
 * `syncfusionDocumentOps.ts` documents, and for the same reason: accept-side
 * deletion walks laid-out widgets and jsdom does not paginate. What jsdom CAN
 * reach, and what actually produced the wedge the captain saw, is the layer
 * above: `resolveLiveRevisionGroupsAsOneUndo` only advances past a member that
 * THROWS. A member that resolves SILENTLY - no throw, still registered in
 * `editor.revisions` - is re-selected as the loop's head (accept) or tail
 * (reject) on every single iteration, so the loop spends its whole budget on
 * that one member, abandons every remaining member of the group, and returns as
 * if it had succeeded. One unresolvable revision therefore costs the caller the
 * entire rest of the card instead of costing it one edit.
 *
 * The trigger is pinned here too, at the SDK: `Revision.handleAcceptReject`
 * removes a revision from `editor.revisions` ONLY from inside `unlinkRangeItem`,
 * under `if (revision.getRange().length === 0)`. Its own range loop is
 * `while (this.getRange().length > 0)`, so a revision whose range is already
 * empty runs no iterations, deregisters nothing, throws nothing, and stays
 * pending forever - refusing accept and reject alike, exactly as the last
 * revision on the captain's document did.
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
import {
  listRevisionGroups,
  resolveLiveRevisionGroupsAsOneUndo,
  revisionIsUnresolvable
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
const jsdomGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((elt: Element) =>
  jsdomGetComputedStyle(elt)) as typeof window.getComputedStyle;
if (!(window.SVGElement.prototype as any).getBBox) {
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
}

/**
 * The costs fixture widened to `items` data rows by cloning r-2.
 *
 * Four item rows split after the second is the captain's card measured chip for
 * chip: 49 edits. The width is not decoration - a two-row fixture produces 29
 * and would not be the shape that wedged.
 */
function bigCostsFixture(items: number): any {
  const doc: any = JSON.parse(JSON.stringify(buildCostsFixture()));
  const wrapper = doc.sections[0].blocks.find(
    (block: any) => block?.contentControlProperties?.tag === '[[table=costs]]'
  );
  const tableBlock = wrapper.rows
    ? wrapper
    : wrapper.blocks.find((block: any) => block.rows);
  const template = JSON.stringify(tableBlock.rows[2]);
  const extra: any[] = [];
  for (let index = 3; index <= items; index++)
    extra.push(JSON.parse(template.split('row=r-2').join(`row=r-${index}`)));
  tableBlock.rows.splice(3, 0, ...extra);
  return doc;
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

function tableBlockIndex(editor: DocumentEditor, tableId: string): number {
  const found = parsed(editor).sections[0].blocks.findIndex(
    (block: any) =>
      block?.contentControlProperties?.tag === `[[table=${tableId}]]`
  );
  if (found < 0)
    throw new Error(
      `fixture has no top-level wrapper for "${tableId}" - the harness is wrong, not the engine`
    );
  return found;
}

function tableBlockOf(editor: DocumentEditor, tableId: string): any {
  const wrapper =
    parsed(editor).sections[0].blocks[tableBlockIndex(editor, tableId)];
  if (wrapper?.rows) return wrapper;
  const inner = (wrapper?.blocks ?? []).find((block: any) => block?.rows);
  if (!inner)
    throw new Error(
      `wrapper for "${tableId}" carries no table block - the harness is wrong, not the engine`
    );
  return inner;
}

function documentFormulas(editor: DocumentEditor): Map<string, string> {
  const out = new Map<string, string>();
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

/** The composition the assistant issues for a split: no split op exists. */
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
  const blockIndex = tableBlockIndex(editor, 'costs');
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

const liveRevisions = (editor: DocumentEditor): any[] =>
  Array.from({ length: editor.revisions.length }, (_, index) =>
    editor.revisions.get(index)
  );

const rangeLengthOf = (revision: any): number => {
  try {
    return (revision.getRange() ?? []).length;
  } catch {
    return -1;
  }
};

/** The card the rail would draw for this change set. */
const cardGroups = (editor: DocumentEditor) =>
  listRevisionGroups(editor as any).map((view: any) => ({
    changeSetId: view.changeSetId,
    group: view.group,
    untagged: view.untagged
  }));

const chipCount = (editor: DocumentEditor) =>
  listRevisionGroups(editor as any).reduce(
    (total: number, view: any) => total + view.items.length,
    0
  );

/**
 * Put one member of the group into the state SyncFusion leaves behind after an
 * accept-side deletion has already taken its content away: still registered in
 * `editor.revisions`, with an empty range.
 *
 * This is not a mock of a failure. It is the SDK's own orphan state, reached
 * through the SDK's own API - `unlinkRevisionFromItem` deregisters a revision
 * only `if (currentRevision.getRange(true).length === 0)`, and
 * `Revision.updateRevisionID` empties a range with exactly this loop - so
 * anything that unlinks a revision from its items without that final check
 * leaves precisely this object behind. The browser reaches it through the
 * laid-out row-deletion path that jsdom cannot run; the resulting object is the
 * same either way, and it is the object the resolve loop has to survive.
 */
function orphanOneMember(editor: DocumentEditor, position: number): any {
  const revision = liveRevisions(editor)[position];
  if (!revision) throw new Error(`no revision at ${position}`);
  for (const item of [...(revision.getRange() ?? [])]) {
    const index = item.getAllRevision?.().indexOf(revision) ?? -1;
    if (index >= 0) item.removeRevision(index);
  }
  if (rangeLengthOf(revision) !== 0)
    throw new Error(
      'the member did not orphan - the harness is wrong, not the engine'
    );
  if (!liveRevisions(editor).includes(revision))
    throw new Error(
      'the orphan deregistered itself - the harness is wrong, not the engine'
    );
  return revision;
}

const ITEMS = 4;
const SPLIT_AT = 2;

describe('a composed split accepts as a whole, or says which member it could not', () => {
  let editor: DocumentEditor;
  let attached: AttachedBindings;

  beforeEach(() => {
    editor = makeEditor(bigCostsFixture(ITEMS));
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
  // The harness's own negative control. If this row ever fails, nothing below
  // is interpretable: it would mean the fixture is not producing the card that
  // wedged, so the rows below would be measuring some other document.
  it('CONTROL: the fixture is the captain\'s card, and with every member healthy it accepts whole', () => {
    const result: any = splitCosts(editor, SPLIT_AT);
    expect(result.results.map((entry: any) => (entry.ok ? 'ok' : entry.error)))
      .toEqual(['ok', 'ok']);
    // The card the captain clicked: 48 edits over one group. It was 49 until
    // the split stopped changing the summary - conserving the document totals
    // leaves those lines reading exactly what they read before, and a line that
    // does not change is not an edit for the captain to review.
    expect(chipCount(editor)).toBe(48);
    expect(cardGroups(editor)).toHaveLength(1);
    expect(editor.revisions.length).toBeGreaterThan(1);

    resolveLiveRevisionGroupsAsOneUndo(editor as any, cardGroups(editor), true);

    expect(editor.revisions.length).toBe(0);
  });

  // ----------------------------------------------------------- the SDK trigger
  it('TRIGGER, pinned at the SDK: an empty-range revision refuses accept AND reject, silently', () => {
    expect(
      result0(splitCosts(editor, SPLIT_AT))
    ).toEqual(['ok', 'ok']);
    const orphan = orphanOneMember(editor, 0);
    const before = editor.revisions.length;

    // Neither direction throws, and neither deregisters it. `handleAcceptReject`
    // removes a revision only from inside `unlinkRangeItem`, which its
    // `while (this.getRange().length > 0)` loop never reaches on an empty range.
    expect(() => orphan.handleAcceptReject(true, false)).not.toThrow();
    expect(editor.revisions.length).toBe(before);
    expect(() => orphan.handleAcceptReject(false, false)).not.toThrow();
    expect(editor.revisions.length).toBe(before);
    expect(liveRevisions(editor)).toContain(orphan);
  });

  // ----------------------------------------------------- the defect, now fixed
  // Was the pinned defect, measured 2026-09-08 and green while the wedge was
  // real: with the poison sixth of eleven in document order, accepting the card
  // left SIX pending (the poison and every member after it) and spent 341 of
  // its 348 resolve attempts on the one object that could not move - the
  // captain's "14 applied, then three minutes of nothing", at this scale.
  //
  // Flipped to assert the FIXED behavior, over the same fixture and the same
  // poison, so the numbers that were the defect are the numbers that would come
  // back if the non-progress law were ever removed.
  it('DEFECT, fixed: one unresolvable member costs one edit, not the tail of the card', () => {
    expect(result0(splitCosts(editor, SPLIT_AT))).toEqual(['ok', 'ok']);
    const total = editor.revisions.length;
    const poisonAt = Math.floor(total / 2);
    const orphan = orphanOneMember(editor, poisonAt);
    const touches = countResolveAttempts(orphan);

    const attempts = resolveLiveRevisionGroupsAsOneUndo(
      editor as any,
      cardGroups(editor),
      true
    );

    // Same fixture, same poison position: the shape the measurement was taken
    // on, less the two summary writes the split no longer makes now that it
    // conserves the document totals.
    expect(total).toBe(9);

    // The poison still cannot MOVE - nothing here pretends to resolve it - and
    // it no longer takes the five members after it down with it. It is also no
    // longer LEFT: an empty range is no edit at all, so the card finishes and
    // the leak is retired with it. See `purgeUnresolvableRevisions`.
    expect(liveRevisions(editor).length).toBe(0);
    expect(liveRevisions(editor).includes(orphan)).toBe(false);

    // The loop no longer SPINS. Counted at the poison itself, which is the only
    // place the spin was ever visible: it is tried ONCE, recognized as
    // non-progressing, and stepped over - against 341 tries out of 348 before.
    expect(touches()).toBe(1);

    // And it is in NEITHER list: it did not resolve, because it was never an
    // edit, and it is not outstanding, because it is gone. Identity and numbers
    // only: a live Revision is circular and jest cannot walk one.
    expect(attempts.includes(orphan)).toBe(false);
    expect(attempts.unresolved.length).toBe(0);
  });

  // ------------------------------------------------------- never author one
  /**
   * The upstream half of the law, and the one that matters most: the resolve
   * loop surviving an unresolvable revision is a floor, not a fix. A revision
   * the user can never accept and never reject must not be authored in the
   * first place.
   *
   * The composed split is exactly the shape that authored one in the browser -
   * it tracked-deletes rows whose cells carry content-control markers, and the
   * marker's own Deletion revision cannot survive its row's resolution. This
   * row measures the change set as delivered: every revision it created spans
   * something, so every one of them can be resolved.
   *
   * STATED PRECISELY, because the honest reading matters: jsdom does not reach
   * the poisoning itself (this file's header says why - the accept-side row
   * deletion walks laid-out widgets and jsdom does not paginate), so this row
   * is green both before and after the marker rule was widened. What it does
   * hold, and what a widened rule most needed proving, is that the widening
   * does not OVER-refuse: the split still authors its full set of resolvable
   * revisions, and none of them is empty-range. The browser is where the
   * narrow rule was measured authoring one; the resolve loop's non-progress law
   * above is what makes that path survivable either way.
   */
  it('a composed split authors no revision that could refuse to resolve', () => {
    const result: any = splitCosts(editor, SPLIT_AT);
    expect(result0(result)).toEqual(['ok', 'ok']);

    // Numbers only. Naming the offenders would print live Revision objects.
    const empty = liveRevisions(editor).filter(revisionIsUnresolvable);
    expect(empty.length).toBe(0);
    expect(liveRevisions(editor).length).toBeGreaterThan(1);

    // And the change set says so itself: the integrity assertion in the commit
    // path found nothing, so the set is reviewable and reports `applied`.
    expect(result.changeSet.status).toBe('applied');
    expect(
      result.warnings.filter((line: string) =>
        line.startsWith('change_set_unresolvable_revision')
      )
    ).toEqual([]);
  });

  /**
   * The assertion's own predicate, proven both ways over real SDK objects.
   *
   * The commit-path guard counts `created.filter(revisionIsUnresolvable)` and
   * fails the change set on any hit. It is pinned here at the predicate rather
   * than by making an op author a bad revision, because after the fix above no
   * op can: the guard exists to catch a FUTURE op that regresses, and a test
   * that had to break the engine to trigger it would be testing the break.
   */
  it('the integrity predicate is exact: an orphan is unresolvable, a healthy member is not', () => {
    expect(result0(splitCosts(editor, SPLIT_AT))).toEqual(['ok', 'ok']);
    const healthy = liveRevisions(editor)[1];
    expect(revisionIsUnresolvable(healthy)).toBe(false);

    const orphan = orphanOneMember(editor, 0);
    expect(revisionIsUnresolvable(orphan)).toBe(true);
  });

  // ------------------------------------------------------------- WEDGE-REPRO
  // The properties the resolve loop owes, now held.
  it('WEDGE-REPRO: accept resolves every member it CAN, and leaves only the one it cannot', () => {
    expect(result0(splitCosts(editor, SPLIT_AT))).toEqual(['ok', 'ok']);
    const total = editor.revisions.length;
    const orphan = orphanOneMember(editor, Math.floor(total / 2));

    resolveLiveRevisionGroupsAsOneUndo(editor as any, cardGroups(editor), true);

    // Every member the loop CAN resolve is resolved, and the one it cannot is
    // retired rather than left pending, so the card is finished either way.
    expect(liveRevisions(editor).length).toBe(0);
    expect(liveRevisions(editor).includes(orphan)).toBe(false);
  });

  it('WEDGE-REPRO: reject mirrors it, instead of abandoning the head of the card', () => {
    expect(result0(splitCosts(editor, SPLIT_AT))).toEqual(['ok', 'ok']);
    const total = editor.revisions.length;
    const orphan = orphanOneMember(editor, Math.floor(total / 2));

    resolveLiveRevisionGroupsAsOneUndo(
      editor as any,
      cardGroups(editor),
      false
    );

    expect(liveRevisions(editor).length).toBe(0);
    expect(liveRevisions(editor).includes(orphan)).toBe(false);
  });

  /**
   * The reporting contract, measured on the only member shape that can still
   * survive a resolve: one that REFUSES with a live range.
   *
   * An empty-range member no longer reaches the rail at all - it is retired as
   * the leak it is - so a test that poisons the range measures the purge, not
   * the notice. A member whose resolve is inert while its range stays intact is
   * a genuine "this edit is still showing", and that is what the rail owes the
   * captain a notice for.
   */
  it('WEDGE-REPRO: a member the loop could not resolve is REPORTED, not swallowed', () => {
    expect(result0(splitCosts(editor, SPLIT_AT))).toEqual(['ok', 'ok']);
    const total = editor.revisions.length;
    const refuser: any = liveRevisions(editor)[Math.floor(total / 2)];
    for (const key of ['robinResolveSelf', 'handleAcceptReject', 'accept'])
      if (typeof refuser[key] === 'function') refuser[key] = () => undefined;

    const outcome = resolveLiveRevisionGroupsAsOneUndo(
      editor as any,
      cardGroups(editor),
      true
    );

    // Still registered, still spanning something: an edit the captain can see.
    expect(revisionIsUnresolvable(refuser)).toBe(false);
    expect(outcome.unresolved).toHaveLength(1);
    expect(outcome.unresolved[0] === refuser).toBe(true);
  });

  /**
   * THE BROWSER DEFECT, at the layer jsdom can reach.
   *
   * Measured 2026-09-08 on the client document: accepting the composed split
   * left exactly one `Deletion` revision with `range.length === 0` that was
   * NOT one of the card's own revisions - the engine minted it during the
   * accept, so it carried no change-set tag and the resolve loop's group
   * filter could not see it, attempt it, or report it. The card read as
   * finished with one edit still pending forever, and no rail notice.
   *
   * jsdom cannot mint one (the accept-side row deletion walks laid-out widgets
   * and jsdom does not paginate), so the mint is staged here exactly as the
   * browser produced it: an empty range and no tag. What this pins is the law
   * that makes the browser state impossible - a resolve retires every
   * empty-range revision in the DOCUMENT, not only the ones its group matched.
   */
  it('retires an empty-range revision the engine minted mid-accept, tag or no tag', () => {
    expect(result0(splitCosts(editor, SPLIT_AT))).toEqual(['ok', 'ok']);
    const total = editor.revisions.length;
    const stray: any = orphanOneMember(editor, Math.floor(total / 2));
    // The browser's survivor was untagged, so nothing about the card matched it.
    stray.customData = undefined;
    stray.author = 'Robin';
    const groups = cardGroups(editor).filter((group: any) => !group.untagged);
    expect(groups).toHaveLength(1);

    const outcome = resolveLiveRevisionGroupsAsOneUndo(
      editor as any,
      groups,
      true
    );

    expect(liveRevisions(editor).length).toBe(0);
    expect(liveRevisions(editor).includes(stray)).toBe(false);
    // And the rail says nothing, because there is no surviving edit to explain.
    expect(outcome.unresolved).toHaveLength(0);
  });
});

/**
 * How many times the resolve loop asks THIS revision to move.
 *
 * The spin was only ever measurable here. `resolveRevisionIndividually` prefers
 * the group primitive's `robinResolveSelf` and falls back to the SDK's
 * `handleAcceptReject`, so both are counted. Returns a reader, not the revision,
 * so nothing in this file ever holds a live Revision in an assertion.
 */
function countResolveAttempts(revision: any): () => number {
  let count = 0;
  for (const key of ['robinResolveSelf', 'handleAcceptReject']) {
    const original = revision[key];
    if (typeof original !== 'function') continue;
    revision[key] = (...args: unknown[]) => {
      count++;
      return original.apply(revision, args);
    };
  }
  return () => count;
}

/** Each op's outcome, by code, so a harness failure names itself. */
function result0(result: any): string[] {
  return result.results.map((entry: any) => (entry.ok ? 'ok' : entry.error));
}
