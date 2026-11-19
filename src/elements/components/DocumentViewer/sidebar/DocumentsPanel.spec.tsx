import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DocumentsPanel from './DocumentsPanel';
import { moveItem } from '../index';

it('lists forms and attachments and navigates on click', () => {
  const onNavigate = jest.fn();
  render(
    <DocumentsPanel
      documents={[
        { type: 'form', pdf_url: 'u1', name: 'Form A' },
        { type: 'attachment', file_url: 'f1', file_name: 'notes.csv' }
      ]}
      onNavigate={onNavigate}
    />
  );
  fireEvent.click(screen.getByText('Form A'));
  expect(onNavigate).toHaveBeenCalledWith('u1', 0);
  fireEvent.click(screen.getByText('notes.csv'));
  expect(onNavigate).toHaveBeenCalledWith('f1', 0);
});

it('renders nothing when there are no documents and no packet editing', () => {
  const { container } = render(
    <DocumentsPanel documents={[]} onNavigate={jest.fn()} />
  );
  expect(container).toBeEmptyDOMElement();
});

it('reorders by drag and drop', () => {
  const onMove = jest.fn();
  render(
    <DocumentsPanel
      documents={[
        { type: 'form', pdf_url: 'u1', name: 'A' },
        { type: 'form', pdf_url: 'u2', name: 'B' }
      ]}
      onNavigate={jest.fn()}
      packetEditor={{
        disabled: false,
        onAddFiles: jest.fn(),
        onMove,
        onRemove: jest.fn()
      }}
    />
  );
  const [first, second] = screen.getAllByRole('listitem');
  const dataTransfer = { setData: jest.fn(), files: [] };
  fireEvent.dragStart(first, { dataTransfer });
  fireEvent.dragOver(second, { dataTransfer });
  fireEvent.drop(second, { dataTransfer });
  expect(onMove).toHaveBeenCalledWith(0, 1);

  // A drop between rows lands on the list, which must not move anything.
  onMove.mockClear();
  fireEvent.dragStart(first, { dataTransfer });
  fireEvent.drop(screen.getByRole('list'), { dataTransfer });
  expect(onMove).not.toHaveBeenCalled();
});

it('moveItem moves immutably and ignores out-of-range targets', () => {
  const items = ['a', 'b', 'c'];
  expect(moveItem(items, 2, 0)).toEqual(['c', 'a', 'b']);
  expect(moveItem(items, 0, 3)).toBe(items);
  expect(items).toEqual(['a', 'b', 'c']);
});
