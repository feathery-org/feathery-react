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
    // The editor serializes S0 on the first edit, then a changed F at close.
    let doc = JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: 'hello' }] }] }]
    });
    const editor = { serialize: () => doc };
    const { view, host } = setup({}, editor);

    act(() => view.result.current.onEdit({ assistant: false })); // captures S0
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
