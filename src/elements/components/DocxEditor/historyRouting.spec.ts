import { registerHistoryRoute } from '../../../robin/document/mounts';
import {
  historyChord,
  installHistoryRouting,
  redoDocument,
  undoDocument
} from './historyRouting';

function fakeEditor() {
  const listeners: Record<string, Array<(a: any) => void>> = {};
  return {
    editorHistory: { undo: jest.fn(), redo: jest.fn() },
    addEventListener: (e: string, f: (a: any) => void) =>
      (listeners[e] ??= []).push(f),
    removeEventListener: (e: string, f: (a: any) => void) => {
      listeners[e] = (listeners[e] ?? []).filter((x) => x !== f);
    },
    fire: (e: string, a: any) => (listeners[e] ?? []).forEach((f) => f(a))
  };
}

describe('history routing', () => {
  it('reads the chords: Ctrl or Cmd Z undoes; Ctrl Y and Ctrl Shift Z redo; nothing else', () => {
    expect(historyChord({ key: 'z', ctrlKey: true })).toBe('undo');
    expect(historyChord({ key: 'Z', metaKey: true, shiftKey: true })).toBe(
      'redo'
    );
    expect(historyChord({ key: 'y', ctrlKey: true })).toBe('redo');
    expect(historyChord({ key: 'z' })).toBeNull();
    expect(historyChord({ key: 'z', ctrlKey: true, altKey: true })).toBeNull();
  });

  it("goes to the editor's own history when the editor has no document session", () => {
    const editor = fakeEditor();
    undoDocument(editor);
    redoDocument(editor);
    expect(editor.editorHistory.undo).toHaveBeenCalledTimes(1);
    expect(editor.editorHistory.redo).toHaveBeenCalledTimes(1);
    const off = installHistoryRouting(editor);
    const args = {
      event: { key: 'z', ctrlKey: true, preventDefault: jest.fn() },
      isHandled: false
    };
    editor.fire('keyDown', args);
    expect(args.isHandled).toBe(false);
    off();
  });

  it('goes through the route when there is one: toolbar and keyboard alike', () => {
    const editor = fakeEditor();
    const route = { undo: jest.fn(), redo: jest.fn(), engineHas: () => true };
    const unregister = registerHistoryRoute(editor, route);
    undoDocument(editor);
    expect(route.undo).toHaveBeenCalledTimes(1);
    expect(editor.editorHistory.undo).not.toHaveBeenCalled();
    const off = installHistoryRouting(editor);
    const args = {
      event: { key: 'y', ctrlKey: true, preventDefault: jest.fn() },
      isHandled: false
    };
    editor.fire('keyDown', args);
    expect(args.isHandled).toBe(true);
    expect(args.event.preventDefault).toHaveBeenCalled();
    expect(route.redo).toHaveBeenCalledTimes(1);
    off();
    editor.fire('keyDown', {
      event: { key: 'z', ctrlKey: true },
      isHandled: false
    });
    expect(route.undo).toHaveBeenCalledTimes(1);
    unregister();
  });

  it('takes a chord only when the engine has an entry for it; otherwise the editor keeps its own keys (review: Ctrl+Shift+Z)', () => {
    const editor = fakeEditor();
    const entries = { undo: false, redo: false };
    const route = {
      undo: jest.fn(),
      redo: jest.fn(),
      engineHas: (direction: 'undo' | 'redo') => entries[direction]
    };
    const unregister = registerHistoryRoute(editor, route);
    const off = installHistoryRouting(editor);
    const press = (event: Record<string, unknown>) => {
      const args = {
        event: { ...event, preventDefault: jest.fn() },
        isHandled: false
      };
      editor.fire('keyDown', args);
      return args.isHandled;
    };
    expect(press({ key: 'z', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(press({ key: 'z', ctrlKey: true })).toBe(false);
    expect(route.redo).not.toHaveBeenCalled();
    expect(route.undo).not.toHaveBeenCalled();
    entries.redo = true;
    expect(press({ key: 'z', ctrlKey: true, shiftKey: true })).toBe(true);
    expect(route.redo).toHaveBeenCalledTimes(1);
    off();
    unregister();
  });
});
