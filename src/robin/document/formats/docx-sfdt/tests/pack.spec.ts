/**
 * The pack through the engine, end to end, on the flagship document, with an editor stand-in that
 * holds the bytes (the splice path needs nothing more; the native seams run in the headless lane).
 */
import * as fs from 'fs';
import * as path from 'path';
import { ReadResult, VerbResult, validateVerbResult } from '../../../envelope';
import { clearPackRegistry, conformanceProblems, registerPack } from '../../../pack';
import { DocumentSession } from '../../../session';
import { NfNode } from '../../../tree';
import { makeView } from '../../../view';
import { prepareWrite } from '../../../verbs';
import { docxPack } from '../index';

const corpus = path.join(__dirname, 'corpus');
const flagship = fs.readFileSync(path.join(corpus, 'flagship-v4b.sfdt.json'), 'utf8');

class ByteHost {
  doc: string;
  opens = 0;
  constructor(doc: string) {
    this.doc = doc;
  }
  serialize() {
    return this.doc;
  }
  open(s: string) {
    this.doc = s;
    this.opens += 1;
  }
  canUndo() {
    return false;
  }
  undo() {}
  canRedo() {
    return false;
  }
  redo() {}
  readOnly() {
    return false;
  }
}

function mount() {
  const host = new ByteHost(flagship);
  const session = new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'env' }, editorId: 'ed' });
  let turn = 0;
  const call = (verb: string, input: unknown): VerbResult => {
    const out = session.dispatch({ protocolVersion: 1, turnId: `turn-${turn}`, editorId: 'ed', target: { type: 'envelope', id: 'env' }, verb, input });
    if (out.status !== 'ok') throw new Error(JSON.stringify(out.failure));
    expect(validateVerbResult(verb as never, out.response.result)).toEqual({ ok: true });
    return out.response.result;
  };
  return { host, session, call, next: () => (turn += 1) };
}
const nodeOf = (r: VerbResult, id: string) => (r as ReadResult).nodes.find((n) => n.id === id) as ReadResult['nodes'][number];

afterEach(() => clearPackRegistry());

describe('the format pack', () => {
  it('is complete and passes the conformance suite over the corpus', () => {
    const fixtures = Object.fromEntries(fs.readdirSync(corpus).map((f) => [f, fs.readFileSync(path.join(corpus, f), 'utf8')]));
    expect(conformanceProblems(docxPack, fixtures)).toEqual([]);
    expect(() => registerPack(docxPack)).not.toThrow();
  });

  it('describes the document and reads bindings with their readers and computed values', () => {
    const { session, call } = mount();
    expect(session.descriptor()).toEqual(expect.objectContaining({ format: 'docx-sfdt', readOnly: false }));
    const row = nodeOf(call('read', { ids: ['n133'] }), 'n133');
    const cells = JSON.stringify(row);
    expect(cells).toContain('"name":"line_total"');
    expect(cells).toContain('"usedBy":["n228"]');
    expect(cells).toContain('"derived":{"value":"7686');
    const hits = call('find', { text: 'stock' }) as { hits: Array<{ id: string; kind: string }> };
    expect(hits.hits.some((h) => h.kind === 'paragraph')).toBe(true);
    const formulas = call('find', { feature: { name: 'formula' } }) as { total: number };
    expect(formulas.total).toBeGreaterThan(10);
  });

  it('refuses deleting a bound table that formulas read, naming them (WP2 T9)', () => {
    const { call } = mount();
    const control = nodeOf(call('read', { ids: ['n534'] }), 'n534');
    const r = call('write', { intent: 'Delete the motor table.', scope: { ids: ['n534'] }, changes: [{ kind: 'delete', id: 'n534', base: control.base }] }) as {
      ok: boolean;
      refusal: { invariant: string; read: string[]; destroyed: string; problems?: Array<{ invariant: string }> };
    };
    expect(r.ok).toBe(false);
    expect(r.refusal.invariant).toBe('orphaned-dependents');
    expect(r.refusal.read).toEqual(['binding', 'formula']);
    expect(r.refusal.destroyed).toContain('summary_subtotal');
  });

  it('copies a bound row: new identity minted, formulas recomputed, committed by splice and proved', () => {
    const { host, call } = mount();
    const read = call('read', { ids: ['n169', 'n119'] });
    const row = nodeOf(read, 'n169');
    const table = nodeOf(read, 'n119');
    const strip = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).filter(([k]) => !['base', 'shape', 'usedBy', 'derived'].includes(k)).map(([k, x]) => [k, strip(x)])) : v;
    const result = call('write', {
      intent: 'Add another Stock line to the property premium table.',
      scope: { ids: ['n169'] },
      changes: [{ kind: 'insert_after', anchor: 'n169', container: table.shape, node: strip(row) }]
    }) as { ok: boolean; committed: boolean; landed: string; facts: Array<{ kind: string; name?: string; summary: string }>; trace: { committed: { seams: string[] }; proof: { outcome: string } }; refusal?: unknown };
    expect(result.refusal).toBeUndefined();
    expect(result).toEqual(expect.objectContaining({ ok: true, committed: true, landed: 'card' }));
    expect(result.trace.committed.seams).toEqual(['splice']);
    expect(result.trace.proof.outcome).toBe('passed');
    // the Stock row holds the start of a bookmark the table keeps: the copy leaves it out
    expect(result.facts.map((f) => f.name ?? f.kind)).toEqual(expect.arrayContaining(['inserted', 'bookmarks', 'rows', 'formulas']));
    expect(host.opens).toBe(1);
    // the spliced document carries Robin's insertion, grouped under the turn
    const doc = JSON.parse(host.doc);
    expect(doc.revisions).toEqual(expect.arrayContaining([expect.objectContaining({ revisionType: 'Insertion', author: 'Robin', customData: expect.stringContaining('"changeSetId":"turn-0"') })]));
    const outline = (call('outline', { depth: 4 }) as { lines: string }).lines;
    expect(outline).toMatch(/row=property-r4/);
  });

  it('refuses separating a bookmark start from its end', () => {
    const { call } = mount();
    const start = nodeOf(call('read', { ids: ['n172'] }), 'n172');
    expect(start.kind).toBe('bookmark');
    const r = call('write', { intent: 'Remove the bookmark start.', scope: { ids: ['n172'] }, changes: [{ kind: 'delete', id: 'n172', base: start.base }] }) as { refusal: { invariant: string } };
    expect(r.refusal.invariant).toBe('bookmark-pair-broken');
  });

  it('inserts a paragraph and deletes another by splice, reversibly', () => {
    const { call } = mount();
    const read = call('read', { ids: ['n36', 'n38', 'n35'] });
    const heading = nodeOf(read, 'n36');
    const section = nodeOf(read, 'n35');
    const body = nodeOf(read, 'n38');
    const r = call('write', {
      intent: 'Add an introduction line and drop the conditions paragraph.',
      scope: { ids: ['n38'] },
      changes: [
        { kind: 'insert_after', anchor: 'n36', container: section.shape, node: { style: body.style, markStyle: body.markStyle, inlines: [{ text: 'This section covers buildings, contents and stock.' }] } },
        { kind: 'delete', id: 'n38', base: body.base }
      ]
    }) as { ok: boolean; trace: { proof: { outcome: string; reversible: boolean } }; refusal?: unknown };
    expect(r.refusal).toBeUndefined();
    expect(r.trace.proof).toEqual(expect.objectContaining({ outcome: 'passed', reversible: true }));
    expect(heading.kind).toBe('paragraph');
  });
});

describe('the commit plan', () => {
  const planFor = (edit: (nf: { root: NfNode; formats: Record<string, Record<string, unknown>> }) => void) => {
    const host = new ByteHost(flagship);
    const session = new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'env' } });
    const state = session.state;
    const intended = JSON.parse(JSON.stringify(state.view.nf));
    edit(intended);
    return docxPack.reconcile.plan({
      turnId: 't',
      before: state.view,
      intended: makeView(intended, docxPack),
      beforeResidue: state.residue,
      intendedResidue: state.residue,
      beforeNative: flagship
    });
  };
  const find = (n: NfNode, id: string): NfNode | null => {
    if (n.id === id) return n;
    for (const v of Object.values(n)) {
      const kids = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v as object).flatMap((x) => (Array.isArray((x as { blocks?: unknown }).blocks) ? (x as { blocks: NfNode[] }).blocks : [])) : [];
      for (const k of kids as NfNode[]) if (k && typeof k === 'object' && typeof k.id === 'string') {
        const hit = find(k, id);
        if (hit) return hit;
      }
    }
    return null;
  };

  it('a text change inside a body paragraph is the native tracked text seam', () => {
    const p = planFor((nf) => {
      (find(nf.root, 'n39') as NfNode).text = 'Cover is subject to the general conditions in the schedule.';
    });
    expect([p.steps.map((s) => s.seam), p.landed, p.history]).toEqual([['text'], 'card', 'editor']);
    const [op] = p.steps[0].payload as Array<{ hi: string; oldMid: string; newMid: string }>;
    expect(op.hi).toBe('1;1');
    expect(op.oldMid.length).toBeGreaterThan(0);
  });

  it('a character format change is the native format seam, landing immediately', () => {
    const p = planFor((nf) => {
      nf.formats.fBold = { bold: true };
      (find(nf.root, 'n39') as NfNode).style = 'fBold';
    });
    expect([p.steps.map((s) => s.seam), p.landed]).toEqual([['format'], 'immediate']);
  });

  it('table structure and header text are spliced', () => {
    const row = planFor((nf) => {
      const table = find(nf.root, 'n50') as NfNode;
      (table.rows as NfNode[]).pop();
    });
    expect([row.steps.map((s) => s.seam), row.history]).toEqual([['splice'], 'engine']);
    const header = planFor((nf) => {
      (find(nf.root, 'n23') as NfNode).text = 'Proposal for';
    });
    expect(header.steps.map((s) => s.seam)).toEqual(['splice']);
  });
});

describe('verifying a write the model got wrong', () => {
  it('refuses a new bound table placed inside an existing bound table control', () => {
    const host = new ByteHost(flagship);
    const session = new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'env' } });
    const state = session.state;
    const table = state.view.get('n119') as NfNode;
    const r = prepareWrite(state, {
      intent: 'Split the table.',
      scope: { ids: ['n119'] },
      changes: [{ kind: 'insert_after', anchor: 'n119', container: 'x', node: { kind: 'table', rows: (table.rows as NfNode[]).slice(0, 1).map((x) => JSON.parse(JSON.stringify(x))) } }]
    } as never);
    expect(r.outcome).not.toBe('verified');
  });
});
