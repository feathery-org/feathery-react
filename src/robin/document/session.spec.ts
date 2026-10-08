/**
 * The core's completion gate: a toy document round-trips through all four verbs against the fake
 * pack, through the bridge payload and response of contract section 10, with proof, rollback,
 * conflicts, the one-write rule and undo routing.
 */
import {
  BridgeResponse,
  ReadResult,
  VerbResult,
  bridgeResponseSchema,
  descriptorSchema,
  validateVerbResult
} from './envelope';
import { DocumentSession, DispatchOutcome } from './session';
import { NfNode } from './tree';
import {
  ToyHost,
  TOY_FORMAT,
  box,
  makeToyPack,
  para,
  toyNative
} from './tests/toyPack';

const doc = toyNative(
  para('Insurance proposal', { bold: true }),
  box([para('Motor'), para('Property', { x: 'native-only' })], {
    name: 'lines'
  }),
  para('Items: 2', { formula: 'count(lines)' })
);
const target = { type: 'envelope', id: 'env_1' };

function mount(native = doc) {
  const host = new ToyHost(native);
  const session = new DocumentSession({
    pack: makeToyPack(),
    host,
    target,
    editorId: 'ed-1'
  });
  let turn = 0;
  const call = (
    verb: string,
    input: unknown,
    turnId = `turn-${turn}`
  ): VerbResult => {
    const out: DispatchOutcome = session.dispatch({
      protocolVersion: 1,
      turnId,
      editorId: 'ed-1',
      target,
      verb,
      input
    });
    if (out.status !== 'ok')
      throw new Error(`dispatch failed: ${JSON.stringify(out.failure)}`);
    expect(bridgeResponseSchema.safeParse(out.response).success).toBe(true);
    expect(validateVerbResult(verb as never, out.response.result)).toEqual({
      ok: true
    });
    return out.response.result;
  };
  const nextTurn = () => {
    turn += 1;
  };
  return { host, session, call, nextTurn };
}

const nodeOf = (r: VerbResult, id: string) =>
  (r as ReadResult).nodes.find(
    (n) => n.id === id
  ) as ReadResult['nodes'][number];

describe('document session: the four verbs end to end', () => {
  it('describes the mounted document', () => {
    const { session, call } = mount();
    const d = session.descriptor();
    expect(descriptorSchema.safeParse(d).success).toBe(true);
    expect(d).toEqual({
      protocolVersion: 1,
      editorId: 'ed-1',
      target,
      format: TOY_FORMAT,
      readOnly: false,
      outlineHash: (call('outline', {}) as { outlineHash: string }).outlineHash
    });
  });

  it('outline, find, read, write a tracked text change; the proof passes and the card is the turn', () => {
    const { host, call } = mount();
    const outline = call('outline', {}) as {
      lines: string;
      outlineHash: string;
    };
    expect(outline.lines.split('\n')).toEqual([
      'n1 para "Insurance proposal"',
      'n2 box 2 items [name=lines] usedBy[n5]',
      '  n3 para "Motor"',
      '  n4 para "Property"',
      'n5 para "Items: 2" {formula=count(lines)}'
    ]);
    const found = call('find', { text: 'motor' }) as {
      hits: Array<{ id: string }>;
    };
    expect(found.hits.map((h) => h.id)).toEqual(['n3']);
    const read = call('read', { ids: ['n3'] });
    const n3 = nodeOf(read, 'n3');

    const result = call('write', {
      intent: 'Rename Motor to Motor fleet.',
      scope: { ids: ['n3'] },
      changes: [
        {
          kind: 'replace',
          id: 'n3',
          base: n3.base,
          node: { text: 'Motor fleet', style: n3.style }
        }
      ]
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        committed: true,
        landed: 'card',
        cardId: 'turn-0',
        touched: ['n3']
      })
    );
    const ok = result as Extract<VerbResult, { committed: boolean }>;
    expect(ok.trace.verified.outcome).toBe('passed');
    expect(ok.trace.committed).toEqual(
      expect.objectContaining({ outcome: 'committed', seams: ['text'] })
    );
    expect(ok.trace.proof).toEqual(
      expect.objectContaining({
        outcome: 'passed',
        landed: true,
        reversible: true
      })
    );
    expect(ok.outlineHash).not.toBe(outline.outlineHash);
    expect(ok.facts.map((f) => f.summary)).toEqual([
      'para n3 replaced ("Motor fleet")'
    ]);
    // the editor holds a tracked change: one native undo group
    expect(JSON.parse(host.serialize()).body[1].items.slice(0, 2)).toEqual([
      { t: 'p', text: 'Motor', rev: 'del' },
      { t: 'p', text: 'Motor fleet', rev: 'ins' }
    ]);
    expect(host.undoStack).toHaveLength(1);
    // the id the model wrote to is the id it reads back
    const after = call('read', { ids: ['n3'] });
    expect(nodeOf(after, 'n3')).toEqual(
      expect.objectContaining({
        text: 'Motor fleet',
        pending: { kind: 'insertion' }
      })
    );
  });

  it('inserts structure with temporary ids, recomputes formulas, and the mapped ids are live', () => {
    const { host, session, call } = mount();
    const n2 = nodeOf(call('read', { ids: ['n2'] }), 'n2');
    const result = call('write', {
      intent: 'Add a Liability line.',
      scope: { ids: ['n4'] },
      changes: [
        {
          kind: 'insert_after',
          anchor: 'n4',
          container: n2.base,
          node: { id: 'tmp:liability', text: 'Liability', style: 'f2' }
        }
      ]
    }) as Extract<VerbResult, { committed: boolean }>;
    expect(result).toEqual(
      expect.objectContaining({
        committed: true,
        landed: 'card',
        mapping: { 'tmp:liability': 'n6' }
      })
    );
    expect(result.trace.committed.seams).toEqual(['splice']);
    expect(result.warnings.map((w) => w.code)).toEqual([
      'undo-history-cleared'
    ]);
    expect(result.finalizerScope).toEqual([{ name: 'formulas', ids: ['n5'] }]);
    const read = call('read', { ids: ['n6', 'n5'] });
    expect(nodeOf(read, 'n6')).toEqual(
      expect.objectContaining({
        text: 'Liability',
        pending: { kind: 'insertion' }
      })
    );
    expect(session.history.depth.undo).toBe(1);
    // the residue of untouched nodes survived the document replacement
    expect(JSON.parse(host.serialize()).body[1].items[1].x).toBe('native-only');
  });

  it('applies formatting immediately with no card, and Ctrl+Z goes to the editor', () => {
    const { host, session, call } = mount();
    const n1 = nodeOf(call('read', { ids: ['n1'] }), 'n1');
    const result = call('write', {
      intent: 'Make the title larger.',
      scope: { ids: ['n1'] },
      changes: [
        {
          kind: 'set',
          target: { ids: ['n1'], base: { n1: n1.base } },
          props: { size: 24 }
        }
      ]
    });
    expect(result).toEqual(
      expect.objectContaining({
        committed: true,
        landed: 'immediate',
        cardId: null
      })
    );
    expect(JSON.parse(host.serialize()).body[0]).toEqual({
      t: 'p',
      text: 'Insurance proposal',
      bold: true,
      size: 24
    });
    expect(session.undo()).toEqual({ via: 'editor' });
    expect(host.serialize()).toBe(doc);
  });

  it('routes undo to the engine after a structural change, and redo back', () => {
    const { host, session, call } = mount();
    const n2 = nodeOf(call('read', { ids: ['n2'] }), 'n2');
    call('write', {
      intent: 'Add a line.',
      scope: { ids: [] },
      changes: [
        {
          kind: 'insert_after',
          anchor: 'n4',
          container: n2.base,
          node: { text: 'Cyber', style: 'f2' }
        }
      ]
    });
    const committed = host.serialize();
    expect(session.undo()).toEqual(expect.objectContaining({ via: 'engine' }));
    expect(host.serialize()).toBe(doc);
    expect(session.redo()).toEqual(expect.objectContaining({ via: 'engine' }));
    expect(host.serialize()).toBe(committed);
  });

  it('a user edit between read and write is a conflict carrying the live node; re-planned, it commits', () => {
    const { host, call, nextTurn } = mount();
    const n4 = nodeOf(call('read', { ids: ['n4'] }), 'n4');
    host.userEdit((d) => {
      (d.body[1] as { items: Array<{ text: string }> }).items[1].text =
        'Property and casualty';
    });
    const conflict = call('write', {
      intent: 'Bold Property.',
      scope: { ids: ['n4'] },
      changes: [
        {
          kind: 'set',
          target: { ids: ['n4'], base: { n4: n4.base } },
          props: { bold: true }
        }
      ]
    });
    expect(conflict).toEqual(
      expect.objectContaining({
        ok: false,
        error: {
          code: 'document.conflict',
          message: '1 node(s) changed since they were read.'
        }
      })
    );
    const live = (
      conflict as {
        conflict: { stale: Array<{ live: NfNode & { base: string } }> };
      }
    ).conflict.stale[0].live;
    expect(live).toEqual(
      expect.objectContaining({ id: 'n4', text: 'Property and casualty' })
    );
    nextTurn();
    const retry = call('write', {
      intent: 'Bold Property.',
      scope: { ids: ['n4'] },
      changes: [
        {
          kind: 'set',
          target: { ids: ['n4'], base: { n4: live.base } },
          props: { bold: true }
        }
      ]
    });
    expect(retry).toEqual(
      expect.objectContaining({ ok: true, committed: true })
    );
  });

  it('one write per message: a resend replays, a different second write is refused', () => {
    const { call } = mount();
    const n1 = nodeOf(call('read', { ids: ['n1'] }), 'n1');
    const input = {
      intent: 'Retitle.',
      scope: { ids: ['n1'] },
      changes: [
        {
          kind: 'replace',
          id: 'n1',
          base: n1.base,
          node: { text: 'Proposal', style: 'f1' }
        }
      ]
    };
    const first = call('write', input);
    expect(call('write', input)).toEqual(first);
    const second = call('write', {
      ...input,
      changes: [{ ...input.changes[0], node: { text: 'Other', style: 'f1' } }]
    });
    expect(second).toEqual(
      expect.objectContaining({
        ok: false,
        refusal: expect.objectContaining({
          invariant: 'one-write-per-message',
          retry: 'do_not_retry'
        })
      })
    );
  });

  it('a failed proof rolls back byte-equal and refuses with the trace saying so', () => {
    const { host, call } = mount();
    const n2 = nodeOf(call('read', { ids: ['n2'] }), 'n2');
    host.corruptNextSeam = true;
    const result = call('write', {
      intent: 'Add a line.',
      scope: { ids: [] },
      changes: [
        {
          kind: 'insert_after',
          anchor: 'n4',
          container: n2.base,
          node: { text: 'Cyber', style: 'f2' }
        }
      ]
    }) as {
      ok: false;
      refusal: { invariant: string; detail: { landed: string[] } };
      trace: { committed: unknown; proof: unknown };
    };
    expect(result.refusal.invariant).toBe('proof-failed');
    expect(result.refusal.detail.landed[0]).toContain('4 items, expected 3');
    expect(result.trace.committed).toEqual(
      expect.objectContaining({ outcome: 'rolled-back' })
    );
    expect(result.trace.proof).toEqual(
      expect.objectContaining({
        outcome: 'failed',
        landed: false,
        rollback: { byteEqual: true }
      })
    );
    expect(host.serialize()).toBe(doc);
  });

  it('a seam that cannot place the change rolls back and refuses apply-failed', () => {
    const { host, call } = mount();
    const n3 = nodeOf(call('read', { ids: ['n3'] }), 'n3');
    host.failNextSeam = 'text';
    const result = call('write', {
      intent: 'Rename.',
      scope: { ids: ['n3'] },
      changes: [
        {
          kind: 'replace',
          id: 'n3',
          base: n3.base,
          node: { text: 'Auto', style: n3.style }
        }
      ]
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        refusal: expect.objectContaining({
          invariant: 'apply-failed',
          retry: 'modified_input'
        })
      })
    );
    expect(host.serialize()).toBe(doc);
  });

  it('a dry run verifies and reports facts without touching the editor', () => {
    const { host, call } = mount();
    const n3 = nodeOf(call('read', { ids: ['n3'] }), 'n3');
    const result = call('write', {
      intent: 'Try a rename.',
      scope: { ids: ['n3'] },
      changes: [
        {
          kind: 'replace',
          id: 'n3',
          base: n3.base,
          node: { text: 'Auto', style: n3.style }
        }
      ],
      dryRun: true
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        committed: false,
        dryRun: true,
        landed: 'none',
        cardId: null
      })
    );
    expect(host.serialize()).toBe(doc);
  });

  it('refusals carry the trace; a pack invariant refuses with its own card', () => {
    const { call } = mount();
    const n2 = nodeOf(call('read', { ids: ['n2'] }), 'n2');
    const result = call('write', {
      intent: 'Drop the lines box.',
      scope: { ids: ['n2'] },
      changes: [{ kind: 'delete', id: 'n2', base: n2.base }]
    }) as {
      refusal: { invariant: string; read: string[] };
      trace: {
        verified: {
          outcome: string;
          checks: Array<{ name: string; pass: boolean }>;
        };
      };
    };
    expect(result.refusal).toEqual(
      expect.objectContaining({
        invariant: 'orphaned-dependents',
        read: ['formula']
      })
    );
    expect(result.trace.verified.outcome).toBe('refused');
    expect(
      result.trace.verified.checks.find((c) => c.name === 'orphaned-dependents')
    ).toEqual({ name: 'orphaned-dependents', pass: false });
  });

  it('a read-only editor refuses writes and still reads', () => {
    const { host, session, call } = mount();
    host.locked = true;
    expect(session.descriptor().readOnly).toBe(true);
    expect(
      call('write', {
        intent: 'x',
        scope: { ids: [] },
        changes: [{ kind: 'delete', id: 'n1', base: 'b' }]
      })
    ).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'document.read_only' })
      })
    );
    expect(call('outline', {})).toEqual(expect.objectContaining({ ok: true }));
  });

  it('dispatch failures: malformed payload, unsupported version, wrong editor; an invalid input is a refusal', () => {
    const { session } = mount();
    const base = {
      protocolVersion: 1,
      turnId: 't',
      editorId: 'ed-1',
      target,
      verb: 'outline',
      input: {}
    };
    expect(session.dispatch({ ...base, verb: 'apply' })).toEqual({
      status: 'error',
      failure: expect.objectContaining({ reason: 'payload-invalid' })
    });
    expect(session.dispatch({ ...base, protocolVersion: 2 })).toEqual({
      status: 'error',
      failure: expect.objectContaining({ reason: 'protocol-unsupported' })
    });
    expect(session.dispatch({ ...base, editorId: 'ed-2' })).toEqual({
      status: 'error',
      failure: expect.objectContaining({ reason: 'wrong-editor' })
    });
    const invalid = session.dispatch({
      ...base,
      verb: 'read',
      input: { ids: [] }
    });
    expect(invalid.status).toBe('ok');
    expect((invalid as { response: BridgeResponse }).response.result).toEqual(
      expect.objectContaining({
        ok: false,
        refusal: expect.objectContaining({ invariant: 'envelope' })
      })
    );
  });

  it('a pack that throws mid-verb is a handler exception, which the server treats as uncertain', () => {
    const host = new ToyHost(doc);
    const pack = makeToyPack();
    const session = new DocumentSession({
      pack,
      host,
      target,
      editorId: 'ed-1'
    });
    pack.text = () => {
      throw new Error('broken pack');
    };
    expect(
      session.dispatch({
        protocolVersion: 1,
        turnId: 't',
        editorId: 'ed-1',
        target,
        verb: 'find',
        input: { text: 'x' }
      })
    ).toEqual({
      status: 'error',
      failure: { reason: 'handler-exception', message: 'broken pack' }
    });
  });

  it('ids continue across user edits between turns', () => {
    const { host, call } = mount();
    host.userEdit((d) => d.body.unshift(para('Cover note')));
    const outline = (call('outline', {}) as { lines: string }).lines.split(
      '\n'
    );
    expect(outline.slice(0, 3)).toEqual([
      'n6 para "Cover note"',
      'n1 para "Insurance proposal"',
      'n2 box 2 items [name=lines] usedBy[n5]'
    ]);
  });
});
