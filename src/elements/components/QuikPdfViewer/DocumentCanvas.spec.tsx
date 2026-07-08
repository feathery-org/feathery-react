import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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
