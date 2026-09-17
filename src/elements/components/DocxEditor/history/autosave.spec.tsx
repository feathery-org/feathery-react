import { act, renderHook } from '@testing-library/react';

import { setAssistantSessionActive } from '../../../../assistant/tools/docx/syncfusionDocumentOps';
import { AUTOSAVE_IDLE_MS } from './autosaveScheduler';
import { applyHunks } from './sfdtDiff';
import {
  useDocxHistorySession,
  UseDocxHistorySessionOptions
} from './useDocxHistorySession';
import { DocxHistoryHost, VersionAuthor } from './types';

const YOU: VersionAuthor = { kind: 'user', key: 'you', label: 'You' };
const SFDT = JSON.stringify({
  sections: [{ blocks: [{ inlines: [{ text: 'hello' }] }] }]
});

const makeHost = (): jest.Mocked<DocxHistoryHost> => ({
  listVersions: jest.fn().mockResolvedValue([]),
  closeVersion: jest.fn().mockResolvedValue(null),
  fetchVersionFile: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
  restoreVersion: jest.fn().mockResolvedValue(undefined),
  renameVersion: jest.fn().mockResolvedValue({} as any)
});

const setup = (
  over: Partial<UseDocxHistorySessionOptions> = {},
  editor: any = { serialize: () => SFDT }
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
const blobText = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(b);
  });

describe('useDocxHistorySession', () => {
  afterEach(() => jest.useRealTimers());

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
    // The close uploads the final document and the diffed change list. S0 == F
    // here (no real edits in the fake), so the diff finds zero changes.
    expect(host.closeVersion).toHaveBeenCalledTimes(1);
    const closePayload = host.closeVersion.mock.calls[0][1];
    expect(host.closeVersion.mock.calls[0][0]).toBe(meta.sessionId);
    expect(closePayload.changeCount).toBe(0);
    expect(closePayload.changesJson).toBeInstanceOf(Blob);
    expect(closePayload.finalSfdtGz).toBeInstanceOf(Blob);
    expect(view.result.current.isSessionOpen()).toBe(false);
    expect(view.result.current.previewSession()).toBeNull();
    expect(view.result.current.savedAt).not.toBeNull();
  });

  it('propagates a document save failure and does not close history', async () => {
    const { view, save, host } = setup();
    save.mockRejectedValueOnce(new Error('network failure'));

    act(() => view.result.current.onEdit({ assistant: false }));

    await expect(
      act(async () => {
        await view.result.current.save();
      })
    ).rejects.toThrow('Document save failed');
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
    // The real editor fires contentChange (→ onEdit) AFTER the edit is applied,
    // so by then serialize() already returns the CHANGED document. If S0 were
    // taken here it would equal F and the edit would vanish. The baseline must
    // come from the pristine document captured at open.
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
    const changes = JSON.parse(
      await blobText(confirmationPayload.changesJson!)
    );
    expect(confirmationPayload.startSha256).not.toBe(
      confirmationPayload.finalSha256
    );
    expect(changes.confirmed).toBe(true);
    expect(changes.changeCount).toBeGreaterThan(0);
    expect(changes.hunks.every((h: any) => h.author === 'robin')).toBe(true);
    expect(changes.trackedAuthors).toEqual(['robin']);
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
  });

  it('preserves the pending current version before accepting after a reload', async () => {
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
        session_id: 'pending-session'
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

    // Snapshot the existing pending row first, then store confirmation in a
    // distinct session. Otherwise both rows render as approved versions.
    expect(host.closeVersion).toHaveBeenCalledTimes(2);
    expect(host.closeVersion.mock.calls[0][0]).toBe('pending-session');
    expect(host.closeVersion.mock.calls[1][0]).not.toBe('pending-session');

    const pendingPayload = host.closeVersion.mock.calls[0][1];
    const pendingChanges = JSON.parse(
      await blobText(pendingPayload.changesJson!)
    );
    expect(pendingChanges.confirmed).toBeUndefined();
    expect(pendingChanges.changeCount).toBeGreaterThan(0);
    const pendingDisplay = applyHunks(JSON.parse(pending), pendingChanges);
    const pendingMetadata = (pendingDisplay.revisions ?? []).map(
      (revision: any) => JSON.parse(revision.customData ?? '{}')
    );
    expect(pendingMetadata.some((data: any) => data.pending === true)).toBe(
      true
    );

    const confirmationChanges = JSON.parse(
      await blobText(host.closeVersion.mock.calls[1][1].changesJson!)
    );
    expect(confirmationChanges.confirmed).toBe(true);
  });

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
    expect(preview!.editCount).toBeGreaterThan(0);
    // applyHunks baked synthetic revisions into the display document.
    expect(preview!.sfdt).toContain('revisionId');
  });

  it('previewSession is null with no open session', () => {
    const { view } = setup();
    expect(view.result.current.previewSession()).toBeNull();
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
    expect(view.result.current.savedAt).toBeNull();

    await act(async () => {
      finishUpload();
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(view.result.current.savedAt).not.toBeNull();
  });

  it('attributes Robin’s first op to Robin via the pre-turn snapshot', async () => {
    // contentChange (→ onEdit) fires AFTER an op applies, so at the user→Robin
    // boundary the document already holds Robin's first op. The slice must come
    // from the snapshot taken at the turn-START edge, or that op is credited to
    // the user.
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
    const changes = JSON.parse(await blobText(payload.changesJson!));
    const authorsOf = (needle: string) =>
      changes.hunks
        .filter((h: any) => JSON.stringify(h).includes(needle))
        .map((h: any) => h.author);
    expect(authorsOf('robin')).toContain('robin');
    // The user's own insertion stays the user's.
    expect(changes.hunks.some((h: any) => h.author === 'you')).toBe(true);
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
    const changes = JSON.parse(await blobText(payload.changesJson!));
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
    const display = JSON.parse(preview!.sfdt);
    const authors = (display.revisions ?? []).map((r: any) => r.author);
    expect(authors).toContain('robin');
    expect(authors).not.toContain('you');
    await act(async () => {
      await view.result.current.save();
    });
    const savedChanges = JSON.parse(
      await blobText(host.closeVersion.mock.calls[0][1].changesJson!)
    );
    expect(savedChanges.trackedAuthors).toContain('robin');
    expect(savedChanges.trackedAuthors).not.toContain('you');
  });

  it('keeps Robin as the closing author when a user-attributed change fires during the close', async () => {
    // The live mis-attribution: after the turn-end close begins, an engine
    // write (or the user's next keystroke) fires onEdit(assistant=false) while
    // the PATCH is in flight. The closing session's F and author are captured
    // synchronously at close, so the stored hunks stay Robin's.
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
    const changes = JSON.parse(await blobText(payload.changesJson!));
    expect(changes.hunks.length).toBeGreaterThan(0);
    expect(changes.hunks.every((h: any) => h.author === 'robin')).toBe(true);
    // The mid-close edit is NOT part of the closed version's document.
    const finalSfdt = await blobText(payload.finalSfdtGz!);
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
