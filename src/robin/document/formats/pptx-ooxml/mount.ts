import type { PptxEditorStore } from '../../../../elements/components/PptxEditor/state/PptxEditorStore';
import { journalFor, lazySession, mountDocument } from '../../mounts';
import { DocumentSession, newEditorId } from '../../session';
import { createHost, pptxPack } from './index';

export interface RobinPresentationMount {
  formKey: string;
  slot: string;
  store: PptxEditorStore;
  envelopeId: string;
  readOnly: boolean;
}

/** Mount an opened deck for Robin, the returned unmount also ends any editing turn */
export function mountRobinPresentation({
  formKey,
  slot,
  store,
  envelopeId,
  readOnly
}: RobinPresentationMount): () => void {
  const mounted = lazySession(
    newEditorId(),
    (editorId) =>
      new DocumentSession({
        pack: pptxPack,
        host: createHost(store, { readOnly }),
        target: { type: 'envelope', id: envelopeId },
        editorId,
        journal: journalFor(formKey)
      })
  );
  const unmount = mountDocument(formKey, slot, mounted);
  mounted.get();
  return () => {
    unmount();
    mounted.peek()?.finishTurn();
  };
}
