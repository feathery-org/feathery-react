// Bound-delete safety must be fail-closed at the seam every host crosses:
// attachBindings itself installs the tracked content-control deletion override,
// so an editor with live bindings is protected even when its host never calls
// installTrackedContentControlDeletion. Before this, identity depended on two
// call sites remembering to install it.
import 'jest-canvas-mock';
import { DocumentEditor } from '@syncfusion/ej2-documenteditor';
import { attachBindings, AttachedBindings } from '../attachBindings';
import {
  isContentControlAttached,
  SyncfusionEditorLike
} from '../editorAdapter';
import { installTrackedContentControlDeletion } from '../../../../../utils/documentEditorPrimitives';
import { buildCostsFixture } from '../core/tests/fixtures/costsFixture';
import { SfdtDocument } from '../core/sfdtTypes';
import {
  collectTags,
  destroyRealDocumentEditor,
  makeRealDocumentEditor
} from './realEditorHarness';

const QUANTITY_R1 = '[[name=quantity|type=integer|row=r-1]]';
const R1 = /row=r-1/;

const parsed = (editor: DocumentEditor) =>
  JSON.parse(editor.serialize()) as SfdtDocument;
const r1TagsOf = (editor: DocumentEditor) =>
  collectTags(parsed(editor)).filter((tag) => R1.test(tag));

function controlForTag(editor: DocumentEditor, tag: string) {
  const collection = (editor as any).documentHelper.contentControlCollection;
  return collection.find(
    (candidate: any) =>
      candidate?.contentControlProperties?.tag === tag &&
      isContentControlAttached(candidate)
  );
}

describe('attachBindings installs the tracked-deletion override itself', () => {
  let editor: DocumentEditor;
  let attached: AttachedBindings;

  beforeEach(() => {
    editor = makeRealDocumentEditor(buildCostsFixture());
    // The ONLY wiring: no host-side installTrackedContentControlDeletion call.
    attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: false
    });
  });

  afterEach(() => {
    attached.dispose();
    destroyRealDocumentEditor(editor);
  });

  it('a bindings-attached editor keeps binding identity through a tracked row delete', () => {
    expect(r1TagsOf(editor)).toHaveLength(4);
    const control = controlForTag(editor, QUANTITY_R1);
    expect(control).toBeDefined();

    editor.enableTrackChanges = true;
    try {
      (editor as any).selection.selectContentControl(control);
      (editor as any).editorModule.deleteRow();
    } finally {
      editor.enableTrackChanges = false;
    }

    // Pending: the deletion is a revision and every tag is still serialized.
    expect(editor.revisions.length).toBeGreaterThan(0);
    expect(r1TagsOf(editor)).toHaveLength(4);

    // Reject restores the row, tags included - the promise a tracked change
    // makes, which the stock SDK breaks without the override.
    const revisions = Array.from(
      { length: editor.revisions.length },
      (_, index) => editor.revisions.get(index)
    );
    for (const revision of revisions.reverse()) revision.reject();
    expect(editor.revisions.length).toBe(0);
    expect(r1TagsOf(editor)).toHaveLength(4);
  });

  it('the install is idempotent when a host also installs it', () => {
    const module = (editor as any).editorModule;
    const patched = module.handleDeleteTracking;
    installTrackedContentControlDeletion(editor as any);
    expect(module.handleDeleteTracking).toBe(patched);
  });
});
