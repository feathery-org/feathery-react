import React from 'react';
import { act, render, waitFor } from '@testing-library/react';

import { installRevisionHighlightRendering } from '../useDocxEditor';
import VersionViewer from './VersionViewer';
import { __clearVersionDocumentCache } from './useVersionDocument';
import { colorForAuthor } from './authorColors';
import { applyHunks, diffSession } from './sfdtDiff';
import { DocxHistoryHost, DocxVersion } from './types';

// Drive the viewer against a fake ej global and a stubbed loader so no real
// Syncfusion runs; assert it constructs read-only, opens the SFDT, and destroys.
jest.mock('../ejLoader', () => ({
  waitForEj: () => Promise.resolve((globalThis as any).ej),
  loadStyles: jest.fn(),
  waitForDocumentLoad: () => Promise.resolve(true)
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
const makeInnerEditor = () => {
  const listeners = new Map<string, (args: any) => void>();
  return {
    isReadOnly: false,
    enableSfdtExport: false,
    enableEditorHistory: true,
    enableAutoFocus: true,
    showRevisions: false,
    zoomFactor: 1,
    documentHelper: {
      viewerContainer: { style: {} as Record<string, string> }
    },
    open: (sfdt: string) => open(sfdt),
    openAsync,
    serialize: () => '{"sfdt":"v"}',
    fitPage() {
      /* no-op */
    },
    resize() {
      /* no-op */
    },
    addEventListener(event: string, cb: (args: any) => void) {
      listeners.set(event, cb);
    },
    removeEventListener(event: string, cb: (args: any) => void) {
      if (listeners.get(event) === cb) listeners.delete(event);
    },
    emit(event: string, args: any) {
      listeners.get(event)?.(args);
    }
  };
};

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
  __clearVersionDocumentCache();
  openAsync.mockReset().mockResolvedValue(undefined);
  construct.mockClear();
  open.mockClear();
  destroy.mockClear();
  (installRevisionHighlightRendering as jest.Mock).mockClear();
  (globalThis as any).ej = {
    documenteditor: { DocumentEditorContainer: FakeDocumentEditorContainer }
  };
});

it('destroys a partially-created container and reports a bounded creation failure', async () => {
  jest.useFakeTimers();
  class NeverCreated extends FakeDocumentEditorContainer {
    addEventListener() {
      /* deliberately never fires */
    }
  }
  (globalThis as any).ej.documenteditor.DocumentEditorContainer = NeverCreated;
  const view = render(
    <VersionViewer
      host={host()}
      version={version()}
      liveDoc={{ loading: false, error: false, degraded: true, sfdt: '{}' }}
    />
  );
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    jest.advanceTimersByTime(20_000);
  });
  expect(view.getByText('Couldn’t load this version.')).toBeTruthy();
  expect(destroy).toHaveBeenCalledTimes(1);
  view.unmount();
  jest.useRealTimers();
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
      expect(installRevisionHighlightRendering).toHaveBeenCalledWith(
        lastEditor,
        expect.any(Function),
        { showPendingOutline: true, showActiveRing: true }
      )
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

  it('reopens a DOCX-only version from its cached import without another conversion', async () => {
    const h = host();
    const row = version({ is_baseline: true, editor_file: 'baseline.docx' });
    const displayed = jest.fn();
    const first = render(
      <VersionViewer host={h} version={row} onDisplayedVersion={displayed} />
    );
    await waitFor(() => expect(displayed).toHaveBeenCalled());
    first.unmount();
    displayed.mockClear();
    render(
      <VersionViewer host={h} version={row} onDisplayedVersion={displayed} />
    );
    await waitFor(() => expect(displayed).toHaveBeenCalled());
    expect(openAsync).toHaveBeenCalledTimes(1);
    expect(h.fetchVersionFile).toHaveBeenCalledTimes(1);
  });

  it('destroys the editor on unmount', async () => {
    const view = render(
      <VersionViewer host={host()} version={version({ final_sfdt: 'u' })} />
    );
    await waitFor(() => expect(construct).toHaveBeenCalled());
    await waitFor(() => expect(open).toHaveBeenCalled());
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

  it('combines saved sessions with the live current session, ignoring its stale checkpoint', async () => {
    const doc = (first: string, last: string) => ({
      sections: [
        {
          blocks: [first, 'Unchanged middle', last].map((text) => ({
            inlines: [{ text }]
          }))
        }
      ]
    });
    const baseline = doc('First', 'Last');
    const earlier = doc('First saved edit', 'Last');
    const latest = doc('First saved edit', 'Last unsaved edit');
    const changes = diffSession(
      earlier,
      [{ sfdt: latest, author: 'you' }],
      'live'
    );
    const h = host({
      fetchVersionFile: jest.fn(async (url: string) => {
        const documents: Record<string, unknown> = { baseline, earlier };
        if (!(url in documents))
          throw new Error(`Unexpected stale fetch: ${url}`);
        return new TextEncoder().encode(JSON.stringify(documents[url])).buffer;
      })
    });
    const onMeta = jest.fn();
    render(
      <VersionViewer
        host={h}
        version={version({
          id: 'current',
          session_id: 'live',
          seq: 2,
          is_current: true,
          final_sfdt: 'stale-checkpoint',
          actor_label: 'Bob'
        })}
        folded={{
          earlier: [
            version({
              id: 'earlier',
              seq: 1,
              final_sfdt: 'earlier',
              actor_label: 'Alice'
            })
          ],
          preceding: version({ id: 'baseline', seq: 0, final_sfdt: 'baseline' })
        }}
        liveDoc={{
          loading: false,
          error: false,
          degraded: false,
          sfdt: JSON.stringify(applyHunks(latest, changes)),
          editCount: 1,
          session: {
            sessionId: 'live',
            authors: [{ kind: 'user', key: 'you', label: 'You' }],
            finalSfdt: JSON.stringify(latest),
            changes
          }
        }}
        onMeta={onMeta}
      />
    );
    await waitFor(() => {
      const rendered = JSON.parse(
        open.mock.calls[open.mock.calls.length - 1]?.[0] ?? '{}'
      );
      expect(
        new Set((rendered.revisions ?? []).map((r: any) => r.author))
      ).toEqual(new Set(['Alice', 'Bob']));
    });
    expect(open.mock.calls[open.mock.calls.length - 1][0]).toContain(
      'unsaved edit'
    );
    expect(h.fetchVersionFile).not.toHaveBeenCalledWith('stale-checkpoint');
    expect(onMeta).toHaveBeenLastCalledWith(
      expect.objectContaining({ editCount: 2 })
    );
  });

  it('shows loading without reopening stale bytes while the next version resolves', async () => {
    let resolveSecond: ((value: ArrayBuffer) => void) | undefined;
    const h = host({
      fetchVersionFile: jest.fn((url: string) => {
        if (url === 'second')
          return new Promise<ArrayBuffer>((resolve) => {
            resolveSecond = resolve;
          });
        return Promise.resolve(
          new TextEncoder().encode('{"sfdt":"first"}').buffer
        );
      })
    });
    const view = render(
      <VersionViewer host={h} version={version({ final_sfdt: 'first' })} />
    );
    await waitFor(() => expect(open).toHaveBeenCalledWith('{"sfdt":"first"}'));

    view.rerender(
      <VersionViewer
        host={h}
        version={version({ id: 'v2', final_sfdt: 'second' })}
      />
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.queryByText('Loading version…')).not.toBeNull();
    expect(open).toHaveBeenCalledTimes(1);

    resolveSecond?.(new TextEncoder().encode('{"sfdt":"second"}').buffer);
    await waitFor(() => expect(open).toHaveBeenCalledWith('{"sfdt":"second"}'));
  });

  it('a slow docx import cannot paint over a newer selection', async () => {
    // A docx-only row (baseline) imports via openAsync, which cannot be
    // aborted. Selecting another version mid-import must queue its open AFTER
    // the stale one lands, so the raw (unpopulated) import never wins.
    let resolveImport!: () => void;
    openAsync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveImport = resolve;
        })
    );
    const realFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      arrayBuffer: async () => new ArrayBuffer(4)
    }) as any;
    try {
      const h = host();
      const view = render(
        <VersionViewer
          host={h}
          version={version({ id: 'docx-race', editor_file: 'e.docx' })}
        />
      );
      await waitFor(() => expect(openAsync).toHaveBeenCalled());

      view.rerender(
        <VersionViewer
          host={h}
          version={version({ id: 'sfdt-race', final_sfdt: 'u' })}
        />
      );
      // The newer open waits for the stale import to fully land first.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(open).not.toHaveBeenCalled();

      resolveImport();
      await waitFor(() => expect(open).toHaveBeenCalledWith('{"sfdt":"v"}'));
      // …and the newer document is the last thing opened.
      expect(open).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = realFetch;
    }
  });

  it('shares zoom changes from the preview footer', async () => {
    const onZoomFactorChange = jest.fn();
    const view = render(
      <VersionViewer
        host={host()}
        version={version()}
        liveDoc={{
          loading: false,
          error: false,
          sfdt: '{"live":true}',
          degraded: false
        }}
        zoomFactor={0.9}
        onZoomFactorChange={onZoomFactorChange}
      />
    );
    await waitFor(() => expect(lastEditor.zoomFactor).toBe(0.9));
    lastEditor.emit('zoomFactorChange', { zoomFactor: 1.2 });
    expect(onZoomFactorChange).toHaveBeenCalledWith(1.2);
    view.unmount();
  });

  it('opens accepted content with its original font colour when highlights are off', async () => {
    const sfdt = {
      sections: [
        {
          blocks: [
            {
              inlines: [
                {
                  text: 'Robin edit',
                  revisionIds: ['robin-insertion'],
                  characterFormat: { fontColor: '#2F5496' }
                }
              ]
            }
          ]
        }
      ],
      revisions: [
        {
          author: 'Robin',
          revisionType: 'Insertion',
          revisionId: 'robin-insertion'
        }
      ]
    };

    render(
      <VersionViewer
        host={host()}
        version={version()}
        highlightsOn={false}
        liveDoc={{
          loading: false,
          error: false,
          sfdt: JSON.stringify(sfdt),
          degraded: false
        }}
      />
    );

    await waitFor(() => expect(open).toHaveBeenCalled());
    const opened = JSON.parse(open.mock.calls[0][0]);
    expect(opened.revisions).toBeUndefined();
    expect(opened.sections[0].blocks[0].inlines[0]).toEqual({
      text: 'Robin edit',
      characterFormat: { fontColor: '#2F5496' }
    });
    expect(installRevisionHighlightRendering).not.toHaveBeenCalled();
  });

  it.each(['live', 'saved', 'docx', 'pruned-source'])(
    'opens restored versions without Robin revision highlights from %s even when highlights are on',
    async (source) => {
      const sfdt = JSON.stringify({
        sections: [
          {
            blocks: [
              {
                inlines: [
                  { text: 'Robin edit', revisionIds: ['robin-insertion'] }
                ]
              }
            ]
          }
        ],
        revisions: [
          {
            author: 'Robin',
            revisionType: 'Insertion',
            revisionId: 'robin-insertion'
          }
        ]
      });
      const originalFetch = global.fetch;
      if (source === 'docx') {
        global.fetch = jest.fn().mockResolvedValue({
          arrayBuffer: async () => new ArrayBuffer(0)
        });
        openAsync.mockImplementationOnce(async () => {
          lastEditor.serialize = () => sfdt;
          lastEditor.showRevisions = true;
        });
      }
      try {
        const onMeta = jest.fn();
        render(
          <VersionViewer
            host={host({
              fetchVersionFile: jest
                .fn()
                .mockResolvedValue(new TextEncoder().encode(sfdt).buffer)
            })}
            version={version({
              id: `restored-${source}`,
              restored_from:
                source === 'pruned-source' ? null : 'original-version',
              restored_from_at: '2026-09-17T12:00:00Z',
              final_sfdt:
                source === 'saved' || source === 'pruned-source'
                  ? 'saved-sfdt'
                  : null,
              editor_file: source === 'docx' ? 'restored.docx' : null
            })}
            highlightsOn
            onMeta={onMeta}
            liveDoc={
              source === 'live'
                ? {
                    loading: false,
                    error: false,
                    sfdt,
                    degraded: false,
                    editCount: 1,
                    pendingCount: 1
                  }
                : undefined
            }
          />
        );
        await waitFor(() => expect(onMeta).toHaveBeenCalled());
        const opened = JSON.parse(open.mock.calls[0][0]);
        expect(opened.revisions).toBeUndefined();
        expect(opened.sections[0].blocks[0].inlines).toEqual([
          { text: 'Robin edit' }
        ]);
        expect(lastEditor.showRevisions).toBe(false);
        expect(installRevisionHighlightRendering).not.toHaveBeenCalled();
        expect(onMeta).toHaveBeenLastCalledWith({
          editCount: undefined,
          formatCount: undefined,
          pendingCount: undefined,
          approvedCount: undefined,
          degraded: true
        });
        // Display normalization must not accept or modify the source document.
        expect(JSON.parse(sfdt).revisions).toHaveLength(1);
      } finally {
        global.fetch = originalFetch;
      }
    }
  );
});

it('opens compact Original before applying verbose-key binding transforms', async () => {
  const compact = JSON.stringify({ optimizeSfdt: true, sec: [{ b: [] }] });
  const row = version({ is_baseline: true, final_sfdt: 'original.sfdt' });
  const h = host({
    fetchVersionFile: jest
      .fn()
      .mockResolvedValue(new TextEncoder().encode(compact).buffer)
  });
  render(<VersionViewer host={h} version={row} highlightsOn={false} />);
  await waitFor(() => expect(open).toHaveBeenCalled());
  expect(open.mock.calls[0][0]).toBe(compact);
  expect(openAsync).not.toHaveBeenCalled();
});
