/**
 * The per-write trace (contract section 8): what was requested (counts only, never the payload),
 * what the verifier checked, what was committed through which seams, and what the proof found.
 * Every `write` result carries one, success or refusal.
 */
import { PROTOCOL_VERSION, Trace, WriteInput } from './envelope';
import type { CheckRecord } from './verifier';

export type Clock = () => number;

export const defaultClock: Clock = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const round = (ms: number) => Math.max(0, Math.round(ms * 10) / 10);

export class TraceBuilder {
  private readonly start: number;

  private mark: number;

  private trace: Trace;

  constructor(
    format: string,
    turnId: string,
    private readonly clock: Clock = defaultClock
  ) {
    this.start = clock();
    this.mark = this.start;
    this.trace = {
      protocolVersion: PROTOCOL_VERSION,
      format,
      turnId,
      requested: {
        changes: 0,
        kinds: {},
        scopeIds: 0,
        bulk: 0,
        formats: 0,
        dryRun: false
      },
      verified: { outcome: 'refused', checks: [], ms: 0 },
      committed: { outcome: 'skipped', seams: [], touched: 0, ms: 0 },
      proof: {
        outcome: 'skipped',
        landed: false,
        reversible: false,
        normalizations: [],
        rollback: null,
        ms: 0
      },
      timing: { totalMs: 0 }
    };
  }

  private lap(): number {
    const now = this.clock();
    const ms = round(now - this.mark);
    this.mark = now;
    return ms;
  }

  /** Counts of what the write asked for; an input that failed the envelope counts as nothing. */
  requested(write: WriteInput | null): this {
    if (!write) return this;
    const kinds: Record<string, number> = {};
    for (const change of write.changes)
      kinds[change.kind] = (kinds[change.kind] ?? 0) + 1;
    this.trace.requested = {
      changes: write.changes.length,
      kinds,
      scopeIds: write.scope.ids.length,
      bulk: write.scope.bulk?.length ?? 0,
      formats: write.scope.formats?.length ?? 0,
      dryRun: write.dryRun === true
    };
    return this;
  }

  verified(outcome: Trace['verified']['outcome'], checks: CheckRecord[]): this {
    this.trace.verified = {
      outcome,
      checks: checks.map((c) => ({ ...c })),
      ms: this.lap()
    };
    return this;
  }

  committed(
    outcome: Trace['committed']['outcome'],
    seams: string[],
    touched: number
  ): this {
    this.trace.committed = {
      outcome,
      seams: [...seams],
      touched,
      ms: this.lap()
    };
    return this;
  }

  proof(proof: {
    outcome: Trace['proof']['outcome'];
    landed: boolean;
    reversible: boolean;
    normalizations: string[];
    rollback: { byteEqual: boolean; equivalent?: boolean } | null;
  }): this {
    this.trace.proof = {
      ...proof,
      normalizations: [...proof.normalizations],
      ms: this.lap()
    };
    return this;
  }

  build(): Trace {
    return {
      ...this.trace,
      timing: { totalMs: round(this.clock() - this.start) }
    };
  }
}
