import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import TrackedChangeGroups from './TrackedChangeGroups';

// A minimal live-editor stand-in: tagged revisions in a collection, plus the
// event surface the panel subscribes to. Group tags use the same JSON shape
// the ops engine stamps through revisionSettings.customData.
const tag = (changeSetId: string, group: string) =>
  JSON.stringify({ v: 1, source: 'robin', changeSetId, group });

function makeEditor(revisions: any[]) {
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
    getRange: () => [{ text: '$6,000' }],
    accept: jest.fn(),
    reject: jest.fn(),
    select: jest.fn(),
    ...overrides
  };
}

describe('TrackedChangeGroups', () => {
  it('renders nothing when the document has no assistant-tagged revisions', () => {
    const editor = makeEditor([
      // A human's manual tracked edit: no group tag.
      makeRevision({ customData: null })
    ]);
    const { container } = render(<TrackedChangeGroups editor={editor} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one card per group with a humanized title and change count', () => {
    const editor = makeEditor([
      makeRevision({
        revisionType: 'Deletion',
        getRange: () => [{ text: '$5,500' }]
      }),
      makeRevision(),
      makeRevision({
        customData: tag('cs-1', 'fix-effective-date'),
        getRange: () => [{ text: '2026-02-01' }]
      })
    ]);
    render(<TrackedChangeGroups editor={editor} />);
    expect(screen.getByText('Update premium')).toBeInTheDocument();
    expect(screen.getByText('Fix effective date')).toBeInTheDocument();
    // Two revisions in the premium group, one in the date group.
    expect(screen.getByText('2 edits')).toBeInTheDocument();
    expect(screen.getByText('1 edit')).toBeInTheDocument();
  });

  it('expands a card to its individual edits and navigates on click', () => {
    const deletion = makeRevision({
      revisionType: 'Deletion',
      getRange: () => [{ text: '$5,500' }]
    });
    const insertion = makeRevision();
    const editor = makeEditor([deletion, insertion]);
    render(<TrackedChangeGroups editor={editor} />);

    // Collapsed by default: no per-edit rows yet.
    expect(screen.queryByText('$5,500')).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Expand Update premium' })
    );
    expect(screen.getByText('$5,500')).toBeInTheDocument();
    expect(screen.getByText('$6,000')).toBeInTheDocument();

    fireEvent.click(screen.getByText('$5,500'));
    expect(deletion.select).toHaveBeenCalled();
    expect(insertion.select).not.toHaveBeenCalled();

    // Collapse hides the rows again.
    fireEvent.click(
      screen.getByRole('button', { name: 'Collapse Update premium' })
    );
    expect(screen.queryByText('$5,500')).not.toBeInTheDocument();
  });

  it('row ✓/✗ resolves a single edit without touching the rest of the group', () => {
    const deletion = makeRevision({
      revisionType: 'Deletion',
      getRange: () => [{ text: '$5,500' }]
    });
    const insertion = makeRevision();
    const revisions = [deletion, insertion];
    // Emulate the live editor: an individually resolved revision leaves the
    // collection while its group siblings stay pending.
    deletion.accept.mockImplementation(() => {
      revisions.splice(revisions.indexOf(deletion), 1);
    });
    const editor = makeEditor(revisions);
    render(<TrackedChangeGroups editor={editor} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Expand Update premium' })
    );
    fireEvent.click(screen.getAllByLabelText('Accept this edit')[0]);

    // Only the clicked row's revision resolved; its sibling is untouched and
    // the click did not double as row navigation.
    expect(deletion.accept).toHaveBeenCalledTimes(1);
    expect(insertion.accept).not.toHaveBeenCalled();
    expect(deletion.select).not.toHaveBeenCalled();

    // The panel refreshed: the resolved row is gone, the sibling remains.
    expect(screen.queryByText('$5,500')).not.toBeInTheDocument();
    expect(screen.getByText('$6,000')).toBeInTheDocument();
  });

  it('group Accept resolves every member, not just the first or contiguous ones', () => {
    const deletion = makeRevision({ revisionType: 'Deletion' });
    const insertion = makeRevision();
    const revisions = [deletion, insertion];
    // Emulate the live editor: resolved revisions leave the collection.
    deletion.accept.mockImplementation(() => {
      revisions.splice(revisions.indexOf(deletion), 1);
    });
    insertion.accept.mockImplementation(() => {
      revisions.splice(revisions.indexOf(insertion), 1);
    });
    const editor = makeEditor(revisions);
    render(<TrackedChangeGroups editor={editor} />);

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    // Every member resolved exactly once — a native accept on one member
    // would instead resolve whatever is contiguous to it.
    expect(deletion.accept).toHaveBeenCalledTimes(1);
    expect(insertion.accept).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Update premium')).not.toBeInTheDocument();
  });

  it('clicking a tracked change in the document navigates the panel to it', () => {
    const deletion = makeRevision({
      revisionType: 'Deletion',
      getRange: () => [{ text: '$5,500' }]
    });
    const insertion = makeRevision();
    const editor = makeEditor([deletion, insertion]);
    render(<TrackedChangeGroups editor={editor} />);

    // Collapsed: the rows are not rendered yet.
    expect(screen.queryByText('$5,500')).not.toBeInTheDocument();

    // The user clicks inside the deletion in the document.
    editor.selection.getCurrentRevision.mockReturnValue([deletion]);
    act(() => editor.emit('selectionChange'));

    // Its group auto-expanded and its row is marked current.
    expect(
      screen.getByText('$5,500').closest('[aria-current="true"]')
    ).toBeInTheDocument();
    expect(
      screen.getByText('$6,000').closest('[aria-current="true"]')
    ).toBeNull();

    // Moving the cursor off any tracked change clears the mark but leaves
    // the group expanded.
    editor.selection.getCurrentRevision.mockReturnValue(undefined);
    act(() => editor.emit('selectionChange'));
    expect(screen.getByText('$5,500')).toBeInTheDocument();
    expect(
      screen.getByText('$5,500').closest('[aria-current="true"]')
    ).toBeNull();
  });

  it('folds a replace pair into one edit; one approval resolves both halves', () => {
    // A replace: the deletion's last range element links directly to the
    // insertion's first (nextNode), same as the live engine produces.
    const newRun = { text: '$6,000' };
    const deletion = makeRevision({
      revisionType: 'Deletion',
      getRange: () => [{ text: '$5,500', nextNode: newRun }]
    });
    const insertion = makeRevision({ getRange: () => [newRun] });
    const revisions = [deletion, insertion];
    deletion.accept.mockImplementation(() => {
      revisions.splice(revisions.indexOf(deletion), 1);
    });
    insertion.accept.mockImplementation(() => {
      revisions.splice(revisions.indexOf(insertion), 1);
    });
    const editor = makeEditor(revisions);
    render(<TrackedChangeGroups editor={editor} />);

    // ONE edit, not two.
    expect(screen.getByText('1 edit')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Expand Update premium' })
    );
    expect(screen.getByText('$5,500 → $6,000')).toBeInTheDocument();

    // One ✓ settles both underlying revisions.
    fireEvent.click(screen.getByLabelText('Accept this edit'));
    expect(deletion.accept).toHaveBeenCalledTimes(1);
    expect(insertion.accept).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Update premium')).not.toBeInTheDocument();
  });

  it('drawer collapses via ✕ or handle; inline click or handle reopen it', () => {
    const revision = makeRevision();
    const editor = makeEditor([revision]);
    const onHiddenChange = jest.fn();
    const { rerender } = render(
      <TrackedChangeGroups
        editor={editor}
        hidden={false}
        onHiddenChange={onHiddenChange}
      />
    );

    // Open: the ✕ collapses it, and no bookmark tab is shown.
    expect(
      screen.queryByLabelText('Expand suggested changes')
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Hide suggested changes'));
    expect(onHiddenChange).toHaveBeenLastCalledWith(true);

    // Collapsed: only the bookmark tab remains, and it reopens the panel.
    rerender(
      <TrackedChangeGroups
        editor={editor}
        hidden
        onHiddenChange={onHiddenChange}
      />
    );
    expect(screen.queryByText('Suggested changes')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Expand suggested changes'));
    expect(onHiddenChange).toHaveBeenLastCalledWith(false);

    // Clicking the tracked change inline also asks the host to show it.
    onHiddenChange.mockClear();
    editor.selection.getCurrentRevision.mockReturnValue([revision]);
    act(() => editor.emit('selectionChange'));
    expect(onHiddenChange).toHaveBeenCalledWith(false);
  });

  it('refreshes when the editor content changes', () => {
    const revisions: any[] = [];
    const editor = makeEditor(revisions);
    const { container } = render(<TrackedChangeGroups editor={editor} />);
    expect(container).toBeEmptyDOMElement();

    // The assistant applies a tagged edit after mount; contentChange fires.
    revisions.push(makeRevision());
    act(() => editor.emit('contentChange'));
    expect(screen.getByText('Update premium')).toBeInTheDocument();
  });
});
