import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import PptxEditor from '../ui/PptxEditor';
import type { PptxEditorStore } from '../state/PptxEditorStore';
import { sampleBytes } from './harness';

it('opens the changes panel when a suggestion lands and closes it once resolved', async () => {
  const bytes = sampleBytes();
  let store!: PptxEditorStore;
  render(
    <PptxEditor
      source={{
        buffer: bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer
      }}
      reviewChanges
      onReady={(s) => {
        store = s;
      }}
    />
  );
  await waitFor(() => expect(store?.getState().deck).toBeTruthy());
  const changes = () => screen.getByRole('button', { name: 'Tracked edits' });
  expect(changes()).toHaveAttribute('aria-pressed', 'false');

  // Opened by hand with nothing pending, it stays open on its empty state
  fireEvent.click(changes());
  await waitFor(() =>
    expect(changes()).toHaveAttribute('aria-pressed', 'true')
  );
  fireEvent.click(changes());
  expect(changes()).toHaveAttribute('aria-pressed', 'false');

  await act(async () => {
    store.transaction({ origin: 'assistant' }, () =>
      store.engine.execute({
        type: 'add-slide',
        atIndex: store.getState().deck!.slides.length
      })
    );
  });
  await waitFor(() =>
    expect(changes()).toHaveAttribute('aria-pressed', 'true')
  );

  await act(async () => store.undo());
  await waitFor(() =>
    expect(changes()).toHaveAttribute('aria-pressed', 'false')
  );
});
