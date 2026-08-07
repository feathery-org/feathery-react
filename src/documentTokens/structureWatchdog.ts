/**
 * Reverts any edit that damages the token structure.
 *
 * Checking our own writes was never enough: the damage a reader hits comes
 * from editing AROUND a token — typing at its edge, deleting across it,
 * pasting over it — where Syncfusion will merge two controls, drop a
 * control's markers, or duplicate it. None of that goes through `writeValues`,
 * so nothing was watching.
 *
 * Rather than enumerate the dangerous gestures, this watches the outcome: if
 * the set of controls is not what it was, the edit is undone. That covers keys
 * nobody thought of, and paste, cut and drag alike, and it fails safe — the
 * reader loses one keystroke instead of the document losing a token, which
 * cannot be rebuilt (`insertContentControl` is a no-op).
 *
 * Values are deliberately not defended: changing a token's text is exactly
 * what the reader is here to do, and the blur commit decides what it means.
 */

import { documentShape, EditorLike, shapeViolations } from './controls';

export type StructureWatchdog = {
  /** Compare against the baseline; undo and report when structure changed. */
  check: () => void;
  /** Our own write just happened: the baseline moves with it, not against it. */
  baseline: () => void;
  /** A different document is open: nothing carries over. */
  reset: () => void;
};

export const structureWatchdog = (
  editor: EditorLike,
  report: {
    repaired: (damage: string[]) => void;
    violated: (problems: string[]) => void;
  }
): StructureWatchdog => {
  // The last document state whose token structure was intact, so a damaging
  // edit can be told from an ordinary one and rolled back. Structure only —
  // values move constantly and are none of this concern.
  let lastGood: ReturnType<typeof documentShape> | null = null;
  let repairing = false;

  const check = (): void => {
    if (repairing) return;
    const now = documentShape(editor);
    if (!lastGood) {
      lastGood = now;
      return;
    }

    // Only the address multiset matters: the same tokens, the same number of
    // times each.
    const structureOnly = (shape: typeof now) => ({
      addresses: shape.addresses,
      text: new Map<string, string>()
    });
    const damage = shapeViolations(
      structureOnly(lastGood),
      structureOnly(now),
      new Set()
    );
    if (damage.length === 0) {
      lastGood = now;
      return;
    }

    repairing = true;
    try {
      (editor as any).editorHistory?.undo?.();
      const repaired = documentShape(editor);
      const left = shapeViolations(
        structureOnly(lastGood),
        structureOnly(repaired),
        new Set()
      );
      if (left.length === 0) {
        report.repaired(damage);
      } else {
        // The undo did not put it back. Stop fighting rather than undoing the
        // reader's earlier work too, and accept the document as it now stands.
        lastGood = repaired;
        report.violated([
          ...damage,
          'and the undo did not restore it',
          ...left
        ]);
      }
    } finally {
      repairing = false;
    }
  };

  return {
    check,
    baseline: () => {
      lastGood = documentShape(editor);
    },
    reset: () => {
      lastGood = null;
    }
  };
};
