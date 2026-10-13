/**
 * One message, one transaction (architecture 5.4, decision D5).
 *
 * The engine enforces exactly one rule itself: one committed write per message, keyed by the
 * bridge `turnId`. The journal returns the recorded response, without re-executing, to a resent
 * identical write, and refuses a different second write with `one-write-per-message`.
 *
 * When to stop retrying refusals and conflicts is the server's loop (contract 7.1, 7.2), not the
 * engine's.
 */
import { WriteInput } from './envelope';
import { canonicalJson, hash64 } from './tree';

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
