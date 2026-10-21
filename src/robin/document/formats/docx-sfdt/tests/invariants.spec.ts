/**
 * Every pack invariant with a true positive (the write that breaks it is refused under its name)
 * and a true negative (a write that respects it is verified).
 */
import * as fs from 'fs';
import * as path from 'path';
import { WriteInput } from '../../../envelope';
import { DocumentSession } from '../../../session';
import { NfNode, baseOf, shapeOf } from '../../../tree';
import { prepareWrite } from '../../../verbs';
import { docxPack } from '../index';
import { docxTree } from '../tree';
import { arr } from '../util';

const flagship = fs.readFileSync(path.join(__dirname, 'corpus', 'flagship-v4b.sfdt.json'), 'utf8');
const state = () => {
  let doc = flagship;
  const host = { serialize: () => doc, open: (s: string) => { doc = s; }, canUndo: () => false, undo: () => {}, canRedo: () => false, redo: () => {}, readOnly: () => false };
  return new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'e' } }).state;
};
const s = state();
const node = (id: string) => s.view.get(id) as NfNode;
const b = (id: string) => baseOf(node(id));
const sh = (id: string) => shapeOf(node(id), docxTree);
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const run = (w: Partial<WriteInput>) => prepareWrite(state(), { intent: 'test', scope: { ids: [] }, ...w } as WriteInput);
const invariants = (r: ReturnType<typeof run>) =>
  r.outcome === 'refused' ? (r.refusal.problems ?? [r.refusal]).map((p) => p.invariant) : [r.outcome];

describe('pack invariants', () => {
  it('field-broken: a field begin removed alone is refused; the whole paragraph is not', () => {
    expect(invariants(run({ scope: { ids: ['n29'] }, changes: [{ kind: 'delete', id: 'n29', base: b('n29') }] }))).toEqual(['field-broken']);
    expect(invariants(run({ scope: { ids: ['n27'] }, changes: [{ kind: 'delete', id: 'n27', base: b('n27') }] }))).toEqual(['verified']);
  });

  it('table-geometry is reported, not refused: a ragged row is legal (ruling 5)', () => {
    const row = copy(node('n58'));
    (row.cells as NfNode[]).pop();
    const r = run({ scope: { ids: ['n58'] }, changes: [{ kind: 'replace', id: 'n58', base: b('n58'), node: row }] });
    expect(r.outcome).toBe('verified');
    if (r.outcome !== 'verified') return;
    expect(r.facts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'finalizer', name: 'table-geometry' })]));
    expect(r.warnings.map((w) => w.code)).toContain('table-ragged');
    // a row removed whole leaves the table even: no report
    const whole = run({ scope: { ids: ['n58'] }, changes: [{ kind: 'delete', id: 'n58', base: b('n58') }] });
    expect(whole.outcome).toBe('verified');
    if (whole.outcome === 'verified') expect(whole.warnings.map((w) => w.code)).not.toContain('table-ragged');
  });

  it('unknown-style: a style the document lacks is refused; one it has is not', () => {
    expect(invariants(run({ scope: { ids: ['n38'] }, changes: [{ kind: 'set', target: { ids: ['n38'], shape: { n38: sh('n38') } }, props: { styleName: 'No Such Style' } }] }))).toEqual(['unknown-style']);
    expect(invariants(run({ scope: { ids: ['n38'] }, changes: [{ kind: 'set', target: { ids: ['n38'], shape: { n38: sh('n38') } }, props: { styleName: 'Heading 2' } }] }))).toEqual(['verified']);
  });

  it('control: a block control written inside a paragraph is refused; an inline control is not', () => {
    const inline = copy(node('n10'));
    delete (inline as Partial<NfNode>).id;
    for (const c of arr<NfNode>(inline.inlines)) delete (c as Partial<NfNode>).id;
    const block = { kind: 'control', contentControlProperties: inline.contentControlProperties, blocks: [{ kind: 'paragraph', inlines: [] }] };
    expect(invariants(run({ scope: { ids: ['n9'] }, changes: [{ kind: 'insert_after', anchor: 'n9', container: sh('n8'), node: block }] }))).toContain('control');
    const plain = { kind: 'control', contentControlProperties: inline.contentControlProperties, inlines: [{ kind: 'run', text: 'x' }] };
    expect(invariants(run({ scope: { ids: ['n9'] }, changes: [{ kind: 'insert_after', anchor: 'n9', container: sh('n8'), node: plain }] }))).toEqual(['verified']);
  });

  it('binding: a malformed formula is refused; a valid rewrite is not', () => {
    const control = copy(node('n148'));
    control.binding = { ...(control.binding as object), expr: 'mul(units' };
    // the subtotal reading it fails too, which orphaned-dependents reports beside it
    expect(invariants(run({ scope: { ids: ['n148'] }, changes: [{ kind: 'replace', id: 'n148', base: b('n148'), node: control }] }))).toContain('binding');
    control.binding = { ...(control.binding as object), expr: 'sum(units,rate)' };
    expect(invariants(run({ scope: { ids: ['n148'] }, changes: [{ kind: 'replace', id: 'n148', base: b('n148'), node: control }] }))).toEqual(['verified']);
  });

  it('binding: a second table inside a bound table control is refused', () => {
    const table = copy(node('n119'));
    expect(invariants(run({ scope: { ids: ['n119'] }, changes: [{ kind: 'insert_after', anchor: 'n119', container: sh('n118'), node: table }] }))).toContain('binding');
  });

  it('orphaned-dependents: deleting what a formula reads is refused; deleting an unread row is not', () => {
    expect(invariants(run({ scope: { ids: ['n534'] }, changes: [{ kind: 'delete', id: 'n534', base: b('n534') }] }))).toEqual(['orphaned-dependents']);
    expect(invariants(run({ scope: { ids: ['n72'] }, changes: [{ kind: 'delete', id: 'n72', base: b('n72') }] }))).toEqual(['verified']);
  });

  it('every refusal names at least one card', () => {
    const r = run({ scope: { ids: ['n29'] }, changes: [{ kind: 'delete', id: 'n29', base: b('n29') }] });
    if (r.outcome !== 'refused') throw new Error('expected a refusal');
    for (const p of r.refusal.problems ?? [r.refusal]) expect(p.read.length).toBeGreaterThan(0);
  });
});
