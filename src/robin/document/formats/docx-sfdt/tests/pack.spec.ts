/**
 * The pack through the engine, end to end, on the flagship document, with an editor stand-in that
 * holds the bytes (the splice path needs nothing more; the native seams run in the headless lane).
 */
import * as fs from 'fs';
import * as path from 'path';
import { ReadResult, VerbResult, validateVerbResult } from '../../../envelope';
import { clearPackRegistry, conformanceProblems, registerPack } from '../../../pack';
import { DocumentSession } from '../../../session';
import { baseOf, NfNode, shapeOf } from '../../../tree';
import { makeView } from '../../../view';
import { prepareWrite } from '../../../verbs';
import { docxPack } from '../index';
import { scanBindings } from '../../../../../elements/components/DocxEditor/bindings/core/sfdtAdapter';

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

function mount(doc = flagship) {
  const host = new ByteHost(doc);
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

  it('outlines at block level: every container with its shape prefix, rows and text boxes with a preview, no runs or cells', () => {
    const { session, call } = mount();
    const outline = call('outline', {}) as { lines: string; depth: number };
    const lines = outline.lines.split('\n');
    const kinds = new Set(lines.map((l) => l.trim().split(' ')[1]).filter(Boolean));
    expect(kinds.has('run')).toBe(false);
    expect(kinds.has('cell')).toBe(false);
    // the grammar: <id> <kind> [@<shape8>] <pack detail>, the shape on every container, never a base
    const view = session.state.view;
    for (const line of lines) {
      const m = /^\s*(n\d+) (\w+)(?: @([0-9a-f]{8}))?/.exec(line);
      if (!m) continue; // a story label
      const node = view.get(m[1]) as NfNode;
      const container = docxPack.tree.childLists(node).length > 0;
      expect([m[1], m[3] !== undefined]).toEqual([m[1], container]);
      if (m[3]) expect(shapeOf(node, docxPack.tree).startsWith(m[3])).toBe(true);
      // a node with no content below its own fields has one hash for both
      if (baseOf(node) !== shapeOf(node, docxPack.tree)) expect(line).not.toContain(baseOf(node).slice(0, 8));
    }
    // the cover title sits in a text box and a row's cells are joined: both findable from the outline
    expect(lines.find((l) => / shape @\w+ text box "Commercial Combined Insurance Proposal"$/.test(l))).toBeDefined();
    expect(lines.some((l) => / row @\w+ "Buildings \| 12 \| \$640\.50 \| \$7,686\.00"/.test(l))).toBe(true);
    // find still searches the full text, not the preview
    expect((call('find', { text: 'valid from' }) as { total: number }).total).toBeGreaterThan(0);
    // the flagship outline stays small: about 3.7k tokens at three characters a token
    expect(outline.lines.length).toBeLessThan(12000);
    // an explicit depth renders every kind
    expect((call('outline', { depth: 6 }) as { lines: string }).lines).toMatch(/ run "/);
  });

  it('accepts the outline\'s shape prefix as a container in a write', () => {
    const { call, next } = mount();
    const lines = (call('outline', {}) as { lines: string }).lines.split('\n');
    const [, id, shape8] = /^\s*(n\d+) table @([0-9a-f]{8})/.exec(lines.find((l) => / table @/.test(l)) as string) as RegExpExecArray;
    const table = nodeOf(call('read', { ids: [id] }), id) as unknown as { rows: Array<Record<string, unknown>> };
    const row = table.rows[1];
    const copy = JSON.parse(JSON.stringify(row, (k, v) => (k === 'id' || k === 'base' || k === 'shape' ? undefined : v)));
    next();
    const r = call('write', { intent: 'Add a line.', scope: { ids: [String(row.id)] }, changes: [{ kind: 'insert_after', anchor: row.id, container: shape8, node: copy }] }) as { ok: boolean };
    expect(r).toEqual(expect.objectContaining({ ok: true }));
  });

  it('a span aimed at a run names its paragraph and where the text reads there (matrix-1 T1)', () => {
    const { session, call } = mount();
    const para = session.state.view.nodes().find((n) => n.kind === 'paragraph' && /valid from/.test(JSON.stringify(n))) as NfNode;
    const run = (para.inlines as NfNode[]).find((i) => i.kind === 'run' && /valid from/.test(String(i.text))) as NfNode;
    const r = call('write', { intent: 'Bold it.', scope: { ids: [run.id] }, changes: [{ kind: 'set', target: { id: run.id, shape: shapeOf(run, docxPack.tree), match: { text: 'valid from', span: { start: 0, end: 10 } } }, props: { bold: true } }] }) as { ok: boolean; refusal: { hint: string } };
    expect(r.ok).toBe(false);
    expect(r.refusal.hint).toMatch(new RegExp(`${para.id} reads "valid from" at \\[\\d+, \\d+\\)`));
  });

  it('finds a formula by its feature whatever the control is titled (QA-1: the client titles controls by name)', () => {
    const control = (tag: string, title: string, text: string) => ({ inlines: [{ text }], contentControlProperties: { lockContents: true, tag, color: '#00000000', title, type: 'Text' } });
    const doc = JSON.stringify({
      sections: [
        {
          blocks: [
            { inlines: [{ text: 'Auto ' }, control('[[name=AutoPremium|type=currency]]', 'AutoPremium', '$1,000.00')] },
            { inlines: [{ text: 'Home ' }, control('[[name=HomePremium|type=currency]]', 'HomePremium', '$2,000.00')] },
            { inlines: [{ text: 'Total ' }, control('[[name=TotalAnnualPremium|expr=sum(AutoPremium,HomePremium)]]', 'TotalAnnualPremium', '$3,000.00')] }
          ]
        }
      ]
    });
    const { call } = mount(doc);
    const all = call('find', { feature: { name: 'formula' } }) as { total: number; hits: Array<{ kind: string }> };
    expect(all.total).toBe(1);
    expect(all.hits[0].kind).toBe('control');
    expect((call('find', { feature: { name: 'formula', value: 'TotalAnnualPremium' } }) as { total: number }).total).toBe(1);
    expect((call('find', { feature: { name: 'binding' } }) as { total: number }).total).toBe(3);
  });

  const williams = path.join(process.env.ROBIN_DOCUMENT_PRIVATE_CORPUS ?? '/nonexistent', 'hilb-williams.sfdt.json');
  (fs.existsSync(williams) ? it : it.skip)('finds the client document\'s TotalAnnualPremium formula (private corpus only)', () => {
    const { call } = mount(fs.readFileSync(williams, 'utf8'));
    expect((call('find', { feature: { name: 'formula', value: 'TotalAnnualPremium' } }) as { total: number }).total).toBe(1);
  });

  it('a rewritten formula pending as a tracked replacement counts once: the old control is paired by its marker', () => {
    const { host, session, call } = mount();
    const control = session.state.view.nodes().find((n) => n.kind === 'control' && typeof (n.binding as { expr?: unknown } | undefined)?.expr === 'string' && Array.isArray(n.inlines)) as NfNode;
    const name = String((control.binding as { name: string }).name);
    const count = () => scanBindings(JSON.parse(host.doc)).occurrences.filter((o) => o.name === name).length;
    const before = count();
    expect(before).toBeGreaterThan(0);
    const read = nodeOf(call('read', { ids: [control.id] }), control.id) as unknown as Record<string, unknown>;
    const node = JSON.parse(JSON.stringify(read, (k, v) => (['base', 'shape', 'usedBy', 'derived', 'pending'].includes(k) ? undefined : v)));
    node.binding = { ...node.binding, expr: `mul(${node.binding.expr},1)` };
    const r = call('write', { intent: 'Write the formula out.', scope: { ids: [control.id] }, changes: [{ kind: 'replace', id: control.id, base: read.base, node }] }) as { ok: boolean };
    expect(r.ok).toBe(true);
    // both controls are in the document until the card is resolved; the bindings count the new one
    expect(count()).toBe(before);
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

  it('carries an edited field to its other occurrences', () => {
    const { host, call } = mount();
    const control = nodeOf(call('read', { ids: ['n15'] }), 'n15');
    const run = (control.inlines as Array<{ id: string; text: string }>)[0];
    const r = call('write', {
      intent: 'Rename the client.',
      scope: { ids: [run.id] },
      changes: [{ kind: 'replace', id: run.id, base: (run as unknown as { base: string }).base, node: { ...JSON.parse(JSON.stringify(run)), base: undefined, shape: undefined, text: 'Contoso Foods' } }]
    }) as { ok: boolean; facts: Array<{ name?: string; ids: string[] }>; refusal?: unknown };
    expect(r.refusal).toBeUndefined();
    expect(r.facts.find((f) => f.name === 'formulas')?.ids.length).toBeGreaterThan(1);
    expect((host.doc.match(/Contoso Foods/g) ?? []).length).toBeGreaterThan(2);
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

  it('a write that changes nothing lands nothing', () => {
    const p = planFor(() => undefined);
    expect([p.steps, p.landed]).toEqual([[], 'immediate']);
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
