/**
 * A read-only view of one version of the normal form: lookups by id and the pack's annotations,
 * computed once per version and only when asked for.
 */
import type { Annotation, DocumentView, Pack } from './pack';
import { NfNode, NormalForm, Placement, indexTree } from './tree';

export function makeView(nf: NormalForm, pack: Pack): DocumentView {
  const index = indexTree(nf.root, pack.tree);
  let annotations: Map<string, Annotation> | null = null;
  let order: NfNode[] | null = null;
  const view: DocumentView = {
    nf,
    get: (id: string) => index.get(id)?.node,
    placement: (id: string): Placement | undefined => index.get(id),
    annotation: (id: string) => {
      if (!annotations) annotations = pack.annotate(view);
      return annotations.get(id);
    },
    nodes: () => {
      if (!order) order = [...index.values()].map((p) => p.node);
      return order;
    }
  };
  return view;
}
