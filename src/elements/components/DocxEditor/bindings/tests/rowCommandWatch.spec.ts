// A row the user inserts with the editor's own tools must show its defaults
// straight away. Before this, nothing reconciled until the next commit trigger,
// so the row sat empty until the user happened to click into it.
//
// Fakes rather than a real editor: what matters is that insertRow is observed and
// that the reconcile it schedules is the restricted kind, neither of which needs
// Syncfusion to verify.
import { createCommitTriggers } from '../commitTriggers';
import { ReconciliationController } from '../controller';
import { SyncfusionEditorLike } from '../editorAdapter';
import { watchRowCommands } from '../rowCommandWatch';

/** Records flush calls; everything else the triggers touch is unused here. */
function fakeController() {
  const flushes: Array<string | undefined> = [];
  const controller = {
    phase: 'idle',
    flush: (options?: { mode?: string }) => flushes.push(options?.mode),
    notifyContentChange: () => undefined
  };
  return { controller, flushes };
}

function fakeEditor(insertRow?: (...args: unknown[]) => unknown) {
  return {
    serialize: () => '{}',
    open: () => undefined,
    editorModule: insertRow ? { insertRow } : {},
    selection: {}
  } as unknown as SyncfusionEditorLike;
}

/** Runs scheduled callbacks on demand so the debounce is deterministic. */
function manualTimers() {
  const queue: Array<() => void> = [];
  return {
    setTimeoutFn: (fn: () => void) => {
      queue.push(fn);
      return queue.length;
    },
    clearTimeoutFn: (id: unknown) => {
      const index = (id as number) - 1;
      if (index >= 0 && index < queue.length) queue[index] = () => undefined;
    },
    runAll: () => {
      const pending = queue.splice(0, queue.length);
      for (const fn of pending) fn();
    }
  };
}

describe('watchRowCommands', () => {
  it('reports an insert and returns the original result', () => {
    let inserted = 0;
    const original = jest.fn(() => 'ok');
    const editor = fakeEditor(original);
    const restore = watchRowCommands(editor, () => (inserted += 1));

    const editorModule = (editor as any).editorModule;
    expect(editorModule.insertRow(false, 2)).toBe('ok');
    expect(original).toHaveBeenCalledWith(false, 2);
    expect(inserted).toBe(1);

    restore();
    expect(editorModule.insertRow).toBe(original);
    editorModule.insertRow();
    expect(inserted).toBe(1); // no longer watching
  });

  it('reports a delete too, so totals drop out at once', () => {
    let changes = 0;
    const original = jest.fn(() => 'deleted');
    const editor = fakeEditor(undefined);
    (editor as any).editorModule = { deleteRow: original };
    const restore = watchRowCommands(editor, () => (changes += 1));

    expect((editor as any).editorModule.deleteRow()).toBe('deleted');
    expect(changes).toBe(1);
    restore();
    expect((editor as any).editorModule.deleteRow).toBe(original);
  });

  it('never lets a failing watcher break the insert', () => {
    const editor = fakeEditor(() => 'ok');
    watchRowCommands(editor, () => {
      throw new Error('watcher blew up');
    });
    expect(() => (editor as any).editorModule.insertRow()).not.toThrow();
  });

  it('is a no-op when the editor exposes no insertRow', () => {
    const editor = fakeEditor();
    let called = 0;
    const restore = watchRowCommands(editor, () => (called += 1));
    expect(typeof restore).toBe('function');
    expect(() => restore()).not.toThrow();
    expect(called).toBe(0);
  });
});

describe('onRowsChanged', () => {
  it('adopts the row with a restricted reconcile, not a commit', () => {
    const { controller, flushes } = fakeController();
    const timers = manualTimers();
    const triggers = createCommitTriggers(
      fakeEditor(),
      controller as unknown as ReconciliationController,
      { setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn }
    );

    triggers.onRowsChanged();
    expect(flushes).toEqual([]); // debounced, not immediate
    timers.runAll();
    // 'self-heal' fills the new row without rewriting cells being typed in.
    expect(flushes).toEqual(['self-heal']);
  });

  it('collapses the several events one insert emits into one reconcile', () => {
    const { controller, flushes } = fakeController();
    const timers = manualTimers();
    const triggers = createCommitTriggers(
      fakeEditor(),
      controller as unknown as ReconciliationController,
      { setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn }
    );

    triggers.onRowsChanged();
    triggers.onRowsChanged();
    triggers.onRowsChanged();
    timers.runAll();
    expect(flushes).toEqual(['self-heal']);
  });

  it('leaves a pending edit alone, so a real commit still happens', () => {
    const { controller, flushes } = fakeController();
    const timers = manualTimers();
    const triggers = createCommitTriggers(
      fakeEditor(),
      controller as unknown as ReconciliationController,
      { setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn }
    );

    triggers.onContentChange();
    expect(triggers.hasPendingEdit()).toBe(true);
    triggers.onRowsChanged();
    timers.runAll();
    expect(triggers.hasPendingEdit()).toBe(true);
    triggers.onEditorBlur();
    expect(flushes).toEqual(['self-heal', undefined]); // adopt, then commit
  });

  it('cancels a scheduled adopt on dispose', () => {
    const { controller, flushes } = fakeController();
    const timers = manualTimers();
    const triggers = createCommitTriggers(
      fakeEditor(),
      controller as unknown as ReconciliationController,
      { setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn }
    );

    triggers.onRowsChanged();
    triggers.dispose();
    timers.runAll();
    expect(flushes).toEqual([]);
  });
});
