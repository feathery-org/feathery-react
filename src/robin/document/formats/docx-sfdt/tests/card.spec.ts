/**
 * Card titles on the flagship: two to four words in the user's terms, outermost nodes counted,
 * derived changes not counted, a parenthetical for what the change also removes.
 */
import * as fs from 'fs';
import * as path from 'path';
import { WriteInput } from '../../../envelope';
import { DocumentSession } from '../../../session';
import { NfNode, baseOf, shapeOf } from '../../../tree';
import { prepareWrite } from '../../../verbs';
import { docxPack } from '../index';
import { docxTree } from '../tree';
import { plan } from '../reconcile';
import { makeView } from '../../../view';
import { arr } from '../util';

const flagship = fs.readFileSync(path.join(__dirname, 'corpus', 'flagship-v4b.sfdt.json'), 'utf8');
const state = () => {
  let doc = flagship;
  const host = { serialize: () => doc, open: (s: string) => { doc = s; }, canUndo: () => false, undo: () => {}, canRedo: () => false, redo: () => {}, readOnly: () => false };
  return new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'e' } }).state;
};
const strip = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !['id', 'base', 'shape', 'pending'].includes(k)).map(([k, x]) => [k, strip(x)])) : v;
const titleOf = (w: Partial<WriteInput>) => {
  const r = prepareWrite(state(), { intent: 'x', scope: { ids: [] }, ...w } as WriteInput);
  if (r.outcome !== 'verified') throw new Error(JSON.stringify(r).slice(0, 500));
  return r.title;
};

describe('card titles', () => {
  const s = state();
  const sections = arr<NfNode>(s.view.nf.root.sections);
  const clause = arr<NfNode>(sections[3].blocks)[16];
  const run = arr<NfNode>(clause.inlines).find((i) => i.kind === 'run') as NfNode;
  const bound = arr<NfNode>(arr<NfNode>(sections[1].blocks)[10].blocks)[0];
  const row = arr<NfNode>(bound.rows)[2];
  const plain = arr<NfNode>(sections[1].blocks)[4];

  it('a text edit is an edited paragraph', () => {
    expect(titleOf({ scope: { ids: [run.id] }, changes: [{ kind: 'replace', id: run.id, base: baseOf(run), node: { kind: 'run', text: 'Replaced.' } }] })).toBe('Edited a paragraph');
  });

  it('a run added inside a paragraph edits the paragraph', () => {
    expect(titleOf({ scope: { ids: [run.id] }, changes: [{ kind: 'insert_after', anchor: run.id, container: shapeOf(clause, docxTree), node: { kind: 'run', text: ' More.' } }] })).toBe('Edited a paragraph');
  });

  it('a copied bound row is one added row, not its cells; the recomputed totals are not counted', () => {
    expect(titleOf({ scope: { ids: [row.id] }, changes: [{ kind: 'insert_after', anchor: row.id, container: shapeOf(bound, docxTree), node: strip(row) }] })).toBe('Added a row');
  });

  it('a deleted row is a removed row', () => {
    expect(titleOf({ scope: { ids: [row.id] }, changes: [{ kind: 'delete', id: row.id, base: baseOf(row) }] })).toBe('Removed a row');
  });

  it('a new cell in every row of a table is an added column; the last cell of every row removed is a removed column', () => {
    const rows = arr<NfNode>(plain.rows);
    const added = rows.map((r) => {
      const last = arr<NfNode>(r.cells)[arr<NfNode>(r.cells).length - 1];
      return { kind: 'insert_after', anchor: last.id, container: shapeOf(r, docxTree), node: { kind: 'cell', blocks: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'New' }] }] } };
    });
    expect(titleOf({ scope: { ids: rows.map((r) => r.id) }, changes: added })).toBe('Added a column');
    const twice = rows.flatMap((r) => {
      const last = arr<NfNode>(r.cells)[arr<NfNode>(r.cells).length - 1];
      const cell = { kind: 'cell', blocks: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'New' }] }] };
      return [{ kind: 'insert_after', anchor: last.id, container: shapeOf(r, docxTree), node: cell }, { kind: 'insert_after', anchor: last.id, container: shapeOf(r, docxTree), node: cell }];
    });
    expect(titleOf({ scope: { ids: rows.map((r) => r.id) }, changes: twice })).toBe('Added 2 columns');
    const removed = rows.map((r) => {
      const last = arr<NfNode>(r.cells)[arr<NfNode>(r.cells).length - 1];
      return { kind: 'delete', id: last.id, base: baseOf(last) };
    });
    expect(titleOf({ scope: { ids: rows.map((r) => r.id) }, changes: removed })).toBe('Removed a column');
  });

  it('cells that do not form a column are counted as cells', () => {
    const r = arr<NfNode>(plain.rows)[1];
    const last = arr<NfNode>(r.cells)[arr<NfNode>(r.cells).length - 1];
    const cell = { kind: 'cell', blocks: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'New' }] }] };
    expect(titleOf({ scope: { ids: [r.id] }, changes: [{ kind: 'insert_after', anchor: last.id, container: shapeOf(r, docxTree), node: cell }, { kind: 'insert_after', anchor: last.id, container: shapeOf(r, docxTree), node: cell }] })).toBe('Added 2 cells');
  });

  it('a property change is formatting', () => {
    expect(titleOf({ scope: { ids: [clause.id] }, changes: [{ kind: 'set', target: { ids: [clause.id], shape: { [clause.id]: shapeOf(clause, docxTree) } }, props: { textAlignment: 'Center' } }] })).toBe('Formatted a paragraph');
  });

  it('a rewritten formula is an edited field, not formatting', () => {
    const control = s.view.nodes().find((n) => n.kind === 'control' && n.binding && typeof (n.binding as { expr?: unknown }).expr === 'string' && s.view.nodes().filter((m) => m.kind === 'control' && (m.binding as { name?: unknown } | undefined)?.name === (n.binding as { name?: unknown }).name).length === 1) as NfNode;
    const node = strip(control) as Record<string, unknown>;
    node.binding = { ...(control.binding as object), expr: `mul(${(control.binding as { expr: string }).expr},1)` };
    expect(titleOf({ scope: { ids: [control.id] }, changes: [{ kind: 'replace', id: control.id, base: baseOf(control), node }] })).toBe('Edited a field');
  });

  it('a moved table is a moved table', () => {
    const anchor = arr<NfNode>(sections[1].blocks)[0];
    expect(titleOf({ scope: { ids: [plain.id] }, changes: [{ kind: 'move', id: plain.id, shape: shapeOf(plain, docxTree), anchor: anchor.id, position: 'before', container: shapeOf(sections[1], docxTree) }] })).toBe('Moved a table');
  });

  it('what the change also removes is said in a parenthetical', () => {
    const neighbour = arr<NfNode>(sections[3].blocks)[15];
    expect(
      titleOf({
        scope: { ids: [clause.id, neighbour.id] },
        changes: [
          { kind: 'insert_after', anchor: clause.id, container: shapeOf(sections[3], docxTree), node: { kind: 'paragraph', inlines: [{ kind: 'run', text: 'A new clause.' }] } },
          { kind: 'delete', id: neighbour.id, base: baseOf(neighbour) }
        ]
      })
    ).toBe('Added a paragraph (removes a paragraph)');
  });
});

describe('the card text travels in the group tag', () => {
  it('a splice mints its revisions with the title and the intent, so they survive a reload', () => {
    const s = state();
    const bound = arr<NfNode>(arr<NfNode>(arr<NfNode>(s.view.nf.root.sections)[1].blocks)[10].blocks)[0];
    const row = arr<NfNode>(bound.rows)[2];
    const r = prepareWrite(s, { intent: 'Remove the third line.', scope: { ids: [row.id] }, changes: [{ kind: 'delete', id: row.id, base: baseOf(row) }] } as WriteInput);
    if (r.outcome !== 'verified') throw new Error(r.outcome);
    const p = plan({ turnId: 'turn-3', before: s.view, intended: makeView(r.intended, docxPack), beforeResidue: s.residue, intendedResidue: r.intendedResidue, beforeNative: flagship, card: { title: r.title, intent: 'Remove the third line.' } });
    const doc = JSON.parse(p.steps[0].payload as string);
    const tags = (doc.revisions as Array<{ customData?: string }>).map((x) => JSON.parse(x.customData ?? '{}')).filter((t) => t.changeSetId === 'turn-3');
    expect(tags.length).toBeGreaterThan(0);
    for (const t of tags) expect(t).toEqual(expect.objectContaining({ source: 'robin', group: 'robin', title: 'Removed a row', intent: 'Remove the third line.' }));
  });
});
