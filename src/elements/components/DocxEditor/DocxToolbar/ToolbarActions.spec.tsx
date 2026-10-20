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
  expect(
    screen.queryByRole('button', { name: 'Save All Documents' })
  ).toBeNull();
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSaveAll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save options' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save this document' }));
  expect(onSave).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Save options' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save All Documents' }));
  expect(onSaveAll).toHaveBeenCalledTimes(1);
  expect(submit).not.toHaveBeenCalled();
});

it.each([
  { terminal: false, multiple: false },
  { terminal: false, multiple: true },
  { terminal: true, multiple: false },
  { terminal: true, multiple: true }
])(
  'routes download scopes with terminal=$terminal, multiple=$multiple',
  ({ terminal, multiple }) => {
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
    render(
      <ToolbarActions
        {...props}
        onDownloadAll={multiple ? onDownloadAll : undefined}
      />
    );
    for (const [name, callback] of [
      [multiple ? 'This document as DOCX' : 'Download as DOCX', onDownload],
      [multiple ? 'This document as PDF' : 'Download as PDF', onDownloadPdf],
      ['All documents (ZIP)', onDownloadAll]
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: 'Download' }));
      if (!multiple && callback === onDownloadAll) {
        expect(screen.queryByRole('button', { name })).toBeNull();
      } else {
        fireEvent.click(screen.getByRole('button', { name }));
        expect(callback).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name })).toBeNull();
      }
    }
  }
);

it.each([false, true])(
  'shows only unsaved status before Save, compact=%s',
  (compact) => {
    const view = render(
      <ToolbarActions compact={compact} onSave={() => undefined} />
    );
    expect(view.queryByText('All documents saved')).toBeNull();
    expect(view.queryByRole('status')).toBeNull();
    // A visually hidden status still takes up space in the action row.
    expect(view.container.querySelector('[role="status"]')).toBeNull();
    view.rerender(
      <ToolbarActions compact={compact} dirty onSave={() => undefined} />
    );
    const status = screen.getByRole('status', { name: 'Unsaved changes' });
    expect(
      status.nextElementSibling?.contains(
        screen.getByRole('button', { name: 'Save' })
      )
    ).toBe(true);
  }
);

it('does not make a hidden cached editor status visible over the active toolbar', () => {
  const view = render(
    <div style={{ visibility: 'hidden' }}>
      <ToolbarActions dirty onSave={() => undefined} />
    </div>
  );
  const status = view.container.querySelector('[role="status"]');
  if (!status) throw new Error('Missing unsaved status');
  expect(getComputedStyle(status).visibility).not.toBe('visible');
  expect(view.queryByText('All documents saved')).toBeNull();
});
