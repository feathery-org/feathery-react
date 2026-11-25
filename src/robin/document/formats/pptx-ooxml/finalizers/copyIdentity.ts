import type { Finalizer } from '../../../pack';
import { READ_ONLY_NODE_KEYS } from '../../../envelope';
import { walk, withoutLists, type NfNode } from '../../../tree';
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
      // A new slide, copied or written with a temporary id, gets its own part from the editor
      const isNewSlide =
        node.kind === 'slide' && (copied || !before.get(node.id));
      if (isNewSlide && node.path !== undefined) {
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
    return { ids: [...ids] };
  }
};
