import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import TrackedChangeGroups from './TrackedChangeGroups';
import { useDocxHistorySession } from './history/useDocxHistorySession';

const tag = (
  changeSetId: string,
  group: string,
  derivedChanges?: Array<{
    name: string;
    beforeText: string;
    afterText: string;
  }>
) =>
  JSON.stringify({
    v: 1,
    source: 'robin',
    changeSetId,
    group,
    derivedChanges
  });

function makeEditor(revisions: any[]): any {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    revisions: { changes: revisions },
    // The panel maps the document cursor to a revision through this on
    // selectionChange; tests point it at a revision to emulate an inline
    // click on a tracked change. Returns undefined until a test redirects it.
    selection: { getCurrentRevision: jest.fn() },
    addEventListener: (event: string, handler: () => void) => {
      (listeners[event] ??= []).push(handler);
    },
    removeEventListener: (event: string, handler: () => void) => {
      listeners[event] = (listeners[event] ?? []).filter((h) => h !== handler);
    },
    emit: (event: string) => (listeners[event] ?? []).forEach((h) => h())
  };
}

function makeRevision(
  overrides: Partial<Record<string, any>> = {}
): Record<string, jest.Mock | any> {
  return {
    revisionType: 'Insertion',
    customData: tag('cs-1', 'update-premium'),
    author: 'Robin (assistant)',
    getRange: () => [{ text: '$6,000' }],
    accept: jest.fn(),
    reject: jest.fn(),
    select: jest.fn(),
    ...overrides
  };
}

function flushDeferredResolve(): Promise<void> {
  return act(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setTimeout(resolve, 0))
        );
      })
  );
}

it.each(['bulk', 'group', 'individual'])(
  '%s accept shows progress until history finishes',
  async (action) => {
    (globalThis as any).CompressionStream = undefined;
    const revision = makeRevision({ revisionID: 'r-1' });
    const revisions = [revision];
    const editor = {
      ...makeEditor(revisions),
      serialize: () =>
        JSON.stringify({
          revisions: revisions.map((r) => ({
            revisionId: r.revisionID,
            author: r.author,
            revisionType: r.revisionType,
            customData: r.customData
          })),
          sections: [
            {
              blocks: [
                {
                  inlines: [
                    {
                      text: '$6,000',
                      ...(revisions.length ? { revisionIds: ['r-1'] } : {})
                    }
                  ]
                }
              ]
            }
          ]
        })
    };
    revision.accept.mockImplementation(() => revisions.splice(0, 1));
    let release!: (versions: any[]) => void;
    const pendingList = new Promise<any[]>((resolve) => {
      release = resolve;
    });
    const host: any = {
      listVersions: jest.fn(() => pendingList),
      closeVersion: jest.fn().mockResolvedValue(null),
      fetchVersionFile: jest.fn(),
      restoreVersion: jest.fn(),
      renameVersion: jest.fn()
    };
    const save = jest.fn().mockResolvedValue(undefined);
    const exportDoc = jest.fn().mockResolvedValue(new Blob(['docx']));
    function Review() {
      const history = useDocxHistorySession({
        editor,
        loading: false,
        host,
        currentUser: { kind: 'user', key: 'you', label: 'You' },
        save,
        exportDoc
      });
      return (
        <TrackedChangeGroups
          editor={editor}
          onAcceptTrackedChanges={history.acceptTrackedChanges}
        />
      );
    }
    render(<Review />);
    let button: HTMLElement;
    if (action === 'bulk')
      button = screen.getByRole('button', { name: 'Accept all' });
    else if (action === 'group')
      button = screen.getByRole('button', { name: 'Accept' });
    else {
      fireEvent.click(
        screen.getByRole('button', { name: 'Expand Update premium' })
      );
      button = screen.getByLabelText('Accept this edit');
    }
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(button.querySelector('circle')).not.toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Accepting changes');
    for (const control of screen
      .getAllByRole('button')
      .filter((control) =>
        /^(Accept|Reject)/.test(
          control.getAttribute('aria-label') ?? control.textContent ?? ''
        )
      )) {
      expect(control).toBeDisabled();
    }
    await flushDeferredResolve();
    expect(host.listVersions).toHaveBeenCalledTimes(1);
    expect(revision.accept).not.toHaveBeenCalled();
    const pending = {
      spinner: !!button.querySelector('circle'),
      disabled: (button as HTMLButtonElement).disabled,
      count: revisions.length
    };
    fireEvent.click(button);
    await flushDeferredResolve();
    expect(host.listVersions).toHaveBeenCalledTimes(1);
    expect(revision.accept).not.toHaveBeenCalled();
    await act(async () => {
      release([]);
    });
    await waitFor(() => expect(revision.accept).toHaveBeenCalledTimes(1));
    expect(revisions).toHaveLength(0);
    expect(pending.disabled).toBe(true);
    expect(pending.spinner).toBe(true);
  }
);

it('clears progress and reports a failed history operation so review can be retried', async () => {
  const revision = makeRevision({ revisionID: 'r1' });
  const editor = {
    ...makeEditor([revision]),
    serialize: () => '{"sections":[]}'
  };
  const fail = jest.spyOn(console, 'debug').mockImplementation(() => {});
  const onAccept = jest.fn().mockRejectedValue(new Error('Save failed'));
  try {
    render(
      <TrackedChangeGroups editor={editor} onAcceptTrackedChanges={onAccept} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await flushDeferredResolve();
    expect(revision.accept).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Could not finish accepting'
    );
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled();
    onAccept.mockImplementation(async (_acceptance, accept) => accept());
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await flushDeferredResolve();
    expect(revision.accept).toHaveBeenCalledTimes(1);
  } finally {
    fail.mockRestore();
  }
});

it('does not apply a deferred action to an editor that has been replaced', async () => {
  const revision = makeRevision();
  const view = render(<TrackedChangeGroups editor={makeEditor([revision])} />);
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
  view.rerender(<TrackedChangeGroups editor={makeEditor([])} />);
  await flushDeferredResolve();
  expect(revision.accept).not.toHaveBeenCalled();
});

it('does not cut an empty version when Accept all is pressed on the empty rail after a failed save', async () => {
  const revision = makeRevision({ revisionID: 'r1' });
  const revisions = [revision];
  const editor = {
    ...makeEditor(revisions),
    serialize: () => '{"sections":[]}'
  };
  revision.accept.mockImplementation(() => revisions.splice(0, 1));
  const fail = jest.spyOn(console, 'debug').mockImplementation(() => {});
  // The edit applies natively, then persisting that acceptance fails.
  const onAccept = jest
    .fn()
    .mockImplementationOnce(async (_acceptance: any, accept: () => void) => {
      accept();
      throw new Error('Save failed');
    });
  try {
    render(
      <TrackedChangeGroups editor={editor} onAcceptTrackedChanges={onAccept} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Accept all' }));
    await flushDeferredResolve();
    expect(revision.accept).toHaveBeenCalledTimes(1);
    // contentChange empties the rail; the stall notice keeps it mounted.
    act(() => editor.emit('contentChange'));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Could not finish accepting'
    );
    onAccept.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Accept all' }));
    await flushDeferredResolve();
    expect(onAccept).not.toHaveBeenCalled();
  } finally {
    fail.mockRestore();
  }
});
