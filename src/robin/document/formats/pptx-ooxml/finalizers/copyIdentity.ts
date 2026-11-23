import type { Finalizer } from '../../../pack';
import type { NfNode } from '../../../tree';

/** The editor names a copied slide's part, so only the slide it copies keeps that name */
export const copyIdentityFinalizer: Finalizer = {
  name: 'copy-identity',
  run(after, { copies = {} }) {
    const ids: string[] = [];
    for (const slide of after.root.slides as NfNode[])
      if (slide.id in copies && slide.path !== undefined) {
        delete slide.path;
        ids.push(slide.id);
      }
    return { ids };
  }
};
