import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createPptxEditorStore } from '../../../../../elements/components/PptxEditor/state/PptxEditorStore';
import { liveDocumentAccessor } from '../../../mounts';
import { mountRobinPresentation } from '../mount';

function loadedStore() {
  const store = createPptxEditorStore();
  store.loadFile(
    new Uint8Array(
      readFileSync(
        resolve(
          __dirname,
          '../../../../../elements/components/PptxEditor/tests/fixtures/sample.pptx'
        )
      )
    ),
    'sample.pptx'
  );
  return store;
}

describe('mountRobinPresentation', () => {
  it('describes the mounted deck to Robin until it is unmounted', () => {
    const off = mountRobinPresentation({
      formKey: 'form-pptx-1',
      slot: 'c1',
      store: loadedStore(),
      envelopeId: 'env_1',
      readOnly: false
    });
    expect(liveDocumentAccessor('form-pptx-1').descriptor()).toEqual(
      expect.objectContaining({
        target: { type: 'envelope', id: 'env_1' },
        readOnly: false
      })
    );

    off();
    expect(liveDocumentAccessor('form-pptx-1').descriptor()).toBeNull();
  });

  it('reports a read-only deck as read-only', () => {
    const off = mountRobinPresentation({
      formKey: 'form-pptx-2',
      slot: 'c1',
      store: loadedStore(),
      envelopeId: 'env_2',
      readOnly: true
    });
    expect(liveDocumentAccessor('form-pptx-2').descriptor()).toEqual(
      expect.objectContaining({ readOnly: true })
    );
    off();
  });
});
