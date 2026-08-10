import { act, renderHook } from '@testing-library/react';

import {
  TURN_IDLE_GRACE_MS,
  useTurnRunning,
  useWorkingPhrase,
  WORKING_PHRASE_INTERVAL_MS,
  WORKING_PHRASES
} from './workingPhrases';

describe('assistant working-on-it phrases', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('advances one phrase per interval while a turn runs', () => {
    const { result } = renderHook(() => useWorkingPhrase(true));

    expect(result.current).toBe(WORKING_PHRASES[0]);

    act(() => jest.advanceTimersByTime(WORKING_PHRASE_INTERVAL_MS));
    expect(result.current).toBe(WORKING_PHRASES[1]);

    act(() => jest.advanceTimersByTime(WORKING_PHRASE_INTERVAL_MS));
    expect(result.current).toBe(WORKING_PHRASES[2]);
  });

  it('wraps around at the end of the list', () => {
    const { result } = renderHook(() => useWorkingPhrase(true));

    act(() =>
      jest.advanceTimersByTime(
        WORKING_PHRASE_INTERVAL_MS * WORKING_PHRASES.length
      )
    );

    expect(result.current).toBe(WORKING_PHRASES[0]);
  });

  // The hook's own interval id, so the assertion ignores unrelated timers
  const spyOnTimers = () => {
    const set = jest.spyOn(global, 'setInterval');
    const cleared = jest.spyOn(global, 'clearInterval');
    return {
      lastIntervalId: () => {
        const results = set.mock.results;
        expect(results.length).toBeGreaterThan(0);
        return results[results.length - 1].value;
      },
      clearedIds: () => cleared.mock.calls.map((call) => call[0]),
      restore: () => {
        set.mockRestore();
        cleared.mockRestore();
      }
    };
  };

  it('clears the interval and resets when the turn ends', () => {
    const timers = spyOnTimers();
    const { result, rerender } = renderHook(
      ({ active }) => useWorkingPhrase(active),
      { initialProps: { active: true } }
    );
    const intervalId = timers.lastIntervalId();

    act(() => jest.advanceTimersByTime(WORKING_PHRASE_INTERVAL_MS));
    expect(result.current).toBe(WORKING_PHRASES[1]);

    rerender({ active: false });
    expect(timers.clearedIds()).toContain(intervalId);
    expect(result.current).toBe(WORKING_PHRASES[0]);

    // Nothing is left running to advance the phrase once the turn is over
    act(() => jest.advanceTimersByTime(WORKING_PHRASE_INTERVAL_MS * 4));
    expect(result.current).toBe(WORKING_PHRASES[0]);

    timers.restore();
  });

  it('restarts from the first phrase on the next turn', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useWorkingPhrase(active),
      { initialProps: { active: true } }
    );

    act(() => jest.advanceTimersByTime(WORKING_PHRASE_INTERVAL_MS * 2));
    expect(result.current).toBe(WORKING_PHRASES[2]);

    rerender({ active: false });
    rerender({ active: true });

    expect(result.current).toBe(WORKING_PHRASES[0]);
  });

  it('clears the interval on unmount', () => {
    const timers = spyOnTimers();
    const { unmount } = renderHook(() => useWorkingPhrase(true));
    const intervalId = timers.lastIntervalId();

    expect(timers.clearedIds()).not.toContain(intervalId);
    unmount();
    expect(timers.clearedIds()).toContain(intervalId);

    timers.restore();
  });
});

// One user turn is several HTTP round-trips, and the SDK's status dips through
// 'ready' between them. These pin the latch that spans those dips.
describe('assistant turn-running latch', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const renderLatch = (running: boolean) =>
    renderHook(({ loading }) => useTurnRunning(loading), {
      initialProps: { loading: running }
    });

  it('latches on immediately, with no entry delay', () => {
    const { result, rerender } = renderLatch(false);

    act(() => jest.advanceTimersByTime(TURN_IDLE_GRACE_MS));
    expect(result.current).toBe(false);

    rerender({ loading: true });
    expect(result.current).toBe(true);
  });

  it('holds across an idle gap shorter than the grace window', () => {
    const { result, rerender } = renderLatch(true);

    // The gap between two round-trips of the same turn
    rerender({ loading: false });
    act(() => jest.advanceTimersByTime(TURN_IDLE_GRACE_MS - 1));
    expect(result.current).toBe(true);

    // The next request starts, so the latch never dropped
    rerender({ loading: true });
    act(() => jest.advanceTimersByTime(TURN_IDLE_GRACE_MS * 4));
    expect(result.current).toBe(true);
  });

  it('drops once the turn has been idle for the whole window', () => {
    const { result, rerender } = renderLatch(true);

    rerender({ loading: false });
    act(() => jest.advanceTimersByTime(TURN_IDLE_GRACE_MS - 1));
    expect(result.current).toBe(true);

    act(() => jest.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });

  it('cancels a pending stand-down when the next round-trip starts', () => {
    const { result, rerender } = renderLatch(true);

    rerender({ loading: false });
    rerender({ loading: true });

    // The timeout armed by the gap must not survive to fire mid-turn
    act(() => jest.advanceTimersByTime(TURN_IDLE_GRACE_MS * 4));
    expect(result.current).toBe(true);
  });

  it('clears the pending timeout on unmount', () => {
    const cleared = jest.spyOn(global, 'clearTimeout');
    const set = jest.spyOn(global, 'setTimeout');
    const { rerender, unmount } = renderLatch(true);

    rerender({ loading: false });
    const timeoutId = set.mock.results[set.mock.results.length - 1].value;

    expect(cleared.mock.calls.map((c) => c[0])).not.toContain(timeoutId);
    unmount();
    expect(cleared.mock.calls.map((c) => c[0])).toContain(timeoutId);

    set.mockRestore();
    cleared.mockRestore();
  });
});

// The two symptoms share one cause, so this pins them together: the phrase is
// driven by the latch, not by the raw per-request flag.
describe('working phrase driven by the turn latch', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // `turn` is the user turn the request belongs to: it stays put across one
  // turn's round-trips and changes when the user sends again
  const renderLatchedPhrase = () =>
    renderHook(
      ({ loading, turn }) => useWorkingPhrase(useTurnRunning(loading), turn),
      { initialProps: { loading: true, turn: 1 } }
    );

  it('keeps counting across the gap between round-trips', () => {
    const { result, rerender } = renderLatchedPhrase();

    act(() => jest.advanceTimersByTime(WORKING_PHRASE_INTERVAL_MS));
    expect(result.current).toBe(WORKING_PHRASES[1]);

    // A round-trip boundary: request one ends, request two starts inside the
    // grace window. The phrase must not drop back to "Working on it..."
    rerender({ loading: false, turn: 1 });
    act(() => jest.advanceTimersByTime(TURN_IDLE_GRACE_MS - 1));
    rerender({ loading: true, turn: 1 });
    expect(result.current).toBe(WORKING_PHRASES[1]);

    act(() => jest.advanceTimersByTime(WORKING_PHRASE_INTERVAL_MS));
    expect(result.current).toBe(WORKING_PHRASES[2]);
  });

  it('restarts from the first phrase on the next user turn', () => {
    const { result, rerender } = renderLatchedPhrase();

    act(() => jest.advanceTimersByTime(WORKING_PHRASE_INTERVAL_MS * 2));
    expect(result.current).toBe(WORKING_PHRASES[2]);

    // The turn really ends, so the latch drops
    rerender({ loading: false, turn: 1 });
    act(() => jest.advanceTimersByTime(TURN_IDLE_GRACE_MS));
    expect(result.current).toBe(WORKING_PHRASES[0]);

    rerender({ loading: true, turn: 2 });
    expect(result.current).toBe(WORKING_PHRASES[0]);
  });

  // The case the latch alone cannot see: a reply lands, the user asks again
  // within 500ms, so the latch never drops and `active` never changes - but
  // this is a new question, not another round-trip of the old one
  it('restarts on a new user turn begun inside the grace window', () => {
    const { result, rerender } = renderLatchedPhrase();

    act(() => jest.advanceTimersByTime(WORKING_PHRASE_INTERVAL_MS * 2));
    expect(result.current).toBe(WORKING_PHRASES[2]);

    rerender({ loading: false, turn: 1 });
    act(() => jest.advanceTimersByTime(TURN_IDLE_GRACE_MS - 1));
    rerender({ loading: true, turn: 2 });

    expect(result.current).toBe(WORKING_PHRASES[0]);
  });
});
