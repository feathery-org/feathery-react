import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DocumentsPanel from './DocumentsPanel';

const baseProps = {
  documents: [],
  onNavigate: jest.fn(),
  attachments: [],
  onAdd: jest.fn(),
  onRemove: jest.fn(),
  uploading: false
};

it('lists attachments and fires remove', () => {
  const onRemove = jest.fn();
  render(
    <DocumentsPanel
      {...baseProps}
      attachments={[{ name: 'QK-003.pdf' }, { name: 'QK-001.pdf' }]}
      onRemove={onRemove}
    />
  );
  expect(screen.getByText('QK-003.pdf')).toBeInTheDocument();
  fireEvent.click(screen.getAllByLabelText('Remove attachment')[0]);
  expect(onRemove).toHaveBeenCalledWith(0);
});

it('fires add on plus click', () => {
  const clickSpy = jest.spyOn(HTMLInputElement.prototype, 'click');
  render(<DocumentsPanel {...baseProps} />);
  fireEvent.click(screen.getByLabelText('Add attachment'));
  expect(clickSpy).toHaveBeenCalled();
  clickSpy.mockRestore();
});

it('disables add while uploading', () => {
  render(<DocumentsPanel {...baseProps} uploading />);
  expect(screen.getByLabelText('Add attachment')).toBeDisabled();
});

it('lists forms and navigates on click', () => {
  const onNavigate = jest.fn();
  render(
    <DocumentsPanel
      {...baseProps}
      documents={[{ type: 'form', pdf_url: 'u1', form_name: 'Form A' }]}
      onNavigate={onNavigate}
    />
  );
  fireEvent.click(screen.getByText('Form A'));
  expect(onNavigate).toHaveBeenCalledWith('u1', 0);
});
