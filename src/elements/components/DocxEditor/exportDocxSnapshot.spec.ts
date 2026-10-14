import JSZip from 'jszip';
import { exportDocxSnapshot } from './useDocxEditor';
import { applyDocumentEdits } from '../../../assistant/tools/docx/syncfusionDocumentOps';
import {
  listRevisionGroups,
  resolveLiveRevisionGroupsAsOneUndo,
  LiveEditor
} from '../../../utils/documentEditorPrimitives';
import {
  destroyRealDocumentEditor,
  docWith,
  makeRealDocumentEditor,
  para,
  textRun
} from './bindings/tests/realEditorHarness';

const documentXml = async (blob: Blob): Promise<string> => {
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  const zip = await JSZip.loadAsync(bytes);
  return zip.file('word/document.xml')?.async('string') ?? '';
};

it('can accept a Robin suggestion after exporting its pending snapshot', async () => {
  const editor = makeRealDocumentEditor(
    docWith(para(textRun('Premium: $5,200')))
  );
  const live = editor as unknown as LiveEditor;
  try {
    applyDocumentEdits(live, {
      changeSetId: 'save-accept',
      edits: [
        {
          op: 'replace_text',
          anchor: '0;0',
          find: '$5,200',
          replace: '$5,500',
          group: 'update-premium'
        }
      ]
    });
    const pending = await exportDocxSnapshot(editor);
    expect(await documentXml(pending)).toContain('<w:ins');
    expect(listRevisionGroups(live)).toHaveLength(1);
    const result = resolveLiveRevisionGroupsAsOneUndo(
      live,
      listRevisionGroups(live),
      true
    );
    expect(result.unresolved).toHaveLength(0);
    expect(listRevisionGroups(live)).toHaveLength(0);
    const accepted = await exportDocxSnapshot(editor);
    expect(await documentXml(accepted)).not.toContain('<w:ins');
    expect(await documentXml(accepted)).not.toContain('<w:del');
    expect(JSON.parse(editor.serialize()).revisions ?? []).toHaveLength(0);
  } finally {
    destroyRealDocumentEditor(editor);
  }
});

it('exports overlapping saves as independent snapshots with the real Word exporter', async () => {
  const editor = makeRealDocumentEditor(
    docWith(para(textRun('Original text')))
  );
  try {
    const first = exportDocxSnapshot(editor);
    editor.selection.selectAll();
    editor.editor.insertText('Later text');
    const second = exportDocxSnapshot(editor);
    const [firstXml, secondXml] = await Promise.all([
      first.then(documentXml),
      second.then(documentXml)
    ]);
    expect(firstXml).toContain('Original text');
    expect(firstXml).not.toContain('Later text');
    expect(secondXml).toContain('Later text');
    expect(secondXml).not.toContain('Original text');
  } finally {
    destroyRealDocumentEditor(editor);
  }
});
