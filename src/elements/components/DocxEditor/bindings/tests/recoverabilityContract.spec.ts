// The captain's criterion, as a contract: "if someone asks to create a new
// table or split a table and then they undo that, it should be as how it was
// before." Two paths, both required:
//   (a) Ctrl+Z walks the edit back, and the history the user already had is
//       still there afterwards.
//   (b) Reject unwinds COMPLETELY - no fragment, no orphan.
//
// This suite exists because the whole programme's boldness rests on it. The
// assistant is allowed to act on a document without asking first ONLY because
// taking it back always works; when undo does not work, that permission was
// resting on a premise that was not true.
//
// WHY IT WAS NOT CAUGHT: every other spec in this directory drives
// `runCommands` with NO options, so `apply` resolves to 'structural'/'patch'
// and the native, undoable path runs. `historySequence.spec.ts`'s row "leaves
// prior history intact when adoption cannot be applied" even spies on
// `editor.open` and asserts it was never called - but in the no-provenance
// configuration, where that is already true. The provenance-bearing path - the
// one the docx assistant ALWAYS takes - had no real-editor coverage at all.
// Every row here therefore runs both configurations and contrasts them.
import 'jest-canvas-mock';
import { DocumentEditor } from '@syncfusion/ej2-documenteditor';
import { attachBindings, AttachedBindings } from '../attachBindings';
import { scanBindings } from '../core/sfdtAdapter';
import { buildCostsFixture } from '../core/tests/fixtures/costsFixture';
import { SfdtBlock, SfdtDocument } from '../core/sfdtTypes';
import {
  isContentControlAttached,
  SyncfusionEditorLike
} from '../editorAdapter';
import {
  BindingCommand,
  BindingCommandOptions,
  bindingCommandSurfaceFor
} from '../reconcileRegistry';
import {
  destroyRealDocumentEditor,
  makeRealDocumentEditor
} from './realEditorHarness';

const QUANTITY_R1 = '[[name=quantity|type=integer|row=r-1]]';

/** What the docx assistant passes on every single edit it makes. */
const PROVENANCE = {
  author: 'Robin',
  changeSetId: 'cs-recoverability',
  group: 'g-1'
};

const parsed = (editor: DocumentEditor) =>
  JSON.parse(editor.serialize()) as SfdtDocument;

const indexOf = (editor: DocumentEditor) => scanBindings(parsed(editor));

const rowIdsOf = (editor: DocumentEditor, tableId: string): string[] =>
  (indexOf(editor).tables.get(tableId)?.rows ?? []).map((row) => row.rowId);

const tableIds = (editor: DocumentEditor): string[] =>
  [...indexOf(editor).tables.keys()].sort();

function stacks(editor: DocumentEditor): { undo: number; redo: number } {
  const history = (editor as any).editorHistoryModule ?? editor.editorHistory;
  const undo = history.undoStackIn ?? history.undoStack;
  const redo = history.redoStackIn ?? history.redoStack;
  return {
    undo: Array.isArray(undo) ? undo.length : 0,
    redo: Array.isArray(redo) ? redo.length : 0
  };
}

function controlForTag(editor: DocumentEditor, tag: string) {
  const collection = (editor as any).documentHelper.contentControlCollection;
  return collection.find(
    (candidate: any) =>
      candidate?.contentControlProperties?.tag === tag &&
      isContentControlAttached(candidate)
  );
}

function writeIntoControl(
  editor: DocumentEditor,
  tag: string,
  text: string
): void {
  const control = controlForTag(editor, tag);
  if (!control) throw new Error(`no control for ${tag}`);
  (editor as any).editorModule.updateContentControl(control, text);
}

const liveRevisions = (editor: DocumentEditor) =>
  Array.from({ length: editor.revisions.length }, (_, index) =>
    editor.revisions.get(index)
  );

const rejectAllRevisions = (editor: DocumentEditor): void => {
  for (const revision of liveRevisions(editor).reverse()) revision.reject();
};

/**
 * The command a split issues for its second half: a whole new bound table
 * cloned from the source. Built by re-tagging the live costs table, which is
 * what duplicate_table does, so the spec exercises a real shape rather than a
 * hand-built one that would not survive a round trip.
 */
function duplicateCostsTableCommand(editor: DocumentEditor): BindingCommand {
  const index = indexOf(editor);
  const costs = index.tables.get('costs');
  if (!costs?.markerPath) throw new Error('costs table has no marker');
  let node: unknown = parsed(editor);
  for (const step of costs.markerPath)
    node = (node as Record<string, unknown>)[step as string];
  const block = JSON.parse(
    JSON.stringify(node)
      .split('table=costs')
      .join('table=costs_b')
      .split('row=r-')
      .join('row=b-')
  ) as SfdtBlock;
  const anchorTag = [...(costs.rows[0]?.bindings.values() ?? [])][0]?.tag;
  return {
    type: 'add-table',
    afterTableId: 'costs',
    afterTag: anchorTag ?? QUANTITY_R1,
    block
  };
}

interface Harness {
  editor: DocumentEditor;
  attached: AttachedBindings;
  run: (commands: BindingCommand[], options?: BindingCommandOptions) => void;
  open: jest.SpyInstance;
}

function openHarness(): Harness {
  const editor = makeRealDocumentEditor(buildCostsFixture());
  const attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
    convertTokensOnOpen: false
  });
  const open = jest.spyOn(editor, 'open');
  const surface = bindingCommandSurfaceFor(editor)!;
  return {
    editor,
    attached,
    open,
    run: (commands, options) => {
      surface.runCommands(commands, options);
    }
  };
}

function closeHarness(harness: Harness): void {
  harness.open.mockRestore();
  harness.attached.dispose();
  destroyRealDocumentEditor(harness.editor);
}

/**
 * Runs one body against both configurations. `provenance` is the ONLY
 * difference between them, so any divergence the assertions find is caused by
 * provenance and nothing else - which is the whole point of a contrast.
 */
function forBothRoutes(
  title: string,
  body: (harness: Harness, options: BindingCommandOptions) => void
): void {
  for (const [label, options] of [
    ['with provenance (the assistant route)', { provenance: PROVENANCE }],
    ['without provenance (the control)', {}]
  ] as Array<[string, BindingCommandOptions]>) {
    it(`${title} - ${label}`, () => {
      const harness = openHarness();
      try {
        body(harness, options);
      } finally {
        closeHarness(harness);
      }
    });
  }
}

describe('an assistant edit is recoverable', () => {
  forBothRoutes(
    'records its own undo entry instead of replacing the document',
    ({ editor, open, run }, options) => {
      const before = stacks(editor).undo;

      run([{ type: 'add-row', tableId: 'costs', afterRowId: 'r-2', rowId: 'r-3' }], options);

      expect(rowIdsOf(editor, 'costs')).toContain('r-3');
      // The document was mutated in place, not reopened. `EditorPort.open` is
      // documented as "Replace the document. Destroys native undo history."
      expect(open).not.toHaveBeenCalled();
      expect(stacks(editor).undo).toBeGreaterThan(before);
      expect(editor.editorHistory.canUndo()).toBe(true);
    }
  );

  forBothRoutes(
    'leaves the undo history the user already had',
    ({ editor, run }, options) => {
      // A pre-existing entry that belongs to the USER, made before the
      // assistant touched anything. Losing OUR undo entry is one defect;
      // destroying an entry the user made is a second, worse one, and it is
      // the half that no comment in the codebase acknowledges.
      writeIntoControl(editor, QUANTITY_R1, '13');
      const userEntries = stacks(editor).undo;
      expect(userEntries).toBeGreaterThan(0);

      run([{ type: 'add-row', tableId: 'costs', afterRowId: 'r-2', rowId: 'r-3' }], options);

      // Strictly greater: our entry sits ON TOP of the user's, never instead
      // of it. A stack that shrank to 1 here is the signature of a wipe
      // followed by a fresh recording, which is what a reopen produces.
      expect(stacks(editor).undo).toBeGreaterThan(userEntries);

      // And the user's own edit is still reachable by undoing past ours.
      let guard = 0;
      while (rowIdsOf(editor, 'costs').includes('r-3') && guard < 6) {
        editor.editorHistory.undo();
        guard += 1;
      }
      editor.editorHistory.undo();
      expect(indexOf(editor).tables.get('costs')?.rows[0]?.bindings.get('quantity')?.text).toBe('12');
    }
  );

  forBothRoutes(
    "criterion (a): undo puts a new table back exactly as it was",
    ({ editor, run }, options) => {
      const beforeTables = tableIds(editor);
      const beforeSections = parsed(editor).sections?.length;
      const withCopy = [...beforeTables, 'costs_b'].sort();
      expect(beforeTables).not.toContain('costs_b');

      run([duplicateCostsTableCommand(editor)], options);
      expect(tableIds(editor)).toEqual(withCopy);

      let guard = 0;
      while (
        tableIds(editor).includes('costs_b') &&
        editor.editorHistory.canUndo() &&
        guard < 8
      ) {
        editor.editorHistory.undo();
        guard += 1;
      }

      // "as how it was before" - the captain's words, measured as the table
      // inventory and the section shape, not as an approximation of them.
      expect(tableIds(editor)).toEqual(beforeTables);
      expect(parsed(editor).sections?.length).toBe(beforeSections);
      expect(rowIdsOf(editor, 'costs')).toEqual(['r-1', 'r-2']);
    }
  );

  forBothRoutes(
    'criterion (b): reject unwinds completely, leaving no fragment',
    ({ editor, run }, options) => {
      const beforeTables = tableIds(editor);
      const beforeRows = rowIdsOf(editor, 'costs');
      expect(beforeTables).not.toContain('costs_b');

      run([duplicateCostsTableCommand(editor)], options);
      expect(tableIds(editor)).toEqual([...beforeTables, 'costs_b'].sort());

      rejectAllRevisions(editor);

      // The 2.3 fragment the captain saw personally: a rejected table that
      // leaves its heading, its separator paragraph, or an orphaned bound cell
      // behind as ordinary live content. Rejecting is not "mostly undo".
      expect(tableIds(editor)).toEqual(beforeTables);
      expect(rowIdsOf(editor, 'costs')).toEqual(beforeRows);
      expect(editor.revisions.length).toBe(0);
      expect(
        JSON.stringify(parsed(editor)).includes('table=costs_b')
      ).toBe(false);
    }
  );
});

describe('an assistant edit stays reviewable', () => {
  // The trade the reopen was made for. The fix must not buy recoverability by
  // giving this up - a PR that fixes undo and silently drops the review record
  // has moved the defect, not removed it.
  it('carries the assistant as author on the revisions it creates', () => {
    const harness = openHarness();
    try {
      harness.run(
        [{ type: 'add-row', tableId: 'costs', afterRowId: 'r-2', rowId: 'r-3' }],
        { provenance: PROVENANCE }
      );
      const authors = liveRevisions(harness.editor).map((revision) =>
        String((revision as any).author ?? '')
      );
      expect(authors.length).toBeGreaterThan(0);
      expect(new Set(authors)).toEqual(new Set([PROVENANCE.author]));
    } finally {
      closeHarness(harness);
    }
  });

  it('carries the change-set group so one card accepts or rejects together', () => {
    const harness = openHarness();
    try {
      harness.run(
        [{ type: 'add-row', tableId: 'costs', afterRowId: 'r-2', rowId: 'r-3' }],
        { provenance: PROVENANCE }
      );
      const tags = liveRevisions(harness.editor).map((revision) =>
        String((revision as any).customData ?? '')
      );
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) {
        expect(tag).toContain(PROVENANCE.changeSetId);
        expect(tag).toContain(PROVENANCE.group);
      }
    } finally {
      closeHarness(harness);
    }
  });

  it('leaves tracking off afterwards, so the next user keystroke is untracked', () => {
    const harness = openHarness();
    try {
      harness.run(
        [{ type: 'add-row', tableId: 'costs', afterRowId: 'r-2', rowId: 'r-3' }],
        { provenance: PROVENANCE }
      );
      // Tracking is borrowed for the batch and handed back. Leaving the global
      // switch on would silently start tracking the user's own typing.
      expect(harness.editor.enableTrackChanges).toBe(false);
    } finally {
      closeHarness(harness);
    }
  });
});

describe('a failed assistant edit is honest about it', () => {
  it('raises native-mutation-failed rather than silently replacing the document', () => {
    const harness = openHarness();
    try {
      jest
        .spyOn((harness.editor as any).editorModule, 'insertContentControl')
        .mockReturnValue(undefined);

      harness.run(
        [{ type: 'add-row', tableId: 'costs', afterRowId: 'r-2', rowId: 'r-3' }],
        { provenance: PROVENANCE }
      );

      // The diagnostic already exists and already says the right thing. Under
      // apply:'open' it could never fire, because the reopen ran first and
      // reported success - the one configuration that does the damage was the
      // one that skipped the warning.
      expect(
        harness.attached
          .diagnostics()
          .some((entry) => entry.code === 'native-mutation-failed')
      ).toBe(true);
      expect(harness.open).not.toHaveBeenCalled();
    } finally {
      closeHarness(harness);
    }
  });
});
