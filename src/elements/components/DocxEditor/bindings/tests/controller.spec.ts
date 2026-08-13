// Ported from the POC's test/controller.test.js. The FakeEditor is the point of
// this suite: it fires contentChange on every write exactly as Syncfusion does,
// so the loop-prevention, sequence-guard and patch-versus-reload decisions are
// tested against the same feedback the real editor produces - without needing
// the real editor at all.
import {
  ControllerEvent,
  ControllerEventName,
  EditorPort,
  ReconciliationController,
  TimerId
} from '../controller';
import { LocalStoragePersistence } from '../persistence';
import { EngineWrite } from '../core/engine';
import {
  addLineItem,
  Occurrence,
  scanBindings,
  setOccurrenceText,
  setTaggedValue
} from '../core/sfdtAdapter';
import { SfdtDocument } from '../core/sfdtTypes';
import { buildCostsFixture } from '../core/tests/fixtures/costsFixture';

/** A fake Syncfusion: holds a document and echoes contentChange like the real one. */
class FakeEditor implements EditorPort {
  doc: SfdtDocument | null = null;

  opens = 0;

  patches = 0;

  restored: unknown = undefined;

  controller: ReconciliationController | null = null;

  /** Set to false to model an editor without the in-place patch API. */
  supportsPatching = true;

  serialize(): string {
    return JSON.stringify(this.doc);
  }

  open(sfdt: string): void {
    this.doc = JSON.parse(sfdt);
    this.opens += 1;
    // The real editor fires contentChange when a document loads.
    this.controller?.notifyContentChange();
  }

  updateValues(writes: EngineWrite[]): boolean {
    if (!this.supportsPatching) return false;
    // Empty text would show the editor's placeholder instead.
    if (writes.some((write) => !write.text)) return false;
    for (const write of writes) {
      const matches = scanBindings(this.doc as SfdtDocument).occurrences.filter(
        (occurrence) => occurrence.tag === write.tag
      );
      if (!matches.length) return false;
      for (const occurrence of matches) {
        this.doc = setOccurrenceText(
          this.doc as SfdtDocument,
          occurrence,
          write.text
        );
      }
    }
    this.patches += 1;
    this.controller?.notifyContentChange();
    return true;
  }

  captureView(): unknown {
    return 'view';
  }

  restoreView(view: unknown): void {
    this.restored = view;
  }

  /** Simulate the user typing into an occurrence, then the event firing. */
  userEdit(pick: (occurrence: Occurrence) => boolean, text: string): void {
    const index = scanBindings(this.doc as SfdtDocument);
    const occurrence = index.occurrences.find(pick);
    if (!occurrence) throw new Error('no occurrence matched the edit');
    this.doc = setOccurrenceText(this.doc as SfdtDocument, occurrence, text);
    this.controller?.notifyContentChange();
  }
}

/** Runs debounced callbacks on demand, so tests never wait on wall-clock time. */
function makeClock() {
  const timers = new Map<number, () => void>();
  let nextId = 0;
  return {
    setTimeout(fn: () => void): TimerId {
      nextId += 1;
      timers.set(nextId, fn);
      return nextId;
    },
    clearTimeout(id: TimerId): void {
      timers.delete(id as number);
    },
    fire(): void {
      while (timers.size) {
        const [id, fn] = timers.entries().next().value as [number, () => void];
        timers.delete(id);
        fn();
      }
    }
  };
}

function setup(debounceMs: number | null = 1) {
  const editor = new FakeEditor();
  const clock = makeClock();
  const events: ControllerEventName[] = [];
  const controller = new ReconciliationController({
    editor,
    debounceMs,
    onChange: (event: ControllerEvent) => events.push(event.event),
    setTimeoutFn: clock.setTimeout.bind(clock),
    clearTimeoutFn: clock.clearTimeout.bind(clock)
  });
  editor.controller = controller;
  return { editor, clock, controller, events };
}

const costsRow = (editor: FakeEditor, column: string) =>
  scanBindings(editor.doc as SfdtDocument)
    .tables.get('costs')!
    .rows[0].bindings.get(column)!.text;

const grandTotals = (editor: FakeEditor) =>
  scanBindings(editor.doc as SfdtDocument)
    .formulas.get('grand_total')!
    .map((entry) => entry.text);

const isQuantityRow1 = (occurrence: Occurrence) =>
  occurrence.name === 'quantity' && occurrence.rowId === 'r-1';

describe('loading', () => {
  it('opens the reconciled document once, with no feedback loop', () => {
    const { editor, clock, controller } = setup();
    controller.loadInitial(buildCostsFixture(), 3);
    expect(editor.opens).toBe(1);
    expect(controller.phase).toBe('idle');
    expect(controller.persistedRevision).toBe(3);
    expect(controller.dirty).toBe(false);
    clock.fire(); // Any echoed contentChange debounce.
    expect(editor.opens).toBe(1); // Reconcile found no changes: no reload.
  });
});

describe('reconciling a user edit', () => {
  it('patches engine output in place, leaving native history intact', () => {
    const { editor, clock, controller } = setup();
    controller.loadInitial(buildCostsFixture());
    const opensAfterLoad = editor.opens;
    editor.restored = undefined; // loadInitial's open() legitimately restored.

    editor.userEdit(isQuantityRow1, '13');
    clock.fire();

    expect(controller.phase).toBe('idle');
    expect(controller.dirty).toBe(true);
    expect(editor.opens).toBe(opensAfterLoad); // No reload: undo survives.
    expect(editor.patches).toBeGreaterThanOrEqual(1);
    expect(costsRow(editor, 'line_total')).toBe('$1,950.00');
    expect(grandTotals(editor)).toEqual(['$7,950.00', '$7,950.00']);
    // Editor document and controller working copy agree after the patch.
    expect(editor.doc).toEqual(controller.workingSfdt);
    // The patch path owns its own synchronous selection restore, so the
    // controller must NOT schedule the async view restore that fights typing.
    expect(editor.restored).toBeUndefined();
  });

  it('commits only on flush in manual mode', () => {
    const { editor, clock, controller } = setup(null);
    controller.loadInitial(buildCostsFixture());

    editor.userEdit(isQuantityRow1, '13');
    clock.fire(); // No debounce timer exists in manual mode.
    expect(costsRow(editor, 'line_total')).toBe('$1,800.00'); // Untouched.

    controller.flush(); // The Enter/blur trigger.
    expect(costsRow(editor, 'line_total')).toBe('$1,950.00');
    expect(grandTotals(editor)).toEqual(['$7,950.00', '$7,950.00']);
  });

  it('falls back to a full open when the editor cannot patch', () => {
    const { editor, clock, controller } = setup();
    editor.supportsPatching = false;
    controller.loadInitial(buildCostsFixture());
    const opensAfterLoad = editor.opens;

    editor.userEdit(isQuantityRow1, '13');
    clock.fire();
    expect(editor.opens).toBe(opensAfterLoad + 1);
    expect(costsRow(editor, 'line_total')).toBe('$1,950.00');
  });

  it('does not touch the editor when reconciliation changes nothing', () => {
    const { editor, clock, controller } = setup();
    controller.loadInitial(buildCostsFixture());
    const opensAfterLoad = editor.opens;
    const patchesAfterLoad = editor.patches;

    // A no-op "edit": the same text written over itself still fires the event.
    editor.userEdit(isQuantityRow1, '12');
    clock.fire();
    expect(editor.opens).toBe(opensAfterLoad);
    expect(editor.patches).toBe(patchesAfterLoad);
  });

  it('reconciles only the final state of rapid edits', () => {
    const { editor, clock, controller } = setup();
    controller.loadInitial(buildCostsFixture());

    editor.userEdit(isQuantityRow1, '2');
    editor.userEdit(isQuantityRow1, '20');
    clock.fire();
    expect(costsRow(editor, 'line_total')).toBe('$3,000.00');
  });

  it('ignores events fired while it is loading its own output', () => {
    const { editor, clock, controller } = setup();
    controller.loadInitial(buildCostsFixture());
    // FakeEditor fires notifyContentChange during open(), while the phase is
    // 'loading'. Nothing may be queued from it.
    const opens = editor.opens;
    clock.fire();
    expect(editor.opens).toBe(opens);
  });
});

describe('runCommand', () => {
  it('fans out a field write and recalculates an added row', () => {
    const { editor, clock, controller } = setup();
    controller.loadInitial(buildCostsFixture());

    controller.runCommand((sfdt, index) =>
      setTaggedValue(sfdt, 'project.name', 'Rebrand', index ?? undefined)
    );
    for (const occurrence of scanBindings(
      editor.doc as SfdtDocument
    ).fields.get('project.name')!) {
      expect(occurrence.text).toBe('Rebrand');
    }

    controller.runCommand(
      (sfdt, index) =>
        addLineItem(sfdt, 'costs', null, index ?? undefined, 'r-9').sfdt
    );
    const table = scanBindings(editor.doc as SfdtDocument).tables.get('costs')!;
    expect(table.rows).toHaveLength(3);
    expect(table.rows[2].bindings.get('line_total')!.text).toBe('$0.00');
    clock.fire();
  });
});

describe('saving', () => {
  it('is blocked by diagnostics until they are fixed', async () => {
    const { editor, clock, controller } = setup();
    const store = new Map<string, string>();
    controller.persistence = new LocalStoragePersistence('doc', {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value)
    });
    controller.loadInitial(buildCostsFixture());

    editor.userEdit(isQuantityRow1, 'twelve');
    clock.fire();
    expect(controller.canSave()).toBe(false);
    expect((await controller.save()).ok).toBe(false);

    editor.userEdit(isQuantityRow1, '12');
    clock.fire();
    expect(controller.canSave()).toBe(true);
    const result = await controller.save();
    expect(result.ok).toBe(true);
    expect(result.ok && result.revision).toBe(1);
    expect(controller.dirty).toBe(false);
  });

  it('conflicts instead of clobbering when the base revision is stale', async () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value)
    };
    const firstTab = new LocalStoragePersistence('doc', storage);
    const secondTab = new LocalStoragePersistence('doc', storage);

    expect((await firstTab.save(buildCostsFixture(), 0)).ok).toBe(true);
    // The second tab is still holding revision 0.
    const result = await secondTab.save(buildCostsFixture(), 0);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.conflict).toBe(true);
    expect(result.ok === false && result.currentRevision).toBe(1);
  });
});

describe('snapshot undo/redo', () => {
  it('restores whole engine transactions', () => {
    const { editor, clock, controller } = setup();
    controller.loadInitial(buildCostsFixture());

    editor.userEdit(isQuantityRow1, '13');
    clock.fire();
    expect(costsRow(editor, 'quantity')).toBe('13');

    expect(controller.undo()).toBe(true);
    expect(costsRow(editor, 'quantity')).toBe('12');
    expect(grandTotals(editor)).toEqual(['$7,800.00', '$7,800.00']);

    expect(controller.redo()).toBe(true);
    expect(costsRow(editor, 'quantity')).toBe('13');
    clock.fire();
  });

  it('reports an empty stack rather than throwing', () => {
    const { controller } = setup();
    controller.loadInitial(buildCostsFixture());
    expect(controller.undo()).toBe(false);
    expect(controller.redo()).toBe(false);
  });
});

describe('failure handling', () => {
  it('surfaces a serialize failure as a diagnostic and stays usable', () => {
    // A real editor can throw mid-serialize while tearing down; the controller
    // must not be left stuck in a non-idle phase, or every later commit is lost.
    const { editor, controller, events } = setup();
    controller.loadInitial(buildCostsFixture());
    jest.spyOn(editor, 'serialize').mockImplementationOnce(() => {
      throw new Error('editor went away');
    });

    controller.flush();

    expect(controller.phase).toBe('idle');
    expect(controller.diagnostics[0].code).toBe('serialize-failed');
    expect(events).toContain('error');

    // And it recovers on the next flush.
    editor.userEdit(isQuantityRow1, '13');
    controller.flush();
    expect(costsRow(editor, 'line_total')).toBe('$1,950.00');
  });
});
