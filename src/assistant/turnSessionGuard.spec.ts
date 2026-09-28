import { act, renderHook } from '@testing-library/react';

import {
  _clearDocxEditors,
  registerDocxEditor
} from './tools/docx/docxEditorRegistry';
import {
  isAssistantWriting,
  setAssistantSessionActive
} from './tools/docx/syncfusionDocumentOps';
import { useAssistantSessionClear } from './turnSessionGuard';
import { TURN_IDLE_GRACE_MS, useTurnRunning } from './workingPhrases';

// One user turn is several HTTP round-trips, and the SDK's status dips
// through 'ready' between them. These pin the rail's writing guard to the
// latch that spans those dips — clearing on the raw flag instead reopens
// the unguarded window that auto-expands the tracked-changes rail.
describe('assistant docx session guard', () => {
  let editor: any;

  beforeEach(() => {
    jest.useFakeTimers();
    _clearDocxEditors();
    editor = {};
    registerDocxEditor('editor-1', editor);
  });
  afterEach(() => {
    jest.useRealTimers();
    _clearDocxEditors();
  });

  // Composed with useTurnRunning exactly as AssistantChat wires it
  const renderGuard = (loading: boolean) =>
    renderHook(
      ({ loading: running }) =>
        useAssistantSessionClear(useTurnRunning(running)),
      { initialProps: { loading } }
    );

  it('holds the flag across a status dip between round-trips', () => {
    const { rerender } = renderGuard(true);
    // The bridge raises the flag on the turn's first document write
    setAssistantSessionActive(editor, true);
    expect(isAssistantWriting(editor)).toBe(true);

    // The dip: the write's tool call resolved, the next request not yet fired
    rerender({ loading: false });
    act(() => jest.advanceTimersByTime(TURN_IDLE_GRACE_MS - 1));
    expect(isAssistantWriting(editor)).toBe(true);

    // The next round-trip starts inside the grace window; the guard held
    rerender({ loading: true });
    act(() => jest.advanceTimersByTime(TURN_IDLE_GRACE_MS * 4));
    expect(isAssistantWriting(editor)).toBe(true);
  });

  it('clears the flag once the turn has been idle past the grace window', () => {
    const { rerender } = renderGuard(true);
    setAssistantSessionActive(editor, true);

    rerender({ loading: false });
    act(() => jest.advanceTimersByTime(TURN_IDLE_GRACE_MS));
    expect(isAssistantWriting(editor)).toBe(false);
  });

  it('clears the flag on unmount even mid-turn', () => {
    const { unmount } = renderGuard(true);
    setAssistantSessionActive(editor, true);

    unmount();
    expect(isAssistantWriting(editor)).toBe(false);
  });
});
