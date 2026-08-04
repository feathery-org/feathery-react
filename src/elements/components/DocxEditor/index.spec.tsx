import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import DocxEditor from './index';

let mockEditor: any;

jest.mock('./useDocxEditor', () => ({
  useDocxEditor: () => ({
    containerRef: { current: null },
    editor: mockEditor,
    loading: false,
    error: null,
    exportDoc: jest.fn()
  })
}));

jest.mock('./DocxToolbar', () => () => null);

jest.mock('./TrackedChangeGroups', () => {
  const React = jest.requireActual('react');
  return ({ onResolve }: { onResolve: (message: string) => void }) =>
    React.createElement(
      'button',
      { onClick: () => onResolve('Modified change accepted.') },
      'Resolve a change'
    );
});

describe('DocxEditor resolution toast', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockEditor = { editorHistory: { undo: jest.fn() } };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('offers one-step Undo and auto-dismisses after four seconds', () => {
    render(<DocxEditor />);

    fireEvent.click(screen.getByRole('button', { name: 'Resolve a change' }));
    expect(screen.getByText('Modified change accepted.')).toBeInTheDocument();
    expect(screen.getByText('⌘Z')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(mockEditor.editorHistory.undo).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText('Modified change accepted.')
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Resolve a change' }));
    act(() => jest.advanceTimersByTime(4000));
    expect(
      screen.queryByText('Modified change accepted.')
    ).not.toBeInTheDocument();
  });
});
