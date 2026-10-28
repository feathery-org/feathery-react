import {
  isRobinEditing,
  setRobinTurnActive,
  whileRobinWrites
} from './robinActivity';
import { ROBIN_TURN_IDLE_MS, settleTurnWhenIdle } from './robinTurnGuard';

function fakeEditor() {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    addEventListener: (e: string, f: () => void) =>
      (listeners[e] ??= []).push(f),
    removeEventListener: (e: string, f: () => void) => {
      listeners[e] = (listeners[e] ?? []).filter((x) => x !== f);
    },
    fire: (e: string) => (listeners[e] ?? []).forEach((f) => f())
  } as any;
}
/** A turn as the session runs it: a write starts it, finishTurn settles it. */
function fakeSession(editor: any) {
  const session = {
    activeTurn: null as string | null,
    start(turnId: string) {
      session.activeTurn = turnId;
      setRobinTurnActive(editor, true);
    },
    finishTurn: jest.fn(() => {
      session.activeTurn = null;
      setRobinTurnActive(editor, false);
    })
  };
  return session;
}

describe("Robin's turn mark clears itself (review: onTurnSettled may never arrive)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('clears after the idle time since the last write when no settle arrives', () => {
    const editor = fakeEditor();
    const session = fakeSession(editor);
    const guard = settleTurnWhenIdle(editor, session);
    session.start('t1');
    guard.activity();
    jest.advanceTimersByTime(ROBIN_TURN_IDLE_MS - 1);
    expect(isRobinEditing(editor)).toBe(true);
    // another write restarts the wait
    guard.activity();
    jest.advanceTimersByTime(ROBIN_TURN_IDLE_MS - 1);
    expect(isRobinEditing(editor)).toBe(true);
    jest.advanceTimersByTime(1);
    expect(isRobinEditing(editor)).toBe(false);
    expect(session.finishTurn).toHaveBeenCalledTimes(1);
    guard.dispose();
  });

  it("a person's edit clears it at once; Robin's own change events do not", () => {
    const editor = fakeEditor();
    const session = fakeSession(editor);
    const guard = settleTurnWhenIdle(editor, session);
    session.start('t1');
    guard.activity();
    whileRobinWrites(editor, () => editor.fire('contentChange'));
    expect(isRobinEditing(editor)).toBe(true);
    editor.fire('contentChange');
    expect(isRobinEditing(editor)).toBe(false);
    expect(session.finishTurn).toHaveBeenCalledTimes(1);
    guard.dispose();
  });

  it('a settle signal clears it sooner, and the wait then does nothing', () => {
    const editor = fakeEditor();
    const session = fakeSession(editor);
    const guard = settleTurnWhenIdle(editor, session);
    session.start('t1');
    guard.activity();
    session.finishTurn();
    jest.advanceTimersByTime(ROBIN_TURN_IDLE_MS);
    expect(session.finishTurn).toHaveBeenCalledTimes(1);
    guard.dispose();
    editor.fire('contentChange');
    expect(session.finishTurn).toHaveBeenCalledTimes(1);
  });
});
