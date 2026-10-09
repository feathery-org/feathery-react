import { parseVerbInput, traceSchema, WriteInput } from './envelope';
import { TraceBuilder } from './trace';

const ticking = (steps: number[]) => {
  let i = 0;
  return () => steps[Math.min(i++, steps.length - 1)];
};

const write = parseVerbInput('write', {
  intent: 'Two inserts and a set.',
  scope: { ids: ['n1', 'n2'], bulk: [{ find: { kind: 'para' }, total: 3 }] },
  changes: [
    { kind: 'insert_after', anchor: 'n1', container: 'c', node: { text: 'a' } },
    { kind: 'insert_after', anchor: 'n2', container: 'c', node: { text: 'b' } },
    {
      kind: 'set',
      target: { find: { kind: 'para' }, total: 3 },
      props: { bold: true }
    }
  ],
  dryRun: true
});

describe('trace', () => {
  it('counts the request, records checks, seams and proof with lap timings', () => {
    const t = new TraceBuilder(
      'toy-format',
      'turn-1',
      ticking([0, 11, 223, 230, 241])
    )
      .requested((write as { value: WriteInput }).value)
      .verified('passed', [
        { name: 'envelope', pass: true },
        { name: 'scope', pass: true }
      ])
      .committed('committed', ['splice'], 9)
      .proof({
        outcome: 'passed',
        landed: true,
        reversible: true,
        normalizations: ['T1'],
        rollback: null
      })
      .build();
    expect(t).toEqual({
      protocolVersion: 1,
      format: 'toy-format',
      turnId: 'turn-1',
      requested: {
        changes: 3,
        kinds: { insert_after: 2, set: 1 },
        scopeIds: 2,
        bulk: 1,
        formats: 0,
        dryRun: true
      },
      verified: {
        outcome: 'passed',
        checks: [
          { name: 'envelope', pass: true },
          { name: 'scope', pass: true }
        ],
        ms: 11
      },
      committed: {
        outcome: 'committed',
        seams: ['splice'],
        touched: 9,
        ms: 212
      },
      proof: {
        outcome: 'passed',
        landed: true,
        reversible: true,
        normalizations: ['T1'],
        rollback: null,
        ms: 7
      },
      timing: { totalMs: 241 }
    });
    expect(traceSchema.safeParse(t).success).toBe(true);
  });

  it('defaults to a refused, skipped, unproved trace that still validates', () => {
    const t = new TraceBuilder('toy-format', 'turn-2')
      .requested(null)
      .verified('refused', [{ name: 'envelope', pass: false }])
      .build();
    expect(t.requested.changes).toBe(0);
    expect(t.committed.outcome).toBe('skipped');
    expect(t.proof.outcome).toBe('skipped');
    expect(traceSchema.safeParse(t).success).toBe(true);
  });
});
