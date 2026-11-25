import { act, renderHook } from '@testing-library/react';
import { featheryDoc, featheryWindow } from './browser';
import useRefreshOnFocus from './useRefreshOnFocus';

const fireFocus = () => featheryWindow().dispatchEvent(new Event('focus'));
const fireVisible = () =>
  featheryDoc().dispatchEvent(new Event('visibilitychange'));

describe('useRefreshOnFocus', () => {
  it('runs on focus when enabled', () => {
    const cb = jest.fn();
    renderHook(() => useRefreshOnFocus(cb, true));
    act(() => fireFocus());
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('runs when the tab becomes visible', () => {
    const cb = jest.fn();
    renderHook(() => useRefreshOnFocus(cb, true));
    act(() => fireVisible());
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled', () => {
    const cb = jest.fn();
    renderHook(() => useRefreshOnFocus(cb, false));
    act(() => {
      fireFocus();
      fireVisible();
    });
    expect(cb).not.toHaveBeenCalled();
  });

  it('coalesces overlapping events until the in-flight run settles', async () => {
    let settle!: () => void;
    const cb = jest.fn(
      () => new Promise<void>((resolve) => (settle = resolve))
    );
    renderHook(() => useRefreshOnFocus(cb, true));

    act(() => fireFocus());
    act(() => fireVisible()); // ignored — the first run is still in flight
    expect(cb).toHaveBeenCalledTimes(1);

    await act(async () => settle());
    act(() => fireFocus());
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('stops after unmount', () => {
    const cb = jest.fn();
    const { unmount } = renderHook(() => useRefreshOnFocus(cb, true));
    unmount();
    act(() => fireFocus());
    expect(cb).not.toHaveBeenCalled();
  });
});
