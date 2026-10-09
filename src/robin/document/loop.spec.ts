import {
  CONFLICT_CAP,
  WriteJournal,
  classifyResult,
  turnPolicy,
  writeSignature
} from './loop';
import {
  VerbResult,
  WriteInput,
  readOnlyResult,
  refusedResult,
  makeRefusal
} from './envelope';

const write = (text: string, intent = 'x'): WriteInput => ({
  intent,
  scope: { ids: ['n1'] },
  changes: [{ kind: 'replace', id: 'n1', base: 'b', node: { text } }]
});
const committed = { ok: true, committed: true } as unknown as VerbResult;
const dryRun = { ok: true, committed: false } as unknown as VerbResult;
const conflict = {
  ok: false,
  error: { code: 'document.conflict', message: '' },
  retry: 'modified_input'
} as unknown as VerbResult;
const uncertain = {
  ok: false,
  error: { code: 'document.uncertain', message: '' },
  retry: 'do_not_retry',
  recovery: ''
} as unknown as VerbResult;
const refused = (retry: 'modified_input' | 'do_not_retry' = 'modified_input') =>
  refusedResult(
    makeRefusal([
      { invariant: 'scope', destroyed: 'x', detail: [], retry, read: [] }
    ])
  );

describe('write journal', () => {
  it('replays the recorded response to an identical resend and refuses a different second write', () => {
    const journal = new WriteJournal<string>();
    expect(journal.check('t1', write('a'))).toBeNull();
    journal.record('t1', write('a'), 'response-1');
    expect(journal.check('t1', write('a', 'reworded intent'))).toEqual({
      replay: 'response-1'
    });
    expect(journal.check('t1', write('b'))).toEqual({ secondWrite: true });
    expect(journal.check('t2', write('b'))).toBeNull();
  });

  it('forgets the oldest turns beyond its limit', () => {
    const journal = new WriteJournal<number>();
    for (let i = 0; i < 51; i += 1) journal.record(`t${i}`, write('a'), i);
    expect(journal.check('t0', write('a'))).toBeNull();
    expect(journal.check('t50', write('a'))).toEqual({ replay: 50 });
  });

  it('signs content, not wording', () => {
    expect(writeSignature(write('a', 'one'))).toBe(
      writeSignature(write('a', 'two'))
    );
    expect(writeSignature(write('a'))).not.toBe(writeSignature(write('b')));
  });
});

describe('turn policy (the server mirrors it)', () => {
  it('classifies results', () => {
    expect(
      [committed, dryRun, refused(), conflict, uncertain, readOnlyResult()].map(
        classifyResult
      )
    ).toEqual([
      'committed',
      'dry-run',
      'refused',
      'conflict',
      'uncertain',
      'terminal'
    ]);
    expect(
      classifyResult({ ok: true, outlineHash: 'h', depth: 2, lines: '' })
    ).toBe('read');
  });

  it('stops after a committed write, an uncertain or terminal result', () => {
    expect(turnPolicy([{ result: committed }])).toEqual({
      next: 'stop',
      reason: 'committed'
    });
    expect(turnPolicy([{ result: uncertain }])).toEqual({
      next: 'stop',
      reason: 'uncertain'
    });
    expect(turnPolicy([{ result: readOnlyResult() }])).toEqual({
      next: 'stop',
      reason: 'terminal'
    });
    expect(turnPolicy([{ result: dryRun }])).toEqual({ next: 'continue' });
  });

  it(`stops at ${CONFLICT_CAP} conflicts and not before`, () => {
    const steps = [{ result: conflict }, { result: conflict }];
    expect(turnPolicy(steps)).toEqual({ next: 'continue' });
    expect(turnPolicy([...steps, { result: conflict }])).toEqual({
      next: 'stop',
      reason: 'conflict-cap'
    });
  });

  it('stops when a refused write comes back unchanged, or a refusal says not to retry', () => {
    expect(
      turnPolicy([
        { signature: 'a', result: refused() },
        { signature: 'b', result: refused() }
      ])
    ).toEqual({ next: 'continue' });
    expect(
      turnPolicy([
        { signature: 'a', result: refused() },
        { signature: 'a', result: refused() }
      ])
    ).toEqual({ next: 'stop', reason: 'no-progress' });
    expect(
      turnPolicy([{ signature: 'a', result: refused('do_not_retry') }])
    ).toEqual({ next: 'stop', reason: 'no-progress' });
  });
});
