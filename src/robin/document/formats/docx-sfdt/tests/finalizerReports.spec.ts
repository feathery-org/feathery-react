/**
 * What a finalizer derives is the engine's to report and to declare (advisor ruling A and A2,
 * after staging session c7efa827; `writeFacts.spec.ts` holds the staging shape itself):
 *
 * A: every value derived as a consequence of a write (recomputed, carried to another occurrence,
 *    re-rendered in its type's display) is reported in the write's facts by node id with the text
 *    that node now reads.
 * A2: scope bounds what the model's changes touch; whatever a finalizer touches, in any way
 *    (changed, removed, created, moved), is the engine's declaration, derived by diff.
 *
 * Each rule is proved here on the committed flagship, on shapes other than the staging one.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Fact, WriteInput } from '../../../envelope';
import { DocumentSession } from '../../../session';
import { NfNode, baseOf, shapeOf, walk } from '../../../tree';
import { prepareWrite } from '../../../verbs';
import { docxPack } from '../index';
import { docxTree } from '../tree';
import { arr } from '../util';

const flagship = fs.readFileSync(
  path.join(__dirname, 'corpus', 'flagship-v4b.sfdt.json'),
  'utf8'
);

function stateOf(native: string) {
  let doc = native;
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
  return new DocumentSession({
    pack: docxPack,
    host,
    target: { type: 'envelope', id: 'env' }
  }).state;
}
const controlsNamed = (root: NfNode, name: string): NfNode[] => {
  const out: NfNode[] = [];
  walk(root, docxTree, ({ node }) => {
    if (
      node.kind === 'control' &&
      (node.binding as { name?: string } | undefined)?.name === name
    )
      out.push(node);
  });
  return out;
};
const firstRun = (c: NfNode) =>
  arr<NfNode>(c.inlines).find((i) => i.kind === 'run') as NfNode;
const replaceText = (r: NfNode, text: string) => ({
  kind: 'replace',
  id: r.id,
  base: baseOf(r),
  node: { kind: 'run', ...(r.style ? { style: r.style } : {}), text }
});
const formulasDetail = (facts: Fact[]) =>
  (
    facts.find((f) => f.kind === 'finalizer' && f.name === 'formulas') as
      | (Fact & {
          detail?: Array<{
            id: string;
            name?: string;
            before?: string;
            after?: string;
          }>;
        })
      | undefined
  )?.detail ?? [];

describe('A: the facts report every value a finalizer derived, by node, with its text', () => {
  it('(a) a field edited at one occurrence: every carried occurrence with its new text', () => {
    const s = stateOf(flagship);
    const [edited, ...others] = controlsNamed(s.view.nf.root, 'client_name');
    expect(others.length).toBeGreaterThan(0);
    const run = firstRun(edited);
    const r = prepareWrite(s, {
      intent: 'Rename the client.',
      scope: { ids: [run.id] },
      changes: [replaceText(run, 'Contoso Foods')]
    } as unknown as WriteInput);
    if (r.outcome !== 'verified')
      throw new Error(JSON.stringify(r).slice(0, 600));
    const detail = formulasDetail(r.facts);
    for (const other of others)
      expect(detail).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: other.id,
            name: 'client_name',
            before: 'Northwind Grocers',
            after: 'Contoso Foods'
          })
        ])
      );
  });

  it("(b) a row added to a bound table: the new row's formula cells and every aggregate that moved", () => {
    const s = stateOf(flagship);
    const table = s.view.get('n119') as NfNode;
    const row = s.view.get('n169') as NfNode;
    const strip = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(strip)
        : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v as object)
              .filter(
                ([k]) =>
                  !['id', 'base', 'shape', 'usedBy', 'derived'].includes(k)
              )
              .map(([k, x]) => [k, strip(x)])
          )
        : v;
    const subtotal = controlsNamed(s.view.nf.root, 'property_premium_subtotal');
    const r = prepareWrite(s, {
      intent: 'Add another Stock line.',
      scope: { ids: [] },
      changes: [
        {
          kind: 'insert_after',
          anchor: row.id,
          container: shapeOf(table, docxTree),
          node: strip(row)
        }
      ]
    } as unknown as WriteInput);
    if (r.outcome !== 'verified')
      throw new Error(JSON.stringify(r).slice(0, 600));
    const detail = formulasDetail(r.facts);
    // every occurrence of the subtotal that moved is listed with the text it now reads
    for (const c of subtotal) {
      const entry = detail.find((d) => d.id === c.id);
      expect(entry).toEqual(
        expect.objectContaining({
          name: 'property_premium_subtotal',
          before: firstRun(c).text
        })
      );
      expect(entry?.after).not.toBe(entry?.before);
    }
    // the new row's own formula cells (a line total) are listed too
    expect(
      detail.some((d) => !s.view.get(d.id) && /line_total/.test(String(d.name)))
    ).toBe(true);
  });

  it('(c) a type re-render: "3000000" typed into a currency field reads "$3,000,000.00" in the fact', () => {
    const s = stateOf(flagship);
    const [limit] = controlsNamed(s.view.nf.root, 'property_limit');
    const run = firstRun(limit);
    const r = prepareWrite(s, {
      intent: 'Raise the limit.',
      scope: { ids: [run.id] },
      changes: [replaceText(run, '3000000')]
    } as unknown as WriteInput);
    if (r.outcome !== 'verified')
      throw new Error(JSON.stringify(r).slice(0, 600));
    expect(formulasDetail(r.facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: limit.id,
          name: 'property_limit',
          after: '$3,000,000.00'
        })
      ])
    );
  });
});

describe("A2: what a finalizer touches is never charged to the model's scope", () => {
  it('a field fan-out whose carried occurrences lose their extra runs commits with only the edited run declared', () => {
    // the other occurrences of client_name each carry an extra empty run, as the staging generator wrote
    const d = JSON.parse(flagship);
    let seen = 0;
    const visit = (x: unknown): void => {
      if (Array.isArray(x)) return x.forEach(visit);
      if (!x || typeof x !== 'object') return;
      const n = x as Record<string, any>;
      if (
        String(n.contentControlProperties?.tag ?? '').includes(
          'name=client_name'
        ) &&
        Array.isArray(n.inlines) &&
        seen++ > 0
      )
        n.inlines.push({ characterFormat: {}, text: '' });
      Object.values(n).forEach(visit);
    };
    visit(d);
    const s = stateOf(JSON.stringify(d));
    const [edited, ...others] = controlsNamed(s.view.nf.root, 'client_name');
    const extra = others.flatMap((c) =>
      arr<NfNode>(c.inlines)
        .filter((i) => i.kind === 'run' && i.text === '')
        .map((i) => i.id)
    );
    expect(extra.length).toBeGreaterThan(0);
    const run = firstRun(edited);
    const r = prepareWrite(s, {
      intent: 'Rename the client.',
      scope: { ids: [run.id] },
      changes: [replaceText(run, 'Contoso Foods')]
    } as unknown as WriteInput);
    expect(r.outcome === 'refused' ? r.refusal : null).toBeNull();
    if (r.outcome !== 'verified') return;
    expect(r.touched).toEqual(expect.arrayContaining(extra));
    expect(r.finalizerScope.find((f) => f.name === 'formulas')?.ids).toEqual(
      expect.arrayContaining(extra)
    );
  });

  it("a row added to a banded table commits with nothing declared: restripe's and the formulas' touches are the engine's", () => {
    const s = stateOf(flagship);
    const control = arr<NfNode>(
      arr<NfNode>(s.view.nf.root.sections)[3].blocks
    )[10];
    const table = arr<NfNode>(control.blocks)[0];
    const rows = arr<NfNode>(table.rows);
    const body = rows[2];
    const strip = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(strip)
        : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v as object)
              .filter(
                ([k]) =>
                  !['id', 'base', 'shape', 'usedBy', 'derived'].includes(k)
              )
              .map(([k, x]) => [k, strip(x)])
          )
        : v;
    const r = prepareWrite(s, {
      intent: 'Add a line.',
      scope: { ids: [] },
      changes: [
        {
          kind: 'insert_after',
          anchor: rows[1].id,
          container: shapeOf(table, docxTree),
          node: strip(body)
        }
      ]
    } as unknown as WriteInput);
    expect(r.outcome === 'refused' ? r.refusal : null).toBeNull();
    if (r.outcome !== 'verified') return;
    const restripe =
      r.finalizerScope.find((f) => f.name === 'restripe')?.ids ?? [];
    expect(restripe.length).toBeGreaterThan(0);
    expect(r.touched).toEqual(expect.arrayContaining(restripe));
  });

  it('a column added to a table that fits commits with only the new cells written: column fit narrows the others', () => {
    const s = stateOf(flagship);
    const table = s.view.get('n119') as NfNode;
    const rows = arr<NfNode>(table.rows);
    const lasts = rows.map(
      (r) => arr<NfNode>(r.cells)[arr<NfNode>(r.cells).length - 1]
    );
    const r = prepareWrite(s, {
      intent: 'Add a column.',
      scope: { ids: [] },
      changes: lasts.map((c, i) => ({
        kind: 'insert_after',
        anchor: c.id,
        container: shapeOf(rows[i], docxTree),
        node: {
          kind: 'cell',
          style: c.style,
          blocks: [
            { kind: 'paragraph', inlines: [{ kind: 'run', text: 'New' }] }
          ]
        }
      }))
    } as unknown as WriteInput);
    expect(r.outcome === 'refused' ? r.refusal : null).toBeNull();
    if (r.outcome !== 'verified') return;
    const fitted =
      r.finalizerScope.find((f) => f.name === 'column-fit')?.ids ?? [];
    expect(fitted.length).toBeGreaterThan(0);
    expect(r.touched).toEqual(expect.arrayContaining(fitted));
  });
});

describe('a content key offered to set points at replace', () => {
  it('set text on a run is refused, and the hint says to replace the run', () => {
    const s = stateOf(flagship);
    const run = firstRun(controlsNamed(s.view.nf.root, 'client_name')[0]);
    const r = prepareWrite(s, {
      intent: 'x',
      scope: { ids: [run.id] },
      changes: [
        {
          kind: 'set',
          target: {
            ids: [run.id],
            shape: { [run.id]: shapeOf(run, docxTree) }
          },
          props: { text: 'Contoso Foods' }
        }
      ]
    } as unknown as WriteInput);
    expect(r.outcome).toBe('refused');
    if (r.outcome !== 'refused') return;
    expect(r.refusal.invariant).toBe('property-invalid');
    expect(r.refusal.hint).toMatch(/replace/);
  });
});
