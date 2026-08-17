// Phase 2's exit criterion: the controller driving a REAL DocumentEditor from the
// pinned build, through the real adapter, with no fakes in the write path.
//
// The Phase 0 spikes proved each engine internal exists and behaves. This proves
// they compose: a user edit in the live editor reconciles, fans out, recalculates,
// and leaves native undo pointing at the user's own edit rather than at engine
// output.
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
import { ReconciliationController } from '../controller';
import {
  configureEditorForBindings,
  createEditorAdapter,
  SyncfusionEditorLike
} from '../editorAdapter';
import { installKeystrokeGuard, isBlockedInField } from '../keystrokeGuard';
import { createCommitTriggers } from '../commitTriggers';
import { innerRangeOf } from '../controlGeometry';
import { scanBindings } from '../core/sfdtAdapter';
import { SfdtDocument } from '../core/sfdtTypes';
import { buildCostsFixture } from '../core/tests/fixtures/costsFixture';

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
  return editor;
}

function destroy(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

/** Read the live document the way the engine does. */
function liveIndex(editor: DocumentEditor) {
  return scanBindings(JSON.parse(editor.serialize()) as SfdtDocument);
}

const costsCell = (editor: DocumentEditor, column: string) =>
  liveIndex(editor).tables.get('costs')!.rows[0].bindings.get(column)!.text;

const grandTotals = (editor: DocumentEditor) =>
  liveIndex(editor)
    .formulas.get('grand_total')!
    .map((entry) => entry.text);

/** Type into a control the way the product does: locate by tag, then write. */
function writeIntoControl(
  editor: DocumentEditor,
  tag: string,
  text: string
): void {
  const collection = (editor as any).documentHelper.contentControlCollection;
  const control = collection.find(
    (candidate: any) => candidate?.contentControlProperties?.tag === tag
  );
  if (!control) throw new Error(`no control for ${tag}`);
  (editor as any).editorModule.updateContentControl(control, text);
}

const QUANTITY_R1 = '[[name=quantity|type=integer|row=r-1]]';

describe('controller over a real DocumentEditor', () => {
  let editor: DocumentEditor;
  let controller: ReconciliationController;

  beforeEach(() => {
    editor = makeEditor();
    controller = new ReconciliationController({
      editor: createEditorAdapter(editor as unknown as SyncfusionEditorLike),
      debounceMs: null // Manual commit, as the product uses.
    });
    controller.loadInitial(buildCostsFixture());
  });

  afterEach(() => destroy(editor));

  it('loads the fixture with its bindings intact', () => {
    const index = liveIndex(editor);
    expect(index.diagnostics).toEqual([]);
    expect(index.tables.get('costs')!.rows).toHaveLength(2);
    expect(costsCell(editor, 'line_total')).toBe('$1,800.00');
  });

  it('reconciles a live edit: fan-out and recalculation, no reload', () => {
    writeIntoControl(editor, QUANTITY_R1, '13');
    controller.flush();

    expect(controller.diagnostics).toEqual([]);
    expect(costsCell(editor, 'line_total')).toBe('$1,950.00');
    // Both occurrences of the doc-level total, in the table and in the prose.
    expect(grandTotals(editor)).toEqual(['$7,950.00', '$7,950.00']);
  });

  it('leaves native undo pointing at the user edit, not at engine output', () => {
    writeIntoControl(editor, QUANTITY_R1, '13');
    controller.flush();
    expect(costsCell(editor, 'line_total')).toBe('$1,950.00');

    // One undo must reach the user's own change. If fan-out or formula writes
    // had been recorded, this would peel engine output instead and the quantity
    // would still read 13.
    editor.editorHistory.undo();

    expect(costsCell(editor, 'quantity')).toBe('12');
  });

  it('normalizes a stripped currency symbol back into place', () => {
    writeIntoControl(editor, '[[name=unit_cost|type=currency|row=r-1]]', '150');
    controller.flush();

    expect(costsCell(editor, 'unit_cost')).toBe('$150.00');
    // The value never changed, so the totals must not move.
    expect(grandTotals(editor)).toEqual(['$7,800.00', '$7,800.00']);
  });

  it('reverts an edit typed over a locked formula', () => {
    writeIntoControl(
      editor,
      '[[name=line_total|expr=mul(quantity,unit_cost)|row=r-1]]',
      '$1.00'
    );
    controller.flush();

    expect(costsCell(editor, 'line_total')).toBe('$1,800.00');
  });

  it('patches in place rather than reopening the document', () => {
    const open = jest.spyOn(editor, 'open');
    writeIntoControl(editor, QUANTITY_R1, '13');
    controller.flush();
    // A reload would destroy the editor's undo history, which the test above
    // depends on. Value-only output must never take that path.
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('falls back to a reload when a write cannot be placed', () => {
    // A write whose tag is not in the document cannot be patched; the controller
    // must still converge rather than silently drop the transaction.
    const adapter = createEditorAdapter(
      editor as unknown as SyncfusionEditorLike
    );
    expect(
      adapter.updateValues!([
        { tag: '[[name=absent]]', text: 'x', kind: 'field' }
      ])
    ).toBe(false);
  });

  it('refuses to patch an empty value, which would show a placeholder', () => {
    const adapter = createEditorAdapter(
      editor as unknown as SyncfusionEditorLike
    );
    expect(
      adapter.updateValues!([{ tag: QUANTITY_R1, text: '', kind: 'field' }])
    ).toBe(false);
  });

  it('skips an empty write without dropping the rest of its batch', () => {
    const adapter = createEditorAdapter(
      editor as unknown as SyncfusionEditorLike
    );
    expect(
      adapter.updateValues!([
        { tag: QUANTITY_R1, text: '', kind: 'field' },
        {
          tag: '[[name=line_total|expr=mul(quantity,unit_cost)|row=r-1]]',
          text: '$2,000.00',
          kind: 'formula'
        }
      ])
    ).toBe(true);

    expect(costsCell(editor, 'quantity')).toBe('12');
    expect(costsCell(editor, 'line_total')).toBe('$2,000.00');
  });

  it('leaves track-changes off after a reconcile, even if it was on', () => {
    // Restoring a leftover true re-arms tracking for the next keystroke inside
    // the control the user just edited.
    (editor as any).enableTrackChanges = true;
    writeIntoControl(editor, QUANTITY_R1, '13');
    controller.flush();
    expect((editor as any).enableTrackChanges).toBe(false);
  });

  it('records no tracked-change revisions for engine writes', () => {
    (editor as any).enableTrackChanges = true;
    const before = editor.revisions.length;
    writeIntoControl(editor, QUANTITY_R1, '13');
    controller.flush();
    // The write above is not itself tracked (it is how the product patches), so
    // what matters is that reconciliation added nothing on top of it.
    expect(editor.revisions.length).toBe(before);
  });

  it('keeps direct user typing in a bound input untracked', () => {
    expect(editor.enableTrackChanges).toBe(false);
    const collection = (editor as any).documentHelper.contentControlCollection;
    const control = collection.find(
      (candidate: any) =>
        candidate?.contentControlProperties?.tag === QUANTITY_R1
    );
    const range = innerRangeOf(
      editor as unknown as SyncfusionEditorLike,
      control
    )!;

    editor.selection.select(
      `${range.prefix}${range.start}`,
      `${range.prefix}${range.end}`
    );
    editor.editor.insertText('13');
    controller.flush();

    expect(editor.revisions.length).toBe(0);
    expect(costsCell(editor, 'quantity')).toBe('13');
    expect(costsCell(editor, 'line_total')).toBe('$1,950.00');
  });

  it('keeps direct user typing in plain prose untracked', () => {
    expect(editor.enableTrackChanges).toBe(false);
    editor.selection.select('0;0;0', '0;0;7');
    editor.editor.insertText('Updated');

    expect(editor.revisions.length).toBe(0);
    expect(editor.serialize()).toContain('Updated');
  });
});

describe('configureEditorForBindings', () => {
  it('reports success when the editor accepts verbose SFDT', () => {
    const editor = makeEditor();
    try {
      expect(
        configureEditorForBindings(editor as unknown as SyncfusionEditorLike)
      ).toBe(true);
      editor.open(JSON.stringify(buildCostsFixture()));
      // Verbose keys are what the adapter reads.
      expect(editor.serialize()).toContain('"contentControlProperties"');
    } finally {
      destroy(editor);
    }
  });
});

describe('keystroke guard on a real editor', () => {
  let editor: DocumentEditor;
  let uninstall: () => void;

  beforeEach(() => {
    editor = makeEditor();
    editor.open(JSON.stringify(buildCostsFixture()));
    uninstall = installKeystrokeGuard(
      editor as unknown as SyncfusionEditorLike
    );
  });

  afterEach(() => {
    uninstall();
    destroy(editor);
  });

  it('blocks a letter when the engine names an integer field at the caret', () => {
    // The decision function is what the guard is; test it directly rather than
    // through a caret the API cannot place where a user would.
    const asEditor = editor as unknown as SyncfusionEditorLike;
    const integerField = {
      contentControlProperties: { tag: QUANTITY_R1 }
    };
    asEditor.selection!.currentContentControl = integerField as any;

    expect(isBlockedInField(asEditor, 'x')).toBe(true);
    expect(isBlockedInField(asEditor, '4')).toBe(false);
    expect(isBlockedInField(asEditor, '-')).toBe(false);
  });

  it('lets everything through where the engine names no inline field', () => {
    // Measured on 34.1.31: a caret inside a marker-wrapped table reports the
    // WRAPPER, and prose reports nothing. The guard has no type to enforce in
    // either case and must fail open rather than block valid typing. This is the
    // documented limit, so pin it - if a future build starts reporting the inline
    // control, this test is where that shows up.
    const asEditor = editor as unknown as SyncfusionEditorLike;
    const collection = (editor as any).documentHelper.contentControlCollection;
    const quantity = collection.find(
      (candidate: any) =>
        candidate?.contentControlProperties?.tag === QUANTITY_R1
    );

    editor.selection.selectContentControl(quantity);
    const reported = asEditor.selection!.currentContentControl;
    expect(reported?.contentControlProperties?.tag).toBe('[[table=costs]]');
    expect(isBlockedInField(asEditor, 'x')).toBe(false);

    asEditor.selection!.currentContentControl = null;
    expect(isBlockedInField(asEditor, 'x')).toBe(false);
  });

  it('restores the original handler on uninstall', () => {
    const patched = (editor as any).editorModule.handleTextInput;
    uninstall();
    expect((editor as any).editorModule.handleTextInput).not.toBe(patched);
    // Re-installed in afterEach's uninstall call being idempotent-safe.
    uninstall = () => {};
  });
});

describe('commit triggers on a real editor', () => {
  let editor: DocumentEditor;
  let controller: ReconciliationController;

  beforeEach(() => {
    editor = makeEditor();
    controller = new ReconciliationController({
      editor: createEditorAdapter(editor as unknown as SyncfusionEditorLike),
      debounceMs: null
    });
    controller.loadInitial(buildCostsFixture());
  });

  afterEach(() => destroy(editor));

  it('commits when the caret moves to another cell of the same table', () => {
    // The case reference comparison alone cannot see: both cells report the same
    // enclosing [[table=costs]] wrapper, so only the caret path distinguishes
    // them. Without this, tabbing across a row would never commit.
    const triggers = createCommitTriggers(
      editor as unknown as SyncfusionEditorLike,
      controller
    );
    const collection = (editor as any).documentHelper.contentControlCollection;
    const control = (tag: string) =>
      collection.find(
        (candidate: any) => candidate?.contentControlProperties?.tag === tag
      );
    const UNIT_COST = '[[name=unit_cost|type=currency|row=r-1]]';

    editor.selection.selectContentControl(control(QUANTITY_R1));
    const quantityPath = editor.selection.startOffset;
    writeIntoControl(editor, QUANTITY_R1, '13');
    triggers.onContentChange();
    expect(triggers.hasPendingEdit()).toBe(true);
    // Still uncommitted while the caret stays put.
    expect(costsCell(editor, 'line_total')).toBe('$1,800.00');

    editor.selection.selectContentControl(control(UNIT_COST));
    // Same wrapper, different cell - which is exactly the point.
    expect(editor.selection.startOffset).not.toBe(quantityPath);
    triggers.onSelectionChange();

    expect(triggers.hasPendingEdit()).toBe(false);
    expect(costsCell(editor, 'line_total')).toBe('$1,950.00');
    triggers.dispose();
  });

  it('does not commit while typing inside one control', () => {
    const triggers = createCommitTriggers(
      editor as unknown as SyncfusionEditorLike,
      controller
    );
    const collection = (editor as any).documentHelper.contentControlCollection;
    const quantity = collection.find(
      (candidate: any) =>
        candidate?.contentControlProperties?.tag === QUANTITY_R1
    );
    editor.selection.selectContentControl(quantity);

    writeIntoControl(editor, QUANTITY_R1, '13');
    triggers.onContentChange();
    // selectionChange fires constantly while typing; the control reference is
    // unchanged, so nothing may commit.
    triggers.onSelectionChange();
    triggers.onSelectionChange();

    expect(triggers.hasPendingEdit()).toBe(true);
    expect(costsCell(editor, 'line_total')).toBe('$1,800.00');
    triggers.dispose();
  });

  it('commits on editor blur so an edit is never stranded', () => {
    const triggers = createCommitTriggers(
      editor as unknown as SyncfusionEditorLike,
      controller
    );
    writeIntoControl(editor, QUANTITY_R1, '13');
    triggers.onContentChange();
    triggers.onEditorBlur();
    expect(costsCell(editor, 'line_total')).toBe('$1,950.00');
    triggers.dispose();
  });

  it('self-heals after undo without renormalizing fields', () => {
    const flush = jest.spyOn(controller, 'flush');
    const timers: Array<() => void> = [];
    const triggers = createCommitTriggers(
      editor as unknown as SyncfusionEditorLike,
      controller,
      {
        setTimeoutFn: (fn) => {
          timers.push(fn);
          return timers.length;
        },
        clearTimeoutFn: () => {}
      }
    );

    // Set the flag on the REAL history module rather than replacing it: the
    // editor calls editorHistoryModule.destroy() on teardown, so swapping the
    // object in breaks the instance.
    const history = (editor as any).editorHistoryModule;
    const wasUndoing = history.isUndoing;
    history.isUndoing = true;
    try {
      triggers.onContentChange();
    } finally {
      history.isUndoing = wasUndoing;
    }

    // An undo already restored the fields the user expects to see, so this must
    // not be treated as a pending edit...
    expect(triggers.hasPendingEdit()).toBe(false);
    timers.forEach((fn) => fn());
    // ...and the follow-up reconcile must be formulas-only.
    expect(flush).toHaveBeenCalledWith({ mode: 'self-heal', adoptRows: false });
    flush.mockRestore();
    triggers.dispose();
  });
});
