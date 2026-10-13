/**
 * The form's document accessor over mounted sessions: the descriptor names one editor chosen by
 * slot, dispatch routes by editor id, and finishTurn ends the editing turn the first write started.
 */
import { descriptorSchema } from './envelope';
import {
  journalFor,
  lazySession,
  liveDocumentAccessor,
  mountDocument,
  mountedDocuments
} from './mounts';
import { DocumentSession } from './session';
import {
  TOY_FORMAT,
  ToyHost,
  makeToyPack,
  para,
  toyNative
} from './tests/toyPack';

const doc = toyNative(para('Motor'), para('Property'));

function session(editorId: string, turns: Array<string | null> = []) {
  return new DocumentSession({
    pack: makeToyPack(),
    host: new ToyHost(doc),
    target: { type: 'envelope', id: `env-${editorId}` },
    editorId,
    onTurnChange: (t) => turns.push(t)
  });
}
const payload = (s: DocumentSession, input: unknown, turnId = 't1') => ({
  turnId,
  editorId: s.editorId,
  target: s.target,
  input
});

describe('mounted documents and the form accessor', () => {
  it('has no descriptor until a document mounts, and none after it unmounts', () => {
    const doc1 = liveDocumentAccessor('form-a');
    expect(doc1.descriptor()).toBeNull();
    expect(doc1.documentType()).toBeNull();
    const unmount = mountDocument('form-a', 'c1', session('ed-a'));
    const d = doc1.descriptor();
    expect(descriptorSchema.safeParse(d).success).toBe(true);
    expect(d).toEqual(
      expect.objectContaining({
        editorId: 'ed-a',
        format: TOY_FORMAT,
        protocolVersion: 2,
        readOnly: false,
        target: { type: 'envelope', id: 'env-ed-a' }
      })
    );
    unmount();
    expect(doc1.descriptor()).toBeNull();
  });

  it('names the editor in the first slot whatever the mount order, and keeps forms apart', () => {
    const off = [
      mountDocument('form-b', 'zeta', session('ed-z')),
      mountDocument('form-b', 'alpha', session('ed-a')),
      mountDocument('form-c', 'beta', session('ed-c'))
    ];
    expect(liveDocumentAccessor('form-b').descriptor()?.editorId).toBe('ed-a');
    expect(liveDocumentAccessor('form-c').descriptor()?.editorId).toBe('ed-c');
    expect(mountedDocuments('form-b').map((s) => s.editorId)).toEqual([
      'ed-a',
      'ed-z'
    ]);
    off.forEach((f) => f());
  });

  it('an unmount removes only its own registration (a remount in the same slot survives it)', () => {
    const first = mountDocument('form-d', 'c1', session('ed-1'));
    const second = mountDocument('form-d', 'c1', session('ed-2'));
    first();
    expect(liveDocumentAccessor('form-d').descriptor()?.editorId).toBe('ed-2');
    second();
    expect(mountedDocuments('form-d')).toEqual([]);
  });

  it('each action reaches the editor the payload names; others fail with a typed code', () => {
    const a = session('ed-a');
    const z = session('ed-z');
    const off = [
      mountDocument('form-e', 'a', a),
      mountDocument('form-e', 'z', z)
    ];
    const accessor = liveDocumentAccessor('form-e');
    const out = accessor.outline(payload(z, {}));
    expect(out).toEqual({
      status: 'ok',
      result: expect.objectContaining({
        ok: true,
        editorId: 'ed-z',
        target: z.target,
        outlineHash: expect.any(String),
        lines: expect.any(String)
      })
    });
    expect(accessor.find(payload(a, { text: 'motor' }))).toEqual({
      status: 'ok',
      result: expect.objectContaining({ ok: true, total: 1 })
    });
    expect(
      accessor.read({ ...payload(a, { ids: ['n1'] }), editorId: 'ed-gone' })
    ).toEqual({
      status: 'error',
      error: 'wrong-editor',
      result: { message: expect.any(String) }
    });
    expect(accessor.outline('not a payload')).toEqual(
      expect.objectContaining({ status: 'error', error: 'handler-exception' })
    );
    off.forEach((f) => f());
    expect(liveDocumentAccessor('form-e').write(payload(a, {}))).toEqual({
      status: 'error',
      error: 'not-mounted',
      result: { message: 'No document editor is mounted in this form.' }
    });
  });

  it('a write starts the editing turn, reads do not, and finishTurn ends it on every mounted document', () => {
    const turns: Array<string | null> = [];
    const s = session('ed-t', turns);
    const off = mountDocument('form-f', 'c1', s);
    const accessor = liveDocumentAccessor('form-f');
    accessor.outline(payload(s, {}));
    expect(s.activeTurn).toBeNull();
    const read = accessor.read(payload(s, { ids: ['n1'] }));
    if (read.status !== 'ok') throw new Error('read failed');
    const node = (
      read.result as unknown as {
        nodes: Array<{ base: string; style?: string }>;
      }
    ).nodes[0];
    const write = accessor.write(
      payload(s, {
        intent: 'Rename.',
        scope: { ids: ['n1'] },
        changes: [
          {
            kind: 'replace',
            id: 'n1',
            base: node.base,
            node: { text: 'Motor fleet', style: node.style }
          }
        ]
      })
    );
    expect(write.status === 'ok' && write.result.ok).toBe(true);
    expect(s.activeTurn).toBe('t1');
    accessor.finishTurn();
    expect(s.activeTurn).toBeNull();
    accessor.finishTurn();
    expect(turns).toEqual(['t1', null]);
    off();
  });

  it('a throwing turn listener does not change the verb', () => {
    const s = new DocumentSession({
      pack: makeToyPack(),
      host: new ToyHost(doc),
      target: { type: 'envelope', id: 'env' },
      editorId: 'ed-x',
      onTurnChange: () => {
        throw new Error('listener');
      }
    });
    const out = s.dispatch(
      'write',
      payload(s, {
        intent: 'Nothing.',
        scope: { ids: [] },
        changes: []
      })
    );
    expect(out.status).toBe('ok');
    expect(s.activeTurn).toBe('t1');
  });
});

describe('a session created on first use (review: no session where Robin never runs)', () => {
  function lazy(editorId: string) {
    const created: string[] = [];
    let made: DocumentSession | null = null;
    const mounted = lazySession(editorId, (id) => {
      created.push(id);
      made = session(id);
      return made;
    });
    return { mounted, created, made: () => made };
  }

  it('mounting creates nothing; finishing a turn before any use creates nothing', () => {
    const a = lazy('ed-lazy-a');
    const off = mountDocument('form-lazy-1', 'c1', a.mounted);
    liveDocumentAccessor('form-lazy-1').finishTurn();
    expect(a.created).toEqual([]);
    off();
  });

  it('the first descriptor read creates the described session only', () => {
    const a = lazy('ed-lazy-b');
    const z = lazy('ed-lazy-z');
    const offs = [
      mountDocument('form-lazy-2', 'a', a.mounted),
      mountDocument('form-lazy-2', 'z', z.mounted)
    ];
    const d = liveDocumentAccessor('form-lazy-2').descriptor();
    expect(d?.editorId).toBe('ed-lazy-b');
    expect(a.created).toEqual(['ed-lazy-b']);
    expect(z.created).toEqual([]);
    offs.forEach((off) => off());
  });

  it('a dispatch creates the session it names, once, and reaches it', () => {
    const a = lazy('ed-lazy-c');
    const off = mountDocument('form-lazy-3', 'c1', a.mounted);
    const accessor = liveDocumentAccessor('form-lazy-3');
    const call = () =>
      accessor.outline({
        turnId: 't1',
        editorId: 'ed-lazy-c',
        target: { type: 'envelope', id: 'env-ed-lazy-c' },
        input: {}
      });
    expect(call().status).toBe('ok');
    expect(call().status).toBe('ok');
    expect(a.created).toEqual(['ed-lazy-c']);
    off();
  });

  it('a session that cannot be created is a document not mounted, never a thrown error', () => {
    const off = mountDocument(
      'form-lazy-4',
      'c1',
      lazySession('ed-lazy-d', () => {
        throw new Error('no editor');
      })
    );
    const accessor = liveDocumentAccessor('form-lazy-4');
    expect(accessor.descriptor()).toBeNull();
    off();
  });
});

describe('the form session journal (protocol 2, contract 10.3)', () => {
  it('a resent write finds its record after the editor remounted, and a new editor shares the journal', () => {
    const journal = journalFor('form-journal');
    const make = (editorId: string) =>
      new DocumentSession({
        pack: makeToyPack(),
        host: new ToyHost(doc),
        target: { type: 'envelope', id: 'env-j' },
        editorId,
        journal
      });
    const first = make('ed-before');
    const off = mountDocument('form-journal', 'c1', first);
    const accessor = liveDocumentAccessor('form-journal');
    const read = accessor.read(payload(first, { ids: ['n1'] }, 'turn-j'));
    if (read.status !== 'ok') throw new Error('read failed');
    const n1 = (
      read.result as unknown as {
        nodes: Array<{ base: string; style?: string }>;
      }
    ).nodes[0];
    const request = payload(
      first,
      {
        intent: 'Rename.',
        scope: { ids: ['n1'] },
        changes: [
          {
            kind: 'replace',
            id: 'n1',
            base: n1.base,
            node: { text: 'Motor fleet', style: n1.style }
          }
        ]
      },
      'turn-j'
    );
    const committed = accessor.write(request);
    expect(committed).toEqual(
      expect.objectContaining({
        status: 'ok',
        result: expect.objectContaining({ committed: true, cardId: 'turn-j' })
      })
    );
    off();
    // the editor remounts: a new editor id over the same document
    const second = make('ed-after');
    const offAgain = mountDocument('form-journal', 'c1', second);
    expect(accessor.write(request)).toEqual(committed);
    // the resend executed nothing on the new editor
    expect(second.host.serialize()).toBe(doc);
    offAgain();
    // and with no editor mounted at all, the record still answers
    expect(accessor.write(request)).toEqual(committed);
  });
});

describe('a malformed payload is a handler exception before anything else (review 8)', () => {
  it('with no editor mounted, with an editor mounted, and for a write the journal could answer', () => {
    const malformed = [
      'not a payload',
      {
        turnId: 42,
        editorId: 'ed',
        target: { type: 'envelope', id: 'e' },
        input: {}
      },
      {
        turnId: 't',
        editorId: 'ed',
        target: { type: 'envelope', id: 'e' },
        input: {},
        verb: 'write'
      }
    ];
    const unmounted = liveDocumentAccessor('form-malformed-none');
    for (const payload of malformed)
      for (const action of [unmounted.outline, unmounted.write])
        expect(action(payload)).toEqual(
          expect.objectContaining({
            status: 'error',
            error: 'handler-exception'
          })
        );
    const off = mountDocument(
      'form-malformed-one',
      'c1',
      session('ed-malformed')
    );
    const mounted = liveDocumentAccessor('form-malformed-one');
    for (const payload of malformed)
      expect(mounted.read(payload)).toEqual(
        expect.objectContaining({ status: 'error', error: 'handler-exception' })
      );
    off();
  });
});
