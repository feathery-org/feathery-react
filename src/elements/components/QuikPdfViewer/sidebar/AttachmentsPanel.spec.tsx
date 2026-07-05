import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AttachmentsPanel from './AttachmentsPanel';

it('lists attachments and fires remove', () => {
  const onRemove = jest.fn();
  render(
    <AttachmentsPanel
      attachments={[{ name: 'QK-003.pdf' }, { name: 'QK-001.pdf' }]}
      onAdd={jest.fn()}
      onRemove={onRemove}
      uploading={false}
    />
  );
  expect(screen.getByText('QK-003.pdf')).toBeInTheDocument();
  fireEvent.click(screen.getAllByLabelText('Remove attachment')[0]);
  expect(onRemove).toHaveBeenCalledWith(0);
});

it('fires add on + click', () => {
  const onAdd = jest.fn();
  const clickSpy = jest.spyOn(HTMLInputElement.prototype, 'click');
  render(
    <AttachmentsPanel
      attachments={[]}
      onAdd={onAdd}
      onRemove={jest.fn()}
      uploading={false}
    />
  );
  fireEvent.click(screen.getByLabelText('Add attachment'));
  expect(clickSpy).toHaveBeenCalled();
  clickSpy.mockRestore();
});
