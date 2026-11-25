// Converts a stored .docx to SFDT in a hidden, short-lived editor, the way the
// live editor opens it, so a folded view can start from the real original.
import { featheryDoc } from '../../../../utils/browser';
import { waitForDocumentLoad, waitForEj } from '../ejLoader';
import { populateVersionBindings } from './populateVersionBindings';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const CREATE_TIMEOUT_MS = 20_000;

export type DocxToSfdt = (bytes: ArrayBuffer) => Promise<any>;

/** A converter backed by the Syncfusion Import service at `serviceUrl`. */
export function hiddenEditorConverter(
  serviceUrl: string,
  headers: Record<string, string>[] = []
): DocxToSfdt {
  return async (bytes) => {
    const ej = await waitForEj();
    if (!ej?.documenteditor) throw new Error('Document editor unavailable');
    const doc = featheryDoc();
    const host = doc.createElement('div');
    host.style.cssText =
      'position:fixed;left:-10000px;top:0;width:816px;height:1056px;visibility:hidden';
    doc.body.appendChild(host);
    const container = new ej.documenteditor.DocumentEditorContainer({
      enableToolbar: false,
      showPropertiesPane: false,
      height: '100%',
      serviceUrl,
      headers,
      documentEditorSettings: { optimizeSfdt: false }
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Converter creation timed out')),
          CREATE_TIMEOUT_MS
        );
        container.addEventListener('created', () => {
          clearTimeout(timer);
          resolve();
        });
        container.appendTo(host);
      });
      const editor = container.documentEditor;
      editor.enableSfdtExport = true;
      const loaded = waitForDocumentLoad(editor);
      // A failed Import never settles openAsync; fail now, not at the timeout.
      const failed = new Promise<never>((resolve, reject) =>
        editor.addEventListener('serviceFailure', () =>
          reject(new Error('Original document import failed'))
        )
      );
      failed.catch(() => undefined);
      await Promise.race([
        editor.openAsync(new Blob([bytes], { type: DOCX_MIME })),
        failed
      ]);
      if (!(await Promise.race([loaded, failed])))
        throw new Error('Original document did not load');
      return populateVersionBindings(JSON.parse(editor.serialize()));
    } finally {
      try {
        container.destroy();
      } catch {
        /* already torn down */
      }
      host.remove();
    }
  };
}
