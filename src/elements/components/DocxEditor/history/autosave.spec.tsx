import { act, renderHook } from '@testing-library/react';

import { setAssistantSessionActive } from '../../../../assistant/tools/docx/syncfusionDocumentOps';
import { AUTOSAVE_IDLE_MS } from './autosaveScheduler';
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

  it('closes the session when the assistant turn ends', async () => {
    const { view, editor, save, host } = setup();

    setAssistantSessionActive(editor, true); // a turn is under way
    act(() => view.result.current.onEdit({ assistant: true }));
    act(() => setAssistantSessionActive(editor, false)); // turn ends
    await flush();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1].closeSession).toBe(true);
    // The edit was attributed to Robin.
    expect(save.mock.calls[0][1].authors).toEqual([
      { kind: 'assistant', label: 'Robin' }
    ]);
    expect(host.closeVersion).toHaveBeenCalledTimes(1);
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
