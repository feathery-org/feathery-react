import React from 'react';
import { render } from '@testing-library/react';
import DocxEditor from './index';

// On step navigation React tears the subtree down parent-first, so by the time
// DocxEditor's own effect cleanups run, useDocxEditor has already destroy()ed
// the Syncfusion instance — whose removeEventListener then THROWS. An unguarded
// cleanup turns that into an uncaught unmount error that crashes the whole
// form (the "can't go back to the previous step" bug). Model that engine here.
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
