/**
 * Undo routing (decision D4, architecture 4.3b): the editor keeps undoing the user's edits and
 * Robin's native changes as it always has; the engine keeps a small stack of its own entries,
 * each a before and after snapshot: a structural change set committed by replacing the document
 * (which clears the editor's history) and a card resolution. Ctrl+Z goes to the editor when it has
 * an entry, else to the engine; Ctrl+Y the same way.
 *
 * An engine entry applies only to the document it left: undo needs the document to be the entry's
 * `after`, redo its `before`, compared under the pack's normalizations because a native undo or a
 * reopen is not byte-stable. Otherwise the user changed the document since, with no way back through
 * the editor, and restoring the snapshot would silently discard that work, so that one entry is
 * dropped and the rest of the stack is kept.
 */
import type { EditorHost } from './pack';

export interface EngineEntry {
  turnId: string;
  kind: 'change-set' | 'resolution';
  before: string;
  after: string;
}

export type HistoryOutcome =
  | { via: 'editor' }
  | { via: 'engine'; entry: EngineEntry }
  | { via: 'none'; stale?: EngineEntry };

/** Snapshots kept per direction; each is a whole serialized document. */
export const ENGINE_HISTORY_LIMIT = 10;

export class EngineHistory {
  private undoStack: EngineEntry[] = [];

  private redoStack: EngineEntry[] = [];

  private readonly limit: number;

  private readonly same: (a: string, b: string) => boolean;

  constructor(
    limit: number = ENGINE_HISTORY_LIMIT,
    same: (a: string, b: string) => boolean = (a, b) => a === b
  ) {
    this.limit = limit;
    this.same = same;
  }

  push(entry: EngineEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  /**
   * The change set's own entry when the document is still exactly what it left (under the pack's
   * normalizations): rejecting its card can then restore the snapshot, byte for byte.
   */
  restorable(turnId: string, now: string): EngineEntry | undefined {
    const top = this.undoStack[this.undoStack.length - 1];
    return top &&
      top.turnId === turnId &&
      top.kind === 'change-set' &&
      this.same(now, top.after)
      ? top
      : undefined;
  }

  get depth(): { undo: number; redo: number } {
    return { undo: this.undoStack.length, redo: this.redoStack.length };
  }

  canUndo(host: EditorHost): boolean {
    return host.canUndo() || this.undoStack.length > 0;
  }

  canRedo(host: EditorHost): boolean {
    return host.canRedo() || this.redoStack.length > 0;
  }

  undo(host: EditorHost): HistoryOutcome {
    if (host.canUndo()) {
      host.undo();
      return { via: 'editor' };
    }
    const entry = this.undoStack.pop();
    if (!entry) return { via: 'none' };
    if (!this.same(host.serialize(), entry.after))
      return { via: 'none', stale: entry };
    host.open(entry.before);
    this.redoStack.push(entry);
    return { via: 'engine', entry };
  }

  redo(host: EditorHost): HistoryOutcome {
    if (host.canRedo()) {
      host.redo();
      return { via: 'editor' };
    }
    const entry = this.redoStack.pop();
    if (!entry) return { via: 'none' };
    if (!this.same(host.serialize(), entry.before))
      return { via: 'none', stale: entry };
    host.open(entry.after);
    this.undoStack.push(entry);
    return { via: 'engine', entry };
  }
}
