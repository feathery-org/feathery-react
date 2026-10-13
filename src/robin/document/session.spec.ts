/**
 * The core's completion gate: a toy document round-trips through all four verbs against the fake
 * pack, through the bridge payload and response of contract section 10, with proof, rollback,
 * conflicts, the one-write rule and undo routing.
 */
import {
  Verb,
  ReadResult,
  VerbResult,
  bridgeResultSchema,
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
    const out: DispatchOutcome = session.dispatch(verb as Verb, {
      turnId,
      editorId: 'ed-1',
      target,
      input
    });
    if (out.status !== 'ok')
      throw new Error(`dispatch failed: ${JSON.stringify(out)}`);
    expect(bridgeResultSchema.safeParse(out.result).success).toBe(true);
    expect(validateVerbResult(verb as never, out.result)).toEqual({
      ok: true
    });
    return out.result;
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
      protocolVersion: 2,
      editorId: 'ed-1',
      target,
      format: TOY_FORMAT,
      readOnly: false,
      outlineHash: (call('outline', {}) as { outlineHash: string }).outlineHash,
      outline: (call('outline', {}) as { lines: string }).lines
    });
  });

  it('reads the selection from the editor: its text capped at 500 characters, and none when the editor cannot say', () => {
    const { host, session } = mount();
    host.selected = {
      start: { id: 'n1', offset: 0 },
      end: { id: 'n3', offset: 2 },
      text: 'x'.repeat(600)
    };
    const d = session.descriptor();
    expect(descriptorSchema.safeParse(d).success).toBe(true);
    expect(d.selection).toEqual({
      start: { id: 'n1', offset: 0 },
      end: { id: 'n3', offset: 2 },
      text: 'x'.repeat(500),
      truncated: true
    });
    host.selected = new Error('editor gone');
    expect(session.descriptor().selection).toBeUndefined();
    expect(session.descriptor().outline).toEqual(expect.any(String));
  });

  it('outline, find, read, write a tracked text change; the proof passes and the card is the turn', () => {
    const { host, call } = mount();
    const outline = call('outline', {}) as {
      lines: string;
      outlineHash: string;
    };
    expect(outline.lines.split('\n')).toEqual([
      'n1 para "Insurance proposal"',
      expect.stringMatching(
        /^n2 box @[0-9a-f]{8} 2 items \[name=lines\] usedBy\[n5\]$/
      ),
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
      { t: 'p', text: 'Motor', rev: 'del', by: 'turn-0' },
      { t: 'p', text: 'Motor fleet', rev: 'ins', by: 'turn-0' }
    ]);
    expect(host.undoStack).toHaveLength(1);
    // the id the model wrote to is the id it reads back
    const after = call('read', { ids: ['n3'] });
    expect(nodeOf(after, 'n3')).toEqual(
      expect.objectContaining({
        text: 'Motor fleet',
        pending: { kind: 'insertion', by: 'turn-0' }
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
          container: n2.shape,
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
        pending: { kind: 'insertion', by: 'turn-0' }
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
          target: { ids: ['n1'], shape: { n1: n1.shape } },
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
          container: n2.shape,
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
          target: { ids: ['n4'], shape: { n4: n4.shape } },
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
          target: { ids: ['n4'], shape: { n4: live.shape } },
          props: { bold: true }
        }
      ]
    });
    expect(retry).toEqual(
      expect.objectContaining({ ok: true, committed: true })
    );
  });

  it('a user keystroke inside a sibling does not conflict an insert into the same list (container is the parent shape)', () => {
    const { host, call } = mount();
    const n2 = nodeOf(call('read', { ids: ['n2'] }), 'n2') as { shape: string };
    host.userEdit((d) => {
      (d.body[1] as { items: Array<{ text: string }> }).items[0].text =
        'Motor and fleet';
    });
    const result = call('write', {
      intent: 'Add a Liability line.',
      scope: { ids: [] },
      changes: [
        {
          kind: 'insert_after',
          anchor: 'n4',
          container: n2.shape,
          node: { text: 'Liability', style: 'f2' }
        }
      ]
    });
    expect(result).toEqual(
      expect.objectContaining({ ok: true, committed: true })
    );
  });

  it('a user insert into the same list does conflict, reporting the carried shape and the live hashes', () => {
    const { host, call } = mount();
    const n2 = nodeOf(call('read', { ids: ['n2'] }), 'n2') as { shape: string };
    host.userEdit((d) => {
      (d.body[1] as { items: unknown[] }).items.push(para('Typed by the user'));
    });
    const result = call('write', {
      intent: 'Add a Liability line.',
      scope: { ids: [] },
      changes: [
        {
          kind: 'insert_after',
          anchor: 'n4',
          container: n2.shape,
          node: { text: 'Liability', style: 'f2' }
        }
      ]
    }) as { conflict: { stale: Array<Record<string, unknown>> } };
    expect(result.conflict.stale).toEqual([
      {
        id: 'n2',
        shape: n2.shape,
        live: expect.objectContaining({
          id: 'n2',
          base: expect.any(String),
          shape: expect.any(String)
        })
      }
    ]);
  });

  it('the top-level list is a container like any other: a replayed insert into it is a conflict naming root (review)', () => {
    const { host, call, nextTurn } = mount();
    const root = nodeOf(call('read', { ids: ['root'] }), 'root');
    const insert = {
      intent: 'Add a closing line.',
      scope: { ids: [] },
      changes: [
        {
          kind: 'insert_after',
          anchor: 'n5',
          container: root.shape,
          node: { text: 'Thank you.', style: 'f1' }
        }
      ]
    };
    expect(call('write', insert)).toEqual(
      expect.objectContaining({ committed: true })
    );
    const once = host.serialize();
    nextTurn();
    const replayed = call('write', insert) as {
      conflict: { stale: Array<Record<string, unknown>> };
    };
    expect(replayed.conflict.stale).toEqual([
      expect.objectContaining({
        id: 'root',
        shape: root.shape,
        live: expect.objectContaining({ id: 'root' })
      })
    ]);
    expect(host.serialize()).toBe(once);
  });

  it('a bulk set carries the shape of what find matched: an edit to a matched node is a conflict even when the count holds (review)', () => {
    const { host, call, nextTurn } = mount();
    const query = { kind: 'para', within: 'n2' };
    const found = call('find', query) as { total: number; shape: string };
    expect(found.total).toBe(2);
    expect(found.shape).toEqual(expect.any(String));
    const bulkSet = (shape: string) => ({
      intent: 'Bigger lines.',
      scope: { ids: [], bulk: [{ find: query, total: 2 }] },
      changes: [
        {
          kind: 'set',
          target: { find: query, total: 2, shape },
          props: { size: 14 }
        }
      ]
    });
    expect(call('write', bulkSet(found.shape))).toEqual(
      expect.objectContaining({ committed: true })
    );
    const once = host.serialize();
    // replayed in a new turn: the same count, but the matched nodes are not as find returned them
    nextTurn();
    const replayed = call('write', bulkSet(found.shape)) as {
      conflict: { bulk: Array<Record<string, unknown>> };
    };
    expect(replayed.conflict.bulk).toEqual([
      expect.objectContaining({ total: 2, live: 2, shape: found.shape })
    ]);
    expect(host.serialize()).toBe(once);
  });

  it('a write that changes nothing returns before any seam: no card, the editor and its undo untouched (review)', () => {
    const { host, call } = mount();
    host.userEdit((d) => d.body.push(para('Typed')));
    const userUndo = [...host.undoStack];
    const nodes = (call('read', { ids: ['n1', 'n2', 'n3'] }) as ReadResult)
      .nodes;
    const [n1, n2, n3] = nodes;
    const before = host.serialize();
    const opens = host.opens;
    const writes = [
      // a property it already has
      {
        intent: 'Bold the title.',
        scope: { ids: ['n1'] },
        changes: [
          {
            kind: 'set',
            target: { ids: ['n1'], shape: { n1: n1.shape } },
            props: { bold: true }
          }
        ]
      },
      // a move to where it already is
      {
        intent: 'Keep Motor first.',
        scope: { ids: ['n3'] },
        changes: [
          {
            kind: 'move',
            id: 'n3',
            shape: n3.shape,
            anchor: 'n4',
            container: n2.shape,
            position: 'before'
          }
        ]
      }
    ];
    writes.forEach((write, i) => {
      const r = call('write', write, `same-${i}`);
      expect(r).toEqual(
        expect.objectContaining({
          ok: true,
          committed: false,
          dryRun: false,
          cardId: null,
          landed: 'none',
          warnings: [expect.objectContaining({ code: 'no-change' })]
        })
      );
      expect((r as { trace: any }).trace.committed.seams).toEqual([]);
    });
    expect(host.serialize()).toBe(before);
    expect(host.opens).toBe(opens);
    expect(host.undoStack).toEqual(userUndo);
  });

  it('a hash sent in the wrong field is an envelope refusal naming the right field, not a conflict', () => {
    const { call } = mount();
    const n2 = nodeOf(call('read', { ids: ['n2'] }), 'n2') as {
      base: string;
      shape: string;
    };
    expect(n2.base).not.toBe(n2.shape);
    const result = call('write', {
      intent: 'Add a Liability line.',
      scope: { ids: [] },
      changes: [
        {
          kind: 'insert_after',
          anchor: 'n4',
          container: n2.base,
          node: { text: 'Liability', style: 'f2' }
        }
      ]
    }) as {
      ok: boolean;
      refusal: { invariant: string; hint: string; destroyed: string };
    };
    expect(result.ok).toBe(false);
    expect(result.refusal.invariant).toBe('envelope');
    expect(result.refusal.destroyed).toContain('changes[0].container');
    expect(result.refusal.hint).toContain('shape');
  });

  it('a resend replays the recorded result; a different write in the same turn is a new commit with the next card (protocol 2)', () => {
    const { host, call } = mount();
    const nodes = (call('read', { ids: ['n1', 'n3'] }) as ReadResult).nodes;
    const retitle = {
      intent: 'Retitle.',
      scope: { ids: ['n1'] },
      changes: [
        {
          kind: 'replace',
          id: 'n1',
          base: nodes[0].base,
          node: { text: 'Proposal', style: 'f1' }
        }
      ]
    };
    // a dry run is never journaled: the real write that follows it executes
    expect(call('write', { ...retitle, dryRun: true })).toEqual(
      expect.objectContaining({ committed: false, dryRun: true })
    );
    const first = call('write', retitle);
    expect(first).toEqual(
      expect.objectContaining({ committed: true, cardId: 'turn-0' })
    );
    const once = host.serialize();
    expect(call('write', retitle)).toEqual(first);
    expect(host.serialize()).toBe(once);
    const second = call('write', {
      intent: 'Rename the line.',
      scope: { ids: ['n3'] },
      changes: [
        {
          kind: 'replace',
          id: 'n3',
          base: nodes[1].base,
          node: { text: 'Motor fleet', style: nodes[1].style }
        }
      ]
    });
    expect(second).toEqual(
      expect.objectContaining({ committed: true, cardId: 'turn-0.2' })
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
          container: n2.shape,
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
        rollback: { byteEqual: true, exact: true, equivalent: true }
      })
    );
    expect(host.serialize()).toBe(doc);
  });

  it("a failed proof names the pack's method cards, so the model knows what to read before retrying", () => {
    const host = new ToyHost(doc);
    const session = new DocumentSession({
      pack: makeToyPack({ methodCards: ['writing-method'] }),
      host,
      target,
      editorId: 'ed-1'
    });
    const send = (verb: string, input: unknown) => {
      const out = session.dispatch(verb as Verb, {
        turnId: 't9',
        editorId: 'ed-1',
        target,
        input
      });
      if (out.status !== 'ok') throw new Error('dispatch failed');
      return out.result as any;
    };
    const n2 = send('read', { ids: ['n2'] }).nodes.find(
      (n: { id: string }) => n.id === 'n2'
    );
    host.corruptNextSeam = true;
    const result = send('write', {
      intent: 'Add a line.',
      scope: { ids: [] },
      changes: [
        {
          kind: 'insert_after',
          anchor: 'n4',
          container: n2.shape,
          node: { text: 'Cyber', style: 'f2' }
        }
      ]
    });
    expect(result.refusal.invariant).toBe('proof-failed');
    expect(result.refusal.read).toEqual(['writing-method']);
  });

  it('a seam that drops native-only data fails the proof and rolls back (residue is proved too)', () => {
    const { host, call } = mount();
    const n3 = nodeOf(call('read', { ids: ['n3'] }), 'n3');
    (host as unknown as { seamFault: string }).seamFault = 'drop-residue';
    const result = call('write', {
      intent: 'Rename Motor.',
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
        refusal: expect.objectContaining({ invariant: 'proof-failed' })
      })
    );
    expect(host.serialize()).toBe(doc);
  });

  it("a seam that re-authors the user's pending change under this turn fails the proof", () => {
    const userDoc = toyNative(
      para('Title'),
      para('User typed this', { rev: 'ins', by: 'user' }),
      para('Other')
    );
    const { host, call } = mount(userDoc);
    const n3 = nodeOf(call('read', { ids: ['n3'] }), 'n3');
    (host as unknown as { seamFault: string }).seamFault = 'reauthor-foreign';
    const result = call('write', {
      intent: 'Rename Other.',
      scope: { ids: ['n3'] },
      changes: [
        {
          kind: 'replace',
          id: 'n3',
          base: n3.base,
          node: { text: 'Another', style: n3.style }
        }
      ]
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        refusal: expect.objectContaining({ invariant: 'proof-failed' })
      })
    );
    expect(host.serialize()).toBe(userDoc);
  });

  it("a seam that leaves its change outside this turn's group fails the proof", () => {
    const { host, call } = mount();
    const n3 = nodeOf(call('read', { ids: ['n3'] }), 'n3');
    (host as unknown as { seamFault: string }).seamFault = 'omit-group';
    const result = call('write', {
      intent: 'Rename Motor.',
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
        refusal: expect.objectContaining({ invariant: 'proof-failed' })
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

  it('dispatch failures are typed codes with the message in result: a malformed payload, a wrong editor; an invalid input is a refusal', () => {
    const { session } = mount();
    const base = { turnId: 't', editorId: 'ed-1', target, input: {} };
    expect(session.dispatch('outline', { ...base, verb: 'outline' })).toEqual({
      status: 'error',
      error: 'handler-exception',
      result: { message: expect.stringContaining('malformed') }
    });
    // protocol 2 carries no version in the payload: the descriptor is the handshake
    expect(
      session.dispatch('outline', { ...base, protocolVersion: 2 })
    ).toEqual(expect.objectContaining({ error: 'handler-exception' }));
    expect(session.dispatch('outline', { ...base, editorId: 'ed-2' })).toEqual({
      status: 'error',
      error: 'wrong-editor',
      result: { message: expect.any(String) }
    });
    const invalid = session.dispatch('read', { ...base, input: { ids: [] } });
    expect(invalid).toEqual({
      status: 'ok',
      result: expect.objectContaining({
        ok: false,
        editorId: 'ed-1',
        target,
        outlineHash: expect.any(String),
        refusal: expect.objectContaining({ invariant: 'envelope' })
      })
    });
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
      session.dispatch('find', {
        turnId: 't',
        editorId: 'ed-1',
        target,
        input: { text: 'x' }
      })
    ).toEqual({
      status: 'error',
      error: 'handler-exception',
      result: { message: 'broken pack' }
    });
  });

  it("an id the user's edit made ambiguous is a conflict until it is read again (review: two identical paragraphs)", () => {
    const twin = toyNative(
      para('Title'),
      para('Same'),
      para('Same'),
      para('End')
    );
    const { host, call, nextTurn } = mount(twin);
    const read = call('read', { ids: ['n2'] });
    const first = nodeOf(read, 'n2');
    // the user deletes the first of the two: which one survives cannot be told from the content
    host.userEdit((d) => d.body.splice(1, 1));
    nextTurn();
    const write = (base: string) =>
      call('write', {
        intent: 'x',
        scope: { ids: ['n2'] },
        changes: [
          {
            kind: 'replace',
            id: 'n2',
            base,
            node: { text: 'Changed', style: first.style }
          }
        ]
      }) as {
        ok: boolean;
        conflict?: { stale: Array<{ id: string; live: { base: string } }> };
      };
    const r = write(first.base as string);
    expect(r.ok).toBe(false);
    expect(r.conflict?.stale.map((s) => s.id)).toEqual(['n2']);
    // the conflict carries the node as it is now: a write from it lands
    nextTurn();
    expect(write(r.conflict?.stale[0].live.base as string).ok).toBe(true);
    // and a read settles it the same way
    const again = mount(twin);
    const seen = nodeOf(again.call('read', { ids: ['n3'] }), 'n3');
    again.host.userEdit((d) => d.body.splice(1, 1));
    again.nextTurn();
    const reread = nodeOf(again.call('read', { ids: ['n2'] }), 'n2');
    expect(reread.base).toBe(seen.base);
    again.nextTurn();
    expect(
      (
        again.call('write', {
          intent: 'x',
          scope: { ids: ['n2'] },
          changes: [
            {
              kind: 'replace',
              id: 'n2',
              base: reread.base,
              node: { text: 'Changed', style: reread.style }
            }
          ]
        }) as { ok: boolean }
      ).ok
    ).toBe(true);
  });

  it('an unambiguous user edit leaves ids writable without a fresh read', () => {
    const { host, call, nextTurn } = mount();
    const first = nodeOf(call('read', { ids: ['n1'] }), 'n1');
    host.userEdit((d) => d.body.push(para('Appended')));
    nextTurn();
    const r = call('write', {
      intent: 'x',
      scope: { ids: ['n1'] },
      changes: [
        {
          kind: 'replace',
          id: 'n1',
          base: first.base,
          node: { text: 'Changed', style: first.style }
        }
      ]
    }) as { ok: boolean };
    expect(r).toEqual(expect.objectContaining({ ok: true }));
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
      expect.stringMatching(
        /^n2 box @[0-9a-f]{8} 2 items \[name=lines\] usedBy\[n5\]$/
      )
    ]);
  });
});

describe('document session: telling the host whose change it is', () => {
  function watched() {
    const host = new ToyHost(doc);
    const events: string[] = [];
    let writing = false;
    const session = new DocumentSession({
      pack: makeToyPack(),
      host,
      target,
      editorId: 'ed-1',
      writing: (commit) => {
        writing = true;
        events.push('writing');
        try {
          return commit();
        } finally {
          writing = false;
        }
      },
      onReplaced: (by) =>
        events.push(`replaced:${by}${writing ? ':marked' : ''}`)
    });
    const call = (verb: string, input: unknown, turnId = 'turn-1') => {
      const out = session.dispatch(verb as Verb, {
        turnId,
        editorId: 'ed-1',
        target,
        input
      });
      if (out.status !== 'ok') throw new Error('dispatch failed');
      return out.result;
    };
    return { host, session, call, events };
  }

  const addLine = (container: string) => ({
    intent: 'Add a line.',
    scope: { ids: [] },
    changes: [
      {
        kind: 'insert_after',
        anchor: 'n4',
        container,
        node: { text: 'Cyber', style: 'f2' }
      }
    ]
  });

  it('a structural commit runs marked as Robin and reports the replaced document while marked', () => {
    const { call, events } = watched();
    const n2 = nodeOf(call('read', { ids: ['n2'] }), 'n2');
    call('write', addLine(n2.shape));
    expect(events).toEqual(['writing', 'replaced:robin:marked']);
  });

  it("an in-place commit runs marked; the editor's own change event reports it", () => {
    const { call, events } = watched();
    const n1 = nodeOf(call('read', { ids: ['n1'] }), 'n1');
    call('write', {
      intent: 'Make the title larger.',
      scope: { ids: ['n1'] },
      changes: [
        {
          kind: 'set',
          target: { ids: ['n1'], shape: { n1: n1.shape } },
          props: { size: 24 }
        }
      ]
    });
    expect(events).toEqual(['writing']);
  });

  it("an undo or redo through the engine's history is the person's replacement; the editor's own is not reported", () => {
    const { call, session, events } = watched();
    const n2 = nodeOf(call('read', { ids: ['n2'] }), 'n2');
    call('write', addLine(n2.shape));
    events.length = 0;
    session.undo();
    session.redo();
    expect(events).toEqual(['replaced:person', 'replaced:person']);
  });

  it('a refused or dry-run write is not marked and reports nothing', () => {
    const { call, events } = watched();
    const n2 = nodeOf(call('read', { ids: ['n2'] }), 'n2');
    call('write', { ...addLine(n2.shape), dryRun: true });
    call('write', addLine('@00000000'));
    expect(events).toEqual([]);
  });
});
