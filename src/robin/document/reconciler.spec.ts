import { EngineHistory } from './history';
import { prepareWrite } from './verbs';
import { reconcile } from './reconciler';
import { makeView } from './view';
import { WriteInput, parseVerbInput } from './envelope';
import { baseOf, NfNode, shapeOf } from './tree';
import { stateOf } from './tests/fixtures';
import { ToyHost, box, para, toyNative } from './tests/toyPack';

const doc = toyNative(
  para('Title', { bold: true }),
  box([para('one'), para('two', { x: 'n' })], { name: 'alpha' })
);

function setup(
  build: (b: (id: string) => string, sh: (id: string) => string) => unknown
) {
  const host = new ToyHost(doc);
  const state = stateOf(host.serialize());
  const b = (id: string) => baseOf(state.view.get(id));
  const sh = (id: string) =>
    shapeOf(state.view.get(id) as NfNode, state.pack.tree);
  const parsed = parseVerbInput('write', build(b, sh));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.refusal));
  const prepared = prepareWrite(state, parsed.value as WriteInput);
  if (prepared.outcome !== 'verified') throw new Error(prepared.outcome);
  const history = new EngineHistory();
  const run = () =>
    reconcile({
      pack: state.pack,
      host,
      history,
      turnId: 'turn-1',
      intent: 'test',
      before: { view: state.view, residue: state.residue, native: doc },
      intended: {
        view: makeView(prepared.intended, state.pack),
        residue: prepared.intendedResidue
      }
    });
  return { host, history, run };
}

const retitle = (b: (id: string) => string) => ({
  intent: 'Retitle.',
  scope: { ids: ['n1'] },
  changes: [
    {
      kind: 'replace',
      id: 'n1',
      base: b('n1'),
      node: { text: 'New title', style: 'f1' }
    }
  ]
});
const addItem = (b: (id: string) => string, sh: (id: string) => string) => ({
  intent: 'Add an item.',
  scope: { ids: [] },
  changes: [
    {
      kind: 'insert_after',
      anchor: 'n4',
      container: sh('n2'),
      node: { text: 'three', style: 'f2' }
    }
  ]
});
const bold = (b: (id: string) => string, sh: (id: string) => string) => ({
  intent: 'Bold one.',
  scope: { ids: ['n3'] },
  changes: [
    {
      kind: 'set',
      target: { ids: ['n3'], shape: { n3: sh('n3') } },
      props: { bold: true }
    }
  ]
});

describe('reconciler', () => {
  it('commits text natively as one editor undo group, tracked, and proves it', () => {
    const { host, history, run } = setup(retitle);
    const r = run();
    expect(r.outcome).toBe('committed');
    if (r.outcome !== 'committed') return;
    expect([r.seams, r.plan.landed, r.plan.history]).toEqual([
      ['text'],
      'card',
      'editor'
    ]);
    expect(r.proof.passed).toBe(true);
    expect(host.undoStack).toHaveLength(1);
    expect(history.depth.undo).toBe(0);
    expect(JSON.parse(host.serialize()).body.slice(0, 2)).toEqual([
      { t: 'p', text: 'Title', bold: true, rev: 'del' },
      { t: 'p', text: 'New title', bold: true, rev: 'ins' }
    ]);
  });

  it('commits structure by replacing the document, and keeps the way back in engine history', () => {
    const { host, history, run } = setup(addItem);
    const r = run();
    expect(r.outcome).toBe('committed');
    if (r.outcome !== 'committed') return;
    expect([r.seams, r.plan.history]).toEqual([['splice'], 'engine']);
    expect(r.warnings.map((w) => w.code)).toEqual(['undo-history-cleared']);
    expect(host.opens).toBe(1);
    expect(history.depth.undo).toBe(1);
    expect(JSON.parse(host.serialize()).body[1].items[2]).toEqual({
      t: 'p',
      text: 'three',
      rev: 'ins'
    });
    expect(JSON.parse(host.serialize()).body[1].items[1].x).toBe('n');
  });

  it('applies formatting immediately, untracked, and proves it against the expected rejection', () => {
    const { host, run } = setup(bold);
    const r = run();
    expect(r.outcome).toBe('committed');
    if (r.outcome !== 'committed') return;
    expect([r.plan.landed, r.warnings.map((w) => w.code)]).toEqual([
      'immediate',
      ['immediate-not-tracked']
    ]);
    expect(JSON.parse(host.serialize()).body[1].items[0]).toEqual({
      t: 'p',
      text: 'one',
      bold: true
    });
  });

  it('rolls back byte-equal when a seam throws partway', () => {
    const { host, history, run } = setup(retitle);
    host.failNextSeam = 'text';
    const r = run();
    expect(r.outcome).toBe('apply-failed');
    if (r.outcome !== 'apply-failed') return;
    expect(r.error).toBe('text: placement failed');
    expect(r.rollback).toEqual({
      byteEqual: true,
      via: 'editor-undo',
      undoSteps: 1
    });
    expect(host.serialize()).toBe(doc);
    expect(history.depth.undo).toBe(0);
  });

  it('rolls back byte-equal when the proof fails, and pushes no history', () => {
    const { host, history, run } = setup(addItem);
    host.corruptNextSeam = true;
    const r = run();
    expect(r.outcome).toBe('proof-failed');
    if (r.outcome !== 'proof-failed') return;
    expect(r.proof.landed).toBe(false);
    expect(r.rollback.byteEqual).toBe(true);
    expect(host.serialize()).toBe(doc);
    expect(history.depth.undo).toBe(0);
  });

  it('refuses a plan naming a seam the pack does not have, with nothing applied', () => {
    const host = new ToyHost(doc);
    const s = stateOf(doc);
    const pack = {
      ...s.pack,
      reconcile: {
        plan: () => ({
          steps: [{ seam: 'teleport', payload: null }],
          landed: 'card' as const,
          history: 'editor' as const
        })
      }
    };
    const out = reconcile({
      pack,
      host,
      history: new EngineHistory(),
      turnId: 't',
      intent: 'x',
      before: { view: s.view, residue: s.residue, native: doc },
      intended: { view: s.view, residue: s.residue }
    });
    expect(out.outcome).toBe('apply-failed');
    if (out.outcome === 'apply-failed') expect(out.error).toContain('teleport');
    expect(host.serialize()).toBe(doc);
  });
});
