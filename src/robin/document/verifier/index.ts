/**
 * The check runner. Every check has a name (a core invariant or a pack invariant) and yields the
 * problems it found; the runner records each as passed or failed, in order, for the trace
 * (contract section 8, `verified.checks`) and collects the problems into one refusal.
 */
import type { RefusalProblem } from '../envelope';
import type { InvariantContext, Pack } from '../pack';

export interface CheckRecord {
  name: string;
  pass: boolean;
}

export class CheckRunner {
  readonly checks: CheckRecord[] = [];

  readonly problems: RefusalProblem[] = [];

  /** Run one check; returns true when it passed. */
  run(name: string, check: () => RefusalProblem[]): boolean {
    const found = check();
    this.checks.push({ name, pass: found.length === 0 });
    this.problems.push(...found);
    return found.length === 0;
  }

  /** Record a check whose outcome was decided elsewhere. */
  record(name: string, pass: boolean): void {
    this.checks.push({ name, pass });
  }

  get failed(): boolean {
    return this.problems.length > 0;
  }
}

/** The pack's invariants, each as its own check, in the pack's order. */
export function runInvariants(
  runner: CheckRunner,
  pack: Pack,
  ctx: InvariantContext
): void {
  for (const invariant of pack.invariants)
    runner.run(invariant.name, () =>
      invariant
        .check(ctx)
        .map((p) => (p.read.length ? p : { ...p, read: [...invariant.cards] }))
    );
}

/** A refusal problem in the core's shape. */
export function problem(
  invariant: string,
  destroyed: string,
  {
    detail = [],
    read = [],
    hint,
    retry = 'modified_input'
  }: Partial<Omit<RefusalProblem, 'invariant' | 'destroyed'>> = {}
): RefusalProblem {
  return {
    invariant,
    destroyed,
    detail,
    retry,
    read,
    ...(hint ? { hint } : {})
  };
}
