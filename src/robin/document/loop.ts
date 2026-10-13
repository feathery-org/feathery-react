/**
 * The engine's write journal (contract section 10.3), keyed by the bridge `turnId`.
 *
 * It records committed writes only: never a dry run, a refusal, a conflict, a no-change answer or a
 * read-only answer, because a journaled dry run would otherwise be replayed to the real write that
 * follows it. A resent identical write (same changes and formats) returns the recorded result
 * without executing; a different write in the same turn executes as a new commit, whose card is
 * `<turnId>.2`, `<turnId>.3`. The form holds one journal per form session, so a resent request
 * still finds its record after the editor remounted.
 *
 * When to stop retrying refusals and conflicts is the server's loop (contract 7.1, 7.2), not the
 * engine's.
 */
import { WriteInput } from './envelope';
import { canonicalJson, hash64 } from './tree';

/** Turns the journal remembers. */
export const JOURNAL_TURNS = 50;

/** The identity of a write's content: what it changes, not how it is worded. */
export function writeSignature(write: WriteInput): string {
  return hash64(
    canonicalJson({ changes: write.changes, formats: write.formats ?? {} })
  );
}

export class WriteJournal<R = unknown> {
  private readonly turns = new Map<
    string,
    Array<{ signature: string; response: R }>
  >();

  /** The recorded result of an identical committed write in this turn, if there is one. */
  replay(turnId: string, write: WriteInput): R | undefined {
    const signature = writeSignature(write);
    return this.turns.get(turnId)?.find((e) => e.signature === signature)
      ?.response;
  }

  /** How many writes this turn has committed. */
  committed(turnId: string): number {
    return this.turns.get(turnId)?.length ?? 0;
  }

  /** The change set id the next committed write of this turn takes: the turn, then `.2`, `.3`. */
  nextChangeSet(turnId: string): string {
    const n = this.committed(turnId);
    return n ? `${turnId}.${n + 1}` : turnId;
  }

  /** Record a committed write's result. */
  record(turnId: string, write: WriteInput, response: R): void {
    const entries = this.turns.get(turnId) ?? [];
    this.turns.delete(turnId);
    this.turns.set(turnId, [
      ...entries,
      { signature: writeSignature(write), response }
    ]);
    while (this.turns.size > JOURNAL_TURNS) {
      const oldest = this.turns.keys().next().value as string;
      this.turns.delete(oldest);
    }
  }
}
