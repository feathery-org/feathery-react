import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DocumentCanvas from './DocumentCanvas';

jest.mock('./pdfjsLoader', () => ({ loadPdfjs: jest.fn() }));
const { loadPdfjs } = jest.requireMock('./pdfjsLoader');

const doc = {
  type: 'form' as const,
  pdf_url: 'http://x/a.pdf',
  form_name: 'Form A'
};
const baseProps = {
  documents: [doc],
  pageWidth: 600,
  onDocLoad: jest.fn(),
  registerPageRef: jest.fn(),
  remountKey: 0
};

it('shows a skeleton while a document loads', () => {
  loadPdfjs.mockReturnValue(new Promise(() => {}));
  render(<DocumentCanvas {...baseProps} />);
  expect(screen.getByLabelText('Loading document')).toBeInTheDocument();
});

it('shows an error card with retry when loading fails', async () => {
  loadPdfjs.mockRejectedValue(new Error('network'));
  render(<DocumentCanvas {...baseProps} />);
  const retry = await screen.findByRole('button', { name: 'Retry' });
  expect(screen.getByRole('alert')).toHaveTextContent('Form A');
  loadPdfjs.mockReturnValue(new Promise(() => {}));
  fireEvent.click(retry);
  expect(await screen.findByLabelText('Loading document')).toBeInTheDocument();
});

it('does not reload already-loaded documents when an attachment is added', async () => {
  // Reloading an on-screen document creates a fresh pdfProxy with empty
  // annotationStorage, silently discarding the user's entered field values.
  // Adding an attachment must load only the new doc, never re-fetch existing.
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
  const getDocument = jest.fn(({ url }: { url: string }) => ({
    promise: Promise.resolve({
      numPages: 1,
      annotationStorage: { getAll: () => ({}) },
      getPage: async () => page,
      _url: url
    })
  }));
  loadPdfjs.mockResolvedValue({
    getDocument,
    AnnotationMode: { ENABLE_FORMS: 2 },
    AnnotationLayer: class {
      render() {
        return Promise.resolve();
      }
    }
  });
  const docA = {
    type: 'form' as const,
    pdf_url: 'http://x/a.pdf',
    form_name: 'A'
  };
  const docB = {
    type: 'attachment' as const,
    pdf_url: 'http://x/b.pdf',
    name: 'B'
  };

  const { rerender } = render(
    <DocumentCanvas {...baseProps} documents={[docA]} />
  );
  await waitFor(() => expect(getDocument).toHaveBeenCalledTimes(1));

  rerender(<DocumentCanvas {...baseProps} documents={[docA, docB]} />);
  await waitFor(() => expect(getDocument).toHaveBeenCalledTimes(2));

  const fetchedUrls = getDocument.mock.calls.map((c) => c[0].url);
  expect(fetchedUrls.filter((u) => u === 'http://x/a.pdf')).toHaveLength(1);
  expect(fetchedUrls).toContain('http://x/b.pdf');
});
