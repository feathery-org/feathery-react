import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DocumentsPanel from './DocumentsPanel';

it('lists forms and navigates on click', () => {
  const onNavigate = jest.fn();
  render(
    <DocumentsPanel
      documents={[{ type: 'form', pdf_url: 'u1', form_name: 'Form A' }]}
      onNavigate={onNavigate}
    />
  );
  fireEvent.click(screen.getByText('Form A'));
  expect(onNavigate).toHaveBeenCalledWith('u1', 0);
});

it('renders nothing when there are no forms', () => {
  const { container } = render(
    <DocumentsPanel documents={[]} onNavigate={jest.fn()} />
  );
  expect(container).toBeEmptyDOMElement();
});
