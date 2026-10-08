/**
 * The restripe finalizer: rows that move band take their band's fill, and a cell that already has
 * its band's fill keeps its format entry exactly, whichever way the editor spelled "no fill".
 */
import * as fs from 'fs';
import * as path from 'path';
import { WriteInput } from '../../../envelope';
import { DocumentSession } from '../../../session';
import { NfNode, baseOf, shapeOf } from '../../../tree';
import { docxTree } from '../tree';
import { prepareWrite } from '../../../verbs';
import { docxPack } from '../index';
import { setControlText } from '../finalizers/formulas';
import { arr } from '../util';

const flagship = fs.readFileSync(path.join(__dirname, 'corpus', 'flagship-v4b.sfdt.json'), 'utf8');
const state = () => {
  let doc = flagship;
  const host = { serialize: () => doc, open: (s: string) => { doc = s; }, canUndo: () => false, undo: () => {}, canRedo: () => false, redo: () => {}, readOnly: () => false };
  return new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'e' } }).state;
};
const tableAt = (root: NfNode, s: number, b: number): NfNode =>
  arr<NfNode>(arr<NfNode>(arr<NfNode>(root.sections)[s].blocks)[b].blocks)[0];
const fill = (formats: Record<string, Record<string, unknown>>, cell: NfNode) => {
  const shading = formats[String(cell.style)]?.shading as Record<string, unknown> | undefined;
  const raw = typeof shading?.backgroundColor === 'string' ? shading.backgroundColor : '';
  return !raw || raw.toLowerCase() === 'empty' ? 'NONE' : raw.toUpperCase();
};

describe('restripe finalizer', () => {
  it('deleting a body row restripes only the rows that changed band', () => {
    const s = state();
    const table = tableAt(s.view.nf.root, 3, 10);
    const rows = arr<NfNode>(table.rows);
    const row = rows[2];
    const r = prepareWrite(s, { intent: 'test', scope: { ids: [row.id] }, changes: [{ kind: 'delete', id: row.id, base: baseOf(row) }] } as WriteInput);
    expect(r.outcome).toBe('verified');
    if (r.outcome !== 'verified') return;
    const after = arr<NfNode>(tableAt(r.intended.root, 3, 10).rows);
    // the band cycle of the original body, read back from the original rows
    const bandOf = rows.map((x) => fill(s.view.nf.formats, arr<NfNode>(x.cells)[0]));
    const restriped = new Set(r.facts.filter((f) => f.kind === 'finalizer' && f.name === 'restripe').flatMap((f) => f.ids));
    after.forEach((x, i) => {
      for (const [j, cell] of arr<NfNode>(x.cells).entries()) {
        const was = arr<NfNode>(rows[i].cells)[j];
        if (fill(r.intended.formats, cell) === fill(s.view.nf.formats, was) && !restriped.has(cell.id)) continue;
        // a restriped cell carries the fill of the row that used to sit at its index
        expect(fill(r.intended.formats, cell)).toBe(bandOf[i]);
      }
    });
    // rows above the deletion are untouched, including the unfilled ones spelled "empty"
    for (const x of after.slice(0, 2))
      for (const cell of arr<NfNode>(x.cells)) expect(restriped.has(cell.id)).toBe(false);
    expect(restriped.size).toBeGreaterThan(0);
  });
});

describe('table identity finalizer', () => {
  it('a copied bound table gets its own table id; the original keeps its own', () => {
    const s = state();
    const sections = arr<NfNode>(s.view.nf.root.sections);
    const control = arr<NfNode>(sections[1].blocks)[10];
    const original = (control.binding as { table?: string }).table;
    expect(typeof original).toBe('string');
    const strip = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !['id', 'base', 'shape', 'pending'].includes(k)).map(([k, x]) => [k, strip(x)])) : v;
    const r = prepareWrite(s, {
      intent: 'Repeat the property premium table.',
      scope: { ids: [control.id] },
      changes: [{ kind: 'insert_after', anchor: control.id, container: shapeOf(sections[1], docxTree), node: strip(control) }]
    } as WriteInput);
    if (r.outcome !== 'verified') throw new Error(JSON.stringify(r).slice(0, 700));
    const blocks = arr<NfNode>(arr<NfNode>(r.intended.root.sections)[1].blocks);
    const ids = [blocks[10], blocks[11]].map((b) => (b.binding as { table?: string }).table);
    expect(ids[0]).toBe(original);
    expect(ids[1]).not.toBe(original);
    expect(typeof ids[1]).toBe('string');
    expect(r.facts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'finalizer', name: 'tables' })]));
  });
});

describe('formula finalizer: writing a control text', () => {
  it('replaces the runs and keeps every other inline (a bookmark end, a field) where it was', () => {
    const control = {
      id: 'c1',
      kind: 'control',
      inlines: [
        { id: 'b1', kind: 'bookmark', name: 'total', type: 0 },
        { id: 'r1', kind: 'run', text: '$1', style: 'f1' },
        { id: 'r2', kind: 'run', text: '0.00' },
        { id: 'b2', kind: 'bookmark', name: 'total', type: 1 }
      ]
    } as unknown as NfNode;
    const changed = setControlText(control, '$12.00');
    expect((control.inlines as NfNode[]).map((i) => [i.id, i.kind, i.text])).toEqual([
      ['b1', 'bookmark', undefined],
      ['r1', 'run', '$12.00'],
      ['b2', 'bookmark', undefined]
    ]);
    expect(changed).toEqual(expect.arrayContaining(['c1', 'r1']));
    // already right: nothing written
    expect(setControlText(control, '$12.00')).toEqual([]);
  });
});
