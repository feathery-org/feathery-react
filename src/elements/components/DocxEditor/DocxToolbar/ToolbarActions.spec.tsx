import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ToolbarActions from './ToolbarActions';

it('routes current and all document saves separately without submitting the form', () => {
  const onSave = jest.fn();
  const onSaveAll = jest.fn();
  const submit = jest.fn((event) => event.preventDefault());
  render(
    <form onSubmit={submit}>
      <ToolbarActions onSave={onSave} onSaveAll={onSaveAll} />
    </form>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  fireEvent.click(screen.getByRole('button', { name: 'This document' }));
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSaveAll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  fireEvent.click(screen.getByRole('button', { name: 'All documents' }));
  expect(onSaveAll).toHaveBeenCalledTimes(1);
  expect(submit).not.toHaveBeenCalled();
});

it.each([false, true])(
  'routes download scopes with terminal=%s',
  (terminal) => {
    const onDownload = jest.fn();
    const onDownloadPdf = jest.fn();
    const onDownloadAll = jest.fn();
    const props = terminal
      ? {
          terminalAction: 'download' as const,
          onTerminalAction: onDownload,
          onTerminalActionPdf: onDownloadPdf
        }
      : { onDownload, onDownloadPdf };
    render(<ToolbarActions {...props} onDownloadAll={onDownloadAll} />);
    for (const [name, callback] of [
      ['This document as DOCX', onDownload],
      ['This document as PDF', onDownloadPdf],
      ['All documents (ZIP)', onDownloadAll]
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: 'Download' }));
      fireEvent.click(screen.getByRole('button', { name }));
      expect(callback).toHaveBeenCalledTimes(1);
    }
  }
);
