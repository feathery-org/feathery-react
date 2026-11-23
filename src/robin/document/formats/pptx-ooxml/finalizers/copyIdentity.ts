import type { Finalizer } from '../../../pack';
import { READ_ONLY_NODE_KEYS } from '../../../envelope';
import { walk, withoutLists, type NfNode } from '../../../tree';
import { MERGE_MARKS } from '../adapter/nodes';
import { isShapeKind, pptxTree } from '../tree';

const DECK_OWNED = ['shapeId', 'name', 'placeholder'];
const NOT_CARRIED: readonly string[] = [
  'id',
  'path',
  'inherited',
  ...READ_ONLY_NODE_KEYS
];

/** Fills in what a copy leaves out and the names the deck gives its shapes and slides */
export const copyIdentityFinalizer: Finalizer = {
  name: 'copy-identity',
  run(after, { before, copies = {} }) {
    const ids = new Set<string>();
    walk(after.root, pptxTree, ({ node }: { node: NfNode }) => {
      const copied = node.id in copies;
      if (copied && node.kind === 'slide' && node.path !== undefined) {
        delete node.path;
        ids.add(node.id);
      }
      const read = before.get(copies[node.id] ?? node.id);
      if (!read || read.kind !== node.kind) return;
      const kept = copied
        ? Object.keys(withoutLists(read, pptxTree)).filter(
            (key) => !NOT_CARRIED.includes(key)
          )
        : isShapeKind(node.kind)
        ? DECK_OWNED
        : [];
      for (const key of kept)
        if (node[key] === undefined && read[key] !== undefined) {
          node[key] = JSON.parse(JSON.stringify(read[key]));
          ids.add(node.id);
        }
    });
    // A row or column copied within its table stands on its own, as the editor copies it
    walk(after.root, pptxTree, ({ node }: { node: NfNode }) => {
      if (node.kind !== 'table' || node.id in copies) return;
      for (const row of (node.rows ?? []) as NfNode[])
        for (const cell of (row.cells ?? []) as NfNode[])
          if (cell.id in copies && MERGE_MARKS.some((mark) => mark in cell)) {
            for (const mark of MERGE_MARKS) delete cell[mark];
            ids.add(cell.id);
          }
    });
    return { ids: [...ids] };
  }
};
