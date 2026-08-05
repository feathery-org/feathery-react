import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import TrackedChangeGroups from './TrackedChangeGroups';

// A minimal live-editor stand-in: tagged revisions in a collection, plus the
// event surface the panel subscribes to. Group tags use the same JSON shape
// the ops engine stamps through revisionSettings.customData.
const tag = (changeSetId: string, group: string) =>
  JSON.stringify({ v: 1, source: 'robin', changeSetId, group });

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

describe('TrackedChangeGroups', () => {
  it('renders nothing when the document has no tracked changes at all', () => {
    const editor = makeEditor([]);
    const { container } = render(<TrackedChangeGroups editor={editor} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a human's manual tracked edits as an author-titled card", () => {
    const editor = makeEditor([
      // A human's manual tracked edit: no group tag, author-attributed.
      makeRevision({
        customData: null,
        author: 'Ayesha',
        getRange: () => [{ text: 'A human tracked edit.' }]
      })
    ]);
    render(<TrackedChangeGroups editor={editor} />);
    // Card titled by the author, tally as usual.
    expect(screen.getByText('Ayesha')).toBeInTheDocument();
    expect(screen.getByText('1 edit')).toBeInTheDocument();

    // Expanding shows the edit with its author attribution.
    fireEvent.click(screen.getByRole('button', { name: 'Expand Ayesha' }));
    expect(screen.getByText('A human tracked edit.')).toBeInTheDocument();
    expect(screen.getAllByText('Ayesha').length).toBeGreaterThan(1);
  });

  it('shows the author on assistant chips too', () => {
    const editor = makeEditor([makeRevision()]);
    render(<TrackedChangeGroups editor={editor} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Expand Update premium' })
    );
    expect(screen.getByText('Robin (assistant)')).toBeInTheDocument();
  });

  it('renders one card per group with a humanized title and a pending tally', () => {
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
    // Two pending edits in the premium group, one in the date group.
    expect(screen.getByText('2 edits')).toBeInTheDocument();
    expect(screen.getByText('1 edit')).toBeInTheDocument();
    expect(screen.getByText('3 pending')).toBeInTheDocument();
  });

  it('expands a card to diff-row chips and focuses/navigates on chip click', () => {
    const deletion = makeRevision({
      revisionType: 'Deletion',
      getRange: () => [{ text: '$5,500' }]
    });
    const insertion = makeRevision();
    const editor = makeEditor([deletion, insertion]);
    render(<TrackedChangeGroups editor={editor} />);

    // Collapsed by default: no chips yet.
    expect(screen.queryByText('$5,500')).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Expand Update premium' })
    );
    expect(screen.getByText('$5,500')).toBeInTheDocument();
    expect(screen.getByText('$6,000')).toBeInTheDocument();
    expect(screen.getByText('Removed')).toBeInTheDocument();
    expect(screen.getByText('Added')).toBeInTheDocument();

    // Clicking a chip focuses it (actions appear, aria-current set) and
    // navigates the document to the revision.
    fireEvent.click(screen.getByText('$5,500'));
    expect(deletion.select).toHaveBeenCalled();
    expect(insertion.select).not.toHaveBeenCalled();
    expect(
      screen.getByText('$5,500').closest('[aria-current="true"]')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Accept this edit')).toBeInTheDocument();

    // Collapse hides the chips again.
    fireEvent.click(
      screen.getByRole('button', { name: 'Collapse Update premium' })
    );
    expect(screen.queryByText('$5,500')).not.toBeInTheDocument();
  });

  it('focused-chip Accept resolves only that edit; the resolved chip disappears', () => {
    const deletion = makeRevision({
      revisionType: 'Deletion',
      getRange: () => [{ text: '$5,500' }]
    });
    const insertion = makeRevision();
    const revisions = [deletion, insertion];
    // Emulate the live editor: a resolved revision leaves the collection
    // while its group sibling stays pending.
    deletion.accept.mockImplementation(() => {
      revisions.splice(revisions.indexOf(deletion), 1);
    });
    const editor = makeEditor(revisions);
    render(<TrackedChangeGroups editor={editor} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Expand Update premium' })
    );
    fireEvent.click(screen.getByText('$5,500'));
    fireEvent.click(screen.getByLabelText('Accept this edit'));

    expect(deletion.accept).toHaveBeenCalledTimes(1);
    expect(insertion.accept).not.toHaveBeenCalled();

    // The resolved chip is gone; its group sibling stays pending.
    expect(screen.queryByText('$5,500')).not.toBeInTheDocument();
    expect(screen.getByText('$6,000')).toBeInTheDocument();
    expect(screen.getByText('1 edit')).toBeInTheDocument();
    expect(screen.getByText('1 pending')).toBeInTheDocument();
  });

  it('group Accept resolves every pending member and removes the card', () => {
    const deletion = makeRevision({ revisionType: 'Deletion' });
    const insertion = makeRevision();
    const revisions = [deletion, insertion];
    deletion.accept.mockImplementation(() => {
      revisions.splice(revisions.indexOf(deletion), 1);
    });
    insertion.accept.mockImplementation(() => {
      revisions.splice(revisions.indexOf(insertion), 1);
    });
    const editor = makeEditor(revisions);
    const { container } = render(<TrackedChangeGroups editor={editor} />);

    fireEvent.click(screen.getByRole('button', { name: 'Accept 2' }));

    // Every member resolved exactly once — a native accept on one member
    // would instead resolve whatever is contiguous to it.
    expect(deletion.accept).toHaveBeenCalledTimes(1);
    expect(insertion.accept).toHaveBeenCalledTimes(1);
    // Nothing pending is left, so the whole rail goes away.
    expect(screen.queryByText('Update premium')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('Accept all resolves every pending edit across groups', () => {
    const premium = makeRevision();
    const date = makeRevision({
      customData: tag('cs-1', 'fix-effective-date'),
      getRange: () => [{ text: '2026-02-01' }]
    });
    const revisions = [premium, date];
    premium.accept.mockImplementation(() => {
      revisions.splice(revisions.indexOf(premium), 1);
    });
    date.accept.mockImplementation(() => {
      revisions.splice(revisions.indexOf(date), 1);
    });
    const editor = makeEditor(revisions);
    const { container } = render(<TrackedChangeGroups editor={editor} />);

    fireEvent.click(screen.getByRole('button', { name: 'Accept all' }));
    expect(premium.accept).toHaveBeenCalledTimes(1);
    expect(date.accept).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();
  });

  it('uses panel-scoped J/K and arrow keys to focus, then A/R to resolve', () => {
    const deletion = makeRevision({
      revisionType: 'Deletion',
      getRange: () => [{ text: '$5,500' }]
    });
    const insertion = makeRevision();
    const revisions = [deletion, insertion];
    deletion.accept.mockImplementation(() => {
      revisions.splice(revisions.indexOf(deletion), 1);
    });
    insertion.reject.mockImplementation(() => {
      revisions.splice(revisions.indexOf(insertion), 1);
    });
    const editor = makeEditor(revisions);
    render(<TrackedChangeGroups editor={editor} />);
    const panel = screen.getByLabelText('Assistant tracked changes');

    // Navigation starts at the first pending chip and opens its card.
    fireEvent.keyDown(panel, { key: 'j' });
    expect(deletion.select).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText('$5,500').closest('[aria-current="true"]')
    ).toBeInTheDocument();

    // Navigation is circular in both directions.
    fireEvent.keyDown(panel, { key: 'ArrowUp' });
    expect(insertion.select).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(panel, { key: 'ArrowDown' });
    expect(deletion.select).toHaveBeenCalledTimes(2);

    // A resolves only the focused chip.
    fireEvent.keyDown(panel, { key: 'a' });
    expect(deletion.accept).toHaveBeenCalledTimes(1);
    expect(insertion.accept).not.toHaveBeenCalled();

    // ArrowDown selects the next still-pending chip; R rejects it.
    fireEvent.keyDown(panel, { key: 'ArrowDown' });
    expect(insertion.select).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(panel, { key: 'r' });
    expect(insertion.reject).toHaveBeenCalledTimes(1);
  });

  it('selects and scrolls the exact revision for keyboard and mouse navigation', () => {
    const first = makeRevision();
    const second = makeRevision({
      customData: tag('cs-1', 'fix-effective-date'),
      getRange: () => [{ text: '2026-02-01' }]
    });
    const editor = makeEditor([first, second]);
    const start = {};
    const end = {};
    editor.selectionModule = {
      start,
      end,
      selectRevision: jest.fn()
    };
    editor.documentHelper = { scrollToPosition: jest.fn() };
    render(<TrackedChangeGroups editor={editor} />);
    const panel = screen.getByLabelText('Assistant tracked changes');

    fireEvent.keyDown(panel, { key: 'ArrowDown' });
    expect(editor.selectionModule.selectRevision).toHaveBeenLastCalledWith(
      first,
      undefined,
      undefined,
      true
    );
    expect(editor.documentHelper.scrollToPosition).toHaveBeenLastCalledWith(
      start,
      end
    );
    expect(first.select).not.toHaveBeenCalled();
    expect(panel).toHaveFocus();

    fireEvent.click(
      screen.getByRole('button', { name: 'Expand Fix effective date' })
    );
    fireEvent.click(screen.getByText('2026-02-01'));
    expect(editor.selectionModule.selectRevision).toHaveBeenLastCalledWith(
      second,
      undefined,
      undefined,
      true
    );
    expect(editor.documentHelper.scrollToPosition).toHaveBeenLastCalledWith(
      start,
      end
    );
    // Syncfusion's enableAutoFocus steals focus into its editable div on
    // selection; the panel must take it back or the next arrow press moves
    // the document caret instead of stepping chips.
    expect(panel).toHaveFocus();
  });

  it('keeps keyboard focus on the panel after resolving from a chip button', () => {
    const insertion = makeRevision();
    const sibling = makeRevision({ getRange: () => [{ text: 'sibling' }] });
    const revisions = [insertion, sibling];
    insertion.accept.mockImplementation(() => {
      revisions.splice(revisions.indexOf(insertion), 1);
    });
    const editor = makeEditor(revisions);
    render(<TrackedChangeGroups editor={editor} />);
    const panel = screen.getByLabelText('Assistant tracked changes');

    fireEvent.click(
      screen.getByRole('button', { name: 'Expand Update premium' })
    );
    fireEvent.click(screen.getByText('$6,000'));
    expect(panel).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Accept this edit' }));
    expect(insertion.accept).toHaveBeenCalledTimes(1);
    expect(panel).toHaveFocus();
  });

  it('forwards undo/redo chords from the focused panel to the editor history', () => {
    const editor = makeEditor([makeRevision()]);
    editor.editorHistory = { undo: jest.fn(), redo: jest.fn() };
    render(<TrackedChangeGroups editor={editor} />);
    const panel = screen.getByLabelText('Assistant tracked changes');

    // The rail holds focus after panel actions; Syncfusion's own undo/redo
    // handling never sees chords pressed here, so the panel forwards them.
    fireEvent.keyDown(panel, { key: 'z', ctrlKey: true });
    expect(editor.editorHistory.undo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(panel, { key: 'z', metaKey: true });
    expect(editor.editorHistory.undo).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(panel, { key: 'z', metaKey: true, shiftKey: true });
    expect(editor.editorHistory.redo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(panel, { key: 'y', ctrlKey: true });
    expect(editor.editorHistory.redo).toHaveBeenCalledTimes(2);

    // Plain A/R (no modifier) still resolves rather than forwarding.
    expect(editor.editorHistory.undo).toHaveBeenCalledTimes(2);
  });

  it('hands focus to the editor when the last pending edit resolves', () => {
    const insertion = makeRevision();
    const revisions = [insertion];
    insertion.accept.mockImplementation(() => {
      revisions.splice(revisions.indexOf(insertion), 1);
    });
    const editor = makeEditor(revisions);
    editor.focusIn = jest.fn();
    const { container } = render(<TrackedChangeGroups editor={editor} />);

    fireEvent.click(screen.getByRole('button', { name: 'Accept 1' }));

    // The rail unmounted; focus on <body> would swallow the next ⌘Z, so it
    // goes back into the document instead.
    expect(insertion.accept).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();
    expect(editor.focusIn).toHaveBeenCalledTimes(1);
  });

  it('does not skip chips when selectRevision echoes a neighbouring selectionChange', () => {
    // Syncfusion's getCurrentRevision() after selectRevision often resolves to
    // an adjacent run (or clears). If that echo updates activeRevision, each
    // ArrowDown advances twice — every other edit is skipped.
    const one = makeRevision({ getRange: () => [{ text: 'one' }] });
    const two = makeRevision({ getRange: () => [{ text: 'two' }] });
    const three = makeRevision({ getRange: () => [{ text: 'three' }] });
    const four = makeRevision({ getRange: () => [{ text: 'four' }] });
    const revisions = [one, two, three, four];
    const editor = makeEditor(revisions);
    editor.selectionModule = {
      start: {},
      end: {},
      selectRevision: jest.fn((rev: any) => {
        const idx = revisions.indexOf(rev);
        const neighbour = revisions[Math.min(idx + 1, revisions.length - 1)];
        editor.selection.getCurrentRevision.mockReturnValue([neighbour]);
        editor.emit('selectionChange');
      })
    };
    editor.documentHelper = { scrollToPosition: jest.fn() };
    render(<TrackedChangeGroups editor={editor} />);
    const panel = screen.getByLabelText('Assistant tracked changes');

    fireEvent.keyDown(panel, { key: 'ArrowDown' });
    expect(
      screen.getByText('one').closest('[aria-current="true"]')
    ).toBeInTheDocument();

    fireEvent.keyDown(panel, { key: 'ArrowDown' });
    expect(
      screen.getByText('two').closest('[aria-current="true"]')
    ).toBeInTheDocument();

    fireEvent.keyDown(panel, { key: 'ArrowDown' });
    expect(
      screen.getByText('three').closest('[aria-current="true"]')
    ).toBeInTheDocument();

    fireEvent.keyDown(panel, { key: 'ArrowDown' });
    expect(
      screen.getByText('four').closest('[aria-current="true"]')
    ).toBeInTheDocument();

    expect(
      editor.selectionModule.selectRevision.mock.calls.map(
        (c: unknown[]) => c[0]
      )
    ).toEqual([one, two, three, four]);
  });

  it('folds a replace pair into one Replaced chip; one approval settles both halves', () => {
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
    const { container } = render(<TrackedChangeGroups editor={editor} />);

    // ONE edit, not two.
    expect(screen.getByText('1 edit')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Expand Update premium' })
    );
    expect(screen.getByText('Replaced')).toBeInTheDocument();
    expect(screen.getByText('$5,500')).toBeInTheDocument();
    expect(screen.getByText('$6,000')).toBeInTheDocument();

    // One approval (focused chip) settles both underlying revisions; with
    // its only edit resolved, the group — and the rail — disappear.
    fireEvent.click(screen.getByText('$6,000'));
    fireEvent.click(screen.getByLabelText('Accept this edit'));
    expect(deletion.accept).toHaveBeenCalledTimes(1);
    expect(insertion.accept).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();
  });

  it('drawer collapses via ✕; inline click or the bookmark tab reopen it', () => {
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

  it('clicking a tracked change in the document navigates the rail to it', () => {
    const deletion = makeRevision({
      revisionType: 'Deletion',
      getRange: () => [{ text: '$5,500' }]
    });
    const insertion = makeRevision();
    const editor = makeEditor([deletion, insertion]);
    render(<TrackedChangeGroups editor={editor} />);

    // Collapsed: the chips are not rendered yet.
    expect(screen.queryByText('$5,500')).not.toBeInTheDocument();

    // The user clicks inside the deletion in the document.
    editor.selection.getCurrentRevision.mockReturnValue([deletion]);
    act(() => editor.emit('selectionChange'));

    // Its group auto-expanded and its chip is marked current.
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

  it('every rail button is type=button so clicks never submit the host form', () => {
    // The rail renders inside the form runtime's real <form>. An untyped
    // <button> defaults to type=submit, so clicking it navigates the page and
    // dumps the user back on the first step. Guard every variant at once:
    // expanded card + focused chip (RailHead, GroupCard, ChangeChip) and the
    // collapsed bookmark tab.
    const deletion = makeRevision({
      revisionType: 'Deletion',
      getRange: () => [{ text: '$5,500' }]
    });
    const editor = makeEditor([deletion, makeRevision()]);
    const onHiddenChange = jest.fn();
    const { rerender } = render(
      <TrackedChangeGroups
        editor={editor}
        hidden={false}
        onHiddenChange={onHiddenChange}
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Expand Update premium' })
    );
    fireEvent.click(screen.getByText('$5,500')); // focus → Accept/Reject render

    // getAllByRole('button') also matches the chip/card divs with
    // role='button'; those are inert (divs cannot submit), so only real
    // <button> elements must carry the attribute.
    const assertAllTyped = () => {
      const buttons = screen
        .getAllByRole('button')
        .filter((el) => el.tagName === 'BUTTON');
      expect(buttons.length).toBeGreaterThan(0);
      buttons.forEach((button) => {
        expect(button).toHaveAttribute('type', 'button');
      });
      return buttons.length;
    };
    expect(assertAllTyped()).toBeGreaterThan(5);

    rerender(
      <TrackedChangeGroups
        editor={editor}
        hidden
        onHiddenChange={onHiddenChange}
      />
    );
    assertAllTyped();
  });

  it('a NEW tracked edit lands in the rail immediately', () => {
    const revisions: any[] = [];
    const editor = makeEditor(revisions);
    const { container } = render(<TrackedChangeGroups editor={editor} />);
    expect(container).toBeEmptyDOMElement();

    // The revision count changed, so no debounce: the card appears in the
    // same frame as the inline wash and the selection-driven expansion.
    revisions.push(makeRevision());
    act(() => {
      editor.emit('contentChange');
    });
    expect(screen.getByText('Update premium')).toBeInTheDocument();
  });

  it('text growth inside an existing edit refreshes on a trailing debounce', () => {
    jest.useFakeTimers();
    try {
      const revision = makeRevision();
      const editor = makeEditor([revision]);
      render(<TrackedChangeGroups editor={editor} />);
      fireEvent.click(
        screen.getByRole('button', { name: 'Expand Update premium' })
      );
      expect(screen.getByText('$6,000')).toBeInTheDocument();

      // Same revision, longer text — one contentChange per keystroke; the
      // rail waits for the trailing pause instead of rebuilding per event.
      revision.getRange = () => [{ text: '$6,000 yearly' }];
      act(() => {
        editor.emit('contentChange');
      });
      act(() => {
        editor.emit('contentChange');
      });
      act(() => {
        jest.advanceTimersByTime(149);
      });
      expect(screen.getByText('$6,000')).toBeInTheDocument();
      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(screen.getByText('$6,000 yearly')).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('rebuilds immediately when a different document opens in place', () => {
    const revisions = [makeRevision()];
    const editor = makeEditor(revisions);
    render(<TrackedChangeGroups editor={editor} />);
    expect(screen.getByText('Update premium')).toBeInTheDocument();

    // documentChange = another document replaced this one; the previous
    // document's cards must not linger for a debounce interval.
    revisions.splice(0, revisions.length);
    act(() => editor.emit('documentChange'));
    expect(screen.queryByText('Update premium')).not.toBeInTheDocument();
  });
});
