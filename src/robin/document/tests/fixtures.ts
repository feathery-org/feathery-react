/** Test support: a live document state over the toy pack. */
import { IdTable } from '../ids';
import { renderOutline } from '../outline';
import type { DocumentView, Pack, Residue } from '../pack';
import { makeView } from '../view';
import { makeToyPack } from './toyPack';

export interface ToyState {
  pack: Pack;
  view: DocumentView;
  residue: Residue;
  ids: IdTable;
  outlineHash: string;
}

export function stateOf(native: string, pack: Pack = makeToyPack(), ids = new IdTable()): ToyState {
  const { nf, residue } = ids.adopt(pack.adapter.toNormalForm(native), pack.tree, pack.formatRefKeys);
  const view = makeView(nf, pack);
  return { pack, view, residue, ids, outlineHash: renderOutline(view, pack).outlineHash };
}
