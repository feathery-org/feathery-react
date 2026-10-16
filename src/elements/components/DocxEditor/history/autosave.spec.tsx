import { act, renderHook } from '@testing-library/react';

import { setAssistantSessionActive } from '../../../../assistant/tools/docx/syncfusionDocumentOps';
import { AUTOSAVE_IDLE_MS } from './autosaveScheduler';
import { DocumentPersistenceError } from '../../../../utils/documentPersistence';
import { applyHunks } from './sfdtDiff';
import {
  useDocxHistorySession,
  UseDocxHistorySessionOptions
} from './useDocxHistorySession';
import { DocxHistoryHost, VersionAuthor } from './types';

const must = <T,>(value: T | null | undefined): T => {
  if (value == null) throw new Error('Expected a value');
  return value;
};

const YOU: VersionAuthor = { kind: 'user', key: 'you', label: 'You' };
const SFDT = JSON.stringify({
  sections: [{ blocks: [{ inlines: [{ text: 'hello' }] }] }]
});

const EDITED_SFDT = JSON.stringify({
  sections: [{ blocks: [{ inlines: [{ text: 'hello world' }] }] }]
});
// The first snapshot is the pristine document; every later one is edited, so
// each session has a real change to save.
const editedEditor = () => {
  let snapshots = 0;
  return { serialize: () => (snapshots++ ? EDITED_SFDT : SFDT) };
};

const makeHost = (): jest.Mocked<DocxHistoryHost> => ({
  listVersions: jest.fn().mockResolvedValue([]),
  closeVersion: jest.fn().mockResolvedValue(null),
  fetchVersionFile: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
  restoreVersion: jest.fn().mockResolvedValue(undefined),
  renameVersion: jest.fn().mockResolvedValue({} as any)
});

const setup = (
  over: Partial<UseDocxHistorySessionOptions> = {},
  editor: any = editedEditor()
) => {
  const save = jest.fn().mockResolvedValue(undefined);
  const exportDoc = jest.fn().mockResolvedValue(new Blob(['docx']));
  const host = makeHost();
  const view = renderHook(() =>
    useDocxHistorySession({
      editor,
      loading: false,
      host,
      currentUser: YOU,
      exportDoc,
      save,
      ...over
    })
  );
  return { view, editor, save, exportDoc, host };
};

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
};

// jsdom's Blob has no .text(); read it the long way.
const blobText = (b: Blob | undefined) =>
  new Promise<string>((resolve, reject) => {
    if (!b) return reject(new Error('Expected a blob'));
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(b);
  });

describe('useDocxHistorySession', () => {
  it.each([false, true])(
    'confirms only revisions actually removed by native acceptance (partial: %s)',
    async (partial) => {
      (globalThis as any).CompressionStream = undefined;
      const document = (acceptFirst: boolean) =>
        JSON.stringify({
          revisions: [
            ...(!acceptFirst
              ? [
                  {
                    author: 'Robin',
                    revisionType: 'Insertion',
                    revisionId: 'r1'
                  }
                ]
              : []),
            { author: 'Robin', revisionType: 'Insertion', revisionId: 'r2' }
          ],
          sections: [
            {
              blocks: [
                {
                  inlines: [
                    {
                      text: 'First suggestion',
                      ...(!acceptFirst ? { revisionIds: ['r1'] } : {})
                    }
                  ]
                },
                { inlines: [{ text: 'Still pending', revisionIds: ['r2'] }] }
              ]
            }
          ]
        });
      let doc = document(false);
      const { view, save, host } = setup({}, { serialize: () => doc });
      await act(async () => {
        await view.result.current.acceptTrackedChanges(
          { beforeSfdt: doc, revisionIds: ['r1', 'r2'] },
          () => {
            if (partial) doc = document(true);
          }
        );
      });
      if (!partial) {
        expect(save).not.toHaveBeenCalled();
        expect(host.closeVersion).not.toHaveBeenCalled();
      } else {
        expect(host.closeVersion).toHaveBeenCalledTimes(1);
        const changes = JSON.parse(
          await blobText(host.closeVersion.mock.calls[0][1].changesJson)
        );
        expect(changes.confirmed).toBe(true);
        expect(changes.hunks.every((h: any) => h.at.block[2] === 0)).toBe(true);
      }
      view.unmount();
    }
  );

  it('saves a new Robin session before uploading its version details', async () => {
    let doc = SFDT;
    const editor: any = { serialize: () => doc };
    const savedSessions = new Set<string>();
    const order: string[] = [];
    const host = makeHost();
    host.closeVersion.mockImplementation(async (sessionId) => {
      order.push('details');
      // The backend rejects a checkpoint for a never-saved session once an
      // earlier version exists (for example immediately after a restore).
      if (!savedSessions.has(sessionId))
        throw new Error('Session was never saved');
      return null;
    });
    const save = jest.fn(async (_blob, meta) => {
      order.push('document');
      savedSessions.add(meta.sessionId);
    });
    const { view } = setup({ host, save }, editor);

    act(() => setAssistantSessionActive(editor, true));
    doc = JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: 'hello Robin' }] }] }]
    });
    act(() => view.result.current.onEdit({ assistant: true }));
    act(() => setAssistantSessionActive(editor, false));
    await flush();

    expect(view.result.current.error).toBeNull();
    expect(order).toEqual(['document', 'details']);
    expect(save.mock.calls[0][1].closeSession).toBeUndefined();
    expect(host.closeVersion.mock.calls[0][0]).toBe(
      save.mock.calls[0][1].sessionId
    );
  });

  it('waits for the Robin document save and keeps its checkpoint snapshot consistent', async () => {
    let doc = SFDT;
    const editor: any = { serialize: () => doc };
    let finishSave!: () => void;
    const { view, host } = setup(
      {
        save: () =>
          new Promise<void>((resolve) => {
            finishSave = resolve;
          })
      },
      editor
    );
    act(() => setAssistantSessionActive(editor, true));
    doc = SFDT.replace('hello', 'hello Robin');
    act(() => view.result.current.onEdit({ assistant: true }));
    act(() => setAssistantSessionActive(editor, false));
    await flush();
    expect(host.closeVersion).not.toHaveBeenCalled();

    doc = SFDT.replace('hello', 'hello Robin and later user text');
    act(() => view.result.current.onEdit({ assistant: false }));
    await act(async () => finishSave());
    await flush();

    expect(host.closeVersion).toHaveBeenCalledTimes(1);
    expect(await blobText(host.closeVersion.mock.calls[0][1].finalSfdtGz)).toBe(
      SFDT.replace('hello', 'hello Robin')
    );
    expect(view.result.current.status).toBe('dirty');
  });

  it('checkpoints each Robin turn inside the throttle window and clears a recovered upload warning', async () => {
    let doc = SFDT;
    const editor: any = { serialize: () => doc };
    const { view, host } = setup({}, editor);
    host.closeVersion.mockRejectedValueOnce(
      new Error('Temporary network failure')
    );

    for (const text of ['first Robin edit', 'second Robin edit']) {
      act(() => setAssistantSessionActive(editor, true));
      doc = SFDT.replace('hello', text);
      act(() => view.result.current.onEdit({ assistant: true }));
      act(() => setAssistantSessionActive(editor, false));
      await flush();
      if (text === 'first Robin edit')
        expect(view.result.current.error).toContain('version details');
    }

    expect(host.closeVersion).toHaveBeenCalledTimes(2);
    expect(view.result.current.error).toBeNull();
    expect(view.result.current.status).toBe('saved');
  });

  it('does not upload Robin version details when its document save fails', async () => {
    const { view, editor, host } = setup({
      save: async () => {
        throw new Error('Document upload failed');
      }
    });
    act(() => setAssistantSessionActive(editor, true));
    act(() => view.result.current.onEdit({ assistant: true }));
    act(() => setAssistantSessionActive(editor, false));
    await flush();

    expect(host.closeVersion).not.toHaveBeenCalled();
    expect(view.result.current.error).toBe('Document upload failed');
  });

  it('preserves a second turn checkpoint requested during an older document save', async () => {
    jest.useFakeTimers();
    let doc = SFDT;
    const editor: any = { serialize: () => doc };
    let finishSave!: () => void;
    const save = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishSave = resolve;
          })
      )
      .mockResolvedValue(undefined);
    const { view, host } = setup({ save }, editor);
    for (const text of ['first Robin edit', 'second Robin edit']) {
      act(() => setAssistantSessionActive(editor, true));
      doc = SFDT.replace('hello', text);
      act(() => view.result.current.onEdit({ assistant: true }));
      act(() => setAssistantSessionActive(editor, false));
      await flush();
    }
    expect(host.closeVersion).not.toHaveBeenCalled();

    await act(async () => finishSave());
    await flush();
    expect(host.closeVersion).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_IDLE_MS);
    });
    await flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(host.closeVersion).toHaveBeenCalledTimes(2);
    expect(await blobText(host.closeVersion.mock.calls[1][1].finalSfdtGz)).toBe(
      SFDT.replace('hello', 'second Robin edit')
    );
    expect(view.result.current.error).toBeNull();
  });

  it('does not return an earlier envelope’s save result after document replacement', async () => {
    const host = makeHost();
    const editor = editedEditor();
    const view = renderHook(
      ({ envelopeId }) =>
        useDocxHistorySession({
          editor,
          loading: false,
          host,
          currentUser: YOU,
          envelopeId,
          exportDoc: async () => new Blob(['docx']),
          save: async () => ({ file: 'old-envelope.docx' })
        }),
      { initialProps: { envelopeId: 'old' } }
    );
    act(() => view.result.current.onEdit({ assistant: false }));
    await act(async () => {
      expect(await view.result.current.save()).toEqual({
        file: 'old-envelope.docx'
      });
    });
    view.rerender({ envelopeId: 'new' });
    await act(async () => {
      expect(await view.result.current.save()).toBeUndefined();
    });
  });
  it('commits bindings before export and retains edits when the binding gate blocks Save', async () => {
    const order: string[] = [];
    let allowed = false;
    const { view, save } = setup({
      canSave: () => {
        order.push('commit');
        return allowed;
      },
      exportDoc: async () => {
        order.push('export');
        return new Blob(['committed']);
      }
    });
    act(() => view.result.current.onEdit({ assistant: false }));
    await expect(view.result.current.save()).rejects.toMatchObject({
      kind: 'blocked'
    });
    expect(view.result.current.isSessionOpen()).toBe(true);
    expect(save).not.toHaveBeenCalled();
    allowed = true;
    await act(async () => {
      await view.result.current.save();
    });
    expect(order).toEqual(['commit', 'commit', 'export']);
  });

  it('keeps the autosave checkpoint aligned with the bytes sent before later edits', async () => {
    jest.useFakeTimers();
    (globalThis as any).CompressionStream = undefined;
    let document = SFDT;
    let finish!: () => void;
    const { view, host } = setup(
      {
        exportDoc: async () => new Blob([document]),
        save: jest.fn(
          () =>
            new Promise<void>((resolve) => {
              finish = resolve;
            })
        )
      },
      { serialize: () => document }
    );
    document = SFDT.replace('hello', 'hello first');
    act(() => view.result.current.onEdit({ assistant: false }));
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_IDLE_MS);
    });
    document = SFDT.replace('hello', 'hello later');
    act(() => view.result.current.onEdit({ assistant: false }));
    await act(async () => {
      finish();
    });
    jest.useRealTimers();
    const sfdt = await blobText(host.closeVersion.mock.calls[0][1].finalSfdtGz);
    expect(sfdt).toContain('hello first');
    expect(sfdt).not.toContain('later');
    view.unmount();
  });
  afterEach(() => jest.useRealTimers());

  it('persists two closing sessions in order while capturing both snapshots immediately', async () => {
    let document = SFDT;
    let finishFirst!: () => void;
    const written: Blob[] = [];
    const { view } = setup(
      {
        exportDoc: () => Promise.resolve(new Blob([document])),
        save: jest.fn(async (blob) => {
          written.push(blob);
          if (written.length === 1)
            await new Promise<void>((resolve) => {
              finishFirst = resolve;
            });
        })
      },
      { serialize: () => document }
    );
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    const firstEdit = SFDT.replace('hello', 'first edit');
    document = firstEdit;
    act(() => {
      view.result.current.onEdit({ assistant: false });
      first = view.result.current.save();
    });
    await flush();
    document = SFDT.replace('hello', 'later edit');
    act(() => {
      view.result.current.onEdit({ assistant: false });
      second = view.result.current.save();
    });
    await flush();
    expect(written).toHaveLength(1);
    finishFirst();
    await act(async () => {
      await Promise.all([first, second]);
    });
    expect(await Promise.all(written.map(blobText))).toEqual([
      firstEdit,
      document
    ]);
  });

  it('retries a failed closed snapshot and returns its actual save result', async () => {
    const result = { file: 'new-saved-document.docx' };
    const save = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(result);
    const { view, host } = setup({ save });
    act(() => view.result.current.onEdit({ assistant: false }));
    await act(async () => {
      await expect(view.result.current.save()).rejects.toThrow();
    });
    await act(async () => {
      await expect(view.result.current.save()).resolves.toEqual(result);
    });
    expect(save.mock.calls[1][0]).toBe(save.mock.calls[0][0]);
    expect(save.mock.calls[1][1].sessionId).toBe(
      save.mock.calls[0][1].sessionId
    );
    expect(host.closeVersion).toHaveBeenCalledTimes(1);
  });

  it('surfaces an auth failure without auto-retrying, and lets Save try again', async () => {
    jest.useFakeTimers();
    const save = jest
      .fn()
      .mockRejectedValueOnce(
        new DocumentPersistenceError('Denied', 'auth', 403)
      )
      .mockResolvedValue(undefined);
    const { view } = setup({ save });
    act(() => view.result.current.onEdit({ assistant: false }));
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_IDLE_MS);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(view.result.current.status).toBe('error');
    expect(view.result.current.error).toBe('Denied');
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      await view.result.current.save();
    });
    // The retained autosave snapshot runs first, then the closing save.
    expect(save).toHaveBeenCalledTimes(3);
    expect(view.result.current.error).toBeNull();
  });

  it('saves under a fresh session when another tab closed this one', async () => {
    const conflict = new DocumentPersistenceError(
      'Session is already closed',
      'conflict',
      400
    );
    const save = jest
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValue(undefined);
    const { view, host } = setup({ save });
    act(() => view.result.current.onEdit({ assistant: false }));
    await act(async () => {
      await view.result.current.save();
    });
    expect(save).toHaveBeenCalledTimes(2);
    const [stale, fresh] = save.mock.calls.map((call) => call[1]);
    expect(fresh.sessionId).not.toBe(stale.sessionId);
    expect(fresh.closeSession).toBe(true);
    expect(save.mock.calls[1][0]).toBe(save.mock.calls[0][0]);
    expect(host.closeVersion.mock.calls[0][0]).toBe(fresh.sessionId);
    expect(view.result.current.error).toBeNull();
  });

  it('moves an autosaving session to a fresh id after a conflict', async () => {
    jest.useFakeTimers();
    const save = jest
      .fn()
      .mockRejectedValueOnce(
        new DocumentPersistenceError(
          'Session is no longer current',
          'conflict',
          400
        )
      )
      .mockResolvedValue(undefined);
    const { view } = setup({ save });
    act(() => view.result.current.onEdit({ assistant: false }));
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_IDLE_MS);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(2);
    const renewed = save.mock.calls[1][1].sessionId;
    expect(renewed).not.toBe(save.mock.calls[0][1].sessionId);
    expect(view.result.current.status).toBe('saved');
    await act(async () => {
      await view.result.current.save();
    });
    expect(save.mock.calls[2][1]).toMatchObject({
      sessionId: renewed,
      closeSession: true
    });
  });

  it('does not wedge later saves when the fresh-session retry also fails', async () => {
    const conflict = () =>
      new DocumentPersistenceError(
        'Session is already closed',
        'conflict',
        400
      );
    const save = jest
      .fn()
      .mockRejectedValueOnce(conflict())
      .mockRejectedValueOnce(conflict())
      .mockResolvedValue(undefined);
    const { view } = setup({ save });
    act(() => view.result.current.onEdit({ assistant: false }));
    await act(async () => {
      await expect(view.result.current.save()).rejects.toMatchObject({
        kind: 'conflict'
      });
    });
    expect(view.result.current.error).toBe('Session is already closed');
    act(() => view.result.current.onEdit({ assistant: false }));
    await act(async () => {
      await view.result.current.save();
    });
    const ids = save.mock.calls.map((call) => call[1].sessionId);
    expect(ids[1]).not.toBe(ids[0]);
    // The retained snapshot retries under its fresh id, never the stale one.
    expect(ids[2]).toBe(ids[1]);
    expect(save).toHaveBeenCalledTimes(4);
    expect(view.result.current.error).toBeNull();
  });

  it('drops version details another tab already finalized instead of retrying them', async () => {
    const { view, host } = setup();
    host.closeVersion.mockRejectedValue(
      new DocumentPersistenceError(
        'Version artifacts are already finalized',
        'conflict',
        400
      )
    );
    act(() => view.result.current.onEdit({ assistant: false }));
    await act(async () => {
      await view.result.current.save();
    });
    expect(view.result.current.error).toBeNull();
    await act(async () => {
      await view.result.current.save();
    });
    expect(host.closeVersion).toHaveBeenCalledTimes(1);
  });

  it('waits for an already-closing document before allowing restore', async () => {
    let finish!: () => void;
    const { view } = setup({
      save: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    });
    act(() => view.result.current.onEdit({ assistant: false }));
    let closing!: Promise<unknown>;
    act(() => {
      closing = view.result.current.save();
    });
    await flush();
    let ready = false;
    const restoring = view.result.current.saveForRestore().then(() => {
      ready = true;
    });
    await flush();
    expect(ready).toBe(false);
    finish();
    await act(async () => {
      await Promise.all([closing, restoring]);
    });
    expect(ready).toBe(true);
  });

  it('marks dirty on edit and, on explicit save, PATCHes with session meta and closes', async () => {
    const { view, save, host } = setup();

    act(() => view.result.current.onEdit({ assistant: false }));
    expect(view.result.current.status).toBe('dirty');
    expect(view.result.current.isSessionOpen()).toBe(true);

    await act(async () => {
      await view.result.current.save();
    });

    expect(save).toHaveBeenCalledTimes(1);
    const [, meta] = save.mock.calls[0];
    expect(meta.sessionId).toBeTruthy();
    expect(meta.closeSession).toBe(true);
    expect(meta.authors).toEqual([{ kind: 'user', label: 'You' }]);
    // The close uploads the final document and the diffed change list.
    expect(host.closeVersion).toHaveBeenCalledTimes(1);
    const closePayload = host.closeVersion.mock.calls[0][1];
    expect(host.closeVersion.mock.calls[0][0]).toBe(meta.sessionId);
    expect(closePayload.changeCount).toBeGreaterThan(0);
    expect(closePayload.changesJson).toBeInstanceOf(Blob);
    expect(closePayload.finalSfdtGz).toBeInstanceOf(Blob);
    expect(view.result.current.isSessionOpen()).toBe(false);
    expect(view.result.current.previewSession()).toBeNull();
    expect(view.result.current.savedAt).not.toBeNull();
  });

  it('lets restore proceed after the document snapshot while holding its diff upload', async () => {
    const { view, save, host } = setup();
    let releaseClose: (() => void) | undefined;
    host.closeVersion.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseClose = () => resolve(null);
        })
    );
    act(() => view.result.current.onEdit({ assistant: false }));

    await act(async () => {
      await view.result.current.saveForRestore();
    });

    // The DOCX snapshot is durable before restore starts, but the expensive
    // diff upload has not entered the network queue yet.
    expect(save).toHaveBeenCalledTimes(1);
    expect(host.closeVersion).not.toHaveBeenCalled();

    act(() => view.result.current.finishRestoreSave());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
    expect(host.closeVersion).toHaveBeenCalledTimes(1);
    releaseClose?.();
    await flush();
  });

  it('propagates a document save failure and does not close history', async () => {
    const { view, save, host } = setup();
    save.mockRejectedValueOnce(new Error('network failure'));

    act(() => view.result.current.onEdit({ assistant: false }));

    await expect(
      act(async () => {
        await view.result.current.save();
      })
    ).rejects.toThrow('network failure');
    expect(host.closeVersion).not.toHaveBeenCalled();
  });

  it('diffs the session and uploads real hunks when the document changed', async () => {
    // Baseline is snapshotted at open (pristine 'hello'); F is 'hello world'.
    let doc = JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: 'hello' }] }] }]
    });
    const editor: any = { serialize: () => doc };
    const { view, host } = setup({}, editor);

    act(() => view.result.current.onEdit({ assistant: false }));
    doc = JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: 'hello world' }] }] }]
    });
    await act(async () => {
      await view.result.current.save(); // close → diff S0 vs F
    });

    const closePayload = host.closeVersion.mock.calls[0][1];
    expect(closePayload.changeCount).toBeGreaterThan(0);
    expect(closePayload.changesJson).toBeInstanceOf(Blob);
  });

  it('diffs the first edit even though contentChange fires after it applies', async () => {
    // contentChange fires AFTER the edit applies, so S0 must come from the
    // pristine document captured at open, not from the first onEdit.
    let doc = JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: 'hello' }] }] }]
    });
    const editor: any = { serialize: () => doc };
    const { view, host } = setup({}, editor);
    await flush(); // let the open-capture effect snapshot the pristine baseline

    // The edit has already been applied by the time onEdit runs.
    doc = JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: 'hello world' }] }] }]
    });
    act(() => view.result.current.onEdit({ assistant: false }));
    await act(async () => {
      await view.result.current.save();
    });

    const closePayload = host.closeVersion.mock.calls[0][1];
    expect(closePayload.changeCount).toBeGreaterThan(0);
  });

  it('stores accepting a tracked Robin edit as its own confirmed Robin version', async () => {
    (globalThis as any).CompressionStream = undefined;
    const original = JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: 'hello' }] }] }]
    });
    const pending = JSON.stringify({
      revisions: [
        {
          author: 'Robin (assistant)',
          revisionType: 'Insertion',
          revisionId: 'r-robin',
          customData: JSON.stringify({
            v: 1,
            source: 'robin',
            changeSetId: 'cs-1',
            group: 'update-premium-table'
          })
        }
      ],
      sections: [
        {
          blocks: [
            {
              inlines: [
                { text: 'hello' },
                { text: ' robin', revisionIds: ['r-robin'] }
              ]
            }
          ]
        }
      ]
    });
    const accepted = JSON.stringify({
      sections: [
        {
          blocks: [{ inlines: [{ text: 'hello' }, { text: ' robin' }] }]
        }
      ]
    });
    let doc = original;
    const editor: any = { serialize: () => doc };
    const { view, save, host } = setup({}, editor);
    await flush();

    // Robin authors a pending suggestion in the current session.
    doc = pending;
    act(() => view.result.current.onEdit({ assistant: true }));

    await act(async () => {
      await view.result.current.acceptTrackedChanges(
        { beforeSfdt: pending, revisionIds: ['r-robin'] },
        () => {
          doc = accepted;
          // Syncfusion's native accept emits this synchronously.
          view.result.current.onEdit({ assistant: false });
        }
      );
    });

    // The pending edit and its later confirmation are separate versions.
    expect(save).toHaveBeenCalledTimes(2);
    expect(host.closeVersion).toHaveBeenCalledTimes(2);
    expect(host.closeVersion.mock.calls[0][0]).not.toBe(
      host.closeVersion.mock.calls[1][0]
    );

    const confirmationPayload = host.closeVersion.mock.calls[1][1];
    const changes = JSON.parse(await blobText(confirmationPayload.changesJson));
    expect(confirmationPayload.startSha256).not.toBe(
      confirmationPayload.finalSha256
    );
    expect(changes.confirmed).toBe(true);
    expect(changes.changeCount).toBeGreaterThan(0);
    expect(changes.hunks.every((h: any) => h.author === 'robin')).toBe(true);
    expect(changes.trackedAuthors).toEqual(['robin']);
    expect(changes.robinRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ group: 'update-premium-table' })
      ])
    );
    expect(save.mock.calls[1][1].authors).toEqual([
      { kind: 'assistant', label: 'Robin' }
    ]);

    const display = applyHunks(JSON.parse(accepted), changes);
    const customData = (display.revisions ?? []).map((revision: any) =>
      JSON.parse(revision.customData)
    );
    expect(customData.length).toBeGreaterThan(0);
    expect(customData.every((data: any) => data.confirmed === true)).toBe(true);
    expect(customData.every((data: any) => !data.pending)).toBe(true);
    expect(
      customData.every((data: any) => data.group === 'update-premium-table')
    ).toBe(true);
  });

  it.each([false, true])(
    'preserves the pending current version before accepting after a reload (has artifacts: %s)',
    async (hasArtifacts) => {
      (globalThis as any).CompressionStream = undefined;
      const pending = JSON.stringify({
        revisions: [
          {
            author: 'Robin (assistant)',
            revisionType: 'Insertion',
            revisionId: 'r-robin'
          }
        ],
        sections: [
          {
            blocks: [
              {
                inlines: [
                  { text: 'hello' },
                  { text: ' robin', revisionIds: ['r-robin'] }
                ]
              }
            ]
          }
        ]
      });
      const accepted = JSON.stringify({
        sections: [
          {
            blocks: [{ inlines: [{ text: 'hello' }, { text: ' robin' }] }]
          }
        ]
      });
      let doc = pending;
      const editor: any = { serialize: () => doc };
      const { view, host } = setup({}, editor);
      host.listVersions.mockResolvedValue([
        {
          is_current: true,
          session_id: 'pending-session',
          authors: [
            { kind: 'user', label: 'You' },
            { kind: 'assistant', label: 'Robin' }
          ],
          ...(hasArtifacts
            ? {
                final_sfdt: 'saved-final',
                changes: 'saved-mixed-author-changes'
              }
            : {})
        } as any
      ]);
      await flush();

      // The page loaded with a pending tracked edit, so there is no open local
      // tracker session when the user accepts it.
      expect(view.result.current.isSessionOpen()).toBe(false);
      await act(async () => {
        await view.result.current.acceptTrackedChanges(
          { beforeSfdt: pending, revisionIds: ['r-robin'] },
          () => {
            doc = accepted;
          }
        );
      });

      if (hasArtifacts) {
        // Existing attribution is immutable: rebuilding from pending revisions
        // alone cannot recover the human edits in the original session.
        expect(host.closeVersion).toHaveBeenCalledTimes(1);
        expect(host.closeVersion.mock.calls[0][0]).not.toBe('pending-session');
        return;
      }

      // Snapshot the existing pending row first, then store confirmation in a
      // distinct session. Otherwise both rows render as approved versions.
      expect(host.closeVersion).toHaveBeenCalledTimes(2);
      expect(host.closeVersion.mock.calls[0][0]).toBe('pending-session');
      expect(host.closeVersion.mock.calls[1][0]).not.toBe('pending-session');

      const pendingPayload = host.closeVersion.mock.calls[0][1];
      // Missing original slices cannot be reconstructed from pending text.
      // Keep its native revisions and leave the backend's known authors intact.
      expect(await blobText(pendingPayload.finalSfdtGz)).toBe(pending);
      expect(pendingPayload.changesJson).toBeUndefined();
      expect(pendingPayload.startSha256).toBe('');

      const confirmationChanges = JSON.parse(
        await blobText(host.closeVersion.mock.calls[1][1].changesJson)
      );
      expect(confirmationChanges.confirmed).toBe(true);
    }
  );

  it('previewSession returns a highlighted display document for the open session', async () => {
    let doc = JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: 'hello' }] }] }]
    });
    const editor: any = { serialize: () => doc };
    const { view } = setup({}, editor);
    await flush(); // capture the pristine baseline

    doc = JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: 'hello world' }] }] }]
    });
    act(() => view.result.current.onEdit({ assistant: false }));

    const preview = view.result.current.previewSession();
    expect(preview).not.toBeNull();
    expect(must(preview).editCount).toBeGreaterThan(0);
    // applyHunks baked synthetic revisions into the display document.
    expect(must(preview).sfdt).toContain('revisionId');
    expect(must(preview).authors).toEqual([YOU]);
    expect(must(preview).sessionId).toBeTruthy();
  });

  it('derives live avatars from surviving edits, clearing them after undo', async () => {
    let text = 'hello';
    const editor = {
      serialize: () =>
        JSON.stringify({ sections: [{ blocks: [{ inlines: [{ text }] }] }] })
    };
    const { view } = setup({}, editor);
    text = 'hello human';
    act(() => view.result.current.onEdit({ assistant: false }));
    text = 'hello human robin';
    act(() => view.result.current.onEdit({ assistant: true }));
    expect(view.result.current.previewSession()?.authors).toEqual([
      YOU,
      { kind: 'assistant', key: 'robin', label: 'Robin' }
    ]);
    text = 'hello human';
    act(() => view.result.current.onEdit({ assistant: false }));
    expect(view.result.current.previewSession()?.authors).toEqual([YOU]);
    text = 'hello';
    act(() => view.result.current.onEdit({ assistant: false }));
    const preview = view.result.current.previewSession();
    expect(preview?.authors).toEqual([]);
    expect(preview?.editCount).toBe(0);
  });

  it('previewSession is null with no open session', () => {
    const { view } = setup();
    expect(view.result.current.previewSession()).toBeNull();
  });

  it('does not save or version a session that changed nothing', async () => {
    const onUnchanged = jest.fn();
    const { view, save, host } = setup(
      { onUnchanged },
      { serialize: () => SFDT }
    );

    act(() => view.result.current.onEdit({ assistant: false }));
    await act(async () => {
      await view.result.current.save();
    });

    expect(save).not.toHaveBeenCalled();
    expect(host.closeVersion).not.toHaveBeenCalled();
    expect(view.result.current.isSessionOpen()).toBe(false);
    expect(view.result.current.status).toBe('saved');
    // The editor clears its "Unsaved changes" mark from this.
    expect(onUnchanged).toHaveBeenCalledTimes(1);
  });

  it('does not autosave a session that still matches its start', async () => {
    jest.useFakeTimers();
    const onUnchanged = jest.fn();
    const { view, save } = setup({ onUnchanged }, { serialize: () => SFDT });

    act(() => view.result.current.onEdit({ assistant: false }));
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_IDLE_MS);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });

    expect(save).not.toHaveBeenCalled();
    expect(onUnchanged).toHaveBeenCalledTimes(1);
  });

  it('skips a session whose edit was undone before it ever saved', async () => {
    let doc = SFDT;
    const { view, save, host } = setup({}, { serialize: () => doc });

    doc = EDITED_SFDT;
    act(() => view.result.current.onEdit({ assistant: false }));
    doc = SFDT;
    act(() => view.result.current.onEdit({ assistant: false }));
    await act(async () => {
      await view.result.current.save();
    });

    expect(save).not.toHaveBeenCalled();
    expect(host.closeVersion).not.toHaveBeenCalled();
  });

  it('saves a session whose only change is accepting a suggestion', async () => {
    // Accepting a tracked insertion leaves the same text, so a fingerprint that
    // ignores revision marks would call it unchanged and lose the accept.
    const pending = JSON.stringify({
      sections: [
        { blocks: [{ inlines: [{ text: 'Added', revisionIds: ['r1'] }] }] }
      ],
      revisions: [
        { author: 'Robin', revisionType: 'Insertion', revisionId: 'r1' }
      ]
    });
    const accepted = JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: 'Added' }] }] }]
    });
    let doc = pending;
    const { view, save } = setup({}, { serialize: () => doc });

    doc = accepted;
    act(() => view.result.current.onEdit({ assistant: false }));
    await act(async () => {
      await view.result.current.save();
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1].closeSession).toBe(true);
  });

  it('still closes a session that saved before its edits were undone', async () => {
    jest.useFakeTimers();
    let doc = SFDT;
    const onUnchanged = jest.fn();
    const { view, save, host } = setup(
      { onUnchanged },
      { serialize: () => doc }
    );

    doc = EDITED_SFDT;
    act(() => view.result.current.onEdit({ assistant: false }));
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_IDLE_MS);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(1);

    // The undo must reach the live file, so the stored row is closed normally.
    doc = SFDT;
    act(() => view.result.current.onEdit({ assistant: false }));
    await act(async () => {
      await view.result.current.save();
    });

    expect(save).toHaveBeenCalledTimes(2);
    const closing = save.mock.calls[1][1];
    expect(closing.closeSession).toBe(true);
    expect(host.closeVersion).toHaveBeenLastCalledWith(
      closing.sessionId,
      expect.anything()
    );
    // A real save clears the mark itself; this path must not claim it.
    expect(onUnchanged).not.toHaveBeenCalled();
  });

  it('autosaves with the session id (no close flag) after the idle window', async () => {
    jest.useFakeTimers();
    const { view, save } = setup();

    act(() => view.result.current.onEdit({ assistant: false }));
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_IDLE_MS);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });

    expect(save).toHaveBeenCalledTimes(1);
    const [, meta] = save.mock.calls[0];
    expect(meta.sessionId).toBeTruthy();
    expect(meta.closeSession).toBeUndefined();
  });

  it('piggybacks a throttled redline checkpoint on the autosave, without closing', async () => {
    jest.useFakeTimers();
    let doc = JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: 'hello' }] }] }]
    });
    const editor: any = { serialize: () => doc };
    const { view, save, host } = setup({}, editor);

    doc = JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: 'hello world' }] }] }]
    });
    act(() => view.result.current.onEdit({ assistant: false }));
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_IDLE_MS);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });

    // The autosave PATCHed without a close flag, AND the checkpoint uploaded
    // the session's redlines — so an abandoned session keeps its highlights.
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1].closeSession).toBeUndefined();
    expect(host.closeVersion).toHaveBeenCalledTimes(1);

    // A second autosave inside the throttle window does NOT checkpoint again.
    act(() => view.result.current.onEdit({ assistant: false }));
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_IDLE_MS);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(host.closeVersion).toHaveBeenCalledTimes(1);
  });

  it('checkpoints (uploads redlines) on assistant turn end WITHOUT closing the session', async () => {
    const { view, editor, save, host } = setup();

    setAssistantSessionActive(editor, true); // a turn is under way
    act(() => view.result.current.onEdit({ assistant: true }));
    act(() => setAssistantSessionActive(editor, false)); // turn ends
    await flush();

    // The turn's redlines are uploaded (durable) via the close endpoint...
    expect(host.closeVersion).toHaveBeenCalledTimes(1);
    expect(host.closeVersion.mock.calls[0][1].authors).toEqual([
      { kind: 'assistant', label: 'Robin' }
    ]);
    // ...but the session is NOT closed: no close-flag PATCH fired, so user and
    // assistant edits keep sharing this session.
    expect(save.mock.calls.some((c) => c[1]?.closeSession === true)).toBe(
      false
    );

    // A follow-up user edit continues the SAME session (no new session opened):
    // an explicit save then closes it, and closeVersion is called for that same
    // session id.
    act(() => view.result.current.onEdit({ assistant: false }));
    const sessionId = host.closeVersion.mock.calls[0][0];
    await act(async () => {
      await view.result.current.save();
    });
    expect(host.closeVersion.mock.calls.at(-1)?.[0]).toBe(sessionId);
  });

  it('refreshes version history after a Current checkpoint finishes uploading', async () => {
    const { view, editor, host } = setup();
    let finishUpload: () => void = () => undefined;
    host.closeVersion.mockImplementation(
      () =>
        new Promise<any>((resolve) => {
          finishUpload = () => resolve(null);
        })
    );

    act(() => setAssistantSessionActive(editor, true));
    act(() => view.result.current.onEdit({ assistant: true }));
    act(() => setAssistantSessionActive(editor, false));
    await flush();
    expect(host.closeVersion).toHaveBeenCalledTimes(1);
    const documentSavedAt = view.result.current.savedAt;
    expect(documentSavedAt).not.toBeNull();

    await act(async () => {
      finishUpload();
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(view.result.current.savedAt).not.toBeNull();
    expect(view.result.current.savedAt).not.toBe(documentSavedAt);
  });

  it('attributes Robin’s first op to Robin via the pre-turn snapshot', async () => {
    // At the user→Robin boundary the document already holds Robin's first op,
    // so the slice must come from the turn-start snapshot.
    (globalThis as any).CompressionStream = undefined; // changesJson as raw JSON
    let doc = JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: 'hello' }] }] }]
    });
    const editor: any = { serialize: () => doc };
    const { view, host } = setup({}, editor);
    await flush(); // pristine baseline

    // The user types first.
    doc = JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: 'hello user' }] }] }]
    });
    act(() => view.result.current.onEdit({ assistant: false }));

    // Robin's turn starts (snapshot taken), THEN its first op applies.
    act(() => setAssistantSessionActive(editor, true));
    doc = JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: 'hello user robin' }] }] }]
    });
    act(() => view.result.current.onEdit({ assistant: true }));
    act(() => setAssistantSessionActive(editor, false)); // turn end → close
    await flush();

    const payload = host.closeVersion.mock.calls[0][1];
    const changes = JSON.parse(await blobText(payload.changesJson));
    const authorsOf = (needle: string) =>
      changes.hunks
        .filter((h: any) => JSON.stringify(h).includes(needle))
        .map((h: any) => h.author);
    expect(authorsOf('robin')).toContain('robin');
    // The user's own insertion stays the user's.
    expect(changes.hunks.some((h: any) => h.author === 'you')).toBe(true);
  });

  it('preserves both authors when a user edits after Robin in the same session', async () => {
    (globalThis as any).CompressionStream = undefined;
    const document = (userText: string, robinText = '') =>
      JSON.stringify({
        sections: [
          {
            blocks: [
              { inlines: [{ text: userText }] },
              {
                inlines: [
                  { text: 'Assistant paragraph' },
                  ...(robinText
                    ? [{ text: robinText, revisionIds: ['r1'] }]
                    : [])
                ]
              }
            ]
          }
        ],
        revisions: robinText
          ? [{ author: 'Robin', revisionType: 'Insertion', revisionId: 'r1' }]
          : []
      });
    let doc = document('User paragraph');
    const editor: any = { serialize: () => doc };
    const { view, host } = setup({}, editor);
    await flush();
    act(() => setAssistantSessionActive(editor, true));
    doc = document('User paragraph', ' robin addition');
    act(() => view.result.current.onEdit({ assistant: true }));
    act(() => setAssistantSessionActive(editor, false));
    await flush();
    doc = document('User paragraph human addition', ' robin addition');
    act(() => view.result.current.onEdit({ assistant: false }));

    const preview = JSON.parse(must(view.result.current.previewSession()).sfdt);
    expect(preview.revisions.map((r: any) => r.author)).toEqual(
      expect.arrayContaining(['you', 'robin'])
    );
    await act(async () => {
      await view.result.current.save();
    });
    const payload = host.closeVersion.mock.calls.slice(-1)[0][1];
    const changes = JSON.parse(await blobText(payload.changesJson));
    expect(changes.trackedAuthors).toEqual(
      expect.arrayContaining(['you', 'robin'])
    );
  });

  it('keeps repeated human text human across Robin turns and acceptance', async () => {
    (globalThis as any).CompressionStream = undefined;
    const document = (human: string, robin: string, pending: boolean) =>
      JSON.stringify({
        sections: [
          {
            blocks: [
              { inlines: [{ text: 'Human: ' + human }] },
              {
                inlines: [
                  { text: 'Robin: ' },
                  { text: robin, ...(pending ? { revisionIds: ['r1'] } : {}) }
                ]
              }
            ]
          }
        ],
        revisions: pending
          ? [{ author: 'Robin', revisionType: 'Insertion', revisionId: 'r1' }]
          : []
      });
    let doc = document('', '', false);
    const editor: any = { serialize: () => doc };
    const { view, host } = setup({}, editor);
    await flush();
    doc = document('same words', '', false);
    act(() => view.result.current.onEdit({ assistant: false }));
    act(() => setAssistantSessionActive(editor, true));
    doc = document('same words', 'same words', true);
    act(() => view.result.current.onEdit({ assistant: true }));
    // Human input between tool calls, while the turn remains active.
    doc = document('same words typed later', 'same words', true);
    act(() => view.result.current.onEdit({ assistant: false }));
    act(() => setAssistantSessionActive(editor, false));
    await flush();
    const pending = doc;
    await act(async () => {
      await view.result.current.acceptTrackedChanges(
        { beforeSfdt: pending, revisionIds: ['r1'] },
        () => {
          doc = document('same words typed later', 'same words', false);
          view.result.current.onEdit({ assistant: false });
        }
      );
    });
    const closes = host.closeVersion.mock.calls.slice(-2);
    const preceding = JSON.parse(await blobText(closes[0][1].changesJson));
    expect(preceding.trackedAuthors).toEqual(
      expect.arrayContaining(['you', 'robin'])
    );
    const display = applyHunks(JSON.parse(pending), preceding);
    const humanRevisionIds = display.sections[0].blocks[0].inlines.flatMap(
      (inline: any) => inline.revisionIds ?? []
    );
    expect(
      display.revisions
        .filter((r: any) => humanRevisionIds.includes(r.revisionId))
        .every(
          (r: any) => r.author === 'you' && !JSON.parse(r.customData).pending
        )
    ).toBe(true);
    const confirmation = JSON.parse(await blobText(closes[1][1].changesJson));
    expect(confirmation.trackedAuthors).toEqual(['robin']);
    expect(confirmation.confirmed).toBe(true);
  });

  it('captures the replacement document baseline when reusing an editor', async () => {
    const document = (text: string) =>
      JSON.stringify({
        sections: [{ blocks: [{ inlines: [{ text }] }] }]
      });
    let doc = document('Old document');
    const editor = { serialize: () => doc };
    const host = makeHost();
    const view = renderHook(
      ({ openNonce }) =>
        useDocxHistorySession({
          editor,
          host,
          loading: false,
          currentUser: YOU,
          openNonce,
          exportDoc: async () => new Blob(['docx']),
          save: async () => undefined
        }),
      { initialProps: { openNonce: 0 } }
    );
    doc = document('Replacement');
    view.rerender({ openNonce: 1 });
    doc = document('Replacement edited');
    act(() => view.result.current.onEdit({ assistant: false }));
    const preview = view.result.current.previewSession();
    expect(preview).not.toBeNull();
    expect(must(preview).sfdt).not.toContain('Old document');
  });

  it('saves DOCX and history from the same snapshot while later typing stays dirty', async () => {
    (globalThis as any).CompressionStream = undefined;
    const document = (text: string) =>
      JSON.stringify({
        sections: [{ blocks: [{ inlines: [{ text }] }] }]
      });
    let doc = document('start');
    const { view, save, host } = setup(
      {
        exportDoc: () => Promise.resolve(new Blob([doc]))
      },
      { serialize: () => doc }
    );
    doc = document('start Robin');
    act(() => view.result.current.onEdit({ assistant: true }));
    let closing!: Promise<unknown>;
    act(() => {
      closing = view.result.current.save();
      doc = document('start Robin later human');
      view.result.current.onEdit({ assistant: false });
    });
    await act(async () => {
      await closing;
    });
    const savedDocx = await blobText(save.mock.calls[0][0]);
    const savedSfdt = await blobText(
      host.closeVersion.mock.calls[0][1].finalSfdtGz
    );
    expect(savedDocx).toBe(savedSfdt);
    expect(savedDocx).not.toContain('later human');
    expect(view.result.current.status).toBe('dirty');
  });

  it('keeps typing during the pre-accept save out of Robin confirmation attribution', async () => {
    (globalThis as any).CompressionStream = undefined;
    const document = (human: string, pending: boolean) =>
      JSON.stringify({
        sections: [
          {
            blocks: [
              { inlines: [{ text: human }] },
              {
                inlines: [
                  {
                    text: 'Robin suggestion',
                    ...(pending ? { revisionIds: ['r1'] } : {})
                  }
                ]
              }
            ]
          }
        ],
        revisions: pending
          ? [{ author: 'Robin', revisionType: 'Insertion', revisionId: 'r1' }]
          : []
      });
    let doc = document('Draft', true);
    const { view, save, host } = setup({}, { serialize: () => doc });
    doc = document('Human', true);
    act(() => view.result.current.onEdit({ assistant: true }));
    save.mockImplementationOnce(async () => {
      doc = document('Human types during save', true);
      view.result.current.onEdit({ assistant: false });
    });
    await act(async () => {
      await view.result.current.acceptTrackedChanges(
        { beforeSfdt: doc, revisionIds: ['r1'] },
        () => {
          doc = document('Human types during save', false);
          view.result.current.onEdit({ assistant: false });
        }
      );
    });
    // Original session, intervening human edit, then the acceptance itself.
    expect(host.closeVersion).toHaveBeenCalledTimes(3);
    const human = JSON.parse(
      await blobText(host.closeVersion.mock.calls[1][1].changesJson)
    );
    expect(human.trackedAuthors).toEqual(['you']);
    const confirmation = JSON.parse(
      await blobText(host.closeVersion.mock.calls[2][1].changesJson)
    );
    expect(confirmation.hunks.every((h: any) => h.at.block[2] === 1)).toBe(
      true
    );
  });

  it('preserves a long alternating-author session without inventing highlights after its slice cap', async () => {
    let text = 'Original';
    const editor = {
      serialize: () =>
        JSON.stringify({ sections: [{ blocks: [{ inlines: [{ text }] }] }] })
    };
    const { view, host } = setup({}, editor);
    for (let i = 0; i < 24; i++) {
      text += ` edit${i}`;
      act(() => view.result.current.onEdit({ assistant: i % 2 === 0 }));
    }
    expect(view.result.current.previewSession()).toBeNull();
    await act(async () => {
      await view.result.current.save();
    });
    const payload = host.closeVersion.mock.calls[0][1];
    expect(payload.changesJson).toBeUndefined();
    expect(payload.changeCount).toBeNull();
    expect(payload.authors).toEqual(
      expect.arrayContaining([
        { kind: 'user', label: 'You' },
        { kind: 'assistant', label: 'Robin' }
      ])
    );
  });

  it('does not lose the first edit after a background tab delays the idle timer', async () => {
    let now = 1_000;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    let text = 'original';
    try {
      const { view } = setup(
        {},
        {
          serialize: () =>
            JSON.stringify({
              sections: [{ blocks: [{ inlines: [{ text }] }] }]
            })
        }
      );
      text += ' Robin';
      act(() => view.result.current.onEdit({ assistant: true }));
      now += 360_000;
      text += ' human';
      act(() => view.result.current.onEdit({ assistant: false }));
      const preview = view.result.current.previewSession();
      expect(preview).not.toBeNull();
      expect(
        JSON.parse(must(preview).sfdt).revisions.map((r: any) => r.author)
      ).toEqual(expect.arrayContaining(['you', 'robin']));
    } finally {
      clock.mockRestore();
    }
  });

  it('captures Robin’s authored runs onto the change list (so accepted edits stay Robin)', async () => {
    // On each assistant edit the hook snapshots Robin's live revision text; those
    // runs ride the change list so an edit accepted before close can still be
    // re-attributed to Robin at view time.
    (globalThis as any).CompressionStream = undefined; // changesJson as raw JSON
    let doc = JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: 'hello' }] }] }]
    });
    const editor: any = { serialize: () => doc };
    const { view, host } = setup({}, editor);
    await flush(); // pristine baseline

    act(() => setAssistantSessionActive(editor, true));
    // Robin inserts " world" as a LIVE tracked revision.
    doc = JSON.stringify({
      sections: [
        {
          blocks: [
            {
              inlines: [
                { text: 'hello' },
                { text: ' world', revisionIds: ['r1'] }
              ]
            }
          ]
        }
      ],
      revisions: [
        {
          author: 'Robin',
          revisionType: 'Insertion',
          revisionId: 'r1',
          customData: JSON.stringify({
            v: 1,
            source: 'robin',
            changeSetId: 'cs-1',
            group: 'add-premium-table'
          })
        }
      ]
    });
    act(() => view.result.current.onEdit({ assistant: true }));
    act(() => setAssistantSessionActive(editor, false)); // turn end → close
    await flush();

    const payload = host.closeVersion.mock.calls[0][1];
    const changes = JSON.parse(await blobText(payload.changesJson));
    expect(
      (changes.robinRuns ?? []).some(
        (r: any) =>
          r.kind === 'ins' &&
          r.text.includes('world') &&
          r.group === 'add-premium-table'
      )
    ).toBe(true);
  });

  it('re-attributes an accepted Robin edit to Robin in the live "Current" preview', async () => {
    (globalThis as any).CompressionStream = undefined;
    // Reproduces the reported bug: a Robin edit whose slice the diff tags 'you',
    // then accepted in the same open session (author flips to 'you'). The live
    // preview must use the captured Robin runs to colour it Robin, not the viewer.
    let doc = JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: 'start' }] }] }]
    });
    const editor: any = { serialize: () => doc };
    const { view, host } = setup({}, editor);
    await flush(); // pristine baseline "start"

    // A user edit opens the session as 'you' (so Robin's text lands in a 'you' slice).
    act(() => view.result.current.onEdit({ assistant: false }));
    // Robin inserts " world" as a live tracked revision (assistant edit).
    doc = JSON.stringify({
      sections: [
        {
          blocks: [
            {
              inlines: [
                { text: 'start' },
                { text: ' world', revisionIds: ['r1'] }
              ]
            }
          ]
        }
      ],
      revisions: [
        { author: 'Robin', revisionType: 'Insertion', revisionId: 'r1' }
      ]
    });
    act(() => view.result.current.onEdit({ assistant: true }));
    // The user accepts it (same open session): revision gone, author back to 'you'.
    doc = JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: 'start world' }] }] }]
    });
    act(() => view.result.current.onEdit({ assistant: false }));

    const preview = view.result.current.previewSession();
    expect(preview).toBeTruthy();
    const display = JSON.parse(must(preview).sfdt);
    const authors = (display.revisions ?? []).map((r: any) => r.author);
    expect(authors).toContain('robin');
    expect(authors).not.toContain('you');
    await act(async () => {
      await view.result.current.save();
    });
    const savedChanges = JSON.parse(
      await blobText(host.closeVersion.mock.calls[0][1].changesJson)
    );
    expect(savedChanges.trackedAuthors).toContain('robin');
    expect(savedChanges.trackedAuthors).not.toContain('you');
  });

  it('keeps Robin as the closing author when a user-attributed change fires during the close', async () => {
    // onEdit(assistant=false) fires while the close PATCH is in flight; F and
    // author are captured synchronously at close, so hunks stay Robin's.
    (globalThis as any).CompressionStream = undefined;
    let doc = JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: 'hello' }] }] }]
    });
    const editor: any = { serialize: () => doc };
    const { view, host, save } = setup({}, editor);
    await flush();

    act(() => setAssistantSessionActive(editor, true));
    doc = JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: 'hello robin' }] }] }]
    });
    act(() => view.result.current.onEdit({ assistant: true }));

    save.mockImplementation(async () => {
      // Lands mid-close, after the turn ended.
      doc = JSON.stringify({
        sections: [{ blocks: [{ inlines: [{ text: 'hello robin later' }] }] }]
      });
      view.result.current.onEdit({ assistant: false });
    });
    act(() => setAssistantSessionActive(editor, false));
    await flush();

    const payload = host.closeVersion.mock.calls[0][1];
    const changes = JSON.parse(await blobText(payload.changesJson));
    expect(changes.hunks.length).toBeGreaterThan(0);
    expect(changes.hunks.every((h: any) => h.author === 'robin')).toBe(true);
    // The mid-close edit is NOT part of the closed version's document.
    const finalSfdt = await blobText(payload.finalSfdtGz);
    expect(finalSfdt).not.toContain('later');
  });

  it('does nothing on a read-only editor', async () => {
    const { view, save } = setup({ readOnly: true });

    act(() => view.result.current.onEdit({ assistant: false }));
    expect(view.result.current.status).toBe('clean');
    await act(async () => {
      await view.result.current.save();
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('does nothing without a history host', async () => {
    const { view, save } = setup({ host: null });

    act(() => view.result.current.onEdit({ assistant: false }));
    await act(async () => {
      await view.result.current.save();
    });
    expect(save).not.toHaveBeenCalled();
  });
});
