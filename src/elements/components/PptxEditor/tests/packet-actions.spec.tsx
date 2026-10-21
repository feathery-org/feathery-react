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
  const source = {
    buffer: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer
  };
  render(
    <PptxEditor
      source={source}
      onSave={save}
      onSaved={saved}
      onSaveAll={saveAll}
      onDownloadAll={downloadAll}
    />
  );
  const saveButton = await screen.findByRole('button', { name: 'Save' });
  expect(screen.queryByText('All documents saved')).toBeNull();
  fireEvent.click(saveButton);
  expect(
    screen.queryByRole('button', { name: 'Save All Documents' })
  ).toBeNull();
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenCalledTimes(1);
  expect(saveAll).not.toHaveBeenCalled();
  for (const modifier of ['ctrlKey', 'metaKey']) {
    const count = saved.mock.calls.length;
    expect(fireEvent.keyDown(saveButton, { key: 's', [modifier]: true })).toBe(
      false
    );
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(count + 1));
    expect(saveAll).not.toHaveBeenCalled();
    await waitFor(() => expect(saveButton).not.toBeDisabled());
  }
  fireEvent.click(screen.getByRole('button', { name: 'Save options' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save this document' }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(4));
  await waitFor(() => expect(saveButton).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Save options' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save All Documents' }));
  expect(saveAll).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: /Download/ }));
  expect(
    screen.getByRole('button', { name: 'This document as PPTX' })
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'This document as PDF' })
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'All documents (ZIP)' }));
  expect(downloadAll).toHaveBeenCalledTimes(1);
});

it('persists edits made during a background save before marking the deck clean', async () => {
  let finish!: () => void;
  const onSave = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const onChange = jest.fn();
  const bytes = sampleBytes();
  render(
    <PptxEditor
      source={{
        buffer: bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer
      }}
      onSave={onSave}
      onChange={onChange}
    />
  );
  const save = await screen.findByRole('button', { name: 'Save' });
  fireEvent.click(save);
  await waitFor(() => expect(finish).toBeDefined());
  fireEvent.click(screen.getAllByRole('button', { name: 'New slide' })[0]);
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(true));
  finish();
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  expect(onChange).toHaveBeenLastCalledWith(true);
  finish();
  await waitFor(() => expect(save).not.toBeDisabled());
  expect(onChange).toHaveBeenLastCalledWith(false);
  expect(screen.queryByRole('status', { name: 'Unsaved changes' })).toBeNull();
});

it('retains edits and undo history when a loaded editor is hidden and shown again', async () => {
  const ready = jest.fn();
  const bytes = sampleBytes();
  const source = {
    buffer: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer
  };
  const { rerender } = render(<PptxEditor source={source} onReady={ready} />);
  await waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
  const newSlide = screen.getAllByRole('button', { name: 'New slide' })[0];
  fireEvent.click(newSlide);
  expect(screen.getByRole('button', { name: 'Slide 10' })).toBeInTheDocument();
  rerender(<PptxEditor source={source} onReady={ready} visible={false} />);
  rerender(<PptxEditor source={source} onReady={ready} visible />);
  expect(ready).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Slide 10' })).toBeInTheDocument();
  fireEvent.keyDown(screen.getAllByRole('button', { name: 'New slide' })[0], {
    key: 'z',
    ctrlKey: true
  });
  expect(screen.queryByRole('button', { name: 'Slide 10' })).toBeNull();
});
