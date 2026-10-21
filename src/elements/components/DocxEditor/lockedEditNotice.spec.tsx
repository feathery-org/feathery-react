import React from 'react';
import { act, render, screen } from '@testing-library/react';
import DocxEditor from './index';

// Drive the real DocxEditor against a stubbed engine and call the bindings
// layer's locked-edit callbacks directly, in the order Syncfusion produces them.
// The `mock` prefix lets jest.mock's hoisted factory reference it.
const mockBindings: {
  onLockedEdit?: () => void;
  onLockedEditResolved?: () => void;
} = {};

jest.mock('./DocxToolbar', () => ({ __esModule: true, default: () => null }));

jest.mock('./useDocxEditor', () => ({
  useDocxEditor: ({ bindings }: any) => {
    mockBindings.onLockedEdit = bindings?.onLockedEdit;
    mockBindings.onLockedEditResolved = bindings?.onLockedEditResolved;
    return {
      containerRef: { current: null },
      editor: { stub: true },
      loading: false,
      error: null,
      exportDoc: jest.fn(),
      bindings: { ready: true, commitForSave: () => true, diagnostics: [] }
    };
  }
}));

const NOTICE = "This content is locked and can't be edited here.";

function fire(name: keyof typeof mockBindings): void {
  const callback = mockBindings[name];
  if (!callback) throw new Error(`DocxEditor did not pass ${name}`);
  callback();
}

describe('DocxEditor locked-content notice', () => {
  it('hides when the caret leaves, even if the show lands in the same batch', () => {
    render(<DocxEditor bindings={{ enabled: true }} />);

    // Caret on the locked Total cell.
    act(() => fire('onLockedEdit'));
    expect(screen.getByText(NOTICE)).toBeInTheDocument();

    // Focus leaves the editor.
    act(() => fire('onLockedEditResolved'));
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();

    // Clicking back in on another cell: Syncfusion fires a stale
    // 'contentControl' for Total, then selectionChange lands on the editable
    // cell - one batch, show then resolve. The notice must not survive it.
    act(() => {
      fire('onLockedEdit');
      fire('onLockedEditResolved');
    });
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });
});
