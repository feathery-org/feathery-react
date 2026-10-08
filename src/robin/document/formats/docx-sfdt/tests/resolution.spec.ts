/**
 * Cards the engine resolves itself: a structural card's reject restores its snapshot, its accept
 * applies the group projection, other cards stay pending, the revision records leave with their
 * anchors, and the resolution is an engine history entry Ctrl+Z reverses.
 */
import * as fs from 'fs';
import * as path from 'path';
import { DocumentSession } from '../../../session';
import { NfNode, NormalForm, baseOf } from '../../../tree';
import { docxPack } from '../index';
import { ownsResolution } from '../projections';
import { composeTracked } from '../reconcile';
import { arr } from '../util';

const flagship = fs.readFileSync(path.join(__dirname, 'corpus', 'flagship-v4b.sfdt.json'), 'utf8');
function mount() {
  let doc = flagship;
  const host = { serialize: () => doc, open: (s: string) => { doc = s; }, canUndo: () => false, undo: () => {}, canRedo: () => false, redo: () => {}, readOnly: () => false };
  const session = new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'e' }, editorId: 'ed' });
  const deleteRow = (turnId: string, tableAt: number, row: number) => {
    const table = arr<NfNode>(arr<NfNode>(arr<NfNode>(session.state.view.nf.root.sections)[3].blocks)[tableAt].blocks)[0];
    const r = arr<NfNode>(table.rows)[row];
    const out = session.dispatch({ protocolVersion: 1, turnId, editorId: 'ed', target: { type: 'envelope', id: 'e' }, verb: 'write', input: { intent: 'Remove a line.', scope: { ids: [r.id] }, changes: [{ kind: 'delete', id: r.id, base: baseOf(r) }] } });
    if (out.status !== 'ok' || !out.response.result.ok) throw new Error(JSON.stringify((out as any).response?.result?.refusal?.detail ?? out).slice(0, 2000));
    return out.response.result;
  };
  const groupsIn = () => {
    const d = JSON.parse(doc);
    return [...new Set((d.revisions ?? []).map((x: { customData?: string }) => JSON.parse(x.customData ?? '{}').changeSetId).filter(Boolean))];
  };
  return { session, deleteRow, groupsIn, doc: () => doc };
}

describe('engine-owned card resolution', () => {
  it('rejecting a structural card restores its snapshot byte for byte, and Ctrl+Z brings the card back', () => {
    const m = mount();
    m.deleteRow('turn-1', 10, 2);
    const committed = m.doc();
    expect(m.session.ownsCard('turn-1')).toBe(true);
    expect(m.session.resolveCard('turn-1', false)).toBe(true);
    expect(m.doc()).toBe(flagship);
    expect(m.session.undo().via).toBe('engine');
    expect(m.doc()).toBe(committed);
    expect(m.groupsIn()).toEqual(['turn-1']);
  });

  it('accepting applies the group projection: the row is gone and no record of the card is left', () => {
    const m = mount();
    m.deleteRow('turn-1', 10, 2);
    expect(m.session.resolveCard('turn-1', true)).toBe(true);
    expect(m.groupsIn()).toEqual([]);
    const table = arr<NfNode>(arr<NfNode>(arr<NfNode>(m.session.state.view.nf.root.sections)[3].blocks)[10].blocks)[0];
    const before = arr<NfNode>(arr<NfNode>(arr<NfNode>(new DocumentSession({ pack: docxPack, host: { serialize: () => flagship, open: () => {}, canUndo: () => false, undo: () => {}, canRedo: () => false, redo: () => {}, readOnly: () => false }, target: { type: 'envelope', id: 'x' } }).state.view.nf.root.sections)[3].blocks)[10].blocks)[0];
    expect(arr(table.rows)).toHaveLength(arr(before.rows).length - 1);
    expect(JSON.stringify(m.session.state.view.nf)).not.toContain('"pending"');
  });

  it("resolving one card leaves another card's changes pending", () => {
    const m = mount();
    m.deleteRow('turn-1', 10, 2);
    m.deleteRow('turn-2', 10, 4);
    expect(m.session.resolveCard('turn-1', true)).toBe(true);
    expect(m.groupsIn()).toEqual(['turn-2']);
  });

  it("a replaced feature is the engine's to resolve even after a reload; a plain row delete is not", () => {
    const m = mount();
    const s = m.session.state;
    const control = s.view.nodes().find((n) => n.kind === 'control' && typeof (n.binding as { expr?: unknown } | undefined)?.expr === 'string') as NfNode;
    const intended = JSON.parse(JSON.stringify(s.view.nf)) as NormalForm;
    const find = (n: NfNode): NfNode | undefined => (n.id === control.id ? n : [...arr<NfNode>(n.inlines), ...arr<NfNode>(n.blocks), ...arr<NfNode>(n.rows), ...arr<NfNode>(n.cells), ...arr<NfNode>(n.sections)].map(find).find(Boolean));
    const target = find(intended.root as NfNode) as NfNode;
    target.binding = { ...(target.binding as object), expr: 'mul(1,1)' };
    const { tracked } = composeTracked(s.view, intended, 'turn-7');
    expect(ownsResolution(tracked, 'turn-7')).toBe(true);
    const row = arr<NfNode>(arr<NfNode>(arr<NfNode>(arr<NfNode>(s.view.nf.root.sections)[3].blocks)[10].blocks)[0].rows)[2];
    const rowGone = JSON.parse(JSON.stringify(s.view.nf)) as NormalForm;
    const t = arr<NfNode>(arr<NfNode>(arr<NfNode>(rowGone.root.sections)[3].blocks)[10].blocks)[0];
    t.rows = arr<NfNode>(t.rows).filter((r) => r.id !== row.id);
    expect(ownsResolution(composeTracked(s.view, rowGone, 'turn-8').tracked, 'turn-8')).toBe(false);
  });
});
