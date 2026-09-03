import React from 'react';
import { render, waitFor } from '@testing-library/react';

import VersionViewer from './VersionViewer';
import { DocxHistoryHost, DocxVersion } from './types';

// Drive the viewer against a fake ej global and a stubbed loader so no real
// Syncfusion runs; assert it constructs read-only, opens the SFDT, and destroys.
jest.mock('../ejLoader', () => ({
  waitForEj: () => Promise.resolve((globalThis as any).ej),
  loadStyles: jest.fn(),
  waitForDocumentLoad: () => Promise.resolve()
}));
jest.mock('../contentControlSafety', () => ({
  stampMissingContentControlColors: jest.fn()
}));

const construct = jest.fn();
const open = jest.fn();
const openAsync = jest.fn().mockResolvedValue(undefined);
const destroy = jest.fn();

class FakeDocumentEditor {
  documentHelper = { viewerContainer: { style: {} as Record<string, string> } };

  constructor(opts: any) {
    construct(opts);
  }

  appendTo() {
    /* no DOM work in the fake */
  }

  open(sfdt: string) {
    open(sfdt);
  }

  openAsync = openAsync;

  fitPage() {
    /* no-op */
  }

  destroy() {
    destroy();
  }
}

const version = (over: Partial<DocxVersion> = {}): DocxVersion =>
  ({
    id: 'v1',
    session_id: 's1',
    seq: 1,
    is_baseline: false,
    is_current: false,
    name: '',
    started_at: '',
    ended_at: '',
    closed_at: '',
    authors: [],
    actor_label: '',
    actor_name: '',
    restored_from: null,
    restored_from_at: null,
    editor_file: null,
    file: null,
    final_sfdt: null,
    changes: null,
    change_count: null,
    format_change_count: null,
    final_sha256: '',
    highlights_pruned_at: null,
    created_at: '',
    ...over
  } as DocxVersion);

const host = (over: Partial<DocxHistoryHost> = {}): DocxHistoryHost => ({
  listVersions: jest.fn(),
  closeVersion: jest.fn(),
  fetchVersionFile: jest
    .fn()
    .mockResolvedValue(new TextEncoder().encode('{"sfdt":"v"}').buffer),
  restoreVersion: jest.fn(),
  renameVersion: jest.fn(),
  ...over
});

beforeEach(() => {
  construct.mockClear();
  open.mockClear();
  destroy.mockClear();
  (globalThis as any).ej = {
    documenteditor: { DocumentEditor: FakeDocumentEditor }
  };
});

afterEach(() => {
  delete (globalThis as any).ej;
});

describe('VersionViewer', () => {
  it('constructs a read-only editor and opens the version SFDT', async () => {
    render(
      <VersionViewer host={host()} version={version({ final_sfdt: 'u' })} />
    );

    await waitFor(() => expect(construct).toHaveBeenCalled());
    expect(construct.mock.calls[0][0].isReadOnly).toBe(true);
    await waitFor(() => expect(open).toHaveBeenCalledWith('{"sfdt":"v"}'));
  });

  it('destroys the editor on unmount', async () => {
    const view = render(
      <VersionViewer host={host()} version={version({ final_sfdt: 'u' })} />
    );
    await waitFor(() => expect(construct).toHaveBeenCalled());
    view.unmount();
    expect(destroy).toHaveBeenCalled();
  });
});
