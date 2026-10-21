import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import PptxDocumentPacket from './PptxDocumentPacket';
import type FeatheryClient from '../../../utils/featheryClient';
import { sampleBytes } from '../PptxEditor/tests/harness';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

it('promotes the next tab prefetch while retaining the first tab’s edits and history', async () => {
  const response = () => ({
    ok: true,
    arrayBuffer: async () => sampleBytes().buffer
  });
  let finishSecond: ((value: unknown) => void) | undefined;
  const requests = jest.fn((url: string) =>
    url === '/2.pptx'
      ? new Promise((resolve) => {
          finishSecond = resolve;
        })
      : Promise.resolve(response())
  );
  global.fetch = requests as unknown as typeof fetch;
  const tabs = ['1', '2', '3'].map((id) => ({
    id,
    label: `Deck ${id}`,
    envelope: { id, file: `/${id}.pptx`, type: 'pptx', signed: false }
  }));
  const props = {
    tabs,
    reloadKey: 0,
    client: {} as FeatheryClient,
    updateEnvelope: jest.fn(),
    resolveEnvelopes: async () => tabs.map((tab) => tab.envelope),
    registerBeforeReplace: jest.fn(),
    onBusy: jest.fn(),
    onError: jest.fn()
  };
  const { rerender } = render(<PptxDocumentPacket {...props} activeId='1' />);
  await screen.findByRole('button', { name: 'Slide 9' });
  fireEvent.click(screen.getAllByRole('button', { name: 'New slide' })[0]);
  expect(screen.getByRole('button', { name: 'Slide 10' })).toBeInTheDocument();
  await waitFor(() => expect(finishSecond).toBeDefined());
  rerender(<PptxDocumentPacket {...props} activeId='2' />);
  await act(async () => {
    if (!finishSecond) throw new Error('No prefetch to promote');
    finishSecond(response());
  });
  await screen.findByRole('button', { name: 'Slide 9' });
  expect(requests.mock.calls.filter(([url]) => url === '/2.pptx')).toHaveLength(
    1
  );
  rerender(<PptxDocumentPacket {...props} activeId='1' />);
  expect(screen.getByRole('button', { name: 'Slide 10' })).toBeInTheDocument();
  fireEvent.keyDown(screen.getAllByRole('button', { name: 'New slide' })[0], {
    key: 'z',
    ctrlKey: true
  });
  expect(screen.queryByRole('button', { name: 'Slide 10' })).toBeNull();
  expect(requests.mock.calls.filter(([url]) => url === '/1.pptx')).toHaveLength(
    1
  );
  expect(props.onError).not.toHaveBeenCalled();
});
