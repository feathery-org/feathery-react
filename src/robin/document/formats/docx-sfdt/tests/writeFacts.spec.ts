/**
 * Acceptance tests for the formulas finalizer's report, on the shape a staging session produced: a
 * total control (a binding whose expression sums other bound fields) held its value in one run and a
 * trailing empty run. The model rewrote one summed field at every occurrence, declaring only its
 * own targets:
 *
 *   1. the write was refused, invariant "scope": the formulas finalizer re-rendered the total and
 *      dropped its empty run, and that removal was charged to the model's scope;
 *   2. with the total and its runs added to the scope it committed, and the only report of the new
 *      total was a count ("1 bound value(s) recomputed or carried to their other occurrences"): no
 *      name and no value, so the reply stated a total the engine had not computed.
 *
 * The document is a client proposal, so it never enters the repo: the tests run on the first
 * document in the private corpus (ROBIN_DOCUMENT_PRIVATE_CORPUS) holding such a total, add the
 * trailing empty run the generator wrote on staging, and read every name and value from the
 * document at run time.
 */
import * as fs from 'fs';
import * as path from 'path';
import { WriteInput } from '../../../envelope';
import { DocumentSession } from '../../../session';
import { NfNode, baseOf, walk } from '../../../tree';
import { prepareWrite } from '../../../verbs';
import { docxPack } from '../index';
import { docxTree } from '../tree';

/** A bound control's tag naming a total: an expression summing other bound fields. */
const SUM_TAG = /\|expr=sum\(([^)]*)\)/;

const corpus = process.env.ROBIN_DOCUMENT_PRIVATE_CORPUS;
const withTotal = (() => {
  if (!corpus || !fs.existsSync(corpus)) return null;
  for (const file of fs.readdirSync(corpus).sort())
    if (file.endsWith('.sfdt.json')) {
      const text = fs.readFileSync(path.join(corpus, file), 'utf8');
      if (SUM_TAG.test(text)) return text;
    }
  return null;
})();
const run = withTotal ? it : it.skip;

/** The document with the staging shape: an empty run after each total's text. */
function stagingShape(native: string): string {
  const d = JSON.parse(native);
  const visit = (x: unknown): void => {
    if (Array.isArray(x)) return x.forEach(visit);
    if (!x || typeof x !== 'object') return;
    const n = x as Record<string, any>;
    if (SUM_TAG.test(String(n.contentControlProperties?.tag ?? '')))
      n.inlines.push({ characterFormat: {}, text: '' });
    Object.values(n).forEach(visit);
  };
  visit(d);
  return JSON.stringify(d);
}

const firstRun = (c: NfNode) =>
  (c.inlines as NfNode[]).find((i) => i.kind === 'run') as NfNode;
const amount = (text: unknown) => Number(String(text).replace(/[^0-9.-]/g, ''));
const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

function setup() {
  let doc = stagingShape(withTotal as string);
  const host = {
    serialize: () => doc,
    open: (x: string) => {
      doc = x;
    },
    canUndo: () => false,
    undo: () => {},
    canRedo: () => false,
    redo: () => {},
    readOnly: () => false
  };
  const state = new DocumentSession({
    pack: docxPack,
    host,
    target: { type: 'envelope', id: 'env' }
  }).state;
  const controls: NfNode[] = [];
  walk(state.view.nf.root, docxTree, ({ node }) => {
    if (
      node.kind === 'control' &&
      (node.binding as { name?: string } | undefined)?.name
    )
      controls.push(node);
  });
  const binding = (c: NfNode) => c.binding as { name: string; expr?: unknown };
  const named = (name: string) =>
    controls.filter((c) => binding(c).name === name);
  // the total, by role: the control whose expression sums the others
  const total = controls.find((c) =>
    /^sum\(/.test(String(binding(c).expr ?? ''))
  ) as NfNode;
  const operands = String(binding(total).expr)
    .replace(/^sum\(|\)$/g, '')
    .split(',')
    .map((s) => s.trim());
  // the summed field the model rewrites: the first one the document shows
  const field = operands.find((name) => named(name).length) as string;
  const fieldControls = named(field);
  const fieldRuns = fieldControls.map(firstRun);
  const was = amount(fieldRuns[0].text);
  const now = was + 1000;
  const totalBefore = (total.inlines as NfNode[])
    .filter((i) => i.kind === 'run')
    .map((i) => String(i.text ?? ''))
    .join('');
  const write = (scope: string[]): WriteInput =>
    ({
      intent: `Change ${field} to ${usd(now)}.`,
      scope: { ids: scope },
      changes: fieldRuns.map((r) => ({
        kind: 'replace',
        id: r.id,
        base: baseOf(r),
        // as staging sent it: the run's own id and style inside the written node
        node: {
          id: r.id,
          kind: 'run',
          ...(r.style ? { style: r.style } : {}),
          text: usd(now)
        }
      }))
    } as unknown as WriteInput);
  return {
    state,
    total,
    totalName: binding(total).name,
    totalBefore,
    totalAfter: amount(totalBefore) - was + now,
    fieldControls,
    fieldRuns,
    write
  };
}

describe('the formulas finalizer reports what it recomputed (staging c7efa827)', () => {
  run(
    'write facts carry recomputed bound values: the total control, its binding name and its new value',
    () => {
      const {
        state,
        total,
        totalName,
        totalBefore,
        totalAfter,
        fieldControls,
        fieldRuns,
        write
      } = setup();
      const totalRuns = (total.inlines as NfNode[]).map((i) => i.id);
      // the scope that committed on staging: the model's own targets plus the total and its runs
      const r = prepareWrite(
        state,
        write([
          ...fieldRuns.map((x) => x.id),
          ...fieldControls.map((c) => c.id),
          total.id,
          ...totalRuns
        ])
      );
      expect(r.outcome).toBe('verified');
      if (r.outcome !== 'verified') return;
      const formulas = r.facts.find(
        (f) => f.kind === 'finalizer' && f.name === 'formulas'
      ) as { detail?: Array<Record<string, unknown>> } | undefined;
      // before the fix: a count only, with no binding name and no value anywhere
      const entry = formulas?.detail?.find((d) => d.id === total.id);
      expect(entry).toEqual(
        expect.objectContaining({ name: totalName, before: totalBefore })
      );
      expect(amount(entry?.after)).toBe(totalAfter);
    }
  );

  run(
    'finalizer side effects are not charged to the declared scope: the model declares only its own targets',
    () => {
      const { state, total, fieldControls, fieldRuns, write } = setup();
      const r = prepareWrite(
        state,
        write([
          ...fieldRuns.map((x) => x.id),
          ...fieldControls.map((c) => c.id)
        ])
      );
      // before the fix: refused, invariant 'scope', the total's empty run removed outside the scope
      expect(r.outcome === 'refused' ? r.refusal : null).toBeNull();
      if (r.outcome !== 'verified') return;
      const formulas = r.finalizerScope.find((f) => f.name === 'formulas');
      expect(formulas?.ids).toEqual(expect.arrayContaining([total.id]));
      expect(r.touched).toEqual(expect.arrayContaining([total.id]));
    }
  );
});
