import { WriteJournal, journalKey, writeSignature } from './loop';
import { WriteInput } from './envelope';

const write = (text: string, intent = 'x'): WriteInput => ({
  intent,
  scope: { ids: ['n1'] },
  changes: [{ kind: 'replace', id: 'n1', base: 'b', node: { text } }]
});
describe('write journal', () => {
  it('replays an identical resend; a different write in the turn takes the next change set', () => {
    const journal = new WriteJournal<string>();
    expect(journal.replay('t1', write('a'))).toBeUndefined();
    expect(journal.nextChangeSet('t1', 't1')).toBe('t1');
    journal.record('t1', write('a'), 'response-1');
    expect(journal.replay('t1', write('a', 'reworded intent'))).toBe(
      'response-1'
    );
    expect(journal.replay('t1', write('b'))).toBeUndefined();
    expect(journal.nextChangeSet('t1', 't1')).toBe('t1.2');
    journal.record('t1', write('b'), 'response-2');
    expect(journal.replay('t1', write('b'))).toBe('response-2');
    expect(journal.replay('t1', write('a'))).toBe('response-1');
    expect(journal.nextChangeSet('t1', 't1')).toBe('t1.3');
    expect(journal.committed('t2')).toBe(0);
  });

  it('forgets the oldest turns beyond its limit', () => {
    const journal = new WriteJournal<number>();
    for (let i = 0; i < 51; i += 1) journal.record(`t${i}`, write('a'), i);
    expect(journal.replay('t0', write('a'))).toBeUndefined();
    expect(journal.replay('t50', write('a'))).toBe(50);
  });

  it('signs content, not wording', () => {
    expect(writeSignature(write('a', 'one'))).toBe(
      writeSignature(write('a', 'two'))
    );
    expect(writeSignature(write('a'))).not.toBe(writeSignature(write('b')));
  });

  it('keys a write by its turn, editor and target', () => {
    const target = { type: 'envelope', id: 'e' };
    expect(journalKey('t', 'ed-a', target)).not.toBe(
      journalKey('t', 'ed-b', target)
    );
    expect(journalKey('t', 'ed-a', target)).not.toBe(
      journalKey('t', 'ed-a', { type: 'envelope', id: 'f' })
    );
    expect(journalKey('t', 'ed-a', target)).toBe(
      journalKey('t', 'ed-a', { ...target })
    );
  });
});
