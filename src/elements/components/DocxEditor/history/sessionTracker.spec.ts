import {
  createSessionTracker,
  SESSION_IDLE_MS,
  CloseReason
} from './sessionTracker';
import { VersionAuthor } from './types';

const USER: VersionAuthor = { kind: 'user', key: 'you', label: 'You' };
const ROBIN: VersionAuthor = {
  kind: 'assistant',
  key: 'robin',
  label: 'Robin'
};

describe('createSessionTracker', () => {
  let clock: number;
  const now = () => clock;

  const make = (
    over: Partial<Parameters<typeof createSessionTracker>[0]> = {}
  ) => {
    const boundaries: VersionAuthor[] = [];
    const closes: CloseReason[] = [];
    const closeMetas: Array<{ sessionId: string }> = [];
    const tracker = createSessionTracker({
      now,
      onSliceBoundary: (a) => boundaries.push(a),
      onClose: (r, meta) => {
        closes.push(r);
        closeMetas.push(meta);
      },
      ...over
    });
    return { tracker, boundaries, closes, closeMetas };
  };

  beforeEach(() => {
    clock = 1_000_000;
  });

  it('mints a session on the first edit and reuses it while active', () => {
    const { tracker, closes } = make();
    expect(tracker.isOpen()).toBe(false);

    tracker.noteEdit(USER);
    const first = tracker.currentMeta();
    expect(first).not.toBeNull();
    expect(tracker.isOpen()).toBe(true);

    clock += 1000;
    tracker.noteEdit(USER);
    expect(tracker.currentMeta()!.sessionId).toBe(first!.sessionId);
    expect(closes).toEqual([]);
  });

  it('closes an idle session and starts a new one on the next edit', () => {
    const { tracker, closes, closeMetas } = make();
    tracker.noteEdit(USER);
    const first = tracker.currentMeta()!.sessionId;

    clock += SESSION_IDLE_MS; // exactly the idle threshold
    tracker.noteEdit(USER);

    expect(closes).toEqual(['idle']);
    // onClose carries the closing session's meta (cleared internally first).
    expect(closeMetas[0].sessionId).toBe(first);
    expect(tracker.currentMeta()!.sessionId).not.toBe(first);
  });

  it('closes on checkIdle without a new edit', () => {
    const { tracker, closes } = make();
    tracker.noteEdit(USER);

    clock += SESSION_IDLE_MS - 1;
    tracker.checkIdle();
    expect(closes).toEqual([]); // not yet idle

    clock += 1;
    tracker.checkIdle();
    expect(closes).toEqual(['idle']);
    expect(tracker.isOpen()).toBe(false);
  });

  it('emits a slice boundary for the outgoing author on an actor switch', () => {
    const { tracker, boundaries } = make();
    tracker.noteEdit(USER);
    tracker.noteEdit(USER); // same author, no boundary
    expect(boundaries).toEqual([]);

    tracker.noteEdit(ROBIN); // switch → the user's slice ends
    expect(boundaries).toEqual([USER]);

    tracker.noteEdit(USER); // switch back → Robin's slice ends
    expect(boundaries).toEqual([USER, ROBIN]);
  });

  it('records each distinct author once, in first-seen order', () => {
    const { tracker } = make();
    tracker.noteEdit(USER);
    tracker.noteEdit(ROBIN);
    tracker.noteEdit(USER);
    expect(tracker.currentMeta()!.authors).toEqual([
      { kind: 'user', label: 'You' },
      { kind: 'assistant', label: 'Robin' }
    ]);
  });

  it('closes on turn end, explicit save, and reset', () => {
    for (const [act, reason] of [
      ['noteTurnEnd', 'turn_end'],
      ['noteExplicitSave', 'explicit_save'],
      ['reset', 'reset']
    ] as const) {
      const { tracker, closes } = make();
      tracker.noteEdit(USER);
      (tracker as any)[act]();
      expect(closes).toEqual([reason]);
      expect(tracker.isOpen()).toBe(false);
    }
  });

  it('is a no-op to close when no session is open', () => {
    const { tracker, closes } = make();
    tracker.noteTurnEnd();
    tracker.reset();
    tracker.checkIdle();
    expect(closes).toEqual([]);
    expect(tracker.currentMeta()).toBeNull();
  });
});
