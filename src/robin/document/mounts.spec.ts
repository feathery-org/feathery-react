/**
 * The form's document accessor over mounted sessions: the descriptor names one editor chosen by
 * slot, dispatch routes by editor id, and finishTurn ends the editing turn the first write started.
 */
import { descriptorSchema } from './envelope';
import {
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
const payload = (
  s: DocumentSession,
  verb: string,
  input: unknown,
  turnId = 't1'
) => ({
  protocolVersion: 1,
  turnId,
  editorId: s.editorId,
  target: s.target,
  verb,
  input
});

describe('mounted documents and the form accessor', () => {
  it('has no descriptor until a document mounts, and none after it unmounts', () => {
    const doc1 = liveDocumentAccessor('form-a');
    expect(doc1.descriptor()).toBeNull();
    const unmount = mountDocument('form-a', 'c1', session('ed-a'));
    const d = doc1.descriptor();
    expect(descriptorSchema.safeParse(d).success).toBe(true);
    expect(d).toEqual(
      expect.objectContaining({
        editorId: 'ed-a',
        format: TOY_FORMAT,
        protocolVersion: 1,
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

  it('dispatch reaches the editor the payload names; others fail as wrong-editor or payload-invalid', () => {
    const a = session('ed-a');
    const z = session('ed-z');
    const off = [
      mountDocument('form-e', 'a', a),
      mountDocument('form-e', 'z', z)
    ];
    const accessor = liveDocumentAccessor('form-e');
    const out = accessor.dispatch(payload(z, 'outline', {}));
    expect(out.status).toBe('ok');
    if (out.status === 'ok') expect(out.response.editorId).toBe('ed-z');
    expect(
      accessor.dispatch({ ...payload(a, 'outline', {}), editorId: 'ed-gone' })
    ).toEqual({
      status: 'error',
      failure: expect.objectContaining({ reason: 'wrong-editor' })
    });
    expect(accessor.dispatch('not a payload')).toEqual({
      status: 'error',
      failure: expect.objectContaining({ reason: 'payload-invalid' })
    });
    off.forEach((f) => f());
    expect(
      liveDocumentAccessor('form-e').dispatch(payload(a, 'outline', {}))
    ).toEqual({
      status: 'error',
      failure: {
        reason: 'wrong-editor',
        message: 'No document editor is mounted in this form.'
      }
    });
  });

  it('a write starts the editing turn, reads do not, and finishTurn ends it on every mounted document', () => {
    const turns: Array<string | null> = [];
    const s = session('ed-t', turns);
    const off = mountDocument('form-f', 'c1', s);
    const accessor = liveDocumentAccessor('form-f');
    accessor.dispatch(payload(s, 'outline', {}));
    expect(s.activeTurn).toBeNull();
    const read = accessor.dispatch(payload(s, 'read', { ids: ['n1'] }));
    if (read.status !== 'ok') throw new Error('read failed');
    const node = (
      read.response.result as unknown as {
        nodes: Array<{ base: string; style?: string }>;
      }
    ).nodes[0];
    const write = accessor.dispatch(
      payload(s, 'write', {
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
    expect(write.status === 'ok' && write.response.result.ok).toBe(true);
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
      payload(s, 'write', {
        intent: 'Nothing.',
        scope: { ids: [] },
        changes: []
      })
    );
    expect(out.status).toBe('ok');
    expect(s.activeTurn).toBe('t1');
  });
});
