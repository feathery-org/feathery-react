import React from 'react';
import { render, waitFor } from '@testing-library/react';

import { installRevisionHighlightRendering } from '../useDocxEditor';
import VersionViewer from './VersionViewer';
import { colorForAuthor } from './authorColors';
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
jest.mock('../useDocxEditor', () => ({
  installRevisionHighlightRendering: jest.fn(),
  closeTrackedChangeReviewPane: jest.fn()
}));

const construct = jest.fn();
const open = jest.fn();
const openAsync = jest.fn().mockResolvedValue(undefined);
const destroy = jest.fn();

// The inner DocumentEditor a DocumentEditorContainer exposes. The viewer sets
// its read-only/export flags after `created`, so keep a handle to the last one
// to assert against.
let lastEditor: any;
const makeInnerEditor = () => ({
  isReadOnly: false,
  enableSfdtExport: false,
  enableEditorHistory: true,
  enableAutoFocus: true,
  showRevisions: false,
  documentHelper: { viewerContainer: { style: {} as Record<string, string> } },
  open: (sfdt: string) => open(sfdt),
  openAsync,
  serialize: () => '{"sfdt":"v"}',
  fitPage() {
    /* no-op */
  },
  resize() {
    /* no-op */
  }
});

class FakeDocumentEditorContainer {
  documentEditor = (lastEditor = makeInnerEditor());

  constructor(opts: any) {
    construct(opts);
  }

  addEventListener(event: string, cb: () => void) {
    // The viewer waits for `created` before touching the inner editor.
    if (event === 'created') cb();
  }

  appendTo() {
    /* no DOM work in the fake */
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
  (installRevisionHighlightRendering as jest.Mock).mockClear();
  (globalThis as any).ej = {
    documenteditor: { DocumentEditorContainer: FakeDocumentEditorContainer }
  };
});

afterEach(() => {
  delete (globalThis as any).ej;
});

describe('VersionViewer', () => {
  it('paints the stored actor’s edits with the same colour as their history avatar', async () => {
    const actor = 'sam@co.com';
    render(
      <VersionViewer
        host={host()}
        version={version({
          actor_label: actor,
          authors: [{ kind: 'user', label: 'You' }]
        })}
        liveDoc={{
          loading: false,
          error: false,
          sfdt: '{"live":true}',
          degraded: false
        }}
      />
    );
    await waitFor(() =>
      expect(installRevisionHighlightRendering).toHaveBeenCalled()
    );
    const colorForRevision = (installRevisionHighlightRendering as jest.Mock)
      .mock.calls[0][1] as (author: string) => string;
    expect(colorForRevision('you')).toBe(
      colorForAuthor({ kind: 'user', key: actor, label: actor })
    );
  });

  it('constructs a read-only editor and opens the version SFDT', async () => {
    render(
      <VersionViewer host={host()} version={version({ final_sfdt: 'u' })} />
    );

    await waitFor(() => expect(construct).toHaveBeenCalled());
    await waitFor(() => expect(open).toHaveBeenCalledWith('{"sfdt":"v"}'));
    expect(lastEditor.isReadOnly).toBe(true);
  });

  it('opens a saved Current version through its stored SFDT', async () => {
    const h = host();
    render(
      <VersionViewer
        host={h}
        version={version({ is_current: true, final_sfdt: 'saved-current' })}
      />
    );

    await waitFor(() =>
      expect(h.fetchVersionFile).toHaveBeenCalledWith('saved-current')
    );
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

  it('opens a provided liveDoc directly, without fetching the version', async () => {
    const h = host();
    render(
      <VersionViewer
        host={h}
        version={version({ is_current: true })}
        liveDoc={{
          loading: false,
          error: false,
          sfdt: '{"live":true}',
          degraded: false
        }}
      />
    );

    await waitFor(() => expect(open).toHaveBeenCalledWith('{"live":true}'));
    // The live document bypasses the version-file fetch entirely.
    expect(h.fetchVersionFile).not.toHaveBeenCalled();
  });
});
