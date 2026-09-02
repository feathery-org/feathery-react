import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DocumentViewer from './index';
import { featheryDoc } from '../../../utils/browser';

// Fillable-field persistence: the viewer renders the PDF's own AcroForm
// widgets (DocumentCanvas), and any edits — tracked through pdf.js's
// annotationStorage modified flag — must be saved back to the envelope
// before finalize runs, so every outcome acts on the edited file.

jest.mock('./pdfjsLoader', () => ({
  loadPdfjs: jest.fn(),
  PDFJS_STANDARD_FONT_DATA_URL: 'http://x/fonts/'
}));
const { loadPdfjs } = jest.requireMock('./pdfjsLoader');

const page = {
  getViewport: () => ({
    width: 600,
    height: 800,
    scale: 1,
    clone: () => ({ width: 600, height: 800, scale: 1 })
  }),
  getAnnotations: async () => [],
  render: () => ({ promise: Promise.resolve(), cancel: () => undefined })
};

// One mock pdfProxy per pdf_url, exposing the same annotationStorage contract
// the viewer relies on: onSetModified fires on the first widget edit and
// saveDocument() resets the modified flag in a finally — on failure too, as
// pdf.js's real save does. `failNextSave` makes the next saveDocument() reject.
const makePdfProxy = () => {
  const storage: any = {
    onSetModified: null,
    onResetModified: null
  };
  let nextSaveError: Error | null = null;
  const proxy: any = {
    numPages: 1,
    annotationStorage: storage,
    getPage: async () => page,
    saveDocument: jest.fn(async () => {
      try {
        if (nextSaveError) {
          const error = nextSaveError;
          nextSaveError = null;
          throw error;
        }
        return new Uint8Array([37, 80, 68, 70]); // %PDF
      } finally {
        storage.onResetModified?.();
      }
    }),
    failNextSave: (error: Error) => {
      nextSaveError = error;
    },
    cleanup: () => undefined,
    destroy: () => undefined
  };
  return proxy;
};

// Constructed once per rendered page by the editable viewer; a read-only
// viewer never mounts it.
const AnnotationLayer = jest.fn(() => ({ render: () => Promise.resolve() }));

const setupPdfjs = (proxies: Record<string, any>) => {
  loadPdfjs.mockResolvedValue({
    getDocument: ({ url }: { url: string }) => ({
      promise: Promise.resolve(proxies[url])
    }),
    AnnotationMode: { ENABLE: 1, ENABLE_FORMS: 2 },
    AnnotationLayer
  });
};

const payload = {
  documents: [
    { type: 'form' as const, pdf_url: 'http://x/a.pdf', envelope_id: 'env-1' },
    { type: 'form' as const, pdf_url: 'http://x/b.pdf', envelope_id: 'env-2' }
  ],
  expires_at: '2999-01-01T00:00:00Z'
};
const action = {
  envelope_action: 'open_in_editor',
  editor_toolbar_actions: ['download']
};

afterEach(() => {
  jest.clearAllMocks();
});

const renderViewer = (proxies: Record<string, any>, overrides: any = {}) => {
  setupPdfjs(proxies);
  const onFinalize = jest.fn().mockResolvedValue({ files: ['out.pdf'] });
  const onSaveEnvelopeFile = jest.fn().mockResolvedValue({ id: 'env-1' });
  render(
    <DocumentViewer
      payload={payload}
      action={action}
      setShow={jest.fn()}
      onComplete={jest.fn()}
      onFinalize={onFinalize}
      onSaveEnvelopeFile={onSaveEnvelopeFile}
      {...overrides}
    />
  );
  return { onFinalize, onSaveEnvelopeFile };
};

// The storage hooks are assigned in onDocLoad, so waiting for them is how we
// know the documents finished loading.
const waitForLoad = async (...proxies: any[]) => {
  await waitFor(() =>
    proxies.forEach((p) =>
      expect(p.annotationStorage.onSetModified).toBeInstanceOf(Function)
    )
  );
};

// A click while the toolbar is still busy from the prior action is
// swallowed by the disabled button, so wait for it to go idle first.
const waitForIdleToolbar = async () => {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled()
  );
};

it('saves only the edited documents to their envelopes before finalizing', async () => {
  const proxyA = makePdfProxy();
  const proxyB = makePdfProxy();
  const { onFinalize, onSaveEnvelopeFile } = renderViewer({
    'http://x/a.pdf': proxyA,
    'http://x/b.pdf': proxyB
  });
  await waitForLoad(proxyA, proxyB);

  // The filler edits a widget in document A only.
  proxyA.annotationStorage.onSetModified();

  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1));

  expect(proxyA.saveDocument).toHaveBeenCalledTimes(1);
  expect(proxyB.saveDocument).not.toHaveBeenCalled();
  expect(onSaveEnvelopeFile).toHaveBeenCalledTimes(1);
  const [envelopeId, blob] = onSaveEnvelopeFile.mock.calls[0];
  expect(envelopeId).toBe('env-1');
  expect(blob.type).toBe('application/pdf');
  // The edited file must be persisted before finalize acts on the envelope.
  expect(onSaveEnvelopeFile.mock.invocationCallOrder[0]).toBeLessThan(
    onFinalize.mock.invocationCallOrder[0]
  );
});

it('does not save anything when no fields were edited', async () => {
  const proxyA = makePdfProxy();
  const proxyB = makePdfProxy();
  const { onFinalize, onSaveEnvelopeFile } = renderViewer({
    'http://x/a.pdf': proxyA,
    'http://x/b.pdf': proxyB
  });
  await waitForLoad(proxyA, proxyB);

  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1));

  expect(onSaveEnvelopeFile).not.toHaveBeenCalled();
  expect(proxyA.saveDocument).not.toHaveBeenCalled();
});

it('does not re-save an already-saved document on a second toolbar action', async () => {
  const proxyA = makePdfProxy();
  const proxyB = makePdfProxy();
  const { onFinalize, onSaveEnvelopeFile } = renderViewer({
    'http://x/a.pdf': proxyA,
    'http://x/b.pdf': proxyB
  });
  await waitForLoad(proxyA, proxyB);

  proxyA.annotationStorage.onSetModified();
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1));
  expect(onSaveEnvelopeFile).toHaveBeenCalledTimes(1);

  // Nothing changed since the save, so the next action skips the upload.
  await waitForIdleToolbar();
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(2));
  expect(onSaveEnvelopeFile).toHaveBeenCalledTimes(1);
});

it('surfaces a save failure, skips finalize, and retries the save on the next attempt', async () => {
  const proxyA = makePdfProxy();
  const proxyB = makePdfProxy();
  const { onFinalize, onSaveEnvelopeFile } = renderViewer({
    'http://x/a.pdf': proxyA,
    'http://x/b.pdf': proxyB
  });
  await waitForLoad(proxyA, proxyB);

  proxyA.annotationStorage.onSetModified();
  onSaveEnvelopeFile.mockRejectedValueOnce(new Error('Document save failed'));

  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Document save failed'
  );
  expect(onFinalize).not.toHaveBeenCalled();

  // saveDocument() reset the modified flag, but the failed upload must leave
  // the document dirty so retrying the action saves it again.
  await waitForIdleToolbar();
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1));
  expect(onSaveEnvelopeFile).toHaveBeenCalledTimes(2);
  expect(
    onSaveEnvelopeFile.mock.calls.every(
      ([envelopeId]) => envelopeId === 'env-1'
    )
  ).toBe(true);
});

it('re-saves on the next attempt when saveDocument() itself fails', async () => {
  const proxyA = makePdfProxy();
  const proxyB = makePdfProxy();
  const { onFinalize, onSaveEnvelopeFile } = renderViewer({
    'http://x/a.pdf': proxyA,
    'http://x/b.pdf': proxyB
  });
  await waitForLoad(proxyA, proxyB);

  proxyA.annotationStorage.onSetModified();
  proxyA.failNextSave(new Error('Worker crashed'));

  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Worker crashed');
  expect(onSaveEnvelopeFile).not.toHaveBeenCalled();
  expect(onFinalize).not.toHaveBeenCalled();

  // pdf.js reset the modified flag even though the save rejected. The doc
  // must still count as dirty, or the retry would finalize the unedited file.
  await waitForIdleToolbar();
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1));
  expect(proxyA.saveDocument).toHaveBeenCalledTimes(2);
  expect(onSaveEnvelopeFile).toHaveBeenCalledTimes(1);
  expect(onSaveEnvelopeFile.mock.calls[0][0]).toBe('env-1');
});

it('freezes the form widgets while a save/finalize is in flight', async () => {
  const proxyA = makePdfProxy();
  const proxyB = makePdfProxy();
  let releaseSave: (value: any) => void = () => undefined;
  const onSaveEnvelopeFile = jest.fn(
    () => new Promise((resolve) => (releaseSave = resolve))
  );
  const { onFinalize } = renderViewer(
    { 'http://x/a.pdf': proxyA, 'http://x/b.pdf': proxyB },
    { onSaveEnvelopeFile }
  );
  await waitForLoad(proxyA, proxyB);
  const widgetLayers = () =>
    Array.from(featheryDoc().querySelectorAll('.annotationLayer'));
  await waitFor(() => expect(widgetLayers()).toHaveLength(2));
  await waitFor(() => expect(AnnotationLayer).toHaveBeenCalledTimes(2));
  widgetLayers().forEach((layer) => expect(layer).not.toHaveAttribute('inert'));

  proxyA.annotationStorage.onSetModified();
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  await waitFor(() => expect(onSaveEnvelopeFile).toHaveBeenCalledTimes(1));

  // An edit made now would never re-mark the doc dirty (pdf.js only fires
  // onSetModified on a false→true flip), so every page's widgets go inert.
  widgetLayers().forEach((layer) => expect(layer).toHaveAttribute('inert'));

  releaseSave({ id: 'env-1' });
  await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1));
  await waitForIdleToolbar();
  widgetLayers().forEach((layer) => expect(layer).not.toHaveAttribute('inert'));
});

it('blocks Escape and Back while a save/finalize is in flight', async () => {
  const proxyA = makePdfProxy();
  const proxyB = makePdfProxy();
  // Keep the action in flight until we release it, so the viewer stays busy.
  let releaseSave: (value: any) => void = () => undefined;
  const onSaveEnvelopeFile = jest.fn(
    () => new Promise((resolve) => (releaseSave = resolve))
  );
  const setShow = jest.fn();
  const { onFinalize } = renderViewer(
    { 'http://x/a.pdf': proxyA, 'http://x/b.pdf': proxyB },
    { onSaveEnvelopeFile, setShow }
  );
  await waitForLoad(proxyA, proxyB);

  proxyA.annotationStorage.onSetModified();
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  await waitFor(() => expect(onSaveEnvelopeFile).toHaveBeenCalledTimes(1));

  // Closing now would hide the viewer while the action's side effect still
  // completes invisibly in the background — both close paths must be inert.
  expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  fireEvent.keyDown(featheryDoc(), { key: 'Escape' });
  expect(setShow).not.toHaveBeenCalled();

  releaseSave({ id: 'env-1' });
  await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1));

  // Idle again: Escape closes as usual.
  await waitForIdleToolbar();
  fireEvent.keyDown(featheryDoc(), { key: 'Escape' });
  expect(setShow).toHaveBeenCalledWith(false);
});

it('finalizes without saving when onSaveEnvelopeFile is not provided', async () => {
  const proxyA = makePdfProxy();
  const proxyB = makePdfProxy();
  const { onFinalize } = renderViewer(
    { 'http://x/a.pdf': proxyA, 'http://x/b.pdf': proxyB },
    { onSaveEnvelopeFile: undefined }
  );
  await waitForLoad(proxyA, proxyB);

  proxyA.annotationStorage.onSetModified();
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1));
  expect(proxyA.saveDocument).not.toHaveBeenCalled();
});

it('shows the documents read-only when the action sets editor_read_only', async () => {
  const proxyA = makePdfProxy();
  const proxyB = makePdfProxy();
  const { onFinalize, onSaveEnvelopeFile } = renderViewer(
    { 'http://x/a.pdf': proxyA, 'http://x/b.pdf': proxyB },
    { action: { ...action, editor_read_only: true } }
  );
  await waitForLoad(proxyA, proxyB);

  // Nothing can dirty a read-only viewer; even a flagged doc is never saved.
  proxyA.annotationStorage.onSetModified();
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1));
  expect(proxyA.saveDocument).not.toHaveBeenCalled();
  expect(onSaveEnvelopeFile).not.toHaveBeenCalled();
  // The live form layer was never mounted (the freeze test above shows the
  // editable viewer constructs one per page), so there is nothing to edit.
  expect(AnnotationLayer).not.toHaveBeenCalled();
});
