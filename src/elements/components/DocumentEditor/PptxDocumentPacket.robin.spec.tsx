import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import PptxDocumentPacket from './PptxDocumentPacket';
import type { DocumentTab } from './documentPacket';
import type FeatheryClient from '../../../utils/featheryClient';
import { sampleBytes } from '../PptxEditor/tests/harness';
import { liveDocumentAccessor } from '../../../robin/document/mounts';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

const mountedEnvelope = (formKey: string) =>
  liveDocumentAccessor(formKey).descriptor()?.target.id;

it('mounts only the active deck for Robin and follows a tab switch', async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    arrayBuffer: async () => sampleBytes().buffer
  })) as unknown as typeof fetch;
  const tabs = ['1', '2'].map((id) => ({
    id,
    label: `Deck ${id}`,
    envelope: {
      id: `env_${id}`,
      file: `/${id}.pptx`,
      type: 'pptx',
      signed: false
    }
  }));
  const props = {
    tabs,
    reloadKey: 0,
    client: {} as FeatheryClient,
    formId: 'form-packet-robin',
    containerId: 'c1',
    robinEnabled: true,
    updateEnvelope: jest.fn(),
    resolveTabEnvelope: async (tab: DocumentTab) => tab.envelope ?? null,
    resolveEnvelopes: async () => tabs.map((tab) => tab.envelope),
    registerBeforeReplace: jest.fn(),
    onBusy: jest.fn(),
    onError: jest.fn()
  };
  const { rerender, unmount } = render(
    <PptxDocumentPacket {...props} activeId='1' />
  );
  await screen.findByRole('button', { name: 'Slide 9' });
  await waitFor(() => expect(mountedEnvelope(props.formId)).toBe('env_1'));
  // Robin's suggestions are reviewed in the editor's tracked edits
  expect(
    screen.getAllByRole('button', { name: /Tracked edits/ }).length
  ).toBeGreaterThan(0);

  rerender(<PptxDocumentPacket {...props} activeId='2' />);
  await waitFor(() => expect(mountedEnvelope(props.formId)).toBe('env_2'));

  unmount();
  expect(mountedEnvelope(props.formId)).toBeUndefined();
});

it('mounts nothing for Robin when it is not enabled', async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    arrayBuffer: async () => sampleBytes().buffer
  })) as unknown as typeof fetch;
  const tab = {
    id: '1',
    label: 'Deck',
    envelope: { id: 'env_1', file: '/1.pptx', type: 'pptx', signed: false }
  };
  render(
    <PptxDocumentPacket
      tabs={[tab]}
      activeId='1'
      reloadKey={0}
      client={{} as FeatheryClient}
      formId='form-packet-off'
      containerId='c1'
      updateEnvelope={jest.fn()}
      resolveTabEnvelope={async () => tab.envelope}
      resolveEnvelopes={async () => [tab.envelope]}
      registerBeforeReplace={jest.fn()}
      onBusy={jest.fn()}
      onError={jest.fn()}
    />
  );
  await screen.findByRole('button', { name: 'Slide 9' });
  expect(mountedEnvelope('form-packet-off')).toBeUndefined();
  expect(screen.queryByRole('button', { name: /Tracked edits/ })).toBeNull();
});
