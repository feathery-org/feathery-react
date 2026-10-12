/**
 * Cards the engine resolves itself: a structural card's reject restores its snapshot, its accept
 * applies the group projection, other cards stay pending, the revision records leave with their
 * anchors, and the resolution is an engine history entry Ctrl+Z reverses.
 */
import * as fs from 'fs';
import * as path from 'path';
import { DocumentSession } from '../../../session';
import { NfNode, NormalForm, baseOf, shapeOf } from '../../../tree';
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

describe('a bookmarked move rejected after a reload (review item 3)', () => {
  const bookmarks = (native: string) => {
    const out: string[] = [];
    const walk = (n: any) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      if (typeof n.bookmarkType === 'number' && typeof n.name === 'string' && !n.name.startsWith('_')) out.push(`${n.bookmarkType}:${n.name}`);
      Object.values(n).forEach(walk);
    };
    walk(JSON.parse(native).sections);
    return out.sort();
  };
  it('the card is the engine\'s after a reload, and its reject carries the bookmarks back to the restored copy', () => {
    const m = mount();
    const s = m.session.state;
    const sections = arr<NfNode>(s.view.nf.root.sections);
    const control = arr<NfNode>(sections[1].blocks)[10];
    const anchor = arr<NfNode>(sections[0].blocks)[3];
    const out = m.session.dispatch({ protocolVersion: 1, turnId: 'turn-m', editorId: 'ed', target: { type: 'envelope', id: 'e' }, verb: 'write', input: { intent: 'Move the table.', scope: { ids: [control.id] }, changes: [{ kind: 'move', id: control.id, shape: shapeOf(control, docxPack.tree), anchor: anchor.id, position: 'after', container: shapeOf(sections[0], docxPack.tree) }] } });
    if (out.status !== 'ok' || !out.response.result.ok) throw new Error(JSON.stringify(out).slice(0, 600));
    // a reload: a new session over the saved bytes, no snapshot, ids minted afresh
    let doc = m.doc();
    const host = { serialize: () => doc, open: (x: string) => { doc = x; }, canUndo: () => false, undo: () => {}, canRedo: () => false, redo: () => {}, readOnly: () => false };
    const reloaded = new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'e' }, editorId: 'ed' });
    expect(reloaded.ownsCard('turn-m')).toBe(true);
    expect(reloaded.resolveCard('turn-m', false)).toBe(true);
    expect(bookmarks(doc)).toEqual(bookmarks(flagship));
    expect(JSON.stringify(JSON.parse(doc).revisions ?? [])).not.toContain('turn-m');
  });
});

describe('asking whether the engine owns a card', () => {
  it('never re-reads the editor (the rail asks from inside its change events)', () => {
    let doc = flagship;
    let reads = 0;
    const host = { serialize: () => { reads += 1; return doc; }, open: (s: string) => { doc = s; }, canUndo: () => false, undo: () => {}, canRedo: () => false, redo: () => {}, readOnly: () => false };
    const session = new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'e' }, editorId: 'ed' });
    const before = reads;
    doc = doc.replace('Commercial Combined', 'Commercial combined');
    expect(session.ownsCard('turn-1')).toBe(false);
    expect(reads).toBe(before);
  });
});
