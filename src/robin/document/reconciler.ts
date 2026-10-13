/**
 * The reconciler (architecture 4.3, 4.3a): writes a verified change set into the live editor.
 *
 * The pack plans the commit by delta class (native tracked commands for text-shaped deltas, the
 * native format API for formatting, a document replacement for structure) and the core runs the
 * plan through the pack's seams, then proves it. One write is one transaction:
 *
 *   - a seam that throws, or a proof that fails, rolls the editor back to the pre-write bytes;
 *   - a plan that replaces the document clears the editor's history, so the engine keeps the way
 *     back as one history entry (decision D4), pushed only once the proof passed;
 *   - a plan that lands natively is the editor's own undoable group.
 */
import type { Warning } from './envelope';
import type { EngineHistory } from './history';
import type {
  CommitPlan,
  DocumentView,
  EditorHost,
  Pack,
  Residue
} from './pack';
import {
  ProofOutcome,
  RollbackOutcome,
  comparableText,
  equivalentNative,
  prove,
  rollback
} from './proof';
import { canonicalJson, NormalForm } from './tree';

export interface ReconcileInput {
  pack: Pack;
  host: EditorHost;
  history: EngineHistory;
  turnId: string;
  intent: string;
  /** The card title the engine composed for this change set. */
  title?: string;
  /** The nodes a finalizer changed (see PlanContext.derived). */
  derived?: readonly string[];
  before: { view: DocumentView; residue: Residue; native: string };
  intended: { view: DocumentView; residue: Residue };
  /**
   * Give the adapter's fresh read-back engine ids, continuing the intended document's: the proof
   * compares node by node, residue included.
   */
  adopt(fresh: { nf: NormalForm; residue: Residue }): {
    nf: NormalForm;
    residue: Residue;
  };
}

export type ReconcileOutcome =
  /** The intended document reads as the live one: nothing to apply, no seam runs. */
  | { outcome: 'unchanged' }
  | {
      outcome: 'committed';
      plan: CommitPlan;
      seams: string[];
      proof: ProofOutcome;
      live: { native: string; nf: NormalForm; residue: Residue };
      warnings: Warning[];
    }
  | {
      outcome: 'apply-failed';
      plan: CommitPlan | null;
      seams: string[];
      error: string;
      rollback: RollbackOutcome;
    }
  | {
      outcome: 'proof-failed';
      plan: CommitPlan;
      seams: string[];
      proof: ProofOutcome;
      rollback: RollbackOutcome;
    };

export function reconcile(input: ReconcileInput): ReconcileOutcome {
  const { pack, host, history, before, intended } = input;
  /** Undo only the groups this commit added; a document replacement is undone by its snapshot. */
  const restore = (
    planned: CommitPlan | null,
    seamsRun: number
  ): RollbackOutcome => {
    try {
      return rollback(host, before.native, {
        undoLimit: planned?.history === 'editor' ? seamsRun : 0,
        equivalent: (now) => equivalentNative(pack, now, before.native),
        layoutOnly: (now) =>
          pack.adapter.layoutOnly?.(now, before.native) ?? false
      });
    } catch {
      // the editor could not even be read: reopen the snapshot, and say the rollback is unproven
      try {
        host.open(before.native);
      } catch {
        // the editor is gone; nothing left to restore
      }
      return {
        byteEqual: false,
        exact: false,
        equivalent: false,
        via: 'snapshot',
        undoSteps: 0
      };
    }
  };
  // a write that changes nothing (a value it already has, a move to where it is) applies nothing:
  // no seam, no card, and the editor's undo history as it was
  if (
    comparableText(pack, intended.view.nf) ===
      comparableText(pack, before.view.nf) &&
    canonicalJson(intended.residue) === canonicalJson(before.residue)
  )
    return { outcome: 'unchanged' };
  let plan: CommitPlan | null = null;
  const seams: string[] = [];
  try {
    plan = pack.reconcile.plan({
      turnId: input.turnId,
      before: before.view,
      intended: intended.view,
      beforeResidue: before.residue,
      intendedResidue: intended.residue,
      beforeNative: before.native,
      ...(input.title
        ? { card: { title: input.title, intent: input.intent } }
        : {}),
      ...(input.derived ? { derived: input.derived } : {})
    });
    for (const step of plan.steps) {
      const seam = pack.seams[step.seam];
      if (!seam)
        throw new Error(
          `the plan names seam ${JSON.stringify(
            step.seam
          )}, which the pack does not have`
        );
      seams.push(step.seam);
      seam.apply(host, step.payload, {
        turnId: input.turnId,
        intent: input.intent,
        ...(input.title ? { title: input.title } : {})
      });
    }
  } catch (e) {
    return {
      outcome: 'apply-failed',
      plan,
      seams,
      error: e instanceof Error ? e.message : String(e),
      rollback: restore(plan, seams.length)
    };
  }
  // Reading the commit back and proving it are inside the same rollback boundary as the seams: once
  // a seam has changed the editor, nothing may leave the edit applied and unproven.
  let native: string;
  let live: { nf: NormalForm; residue: Residue };
  let proof: ReturnType<typeof prove>;
  try {
    native = host.serialize();
    live = input.adopt(pack.adapter.toNormalForm(native));
    proof = prove(pack, {
      before: before.view.nf,
      intended: intended.view.nf,
      live: live.nf,
      turnId: input.turnId,
      intendedResidue: intended.residue,
      liveResidue: live.residue
    });
  } catch (e) {
    return {
      outcome: 'apply-failed',
      plan,
      seams,
      error: `reading the change back failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
      rollback: restore(plan, seams.length)
    };
  }
  // A document replacement keeps the before snapshot in engine history, so its card reverts it
  // exactly; the editor's own one-by-one reject cannot represent every structural change (an
  // inserted cell or section has no revision of its own), and that is a disclosure, not a failure.
  const warnings: Warning[] = [...(plan.warnings ?? [])];
  // only a card has a reject; a change that landed immediately must be reversible as it stands
  if (
    !proof.reversible &&
    plan.history === 'engine' &&
    plan.landed === 'card' &&
    proof.landed &&
    proof.conserved &&
    proof.authorship
  ) {
    proof.reversible = true;
    proof.passed = true;
    warnings.push({
      code: 'reject-by-card',
      message:
        "Some of this change cannot be rejected piece by piece in the editor's review pane; rejecting the card restores the document exactly, and after a reload rejecting the card still carries a moved node's bookmarks back with it."
    });
  }
  if (!proof.passed)
    return {
      outcome: 'proof-failed',
      plan,
      seams,
      proof,
      rollback: restore(plan, seams.length)
    };
  if (plan.history === 'engine')
    history.push({
      turnId: input.turnId,
      kind: 'change-set',
      before: before.native,
      after: native
    });
  return {
    outcome: 'committed',
    plan,
    seams,
    proof,
    live: { native, nf: live.nf, residue: live.residue },
    warnings
  };
}
