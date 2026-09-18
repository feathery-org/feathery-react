import JSZip from 'jszip';
import { exportDocxSnapshot } from './useDocxEditor';
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
