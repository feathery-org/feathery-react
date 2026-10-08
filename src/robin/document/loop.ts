/**
 * One message, one transaction (architecture 5.4, decision D5).
 *
 * The engine enforces exactly one rule itself: one committed write per message, keyed by the
 * bridge `turnId`. The journal returns the recorded response, without re-executing, to a resent
 * identical write, and refuses a different second write with `one-write-per-message`.
 *
 * The retry policy around refusals and conflicts is the server's loop (contract 7.1, 7.2), not the
 * engine's; `turnPolicy` states it here once, as a pure function over a turn's results, so the
 * engine's tests and any in-browser driver run the same rules the server mirrors: stop after a
 * committed write, stop after three conflicts, stop when a refused write is sent again unchanged,
 * stop on an uncertain or terminal result.
 */
import { ERROR_CODES, VerbResult, WriteInput } from './envelope';
import { canonicalJson, hash64, isPlainObject } from './tree';

/** Conflict rounds per message before the server tells the user plainly (D5). */
export const CONFLICT_CAP = 3;
/** Turns the journal remembers; a message's writes all land within one turn. */
export const JOURNAL_TURNS = 50;

/** The identity of a write's content: what it changes, not how it is worded. */
export function writeSignature(write: WriteInput): string {
  return hash64(
    canonicalJson({ changes: write.changes, formats: write.formats ?? {} })
  );
}

export class WriteJournal<R = unknown> {
  private readonly entries = new Map<
    string,
    { signature: string; response: R }
  >();

  /** Null when the turn has no committed write yet. */
  check(
    turnId: string,
    write: WriteInput
  ): { replay: R } | { secondWrite: true } | null {
    const entry = this.entries.get(turnId);
    if (!entry) return null;
    return entry.signature === writeSignature(write)
      ? { replay: entry.response }
      : { secondWrite: true };
  }

  record(turnId: string, write: WriteInput, response: R): void {
    this.entries.delete(turnId);
    this.entries.set(turnId, { signature: writeSignature(write), response });
    while (this.entries.size > JOURNAL_TURNS) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }
}

export type ResultClass =
  | 'committed'
  | 'dry-run'
  | 'read'
  | 'refused'
  | 'conflict'
  | 'uncertain'
  | 'terminal';

export function classifyResult(result: VerbResult): ResultClass {
  if (result.ok) {
    if (!('committed' in result)) return 'read';
    return result.committed ? 'committed' : 'dry-run';
  }
  switch ((result as { error?: { code?: string } }).error?.code) {
    case ERROR_CODES.refused:
      return 'refused';
    case ERROR_CODES.conflict:
      return 'conflict';
    case ERROR_CODES.uncertain:
      return 'uncertain';
    default:
      return 'terminal';
  }
}

export interface TurnStep {
  /** The write's signature, for writes; absent for the read verbs. */
  signature?: string;
  result: VerbResult;
}

export type TurnDecision =
  | { next: 'continue' }
  | {
      next: 'stop';
      reason:
        | 'committed'
        | 'conflict-cap'
        | 'no-progress'
        | 'uncertain'
        | 'terminal';
    };

export function turnPolicy(steps: TurnStep[]): TurnDecision {
  let conflicts = 0;
  const refused = new Set<string>();
  for (const step of steps) {
    const kind = classifyResult(step.result);
    if (kind === 'committed') return { next: 'stop', reason: 'committed' };
    if (kind === 'uncertain') return { next: 'stop', reason: 'uncertain' };
    if (kind === 'terminal') return { next: 'stop', reason: 'terminal' };
    if (kind === 'conflict') {
      conflicts += 1;
      if (conflicts >= CONFLICT_CAP)
        return { next: 'stop', reason: 'conflict-cap' };
    }
    if (kind === 'refused' && step.signature !== undefined) {
      const retry = isPlainObject(step.result)
        ? (step.result as { retry?: string }).retry
        : undefined;
      if (refused.has(step.signature) || retry === 'do_not_retry')
        return { next: 'stop', reason: 'no-progress' };
      refused.add(step.signature);
    }
  }
  return { next: 'continue' };
}
