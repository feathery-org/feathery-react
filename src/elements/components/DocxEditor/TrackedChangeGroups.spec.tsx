import 'jest-canvas-mock';
import { randomFillSync } from 'crypto';
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import {
  DocumentEditor,
  Editor,
  EditorHistory,
  ImageResizer,
  Search,
  Selection,
  SfdtExport
} from '@syncfusion/ej2-documenteditor';
import TrackedChangeGroups from './TrackedChangeGroups';
import { RailErrorBoundary } from './index';
import { applyDocumentEdits } from '../../../assistant/tools/docx/syncfusionDocumentOps';
import {
  installRevisionGroupIsolation,
  resolveLiveRevisionGroupsAsOneUndo,
  resolveRevisionsAsOneUndo,
  LiveEditor
} from '../../../utils/documentEditorPrimitives';
import { featheryDoc, featheryWindow } from '../../../utils/browser';

DocumentEditor.Inject(
  Editor,
  Selection,
  SfdtExport,
  EditorHistory,
  ImageResizer,
  Search
);

const testWindow = featheryWindow();
if (!testWindow.crypto?.getRandomValues) {
  Object.defineProperty(testWindow, 'crypto', {
    value: {
      getRandomValues: (array: Uint8Array) => randomFillSync(array)
    }
  });
}

const jsdomGetComputedStyle = testWindow.getComputedStyle.bind(testWindow);
testWindow.getComputedStyle = ((elt: Element) =>
  jsdomGetComputedStyle(elt)) as typeof testWindow.getComputedStyle;

if (!(testWindow.SVGElement.prototype as any).getBBox) {
  (testWindow.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
}

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

// The editor mid-destroy: EJ2's observer internals hit Object.keys(null),
// which is exactly the error class step navigation surfaces. Every touchpoint
// throws — the rail must read this as "no editor", never crash.
function makeDestroyedEditor(): any {
  const die = () => {
    throw new TypeError('Cannot convert undefined or null to object');
  };
  return {
    isDestroyed: true,
    get revisions() {
      return die();
    },
    selection: { getCurrentRevision: die },
    addEventListener: die,
    removeEventListener: die,
    focusIn: die,
    editorHistory: { undo: die, redo: die }
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

function makeRealEditor(text = ''): DocumentEditor {
  const host = featheryDoc().createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  featheryDoc().body.appendChild(host);
  const editor = new DocumentEditor({
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableImageResizer: true,
    enableSearch: true,
    enableSfdtExport: true,
    enableEditorHistory: true
  });
  editor.appendTo(host);
  editor.open(
    JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text }] }] }]
    })
  );
  installRevisionGroupIsolation(editor as unknown as LiveEditor);
  return editor;
}

function destroyRealEditor(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

function acceptOnlyGroup(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
}

// Single-edit groups carry no group-wide card button, so the rail-wide action
// is how they reach the same group resolve path (resolveGroups) that a card's
// Accept N takes.
function acceptAllGroups(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Accept all' }));
}

// Flushes the two animation frames afterNextPaint defers the resolve past.
// Always real timers: jsdom's rAF is wall-clock and ignores Jest's fakes.
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
    expect(screen.getByText('1 change')).toBeInTheDocument();

    // Expanding shows the edit itself. The author is the card title, not
    // repeated on each chip, so it still appears exactly once.
    fireEvent.click(screen.getByRole('button', { name: 'Expand Ayesha' }));
    expect(screen.getByText('A human tracked edit.')).toBeInTheDocument();
    expect(screen.getAllByText('Ayesha')).toHaveLength(1);
  });

  it('shows the assistant author once on the group header, not per chip', () => {
    const editor = makeEditor([makeRevision(), makeRevision()]);
    render(<TrackedChangeGroups editor={editor} />);
    // Visible on the header before expanding.
    expect(screen.getByText('Robin (assistant)')).toBeInTheDocument();
    // Still exactly one after expanding two chips — no per-chip repetition.
    fireEvent.click(
      screen.getByRole('button', { name: 'Expand Update premium' })
    );
    expect(screen.getAllByText('Robin (assistant)')).toHaveLength(1);
  });

  it('keeps every review control from submitting the surrounding form', () => {
    const editor = makeEditor([makeRevision()]);
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
    fireEvent.click(screen.getByText('$6,000'));
    screen
      .getAllByRole('button')
      .filter((button) => button.tagName === 'BUTTON')
      .forEach((button) => expect(button).toHaveAttribute('type', 'button'));

    rerender(
      <TrackedChangeGroups
        editor={editor}
        hidden
        onHiddenChange={onHiddenChange}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Expand suggested changes' })
    ).toHaveAttribute('type', 'button');
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
    expect(screen.getByText('2 changes')).toBeInTheDocument();
    expect(screen.getByText('1 change')).toBeInTheDocument();
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
    // Every row shows its own Accept/Reject; scope to the focused chip's row.
    expect(
      within(
        screen.getByText('$5,500').closest('[role="button"]') as HTMLElement
      ).getByLabelText('Accept this edit')
    ).toBeInTheDocument();

    // Collapse hides the chips again.
    fireEvent.click(
      screen.getByRole('button', { name: 'Collapse Update premium' })
    );
    expect(screen.queryByText('$5,500')).not.toBeInTheDocument();
  });

  it('clicking the group title navigates to the first edit without expanding', () => {
    const editor = makeEditor([makeRevision()]);
    render(<TrackedChangeGroups editor={editor} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Go to Update premium' })
    );

    // Navigated (same fallback .select() path a chip click uses)...
    expect(editor.revisions.changes[0].select).toHaveBeenCalled();
    // ...but the group never opened.
    expect(screen.queryByText('$6,000')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Expand Update premium' })
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('the group title targets the FIRST chip specifically, not just any member', () => {
    const deletion = makeRevision({
      revisionType: 'Deletion',
      getRange: () => [{ text: '$5,500' }]
    });
    const insertion = makeRevision();
    const editor = makeEditor([deletion, insertion]);
    render(<TrackedChangeGroups editor={editor} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Go to Update premium' })
    );

    expect(deletion.select).toHaveBeenCalled();
    expect(insertion.select).not.toHaveBeenCalled();
    // Still collapsed — the title button never toggles the caret's state.
    expect(screen.queryByText('$5,500')).not.toBeInTheDocument();
    expect(screen.queryByText('$6,000')).not.toBeInTheDocument();
  });

  it('the group title rings EVERY chip in the group, not just the first', () => {
    const deletion = makeRevision({
      revisionType: 'Deletion',
      getRange: () => [{ text: '$5,500' }]
    });
    const insertion = makeRevision();
    const editor = makeEditor([deletion, insertion]);
    render(<TrackedChangeGroups editor={editor} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Go to Update premium' })
    );
    // Navigation targets chips[0] only (asserted above); the ring, however,
    // covers the whole group — expanding afterward shows both marked.
    fireEvent.click(
      screen.getByRole('button', { name: 'Expand Update premium' })
    );

    expect(
      screen.getByText('$5,500').closest('[aria-current="true"]')
    ).toBeInTheDocument();
    expect(
      screen.getByText('$6,000').closest('[aria-current="true"]')
    ).toBeInTheDocument();
  });

  it('the caret still toggles expand/collapse independently of the title button', () => {
    const editor = makeEditor([makeRevision()]);
    render(<TrackedChangeGroups editor={editor} />);

    // Navigate via the title first — must not leave the caret expanded.
    fireEvent.click(
      screen.getByRole('button', { name: 'Go to Update premium' })
    );
    expect(
      screen.getByRole('button', { name: 'Expand Update premium' })
    ).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(
      screen.getByRole('button', { name: 'Expand Update premium' })
    );
    expect(screen.getByText('$6,000')).toBeInTheDocument();
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
    fireEvent.click(
      within(
        screen.getByText('$5,500').closest('[role="button"]') as HTMLElement
      ).getByLabelText('Accept this edit')
    );

    expect(deletion.accept).toHaveBeenCalledTimes(1);
    expect(insertion.accept).not.toHaveBeenCalled();

    // The resolved chip is gone; its group sibling stays pending.
    expect(screen.queryByText('$5,500')).not.toBeInTheDocument();
    expect(screen.getByText('$6,000')).toBeInTheDocument();
    expect(screen.getByText('1 change')).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    // Every member resolved exactly once — a native accept on one member
    // would instead resolve whatever is contiguous to it.
    expect(deletion.accept).toHaveBeenCalledTimes(1);
    expect(insertion.accept).toHaveBeenCalledTimes(1);
    // Nothing pending is left, so the whole rail goes away.
    expect(screen.queryByText('Update premium')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('group Reject resolves every pending member and removes the card', () => {
    const deletion = makeRevision({ revisionType: 'Deletion' });
    const insertion = makeRevision();
    const revisions = [deletion, insertion];
    deletion.reject.mockImplementation(() => {
      revisions.splice(revisions.indexOf(deletion), 1);
    });
    insertion.reject.mockImplementation(() => {
      revisions.splice(revisions.indexOf(insertion), 1);
    });
    const editor = makeEditor(revisions);
    const { container } = render(<TrackedChangeGroups editor={editor} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    expect(deletion.reject).toHaveBeenCalledTimes(1);
    expect(insertion.reject).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();
  });

  it('Accept all resolves every pending edit across groups', async () => {
    // The resolve is deferred past two animation frames (afterNextPaint), so
    // flush before asserting.
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
    await flushDeferredResolve();
    expect(premium.accept).toHaveBeenCalledTimes(1);
    expect(date.accept).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a spinner on Accept all while its deferred resolve is pending', async () => {
    const revisions: any[] = [];
    const revision = makeRevision();
    revision.accept.mockImplementation(() => {
      revisions.splice(revisions.indexOf(revision), 1);
    });
    revisions.push(revision);
    const editor = makeEditor(revisions);
    render(<TrackedChangeGroups editor={editor} />);

    const acceptAllBtn = screen.getByRole('button', { name: 'Accept all' });
    const rejectAllBtn = screen.getByRole('button', { name: 'Reject all' });
    expect(acceptAllBtn.querySelector('svg')).toBeNull();
    fireEvent.click(acceptAllBtn);
    // The resolve itself hasn't run yet (still queued) — the spinner is up
    // and BOTH bulk buttons are disabled so the two can't race each other.
    expect(revision.accept).not.toHaveBeenCalled();
    expect(acceptAllBtn.querySelector('svg')).not.toBeNull();
    expect(acceptAllBtn).toBeDisabled();
    expect(rejectAllBtn).toBeDisabled();

    await flushDeferredResolve();
    expect(revision.accept).toHaveBeenCalledTimes(1);
  });

  it('shows a spinner on Reject all while its deferred resolve is pending', async () => {
    const revisions: any[] = [];
    const revision = makeRevision();
    revision.reject.mockImplementation(() => {
      revisions.splice(revisions.indexOf(revision), 1);
    });
    revisions.push(revision);
    const editor = makeEditor(revisions);
    render(<TrackedChangeGroups editor={editor} />);

    const acceptAllBtn = screen.getByRole('button', { name: 'Accept all' });
    const rejectAllBtn = screen.getByRole('button', { name: 'Reject all' });
    expect(rejectAllBtn.querySelector('svg')).toBeNull();
    fireEvent.click(rejectAllBtn);
    expect(revision.reject).not.toHaveBeenCalled();
    expect(rejectAllBtn.querySelector('svg')).not.toBeNull();
    expect(rejectAllBtn).toBeDisabled();
    expect(acceptAllBtn).toBeDisabled();

    await flushDeferredResolve();
    expect(revision.reject).toHaveBeenCalledTimes(1);
  });

  it('suppresses the selectionChange echo native accept fires during a group-wide resolve', () => {
    // Each native accept() moves the selection, firing a real
    // selectionChange — one unguarded rail rescan per resolve if unsuppressed.
    const first = makeRevision({ getRange: () => [{ text: 'first' }] });
    const second = makeRevision({ getRange: () => [{ text: 'second' }] });
    const untouched = makeRevision({
      customData: tag('cs-2', 'fix-effective-date'),
      getRange: () => [{ text: 'Untouched' }]
    });
    const revisions = [first, second, untouched];
    for (const revision of [first, second]) {
      revision.accept.mockImplementation(() => {
        revisions.splice(revisions.indexOf(revision), 1);
        // The echo: lands the cursor on some OTHER still-pending edit and
        // fires the same event a real click would.
        editor.selection.getCurrentRevision.mockReturnValue([untouched]);
        editor.emit('selectionChange');
      });
    }
    const editor = makeEditor(revisions);
    render(<TrackedChangeGroups editor={editor} />);

    // Two groups each render an 'Accept' button; the first is 'Update premium'.
    fireEvent.click(screen.getAllByRole('button', { name: 'Accept' })[0]);

    // Without suppression, "untouched"'s group would now be force-expanded
    // with its chip marked current, even though the user never touched it.
    expect(
      screen.getByRole('button', { name: 'Expand Fix effective date' })
    ).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Untouched')).not.toBeInTheDocument();
  });

  it('suppresses the selectionChange echo native accept fires during a chip resolve', async () => {
    const chip = makeRevision({ getRange: () => [{ text: 'chip' }] });
    const untouched = makeRevision({
      customData: tag('cs-2', 'fix-effective-date'),
      getRange: () => [{ text: 'Untouched' }]
    });
    const revisions = [chip, untouched];
    chip.accept.mockImplementation(() => {
      revisions.splice(revisions.indexOf(chip), 1);
      editor.selection.getCurrentRevision.mockReturnValue([untouched]);
      editor.emit('selectionChange');
    });
    const editor = makeEditor(revisions);
    render(<TrackedChangeGroups editor={editor} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Expand Update premium' })
    );
    fireEvent.click(screen.getByText('chip'));
    // Let focusChip's OWN echo-suppression (armed by the click above) clear
    // first, so what's actually being exercised below is resolveChips' own
    // suppression — not a residual one left over from focusing the chip.
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByLabelText('Accept this edit'));

    expect(
      screen.getByRole('button', { name: 'Expand Fix effective date' })
    ).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Untouched')).not.toBeInTheDocument();
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
    fireEvent.click(
      within(
        screen.getByText('$6,000').closest('[role="button"]') as HTMLElement
      ).getByRole('button', { name: 'Accept this edit' })
    );
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

    // Single-edit groups have no group-wide buttons; resolve via the chip.
    fireEvent.click(
      screen.getByRole('button', { name: 'Expand Update premium' })
    );
    fireEvent.click(screen.getByText('$6,000'));
    fireEvent.click(screen.getByLabelText('Accept this edit'));

    // The rail unmounted; focus on <body> would swallow the next ⌘Z, so it
    // goes back into the document instead.
    expect(insertion.accept).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();
    expect(editor.focusIn).toHaveBeenCalledTimes(1);
  });

  it('always shows group-wide Accept/Reject, even for single-edit groups', () => {
    const editor = makeEditor([makeRevision()]);
    render(<TrackedChangeGroups editor={editor} />);

    // Group-wide actions are visible up front — no need to expand or focus a
    // chip.
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Expand Update premium' })
    );
    fireEvent.click(screen.getByText('$6,000'));
    expect(screen.getByLabelText('Accept this edit')).toBeInTheDocument();
    expect(screen.getByLabelText('Reject this edit')).toBeInTheDocument();
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
    expect(screen.getByText('1 change')).toBeInTheDocument();
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

  it('ignores a selectionChange fired while the assistant is writing (no expand flicker)', () => {
    // Every op moves the caret, firing the same selectionChange a real click
    // does; unguarded, each op expands a group the next refresh() collapses.
    const revision = makeRevision();
    const editor = makeEditor([revision]);
    editor.__featheryAssistantWriting = true;
    render(<TrackedChangeGroups editor={editor} />);

    editor.selection.getCurrentRevision.mockReturnValue([revision]);
    act(() => editor.emit('selectionChange'));

    expect(screen.queryByText('$6,000')).not.toBeInTheDocument();

    // The guard doesn't leak past the batch — a real click still works.
    editor.__featheryAssistantWriting = false;
    act(() => editor.emit('selectionChange'));
    expect(
      screen.getByText('$6,000').closest('[aria-current="true"]')
    ).toBeInTheDocument();
  });

  it('ignores a selectionChange fired while the document is opening', () => {
    // Opening/reopening a document plants Syncfusion's own default caret,
    // firing this same event — not a real click either.
    const revision = makeRevision();
    const editor = makeEditor([revision]);
    editor.__featheryOpeningDocument = true;
    render(<TrackedChangeGroups editor={editor} />);

    editor.selection.getCurrentRevision.mockReturnValue([revision]);
    act(() => editor.emit('selectionChange'));
    expect(screen.queryByText('$6,000')).not.toBeInTheDocument();

    editor.__featheryOpeningDocument = false;
    act(() => editor.emit('selectionChange'));
    expect(
      screen.getByText('$6,000').closest('[aria-current="true"]')
    ).toBeInTheDocument();
  });

  it('never uses an editor ancestor as the rail chip scrollbox', () => {
    const revision = makeRevision();
    const editor = makeEditor([revision]);
    const { container } = render(
      <div data-testid='editor-viewport'>
        <TrackedChangeGroups editor={editor} />
      </div>
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Expand Update premium' })
    );
    const viewport = screen.getByTestId('editor-viewport');
    const panel = screen.getByLabelText('Assistant tracked changes');
    const scrollBox = panel.children[1] as HTMLElement;
    const row = screen.getByText('$6,000').closest('[role="button"]');
    expect(row).not.toBeNull();

    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 1000 },
      scrollHeight: { configurable: true, value: 20000 },
      scrollTop: { configurable: true, writable: true, value: 8742 }
    });
    Object.defineProperties(scrollBox, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 600 },
      scrollTop: { configurable: true, writable: true, value: 0 }
    });
    jest
      .spyOn(row as HTMLElement, 'getBoundingClientRect')
      .mockReturnValue({ top: 1200, bottom: 1280 } as DOMRect);
    jest.spyOn(scrollBox, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 700
    } as DOMRect);

    editor.selection.getCurrentRevision.mockReturnValue([revision]);
    act(() => editor.emit('selectionChange'));

    expect(scrollBox.scrollTop).toBe(0);
    expect(viewport.scrollTop).toBe(8742);
    expect(container).toContainElement(row as HTMLElement);
  });

  it('scrolls to the group card top so the heading stays in view', () => {
    const revision = makeRevision();
    const editor = makeEditor([revision]);
    render(<TrackedChangeGroups editor={editor} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Expand Update premium' })
    );
    const panel = screen.getByLabelText('Assistant tracked changes');
    const scrollBox = panel.children[1] as HTMLElement;
    const card = scrollBox.children[0] as HTMLElement;
    const row = screen
      .getByText('$6,000')
      .closest('[role="button"]') as HTMLElement;

    // Scrolled well past the card; the effect must bring it back up.
    Object.defineProperties(scrollBox, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 3000 },
      scrollTop: { configurable: true, writable: true, value: 2000 }
    });
    Object.defineProperty(row, 'offsetHeight', {
      configurable: true,
      value: 40
    });
    jest
      .spyOn(scrollBox, 'getBoundingClientRect')
      .mockReturnValue({ top: 100, bottom: 700 } as DOMRect);
    // Both are scrolled above the viewport (top < box top); the card header
    // sits just above its first chip row.
    jest
      .spyOn(card, 'getBoundingClientRect')
      .mockReturnValue({ top: 50, bottom: 300 } as DOMRect);
    jest
      .spyOn(row, 'getBoundingClientRect')
      .mockReturnValue({ top: 90, bottom: 130 } as DOMRect);

    editor.selection.getCurrentRevision.mockReturnValue([revision]);
    act(() => editor.emit('selectionChange'));

    // Card top offset = 50 - 100 + 2000 = 1950 (not the row's 1990), so the
    // group heading of the clicked change remains visible.
    expect(scrollBox.scrollTop).toBe(1950);
  });

  it('leaves the rail scroll in place when a group is merely expanded', () => {
    const revision = makeRevision();
    const editor = makeEditor([revision]);
    render(<TrackedChangeGroups editor={editor} />);
    const panel = screen.getByLabelText('Assistant tracked changes');
    const scrollBox = panel.children[1] as HTMLElement;
    Object.defineProperties(scrollBox, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 3000 },
      scrollTop: { configurable: true, writable: true, value: 1234 }
    });

    // Expanding/collapsing the group changes no selection, so the scroll
    // effect must not run — the rail stays exactly where the user left it.
    fireEvent.click(
      screen.getByRole('button', { name: 'Expand Update premium' })
    );
    expect(scrollBox.scrollTop).toBe(1234);
    fireEvent.click(
      screen.getByRole('button', { name: 'Collapse Update premium' })
    );
    expect(scrollBox.scrollTop).toBe(1234);
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

  it('does not immediately refresh on a new edit while the assistant is writing (debounces instead)', () => {
    // A revision-count change normally skips the debounce (see the test
    // above), which is O(n^2) across a batch. While the assistant writes,
    // the debounce applies instead: one refresh per batch, not per op.
    jest.useFakeTimers();
    try {
      const revisions: any[] = [];
      const editor = makeEditor(revisions);
      const { container } = render(<TrackedChangeGroups editor={editor} />);
      expect(container).toBeEmptyDOMElement();

      editor.__featheryAssistantWriting = true;
      revisions.push(makeRevision());
      act(() => {
        editor.emit('contentChange');
      });
      // Suppressed: no immediate refresh even though the count changed.
      expect(container).toBeEmptyDOMElement();

      act(() => {
        jest.advanceTimersByTime(150); // matches CONTENT_REFRESH_DEBOUNCE_MS
      });
      // The debounced refresh still catches up once the batch settles.
      expect(screen.getByText('Update premium')).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
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

  it('collapses an expanded group while a new document is opening', () => {
    const editor = makeEditor([makeRevision()]);
    render(<TrackedChangeGroups editor={editor} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Expand Update premium' })
    );
    expect(screen.getByText('$6,000')).toBeInTheDocument();

    // useDocxEditor sets this around openAsync/open; documentChange fires
    // as part of that same window.
    editor.__featheryOpeningDocument = true;
    act(() => editor.emit('documentChange'));

    // Collapsed, but the card itself is still there — the edit is still
    // pending, it's just not a state the user asked to review right now.
    expect(screen.queryByText('$6,000')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Expand Update premium' })
    ).toBeInTheDocument();
  });

  it('collapses an expanded group while the assistant is writing a batch', () => {
    jest.useFakeTimers();
    try {
      const editor = makeEditor([makeRevision()]);
      render(<TrackedChangeGroups editor={editor} />);
      fireEvent.click(
        screen.getByRole('button', { name: 'Expand Update premium' })
      );
      expect(screen.getByText('$6,000')).toBeInTheDocument();

      // applyDocumentEdits sets this around the whole batch; contentChange
      // fires once per op inside it.
      editor.__featheryAssistantWriting = true;
      act(() => editor.emit('contentChange'));
      act(() => {
        jest.advanceTimersByTime(150); // matches CONTENT_REFRESH_DEBOUNCE_MS
      });

      expect(screen.queryByText('$6,000')).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Expand Update premium' })
      ).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  // Step navigation destroys the Syncfusion instance under a still-mounted
  // rail: every raw EJ2 call then throws. The rail must treat a dead editor
  // as "no editor" across its whole lifecycle — mount, swap, and unmount —
  // instead of crashing out of the form step.
  it('survives an already-destroyed editor across mount and unmount', () => {
    const editor = makeDestroyedEditor();
    const view = render(<div />);
    expect(() => {
      view.rerender(<TrackedChangeGroups editor={editor} />);
    }).not.toThrow();
    expect(view.container).toBeEmptyDOMElement();
    expect(() => view.unmount()).not.toThrow();
  });

  it('survives the live editor being swapped for a destroyed one', () => {
    const editor = makeEditor([makeRevision()]);
    const { rerender, unmount } = render(
      <TrackedChangeGroups editor={editor} />
    );
    expect(screen.getByText('Update premium')).toBeInTheDocument();

    // The back-navigation race: the old instance is destroyed and the rail
    // re-renders against it before its own unmount lands.
    expect(() => {
      rerender(<TrackedChangeGroups editor={makeDestroyedEditor()} />);
    }).not.toThrow();
    expect(screen.queryByText('Update premium')).not.toBeInTheDocument();
    expect(() => unmount()).not.toThrow();
  });

  // EJ2 clears its listener registry before flipping isDestroyed, so
  // removeEventListener can still throw — and a passive-effect cleanup throw
  // escapes RailErrorBoundary, leaving the rail's buttons dead.
  it('survives removeEventListener throwing on unmount even though isDestroyed is still false', () => {
    const editor = makeEditor([makeRevision()]);
    editor.removeEventListener = () => {
      throw new TypeError('Cannot convert undefined or null to object');
    };
    const { unmount } = render(<TrackedChangeGroups editor={editor} />);
    expect(() => unmount()).not.toThrow();
  });
});

describe('resolveLiveRevisionGroupsAsOneUndo', () => {
  // A revision that throws stays at current[0]/current[last] and would be
  // retried until the budget is gone, starving the rest of the group.
  it('does not let one permanently-stuck revision block the rest of the group from resolving', () => {
    const stuck = makeRevision({ getRange: () => [{ text: 'stuck' }] });
    stuck.accept.mockImplementation(() => {
      throw new Error('native accept failure');
    });
    const first = makeRevision({ getRange: () => [{ text: 'first' }] });
    const second = makeRevision({ getRange: () => [{ text: 'second' }] });
    const revisions = [stuck, first, second];
    for (const revision of [first, second]) {
      revision.accept.mockImplementation(() => {
        revisions.splice(revisions.indexOf(revision), 1);
      });
    }
    const editor = makeEditor(revisions);

    const resolved = resolveLiveRevisionGroupsAsOneUndo(
      editor as unknown as LiveEditor,
      [{ changeSetId: 'cs-1', group: 'update-premium' }],
      true
    );

    expect(first.accept).toHaveBeenCalledTimes(1);
    expect(second.accept).toHaveBeenCalledTimes(1);
    // Retried once (and only once) before being excluded, never blocking
    // the other two.
    expect(stuck.accept).toHaveBeenCalledTimes(1);
    expect(revisions).toEqual([stuck]);
    expect(resolved).toEqual([stuck, first, second]);
  });
});

describe('resolveRevisionsAsOneUndo', () => {
  // The identity index backing this is built ONCE per call, not once per
  // revision — verify it still correctly resolves every distinct target in
  // one pass (not just the first one it happens to look up).
  it('resolves every distinct revision in one call via the identity index', () => {
    const first = makeRevision({ getRange: () => [{ text: 'first' }] });
    const second = makeRevision({
      customData: tag('cs-2', 'fix-effective-date'),
      getRange: () => [{ text: 'second' }]
    });
    const third = makeRevision({
      customData: tag('cs-3', 'add-signature'),
      getRange: () => [{ text: 'third' }]
    });
    const editor = makeEditor([first, second, third]);

    resolveRevisionsAsOneUndo(
      editor as unknown as LiveEditor,
      [first, second, third],
      true
    );

    expect(first.accept).toHaveBeenCalledTimes(1);
    expect(second.accept).toHaveBeenCalledTimes(1);
    expect(third.accept).toHaveBeenCalledTimes(1);
  });

  // A revision cascaded away by an earlier identity in the same call must be
  // skipped, not crash. Simulated by never adding it to the live collection.
  it('safely skips an identity that is not (or no longer) in the live collection', () => {
    const alreadyGone = makeRevision({ getRange: () => [{ text: 'gone' }] });
    const present = makeRevision({
      customData: tag('cs-2', 'fix-effective-date'),
      getRange: () => [{ text: 'present' }]
    });
    const editor = makeEditor([present]); // alreadyGone is NOT in the collection

    expect(() =>
      resolveRevisionsAsOneUndo(
        editor as unknown as LiveEditor,
        [alreadyGone, present],
        true
      )
    ).not.toThrow();

    expect(alreadyGone.accept).not.toHaveBeenCalled();
    expect(present.accept).toHaveBeenCalledTimes(1);
  });
});

describe('RailErrorBoundary', () => {
  // The rail is an overlay on the review experience; any failure inside it —
  // including ones the touchpoint guards can't reach, like a future render
  // bug — must hide the panel, not eject the user from their form step.
  it('contains a crashing rail: hides it, warns, and nothing escapes', () => {
    const Bomb = () => {
      throw new TypeError('Cannot convert undefined or null to object');
    };
    // React logs boundary-caught errors via console.error; silence that noise
    // but keep our own console.warn observable.
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      let container: HTMLElement | undefined;
      expect(() => {
        ({ container } = render(
          <RailErrorBoundary>
            <Bomb />
          </RailErrorBoundary>
        ));
      }).not.toThrow();
      expect(container).toBeEmptyDOMElement();
      expect(consoleWarn).toHaveBeenCalledWith(
        'Feathery: tracked-changes panel failed and was hidden.',
        expect.any(TypeError)
      );
    } finally {
      consoleError.mockRestore();
      consoleWarn.mockRestore();
    }
  });

  // Hiding the rail for the rest of the session is its own defect: the pending
  // changes are still in the document and there is no longer any way to see
  // them. A transient failure has to come back.
  it('retries a transient failure and shows the rail again', async () => {
    jest.useFakeTimers();
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      // An EFFECT throw, which is the case Anthony cited: the rail's mount
      // effect reads the editor, and React does not retry an effect the way it
      // retries a render.
      let throwOnce = true;
      const Flaky = () => {
        React.useEffect(() => {
          if (throwOnce) {
            throwOnce = false;
            throw new TypeError('read during teardown');
          }
        }, []);
        return <div data-testid='rail-child' />;
      };
      render(
        <RailErrorBoundary>
          <Flaky />
        </RailErrorBoundary>
      );
      expect(screen.queryByTestId('rail-child')).not.toBeInTheDocument();

      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      expect(screen.getByTestId('rail-child')).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
      consoleError.mockRestore();
      consoleWarn.mockRestore();
    }
  });

  it('stops retrying a fault that reproduces, and stays hidden', async () => {
    jest.useFakeTimers();
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      let runs = 0;
      const Bomb = () => {
        React.useEffect(() => {
          runs++;
          throw new TypeError('a real fault, every time');
        }, []);
        return <div data-testid='rail-child' />;
      };
      const { container } = render(
        <RailErrorBoundary>
          <Bomb />
        </RailErrorBoundary>
      );
      for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          jest.advanceTimersByTime(500);
        });
      }
      expect(container).toBeEmptyDOMElement();
      // The first mount plus the bounded retries, and no more.
      expect(runs).toBe(3);
    } finally {
      jest.useRealTimers();
      consoleError.mockRestore();
      consoleWarn.mockRestore();
    }
  });

  it('renders its child untouched when nothing fails', () => {
    render(
      <RailErrorBoundary>
        <div data-testid='rail-child' />
      </RailErrorBoundary>
    );
    expect(screen.getByTestId('rail-child')).toBeInTheDocument();
  });

  it('real SDK: native grouped table can be accepted again after undo', () => {
    const editor = makeRealEditor();
    let unmount = () => {};
    try {
      const settings = (editor as any).documentEditorSettings.revisionSettings;
      const withGroup = (group: string, run: () => void) => {
        const previous = settings.customData;
        settings.customData = tag('native-cs', group);
        try {
          run();
        } finally {
          settings.customData = previous;
        }
      };
      editor.enableTrackChanges = true;
      editor.selection.moveToDocumentEnd();
      withGroup('add-premium-table', () => {
        editor.editor.insertText('Premium schedule for review:');
        editor.editor.insertTable(3, 3);
        const cells = [
          'Item',
          'Current',
          'Proposed',
          'Premium',
          '$5,200',
          '$5,500',
          'Deductible',
          '$1,000',
          '$1,200'
        ];
        cells.forEach((text, index) => {
          editor.editor.insertText(text);
          if (index < cells.length - 1)
            editor.selection.handleTabKey(true, false);
        });
      });
      editor.selection.moveToDocumentEnd();

      ({ unmount } = render(<TrackedChangeGroups editor={editor} />));
      expect(screen.getByText('Add premium table')).toBeInTheDocument();
      acceptOnlyGroup();
      expect(editor.revisions.length).toBe(0);

      act(() => editor.editorHistory.undo());
      expect(editor.revisions.length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled();
      acceptOnlyGroup();
      expect(editor.revisions.length).toBe(0);
    } finally {
      unmount();
      destroyRealEditor(editor);
    }
  });

  it('real SDK: bridge-created group can be accepted again after undo', async () => {
    const editor = makeRealEditor('Premium: $5,200');
    let unmount = () => {};
    try {
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'bridge-cs',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;0',
            find: '$5,200',
            replace: '$5,500',
            group: 'update-premium'
          }
        ]
      });
      expect(result.results[0]).toMatchObject({ ok: true });
      ({ unmount } = render(<TrackedChangeGroups editor={editor} />));
      acceptAllGroups();
      await flushDeferredResolve();
      expect(editor.revisions.length).toBe(0);

      act(() => editor.editorHistory.undo());
      expect(editor.revisions.length).toBe(2);
      expect(screen.getByRole('button', { name: 'Accept all' })).toBeEnabled();
      acceptAllGroups();
      await flushDeferredResolve();
      expect(editor.revisions.length).toBe(0);
    } finally {
      unmount();
      destroyRealEditor(editor);
    }
  });

  it('real SDK: an individual chip accepts again from its button after undo', () => {
    const editor = makeRealEditor('Premium: $5,200');
    let unmount = () => {};
    try {
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'individual-button-cs',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;0',
            find: '$5,200',
            replace: '$5,500',
            group: 'update-premium'
          }
        ]
      });
      expect(result.results[0]).toMatchObject({ ok: true });
      ({ unmount } = render(<TrackedChangeGroups editor={editor} />));
      fireEvent.click(
        screen.getByRole('button', { name: 'Expand Update premium' })
      );
      fireEvent.click(screen.getByText('$5,500'));
      fireEvent.click(screen.getByLabelText('Accept this edit'));
      expect(editor.revisions.length).toBe(0);

      act(() => editor.editorHistory.undo());
      expect(editor.revisions.length).toBe(2);
      fireEvent.click(screen.getByText('$5,500'));
      fireEvent.click(screen.getByLabelText('Accept this edit'));
      expect(editor.revisions.length).toBe(0);
    } finally {
      unmount();
      destroyRealEditor(editor);
    }
  });

  it('real SDK: an individual chip rejects again from the keyboard after undo', () => {
    const editor = makeRealEditor('Premium: $5,200');
    let unmount = () => {};
    try {
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'individual-keyboard-cs',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;0',
            find: '$5,200',
            replace: '$5,500',
            group: 'update-premium'
          }
        ]
      });
      expect(result.results[0]).toMatchObject({ ok: true });
      ({ unmount } = render(<TrackedChangeGroups editor={editor} />));
      let panel = screen.getByLabelText('Assistant tracked changes');
      fireEvent.keyDown(panel, { key: 'j' });
      fireEvent.keyDown(panel, { key: 'r' });
      expect(editor.revisions.length).toBe(0);

      act(() => editor.editorHistory.undo());
      expect(editor.revisions.length).toBe(2);
      panel = screen.getByLabelText('Assistant tracked changes');
      fireEvent.keyDown(panel, { key: 'j' });
      fireEvent.keyDown(panel, { key: 'r' });
      expect(editor.revisions.length).toBe(0);
      expect(editor.serialize()).toContain('$5,200');
      expect(editor.serialize()).not.toContain('$5,500');
    } finally {
      unmount();
      destroyRealEditor(editor);
    }
  });
});
