// Robin's turn mark (robinActivity) is set by a turn's first write and cleared when the form says
// the turn settled. If that signal never arrives (a dropped connection, a closed panel), the mark
// would stay until the editor remounts, and with it the locks it holds (reorder, restore, autosave
// slicing). So it also clears itself: after a quiet spell since Robin's last write, and at once
// when the person edits the document themselves.
import { isRobinWriting } from './robinActivity';

/**
 * How long after Robin's last write an unsettled turn ends on its own: two minutes. Measured over
 * the rig's final browser pass (61 sessions, 308 gaps between consecutive document writes): median
 * 5.6 s, 90th percentile 34 s. Short enough that a lost settle does not hold the locks for the
 * rest of the session; if a turn's next write comes later, it simply marks the turn again. A
 * settle signal still ends the turn at once.
 */
export const ROBIN_TURN_IDLE_MS = 120000;

interface TurnOwner {
  readonly activeTurn: string | null;
  finishTurn(): void;
}

/** Ends `session`'s turn when it goes quiet or the person edits; `activity()` on each write. */
export function settleTurnWhenIdle(
  editor: unknown,
  session: TurnOwner,
  idleMs: number = ROBIN_TURN_IDLE_MS
): { activity(): void; dispose(): void } {
  const ed = editor as {
    addEventListener?: (event: string, cb: () => void) => void;
    removeEventListener?: (event: string, cb: () => void) => void;
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const settle = () => {
    stop();
    if (session.activeTurn !== null) session.finishTurn();
  };
  // a change event while Robin is not writing is the person's own edit
  const onChange = () => {
    if (!isRobinWriting(editor)) settle();
  };
  ed.addEventListener?.('contentChange', onChange);
  return {
    activity() {
      stop();
      timer = setTimeout(settle, idleMs);
    },
    dispose() {
      stop();
      try {
        ed.removeEventListener?.('contentChange', onChange);
      } catch {
        // a destroyed editor has nothing to detach from
      }
    }
  };
}
