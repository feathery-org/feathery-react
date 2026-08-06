import React from 'react';
import { render } from '@testing-library/react';

import ComponentsTab from '../ComponentsTab';
import { createBlockStore } from '../store';
import { SAMPLE_DOCUMENT } from '../sampleDocument';
import { useDocxEditor } from '../../elements/components/DocxEditor/useDocxEditor';

jest.mock('../../elements/components/DocxEditor/useDocxEditor');

type FakeEditor = {
  open: jest.Mock;
  serialize: jest.Mock;
  addEventListener: jest.Mock;
  removeEventListener: jest.Mock;
};

const makeEditor = (): FakeEditor & { fireContentChange: () => void } => {
  let listener: (() => void) | null = null;
  return {
    open: jest.fn(),
    serialize: jest.fn(),
    addEventListener: jest.fn((_name: string, fn: () => void) => {
      listener = fn;
    }),
    removeEventListener: jest.fn((_name: string, fn: () => void) => {
      if (listener === fn) listener = null;
    }),
    fireContentChange: () => listener?.()
  };
};

// A components-doc SFDT with the h2 sample bolded, in the shape `extractTheme`
// reads: a paragraph carrying the cmp_h2 bookmark pair around its run.
const boldedH2Sfdt = JSON.stringify({
  sections: [
    {
      blocks: [
        {
          paragraphFormat: { styleName: 'Heading 2' },
          characterFormat: {},
          inlines: [
            { characterFormat: {}, bookmarkType: 0, name: 'cmp_h2' },
            { characterFormat: { bold: true }, text: 'Heading 2 sample' },
            { characterFormat: {}, bookmarkType: 1, name: 'cmp_h2' }
          ]
        }
      ]
    }
  ]
});

describe('ComponentsTab', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
  });

  it('opens the components sample document once the editor is ready', () => {
    const editor = makeEditor();
    (useDocxEditor as jest.Mock).mockReturnValue({
      containerRef: { current: null },
      editor
    });
    const store = createBlockStore(SAMPLE_DOCUMENT);

    render(<ComponentsTab store={store} />);

    expect(useDocxEditor).toHaveBeenCalledWith(
      expect.objectContaining({ builtinToolbar: true })
    );
    expect(editor.open).toHaveBeenCalledTimes(1);
  });

  it('extracts the theme from a debounced contentChange and applies it to the store', () => {
    const editor = makeEditor();
    editor.serialize.mockReturnValue(boldedH2Sfdt);
    (useDocxEditor as jest.Mock).mockReturnValue({
      containerRef: { current: null },
      editor
    });
    const store = createBlockStore(SAMPLE_DOCUMENT);

    render(<ComponentsTab store={store} />);

    editor.fireContentChange();
    // Not yet — debounced.
    expect(store.getData().theme.h2.characterFormat?.bold).toBeUndefined();

    jest.advanceTimersByTime(600);

    expect(store.getData().theme.h2.characterFormat?.bold).toBe(true);
  });

  it('never reopens the components editor on repeated contentChange events', () => {
    const editor = makeEditor();
    editor.serialize.mockReturnValue(boldedH2Sfdt);
    (useDocxEditor as jest.Mock).mockReturnValue({
      containerRef: { current: null },
      editor
    });
    const store = createBlockStore(SAMPLE_DOCUMENT);

    render(<ComponentsTab store={store} />);
    expect(editor.open).toHaveBeenCalledTimes(1);

    editor.fireContentChange();
    jest.advanceTimersByTime(600);
    editor.fireContentChange();
    jest.advanceTimersByTime(600);

    expect(editor.open).toHaveBeenCalledTimes(1);
  });
});
