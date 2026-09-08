/**
 * WEDGE-REPRO: the composed bound-table split whose group accept applies a
 * PREFIX of the card and then goes inert, silently.
 *
 * MEASURED IN A REAL BROWSER, on a real client document, 2026-09-08. One review
 * card: a composed split (duplicate_table with keepRows, plus delete_row of the
 * complement, plus the summary formulas it recomputes), 49 pending edits over 13
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
    // The card the captain clicked: 49 edits over one group.
    expect(chipCount(editor)).toBe(49);
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

  // -------------------------------------------------------- the defect, measured
  // Green today, RED the day the wedge is fixed - the repo's convention for a
  // pinned defect (see splitTableContract.spec.ts S2(d)); this jest has no
  // `test.failing`. The property rows this one stands in for are the skipped
  // WEDGE-REPRO rows below.
  it('DEFECT: one unresolvable member costs the whole tail of the card, with no error', () => {
    expect(result0(splitCosts(editor, SPLIT_AT))).toEqual(['ok', 'ok']);
    const total = editor.revisions.length;
    const poisonAt = Math.floor(total / 2);
    const orphan = orphanOneMember(editor, poisonAt);

    const attempts = resolveLiveRevisionGroupsAsOneUndo(
      editor as any,
      cardGroups(editor),
      true
    );

    // THE WEDGE. Everything BEFORE the poison applied; the poison and every
    // member after it are still pending, and the caller was told nothing.
    const left = liveRevisions(editor);
    expect(left.includes(orphan)).toBe(true);

    // MEASURED, 2026-09-08. The group holds 11 revisions and the poison sits
    // sixth in document order, so accepting the card leaves SIX pending: the
    // poison and every member after it. One unresolvable edit cost five good
    // ones - the captain's 14-then-nothing, at this fixture's scale.
    expect(total).toBe(11);
    expect(left.length).toBe(total - poisonAt);

    // And the loop did not stop, it SPUN: 341 of its 348 resolve attempts went
    // to that one object, because nothing ever removes it from `current[0]`.
    // That is the whole of "no spinner, no console error, three minutes of
    // polling" - the click did work, all of it on the member that cannot move.
    const spun = attempts.filter((entry) => entry === orphan).length;
    expect(spun).toBeGreaterThan(300);
    expect(spun / attempts.length).toBeGreaterThan(0.9);
  });

  // ------------------------------------------------------------- WEDGE-REPRO
  // The properties the resolve loop owes. Skipped rather than red so the suite
  // keeps meaning "everything asserted here is true"; un-skip them to watch the
  // wedge, and delete the skip with the fix.
  it.skip('WEDGE-REPRO: accept resolves every member it CAN, and leaves only the one it cannot', () => {
    expect(result0(splitCosts(editor, SPLIT_AT))).toEqual(['ok', 'ok']);
    const total = editor.revisions.length;
    const orphan = orphanOneMember(editor, Math.floor(total / 2));

    resolveLiveRevisionGroupsAsOneUndo(editor as any, cardGroups(editor), true);

    // One member cannot resolve, so exactly one is left - not the whole tail.
    // Identity, not deep equality: a live Revision is circular and jest cannot
    // walk it, so a `toEqual` here fails for the wrong reason.
    const left = liveRevisions(editor);
    expect(left.length).toBe(1);
    expect(left[0] === orphan).toBe(true);
  });

  it.skip('WEDGE-REPRO: reject mirrors it, instead of abandoning the head of the card', () => {
    expect(result0(splitCosts(editor, SPLIT_AT))).toEqual(['ok', 'ok']);
    const total = editor.revisions.length;
    const orphan = orphanOneMember(editor, Math.floor(total / 2));

    resolveLiveRevisionGroupsAsOneUndo(
      editor as any,
      cardGroups(editor),
      false
    );

    const left = liveRevisions(editor);
    expect(left.length).toBe(1);
    expect(left[0] === orphan).toBe(true);
  });

  it.skip('WEDGE-REPRO: a member the loop could not resolve is REPORTED, not swallowed', () => {
    expect(result0(splitCosts(editor, SPLIT_AT))).toEqual(['ok', 'ok']);
    const total = editor.revisions.length;
    orphanOneMember(editor, Math.floor(total / 2));

    // The caller has no way to learn the card did not finish. Whatever shape the
    // fix takes - a thrown error, a returned unresolved list, a diagnostic - the
    // rail must be able to tell the captain the card stalled instead of showing
    // a silent partial application.
    const unresolved = (
      resolveLiveRevisionGroupsAsOneUndo as unknown as (
        ...args: unknown[]
      ) => { unresolved?: unknown[] }
    )(editor as any, cardGroups(editor), true);
    expect(unresolved.unresolved).toHaveLength(1);
  });
});

/** Each op's outcome, by code, so a harness failure names itself. */
function result0(result: any): string[] {
  return result.results.map((entry: any) => (entry.ok ? 'ok' : entry.error));
}
