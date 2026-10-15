import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PptxEditor from '../ui/PptxEditor';
import { sampleBytes } from './harness';

it('offers separate current/all actions on the actual presentation toolbar', async () => {
  const save = jest.fn().mockResolvedValue(undefined);
  const saved = jest.fn();
  const saveAll = jest.fn().mockResolvedValue(undefined);
  const downloadAll = jest.fn().mockResolvedValue(undefined);
  const bytes = sampleBytes();
  const source = { buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
  render(<PptxEditor source={source} onSave={save} onSaved={saved} onSaveAll={saveAll} onDownloadAll={downloadAll} />);
  fireEvent.click(await screen.findByRole('button', { name: /Save/ }));
  fireEvent.click(screen.getByRole('button', { name: 'This document' }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenCalledTimes(1);
  expect(saveAll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  fireEvent.click(screen.getByRole('button', { name: 'All documents' }));
  expect(saveAll).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: /Download/ }));
  expect(screen.getByRole('button', { name: 'This document as PPTX' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'This document as PDF' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'All documents (ZIP)' }));
  expect(downloadAll).toHaveBeenCalledTimes(1);
});
