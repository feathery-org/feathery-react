import { act, renderHook } from '@testing-library/react';

import {
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
