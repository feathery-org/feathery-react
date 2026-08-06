import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import DebugPanel from '../DebugPanel';
import { createBlockStore } from '../store';
import { attachBlockSync, EditorSurface } from '../blockSync';
import { SAMPLE_DOCUMENT } from '../sampleDocument';

type FakeEditor = EditorSurface & {
  fireContentChange: () => void;
};

const makeEditor = (): FakeEditor => {
  let listener: (() => void) | null = null;
  return {
    open: jest.fn(),
    serialize: jest.fn(),
    addEventListener: jest.fn((_name, fn) => {
      listener = fn;
    }),
    removeEventListener: jest.fn((_name, fn) => {
      if (listener === fn) listener = null;
    }),
    scrollContainer: () => ({ scrollTop: 0 }),
    fireContentChange: () => listener?.()
  };
};

const lastOpenedRaw = (editor: FakeEditor): string => {
  const calls = (editor.open as jest.Mock).mock.calls;
  return calls[calls.length - 1][0];
};

describe('DebugPanel', () => {
  it('renders the store data JSON containing a known block id', () => {
    const store = createBlockStore(SAMPLE_DOCUMENT);
    const editor = makeEditor();
    const sync = attachBlockSync(editor, store, null);
    render(<DebugPanel store={store} sync={sync} editor={editor} />);

    expect(screen.getByTestId('docx-debug-data').textContent).toContain(
      'blk_scope_p'
    );
  });

  it("Pull puts serialize()'s return value into the SFDT textarea", () => {
    const store = createBlockStore(SAMPLE_DOCUMENT);
    const editor = makeEditor();
    const sync = attachBlockSync(editor, store, null);
    (editor.serialize as jest.Mock).mockReturnValue('{"pulled":"sfdt"}');
    render(<DebugPanel store={store} sync={sync} editor={editor} />);

    fireEvent.click(screen.getByRole('button', { name: 'Pull' }));

    expect(screen.getByTestId('docx-debug-sfdt')).toHaveValue(
      '{"pulled":"sfdt"}'
    );
  });

  it('shows a log entry after sync emits one via an absorb', () => {
    jest.useFakeTimers();
    const store = createBlockStore(SAMPLE_DOCUMENT);
    const editor = makeEditor();
    const sync = attachBlockSync(editor, store, null);
    render(<DebugPanel store={store} sync={sync} editor={editor} />);

    const opened = JSON.parse(lastOpenedRaw(editor));
    // blk_scope_p is section 0, block index 3: [bookmarkStart, textRun, bookmarkEnd]
    opened.sections[0].blocks[3].inlines[1].text = 'Edited from the document.';
    (editor.serialize as jest.Mock).mockReturnValue(JSON.stringify(opened));

    act(() => {
      editor.fireContentChange();
      jest.advanceTimersByTime(400);
    });

    expect(screen.getByTestId('docx-debug-log').textContent).toContain(
      'absorb'
    );
    jest.useRealTimers();
  });
});
