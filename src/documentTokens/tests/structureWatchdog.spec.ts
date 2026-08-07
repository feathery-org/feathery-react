/**
 * The two outcomes when an edit damages the token structure.
 *
 * fuzz.spec.ts only ever exercises the happy path, where the editor's own undo
 * puts the structure back. The failure path — undo that does NOT restore it —
 * is the one that must report loudly, and nothing was driving it. These do,
 * against the smallest fake that the watchdog's public surface reads through:
 * `documentShape` → `readTokens` → `exportContentControlData` (no
 * `contentControlCollection`, so that fallback path is taken), plus the
 * `editorHistory.undo` the watchdog calls to try to repair.
 */

import { ContentControlInfo, EditorLike, encodeTag } from '../controls';
import { structureWatchdog } from '../structureWatchdog';
import { TokenSpec } from '../plan';

const qty = (index: number): TokenSpec => ({
  id: 'qty',
  index,
  source: 'qty',
  format: { kind: 'number' }
});

const info = (spec: TokenSpec): ContentControlInfo => ({
  title: spec.id,
  tag: encodeTag(spec),
  value: '',
  canEdit: false,
  canDelete: true
});

const fakeEditor = (specs: TokenSpec[]) => {
  let controls = specs.map(info);
  // Default: undo is a no-op, leaving whatever damage was done in place.
  let onUndo = (): void => {};

  const editor: EditorLike = {
    exportContentControlData: () => controls.map((c) => ({ ...c })),
    getBookmarks: () => [],
    selection: { selectBookmark: () => {} },
    editor: { insertText: () => {} },
    editorHistory: {
      beginUndoAction: () => {},
      endUndoAction: () => {}
    }
  };
  // The watchdog reaches for `editorHistory.undo`, which is outside EditorLike's
  // typed slice — the same private surface the real editor exposes.
  (editor.editorHistory as any).undo = () => onUndo();

  return {
    editor,
    /** Damage the structure the way an errant keystroke does: a token vanishes. */
    dropLastToken: (): void => {
      controls = controls.slice(0, -1);
    },
    /** Arm undo to put the structure back — a repairable edit. */
    undoRestoresTo: (specsBack: TokenSpec[]): void => {
      onUndo = () => {
        controls = specsBack.map(info);
      };
    }
  };
};

describe('structureWatchdog', () => {
  const report = () => ({ repaired: jest.fn(), violated: jest.fn() });

  it('reports a repair when the undo restores the structure', () => {
    const r = report();
    const { editor, dropLastToken, undoRestoresTo } = fakeEditor([
      qty(0),
      qty(1)
    ]);
    const watchdog = structureWatchdog(editor, r);
    watchdog.baseline();

    undoRestoresTo([qty(0), qty(1)]); // the reader's edit is undoable
    dropLastToken(); // qty__1 gone
    watchdog.check();

    expect(r.repaired).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining('qty__1 vanished')])
    );
    expect(r.violated).not.toHaveBeenCalled();
  });

  it('reports a violation when the undo does NOT restore the structure', () => {
    const r = report();
    const { editor, dropLastToken } = fakeEditor([qty(0), qty(1)]);
    const watchdog = structureWatchdog(editor, r);
    watchdog.baseline();

    dropLastToken(); // qty__1 gone, and undo is a no-op
    watchdog.check();

    expect(r.violated).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.stringContaining('qty__1 vanished'),
        'and the undo did not restore it'
      ])
    );
    expect(r.repaired).not.toHaveBeenCalled();
  });

  it('leaves an intact structure alone', () => {
    const r = report();
    const { editor } = fakeEditor([qty(0), qty(1)]);
    const watchdog = structureWatchdog(editor, r);
    watchdog.baseline();

    watchdog.check(); // nothing changed

    expect(r.repaired).not.toHaveBeenCalled();
    expect(r.violated).not.toHaveBeenCalled();
  });
});
