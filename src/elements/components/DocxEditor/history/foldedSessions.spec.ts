import {
  diffFoldedSessions,
  FoldedSession,
  sessionAuthorKey,
  sessionStart
} from './foldedSessions';
import { applyHunks, diffSession, trackedAuthorKeys } from './sfdtDiff';
import { DocxVersion } from './types';

const doc = (text: string) => ({
  sections: [{ blocks: [{ inlines: [{ text }] }] }]
});

// A stored session: its final document and the change list a close would save.
const session = (from: string, to: string, author: string): FoldedSession => ({
  finalSfdt: JSON.stringify(doc(to)),
  changes: diffSession(doc(from), [{ sfdt: doc(to), author: 'you' }], author),
  author
});

describe('sessionAuthorKey', () => {
  const version = (over: Partial<DocxVersion>) => over as DocxVersion;

  it('names a person by their saved actor', () => {
    expect(
      sessionAuthorKey(
        version({
          authors: [{ kind: 'user', label: 'You' }],
          actor_label: 'bob@x.io',
          actor_name: 'Bob'
        })
      )
    ).toBe('bob@x.io');
  });

  it('keeps Robin-only sessions as Robin', () => {
    expect(
      sessionAuthorKey(
        version({
          authors: [{ kind: 'assistant', label: 'Robin' }],
          actor_label: 'alice@x.io'
        })
      )
    ).toBe('robin');
  });

  it('falls back to the browser-local key without a saved actor', () => {
    expect(
      sessionAuthorKey(
        version({ authors: [{ kind: 'user', label: 'You' }], actor_label: '' })
      )
    ).toBe('you');
  });
});

describe('sessionStart', () => {
  it('rebuilds the document before the session', () => {
    const stored = session('Hello', 'Hello world', 'alice');
    const start = must(sessionStart(stored));
    expect(start.sections[0].blocks[0].inlines.map((i: any) => i.text)).toEqual(
      ['Hello']
    );
    // Diffing from the rebuilt start reproduces the session's own edits.
    const again = diffSession(
      start,
      [{ sfdt: doc('Hello world'), author: 'you' }],
      'x'
    );
    expect(again.changeCount).toBe(must(stored.changes).changeCount);
  });

  it('is null without a change list', () => {
    expect(
      sessionStart({
        finalSfdt: JSON.stringify(doc('x')),
        changes: null,
        author: 'a'
      })
    ).toBeNull();
  });
});

describe('diffFoldedSessions', () => {
  it('attributes each session to its own author', () => {
    const sessions = [
      session('Hello', 'Hello Alice', 'alice@x.io'),
      session('Hello Alice', 'Hello Alice and Bob', 'bob@x.io')
    ];
    const changes = must(diffFoldedSessions(doc('Hello'), sessions));
    const display = applyHunks(doc('Hello Alice and Bob'), changes);
    expect(trackedAuthorKeys(display).sort()).toEqual([
      'alice@x.io',
      'bob@x.io'
    ]);
  });

  it('gives up instead of blocking when the time budget runs out', () => {
    const sessions = [session('Hello', 'Hello again', 'alice@x.io')];
    expect(diffFoldedSessions(doc('Hello'), sessions, -1)).toBeNull();
  });
});

function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Expected a value');
  return value;
}
