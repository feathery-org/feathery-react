import { WriteJournal, writeSignature } from './loop';
import { WriteInput } from './envelope';

const write = (text: string, intent = 'x'): WriteInput => ({
  intent,
  scope: { ids: ['n1'] },
  changes: [{ kind: 'replace', id: 'n1', base: 'b', node: { text } }]
});
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
