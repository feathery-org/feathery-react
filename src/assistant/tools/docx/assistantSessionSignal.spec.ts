// The version-history session tracker treats a turn end (assistant session
// active → inactive) as a slice boundary. It must hear only EDGES, and be able
// to unsubscribe. These are the guarantees onAssistantSessionChange makes.
import {
  isAssistantWriting,
  onAssistantSessionChange,
  setAssistantSessionActive
} from './syncfusionDocumentOps';

describe('onAssistantSessionChange', () => {
  const makeEditor = () => ({} as any);

  it('notifies only on transitions, not repeated same-value sets', () => {
    const editor = makeEditor();
    const seen: boolean[] = [];
    onAssistantSessionChange(editor, (active) => seen.push(active));

    setAssistantSessionActive(editor, true); // edge → true
    setAssistantSessionActive(editor, true); // no change
    setAssistantSessionActive(editor, false); // edge → false
    setAssistantSessionActive(editor, false); // no change

    expect(seen).toEqual([true, false]);
  });

  it('stops delivering after unsubscribe', () => {
    const editor = makeEditor();
    const seen: boolean[] = [];
    const off = onAssistantSessionChange(editor, (active) => seen.push(active));

    setAssistantSessionActive(editor, true);
    off();
    setAssistantSessionActive(editor, false);

    expect(seen).toEqual([true]);
  });

  it('keeps the writing predicate in sync with the flag', () => {
    const editor = makeEditor();
    expect(isAssistantWriting(editor)).toBe(false);
    setAssistantSessionActive(editor, true);
    expect(isAssistantWriting(editor)).toBe(true);
    setAssistantSessionActive(editor, false);
    expect(isAssistantWriting(editor)).toBe(false);
  });

  it('is a no-op (no throw) on a null editor', () => {
    expect(() => setAssistantSessionActive(null, true)).not.toThrow();
    const off = onAssistantSessionChange(null, () => undefined);
    expect(() => off()).not.toThrow();
  });
});
