import React from 'react';
import { render } from '@testing-library/react';
import DocxEditor from './index';

// By DocxEditor's cleanups the Syncfusion instance is already destroyed and
// removeEventListener throws; this mock models that engine.
const mockEditor: any = {
  zoomFactor: 1,
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(() => {
    throw new TypeError('Cannot convert undefined or null to object');
  })
};

jest.mock('./DocxToolbar', () => ({
  __esModule: true,
  default: () => null
}));

jest.mock('./useDocxEditor', () => ({
  useDocxEditor: () => ({
    containerRef: { current: null },
    editor: mockEditor,
    loading: false,
    error: null,
    exportDoc: async () => new Blob(['docx']),
    bindings: { ready: false, commitForSave: () => true, diagnostics: [] }
  })
}));

describe('DocxEditor unmount', () => {
  it('unmounts cleanly when the engine is already destroyed', () => {
    const { unmount } = render(<DocxEditor onSave={async () => undefined} />);
    expect(() => unmount()).not.toThrow();
  });
});
