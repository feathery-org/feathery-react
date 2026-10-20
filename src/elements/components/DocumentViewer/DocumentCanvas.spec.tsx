import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DocumentCanvas from './DocumentCanvas';

jest.mock('./pdfjsLoader', () => ({ loadPdfjs: jest.fn() }));
const { loadPdfjs } = jest.requireMock('./pdfjsLoader');

const doc = {
  type: 'form' as const,
  pdf_url: 'http://x/a.pdf',
  name: 'Form A'
};
const baseProps = {
  documents: [doc],
  pageWidth: 600,
  onDocLoad: jest.fn(),
  registerPageRef: jest.fn()
};

it('edits text occurrences independently by default without extra controls', async () => {
  // Model pdf.js's document-global sibling lookup, including reused object ids
  // in different PDFs. This is the cross-document regression, not just naming.
  const suffix = (n: string) => `__feathery_occurrence_${n.repeat(32)}`;
  const getAnnotations = async () => [
    {
      id: '1R',
      fieldName: `1own_FullName${suffix('1')}`,
      fieldType: 'Tx',
      fieldValue: 'Owner'
    },
    {
      id: '2R',
      fieldName: `1own_FullName${suffix('2')}`,
      fieldType: 'Tx',
      fieldValue: 'Owner'
    }
  ];
  const proxies: any[] = [];
  loadPdfjs.mockResolvedValue({
    getDocument: () => {
      const values: Record<string, any> = {};
      const proxy = {
        numPages: 1,
        annotationStorage: {
          getValue: (id: string, fallback: any) => values[id] || fallback,
          setValue: (id: string, value: any) => {
            values[id] = value;
          }
        },
        getPage: async () => ({
          getViewport: () => ({ width: 600, height: 800, clone: () => ({}) }),
          getAnnotations,
          render: () => ({ promise: Promise.resolve(), cancel: jest.fn() })
        })
      };
      proxies.push(proxy);
      return { promise: Promise.resolve(proxy) };
    },
    AnnotationMode: { ENABLE_FORMS: 2 },
    AnnotationLayer: class {
      config: any;
      constructor(config: any) {
        this.config = config;
      }

      async render({ annotations }: any) {
        const { div, annotationStorage: storage } = this.config;
        annotations.forEach((a: any) => {
          const input = div.ownerDocument.createElement('input');
          input.id = `pdfjs-${a.id}`;
          input.name = a.fieldName;
          input.setAttribute('data-element-id', a.id);
          input.value = storage.getValue(a.id, { value: a.fieldValue }).value;
          input.addEventListener('input', () => {
            div.ownerDocument
              .getElementsByName(input.name)
              .forEach((el: HTMLElement) => {
                (el as HTMLInputElement).value = input.value;
                storage.setValue(el.getAttribute('data-element-id'), {
                  value: input.value
                });
              });
          });
          div.append(input);
        });
      }
    }
  });
  render(
    <DocumentCanvas
      {...baseProps}
      documents={[doc, { ...doc, pdf_url: 'http://x/b.pdf' }]}
    />
  );
  await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(4));
  const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
  fireEvent.input(inputs[0], { target: { value: 'Updated owner' } });
  expect(inputs.map((i) => i.value)).toEqual([
    'Updated owner',
    'Owner',
    'Owner',
    'Owner'
  ]);
  expect(proxies[1].annotationStorage.getValue('1R', {})).toEqual({});

  fireEvent.focus(inputs[1]);
  expect(
    screen.queryByRole('button', { name: /occurrence/i })
  ).not.toBeInTheDocument();
  expect(inputs[0].name).not.toBe(inputs[1].name);
  fireEvent.input(inputs[1], { target: { value: 'Guardian' } });
  expect(inputs.map((i) => i.value)).toEqual([
    'Updated owner',
    'Guardian',
    'Owner',
    'Owner'
  ]);
  expect(proxies[0].annotationStorage.getValue('2R', {})).toEqual({
    value: 'Guardian'
  });
});

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
    name: 'A'
  };
  const docB = {
    type: 'form' as const,
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

it('destroys loaded documents on unmount and when an attachment is removed', async () => {
  // A pdfProxy holds the parsed document in the pdf.js worker; dropping the
  // reference without destroy() leaks it for the life of the page, so each
  // open/close of the viewer would accumulate another full document.
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
  const destroy = jest.fn();
  const cleanup = jest.fn();
  const getDocument = jest.fn(() => ({
    promise: Promise.resolve({
      numPages: 1,
      annotationStorage: { getAll: () => ({}) },
      getPage: async () => page,
      cleanup,
      destroy
    })
  }));
  loadPdfjs.mockResolvedValue({
    getDocument,
    AnnotationMode: { ENABLE_FORMS: 2, ENABLE: 1 },
    AnnotationLayer: class {
      render() {
        return Promise.resolve();
      }
    }
  });
  const docA = { type: 'form' as const, pdf_url: 'http://x/a.pdf' };
  const docB = { type: 'form' as const, pdf_url: 'http://x/b.pdf' };

  const { rerender, unmount } = render(
    <DocumentCanvas {...baseProps} documents={[docA, docB]} />
  );
  await waitFor(() => expect(getDocument).toHaveBeenCalledTimes(2));

  // Removing the attachment releases just that document.
  rerender(<DocumentCanvas {...baseProps} documents={[docA]} />);
  await waitFor(() => expect(destroy).toHaveBeenCalledTimes(1));

  // Unmounting releases the rest.
  unmount();
  await waitFor(() => expect(destroy).toHaveBeenCalledTimes(2));
  expect(cleanup).toHaveBeenCalled();
});
