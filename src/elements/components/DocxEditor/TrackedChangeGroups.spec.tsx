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
    addEventListener: (event: string, handler: () => void) => {
      (listeners[event] ??= []).push(handler);
    },
    removeEventListener: (event: string, handler: () => void) => {
      listeners[event] = (listeners[event] ?? []).filter(
        (h) => h !== handler
      );
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
      makeRevision({ revisionType: 'Deletion', getRange: () => [{ text: '$5,500' }] }),
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

  it('Accept resolves through one member and refreshes the panel', () => {
    const revisions = [
      makeRevision({ revisionType: 'Deletion' }),
      makeRevision()
    ];
    // Emulate the atomic group binding: accepting the first member resolves
    // the whole group, i.e. both revisions leave the collection.
    revisions[0].accept.mockImplementation(() => {
      revisions.length = 0;
    });
    const editor = makeEditor(revisions);
    render(<TrackedChangeGroups editor={editor} />);

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(screen.queryByText('Update premium')).not.toBeInTheDocument();
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
