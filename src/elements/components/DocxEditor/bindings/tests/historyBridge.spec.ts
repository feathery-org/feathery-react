// Undo has to reach past a structural reconcile. Adopting an inserted row
// reloads the document, which empties Syncfusion's undo stack, so the row insert
// became impossible to take back. These assertions pin the arbitration rule:
// native history wins whenever it has anything left, and a snapshot is used only
// when the alternative is doing nothing at all.
import { installHistoryBridge } from '../historyBridge';
import { SyncfusionEditorLike } from '../editorAdapter';

interface FakeHistory {
  undo?: (...args: unknown[]) => unknown;
  redo?: (...args: unknown[]) => unknown;
  canUndo?: () => boolean;
  canRedo?: () => boolean;
}

function fakeEditor(history: FakeHistory | undefined) {
  return {
    serialize: () => '{}',
    open: () => undefined,
    editorHistoryModule: history
  } as unknown as SyncfusionEditorLike;
}

/**
 * A history module plus handles on the ORIGINAL methods - the module's own
 * properties get replaced by the bridge, so asserting through them would only
 * ever see the wrapper.
 */
function nativeHistory(depth: { undo: number; redo: number }, bare = false) {
  const undo = jest.fn();
  const redo = jest.fn();
  const module: FakeHistory = bare
    ? { undo, redo }
    : {
        undo,
        redo,
        canUndo: () => depth.undo > 0,
        canRedo: () => depth.redo > 0
      };
  return { module, undo, redo };
}

/** Counts snapshot restores, and can report having none left. */
function snapshots(available = 1) {
  const calls = { undo: 0, redo: 0 };
  return {
    calls,
    port: {
      undo: () => {
        if (calls.undo >= available) return false;
        calls.undo += 1;
        return true;
      },
      redo: () => {
        if (calls.redo >= available) return false;
        calls.redo += 1;
        return true;
      }
    }
  };
}

const callUndo = (module: FakeHistory) => (module.undo as () => void)();
const callRedo = (module: FakeHistory) => (module.redo as () => void)();

describe('installHistoryBridge', () => {
  it('leaves native history in charge while it still has entries', () => {
    const native = nativeHistory({ undo: 2, redo: 0 });
    const snap = snapshots();
    installHistoryBridge(fakeEditor(native.module), snap.port);

    callUndo(native.module);
    expect(native.undo).toHaveBeenCalledTimes(1);
    expect(snap.calls.undo).toBe(0); // untouched
  });

  it('uses a snapshot once native history is exhausted', () => {
    // The state a structural reload leaves behind: nothing native to undo.
    const native = nativeHistory({ undo: 0, redo: 0 });
    const snap = snapshots();
    installHistoryBridge(fakeEditor(native.module), snap.port);

    callUndo(native.module);
    expect(snap.calls.undo).toBe(1);
    // The native implementation must not also run - that would undo twice.
    expect(native.undo).toHaveBeenCalledTimes(0);
  });

  it('redoes from a snapshot the same way', () => {
    const native = nativeHistory({ undo: 0, redo: 0 });
    const snap = snapshots();
    installHistoryBridge(fakeEditor(native.module), snap.port);

    callRedo(native.module);
    expect(snap.calls.redo).toBe(1);
    expect(native.redo).toHaveBeenCalledTimes(0);
  });

  it('still calls native when there is no snapshot either', () => {
    // Nothing to restore anywhere: the keystroke must reach the editor rather
    // than being silently swallowed.
    const native = nativeHistory({ undo: 0, redo: 0 });
    installHistoryBridge(fakeEditor(native.module), snapshots(0).port);

    callUndo(native.module);
    expect(native.undo).toHaveBeenCalledTimes(1);
  });

  it('falls through to native when a snapshot throws', () => {
    const native = nativeHistory({ undo: 0, redo: 0 });
    installHistoryBridge(fakeEditor(native.module), {
      undo: () => {
        throw new Error('snapshot blew up');
      },
      redo: () => false
    });

    expect(() => callUndo(native.module)).not.toThrow();
    expect(native.undo).toHaveBeenCalledTimes(1);
  });

  it('keeps native behaviour on a build with no capability methods', () => {
    // Unknown build: never substitute a snapshot for something we cannot verify.
    const native = nativeHistory({ undo: 0, redo: 0 }, true);
    const snap = snapshots();
    installHistoryBridge(fakeEditor(native.module), snap.port);

    callUndo(native.module);
    callRedo(native.module);
    expect(native.undo).toHaveBeenCalledTimes(1);
    expect(native.redo).toHaveBeenCalledTimes(1);
    expect(snap.calls).toEqual({ undo: 0, redo: 0 });
  });

  it('restores the original methods on uninstall', () => {
    const native = nativeHistory({ undo: 0, redo: 0 });
    const uninstall = installHistoryBridge(
      fakeEditor(native.module),
      snapshots().port
    );

    expect(native.module.undo).not.toBe(native.undo);
    uninstall();
    expect(native.module.undo).toBe(native.undo);
    expect(native.module.redo).toBe(native.redo);
  });

  it('is a no-op when the editor has no history module', () => {
    const uninstall = installHistoryBridge(
      fakeEditor(undefined),
      snapshots().port
    );
    expect(typeof uninstall).toBe('function');
    expect(() => uninstall()).not.toThrow();
  });
});
