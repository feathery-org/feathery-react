/**
 * Acceptance tests for the formulas finalizer's report, red until the fix lands (evidence phase).
 *
 * Staging, session c7efa827 (2026-10-15 20:03Z), Hilb PL proposal: a total control n335
 * (TotalAnnualPremium = sum(PropertyPremium, GeneralLiabilityPremium, AutoPremium), derived value
 * 34032) held run n336 "$34,032.00" and a trailing empty run n337. The model replaced the
 * PropertyPremium runs n149/n300 with "$9,488.00", declaring scope [n149, n300, n148, n299]:
 *
 *   1. refused, invariant "scope": "the change would touch 1 node(s) outside the declared scope:
 *      n337 (run) removed" - the finalizer re-rendered the total and dropped the empty run, and that
 *      removal was charged to the model's scope;
 *   2. with n335, n336, n337 added to the scope it committed, and the only report of the new total
 *      was {kind: "finalizer", name: "formulas", ids: ["n335", "n336"], summary: "1 bound value(s)
 *      recomputed or carried to their other occurrences"} - no name, no value; the reply then
 *      stated $32,520 where the engine had computed $33,520.
 *
 * The same shape on the Hilb PL Williams proposal (private corpus, ROBIN_DOCUMENT_PRIVATE_CORPUS):
 * TotalAnnualPremium = sum(IndianaAutomobilePremium, Homeowners4129W950NPremium) = 6931 in n955
 * (run n956 "$6,931.00"); the staging document's trailing empty run is added to it here, as the
 * generator wrote it on staging. Writing IndianaAutomobilePremium 4076 -> 5000 makes the total
 * 7855, "$7,855.00".
 */
import * as fs from 'fs';
import * as path from 'path';
import { WriteInput } from '../../../envelope';
import { DocumentSession } from '../../../session';
import { NfNode, baseOf, walk } from '../../../tree';
import { prepareWrite } from '../../../verbs';
import { docxPack } from '../index';
import { docxTree } from '../tree';

const williams = path.join(
  process.env.ROBIN_DOCUMENT_PRIVATE_CORPUS ?? '/nonexistent',
  'hilb-williams.sfdt.json'
);
const run = fs.existsSync(williams) ? it : it.skip;

/** The Williams proposal with the staging shape: an empty run after the total's text. */
function stagingShape(): string {
  const d = JSON.parse(fs.readFileSync(williams, 'utf8'));
  const visit = (x: unknown): void => {
    if (Array.isArray(x)) return x.forEach(visit);
    if (!x || typeof x !== 'object') return;
    const n = x as Record<string, any>;
    if (
      String(n.contentControlProperties?.tag ?? '').includes(
        'name=TotalAnnualPremium|'
      )
    )
      n.inlines.push({ characterFormat: {}, text: '' });
    Object.values(n).forEach(visit);
  };
  visit(d);
  return JSON.stringify(d);
}

function setup() {
  let doc = stagingShape();
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
  const named = (name: string) =>
    controls.filter((c) => (c.binding as { name: string }).name === name);
  const autos = named('IndianaAutomobilePremium');
  const total = named('TotalAnnualPremium')[0];
  const autoRuns = autos.map(
    (c) => (c.inlines as NfNode[]).find((i) => i.kind === 'run') as NfNode
  );
  const write = (scope: string[]): WriteInput =>
    ({
      intent: 'Change the automobile premium to $5,000.00.',
      scope: { ids: scope },
      changes: autoRuns.map((r) => ({
        kind: 'replace',
        id: r.id,
        base: baseOf(r),
        node: {
          kind: 'run',
          ...(r.style ? { style: r.style } : {}),
          text: '$5,000.00'
        }
      }))
    } as unknown as WriteInput);
  return { state, autos, autoRuns, total, write };
}

describe('the formulas finalizer reports what it recomputed (staging c7efa827)', () => {
  run(
    'write facts carry recomputed bound values: the total control, its binding name and its new value',
    () => {
      const { state, autos, autoRuns, total, write } = setup();
      const totalRuns = (total.inlines as NfNode[]).map((i) => i.id);
      // the scope that committed on staging: the model's own targets plus the total and its runs
      const r = prepareWrite(
        state,
        write([
          ...autoRuns.map((x) => x.id),
          ...autos.map((c) => c.id),
          total.id,
          ...totalRuns
        ])
      );
      expect(r.outcome).toBe('verified');
      if (r.outcome !== 'verified') return;
      const formulas = r.facts.filter(
        (f) => f.kind === 'finalizer' && f.name === 'formulas'
      );
      // Today (red): [{ kind: 'finalizer', name: 'formulas', ids: [<total>, <its run>],
      //   summary: '1 bound value(s) recomputed or carried to their other occurrences' }]
      // - a count, with no binding name and no value anywhere.
      const reported = JSON.stringify(formulas);
      expect(reported).toContain('TotalAnnualPremium');
      expect(reported).toMatch(/\$7,855\.00|7855/);
    }
  );

  run(
    'finalizer side effects are not charged to the declared scope: the model declares only its own targets',
    () => {
      const { state, autos, autoRuns, total, write } = setup();
      const r = prepareWrite(
        state,
        write([...autoRuns.map((x) => x.id), ...autos.map((c) => c.id)])
      );
      // Today (red): outcome 'refused', invariant 'scope', destroyed:
      //   "Nothing was applied: the change would touch 1 node(s) outside the declared scope:
      //    <the total's empty run> (run) removed."
      expect(r.outcome === 'refused' ? r.refusal : null).toBeNull();
      if (r.outcome !== 'verified') return;
      const formulas = r.finalizerScope.find((f) => f.name === 'formulas');
      expect(formulas?.ids).toEqual(expect.arrayContaining([total.id]));
      expect(r.touched).toEqual(expect.arrayContaining([total.id]));
    }
  );
});
