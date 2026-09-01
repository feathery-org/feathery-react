// Review-editor harness: mounts the shipped DocumentViewer against a local
// fillable PDF with no form and no backend, so the pdf.js widget layer and the
// save-before-finalize flow can be exercised in a real browser. jsdom cannot
// reproduce what matters here: real pdf.js (CDN) rendering the AnnotationLayer,
// real typing committing into annotationStorage, and saveDocument() writing
// those values back into the PDF bytes.
//
// Everything observable lands on window.__harness:
//   saves:     [{ envelopeId, size, values }] — values re-read from the saved
//              bytes with a fresh pdf.js document, proving the round-trip
//   finalizes: [params passed to onFinalize]
//   completed / closed: viewer lifecycle flags
import React from 'react';
import { createRoot } from 'react-dom/client';
import DocumentViewer from '../../src/elements/components/DocumentViewer';
import { loadPdfjs } from '../../src/elements/components/DocumentViewer/pdfjsLoader';

const harness: any = {
  saves: [],
  finalizes: [],
  completed: false,
  closed: false,
  errors: []
};
(window as any).__harness = harness;

// Field name → value(s), re-read from saved PDF bytes by a fresh pdf.js parse.
async function extractFieldValues(bytes: Uint8Array) {
  const pdfjs = await loadPdfjs();
  // pdf.js transfers the buffer to its worker; hand it a copy.
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const fieldObjects = (await doc.getFieldObjects()) ?? {};
  const values: Record<string, any> = {};
  Object.entries(fieldObjects).forEach(([name, objs]: [string, any]) => {
    values[name] = objs.map((o: any) => o.value);
  });
  await doc.destroy();
  return values;
}

const payload = {
  documents: [
    {
      type: 'form' as const,
      pdf_url: '/harness/review-editor/sample-form.pdf',
      envelope_id: 'env-harness',
      name: 'Sample Form'
    }
  ],
  expires_at: '2999-01-01T00:00:00Z'
};

// Download + Sign: Download exercises save-before-finalize while keeping the
// editor open (repeatable), Sign is the closing action.
const action = {
  envelope_action: 'open_in_editor',
  editor_toolbar_actions: ['download', 'sign']
};

const root = createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <DocumentViewer
    payload={payload}
    action={action}
    setShow={(show: boolean) => {
      if (!show) {
        harness.closed = true;
        root.unmount();
      }
    }}
    onComplete={() => {
      harness.completed = true;
    }}
    onFinalize={async (params: any) => {
      harness.finalizes.push(params);
      return {};
    }}
    onSaveEnvelopeFile={async (envelopeId: string, file: Blob) => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const values = await extractFieldValues(bytes);
        harness.saves.push({ envelopeId, size: bytes.length, values });
      } catch (e: any) {
        harness.errors.push(String(e?.message ?? e));
        throw e;
      }
      return { id: envelopeId };
    }}
  />
);
