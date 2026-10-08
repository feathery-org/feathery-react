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
import { ProofOutcome, RollbackOutcome, prove, rollback } from './proof';
import type { NormalForm } from './tree';

export interface ReconcileInput {
  pack: Pack;
  host: EditorHost;
  history: EngineHistory;
  turnId: string;
  intent: string;
  before: { view: DocumentView; residue: Residue; native: string };
  intended: { view: DocumentView; residue: Residue };
}

export type ReconcileOutcome =
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
  let plan: CommitPlan | null = null;
  const seams: string[] = [];
  try {
    plan = pack.reconcile.plan({
      before: before.view,
      intended: intended.view,
      beforeResidue: before.residue,
      intendedResidue: intended.residue,
      beforeNative: before.native
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
        intent: input.intent
      });
    }
  } catch (e) {
    return {
      outcome: 'apply-failed',
      plan,
      seams,
      error: e instanceof Error ? e.message : String(e),
      rollback: rollback(host, before.native)
    };
  }
  const native = host.serialize();
  const fresh = pack.adapter.toNormalForm(native);
  const proof = prove(pack, {
    before: before.view.nf,
    intended: intended.view.nf,
    live: fresh.nf
  });
  if (!proof.passed)
    return {
      outcome: 'proof-failed',
      plan,
      seams,
      proof,
      rollback: rollback(host, before.native)
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
    live: { native, nf: fresh.nf, residue: fresh.residue },
    warnings: plan.warnings ?? []
  };
}
