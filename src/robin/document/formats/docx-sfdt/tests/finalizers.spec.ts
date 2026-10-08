/**
 * The restripe finalizer: rows that move band take their band's fill, and a cell that already has
 * its band's fill keeps its format entry exactly, whichever way the editor spelled "no fill".
 */
import * as fs from 'fs';
import * as path from 'path';
import { WriteInput } from '../../../envelope';
import { DocumentSession } from '../../../session';
import { NfNode, baseOf } from '../../../tree';
import { prepareWrite } from '../../../verbs';
import { docxPack } from '../index';
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
