import React from 'react';
import { act, render, screen } from '@testing-library/react';
import DocxToolbar from './index';

// jsdom has no ResizeObserver (the reason this file stubs it): the overflow
// hook must still be able to construct/observe, and the table-group toggle
// must refit via the pre-paint layout effect rather than waiting on observer
// callbacks — which is exactly the narrow-width flicker regression.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  (globalThis as any).ResizeObserver =
    (globalThis as any).ResizeObserver ?? ResizeObserverStub;
});

function makeEditor(): any {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    zoomFactor: 1,
    enableTrackChanges: false,
    selection: {
      contextType: 'Text',
      characterFormat: {
        bold: false,
        italic: false,
        strikethrough: 'None',
        fontFamily: 'Calibri',
        fontSize: 11,
        fontColor: '#000000'
      },
      paragraphFormat: { styleName: 'Normal', textAlignment: 'Left' },
      cellFormat: { background: 'empty' },
      tableFormat: { background: 'empty' }
    },
    addEventListener: (event: string, handler: () => void) => {
      (listeners[event] ??= []).push(handler);
    },
    removeEventListener: (event: string, handler: () => void) => {
      listeners[event] = (listeners[event] ?? []).filter((h) => h !== handler);
    },
    emit: (event: string) => (listeners[event] ?? []).forEach((h) => h())
  };
}

describe('DocxToolbar table group toggle', () => {
  it('shows the table group only while the cursor is inside a table', () => {
    const editor = makeEditor();
    render(<DocxToolbar editor={editor} />);

    expect(screen.queryByTitle('Table rows')).not.toBeInTheDocument();

    editor.selection.contextType = 'TableText';
    act(() => editor.emit('selectionChange'));
    // Rendered twice (hidden measurement row + visible row) — both count.
    expect(screen.getAllByTitle('Table rows').length).toBeGreaterThan(0);
    expect(screen.getAllByTitle('Merge cells').length).toBeGreaterThan(0);

    editor.selection.contextType = 'Text';
    act(() => editor.emit('selectionChange'));
    expect(screen.queryByTitle('Table rows')).not.toBeInTheDocument();
  });
});
