import { act, renderHook } from '@testing-library/react';
import {
  toBackgroundHex,
  toInputHex,
  useEditorFormatState
} from './useEditorFormatState';

// <input type='color'> accepts only '#rrggbb'. EJ2 hands the toolbar 8-digit
// alpha hex — '#00000000' is its "automatic" color — which the browser
// rejects with a console warning on every selection change.
describe('toInputHex', () => {
  it('passes conforming 6-digit hex through untouched', () => {
    expect(toInputHex('#1a2b3c')).toBe('#1a2b3c');
    expect(toInputHex('#FFFFFF')).toBe('#FFFFFF');
  });

  it('drops the alpha pair from 8-digit hex', () => {
    expect(toInputHex('#00000000')).toBe('#000000');
    expect(toInputHex('#1A2B3CFF')).toBe('#1A2B3C');
  });

  it('maps anything non-conforming to black', () => {
    expect(toInputHex('empty')).toBe('#000000');
    expect(toInputHex('red')).toBe('#000000');
    expect(toInputHex('')).toBe('#000000');
    expect(toInputHex('#abc')).toBe('#000000');
  });
});

describe('toBackgroundHex', () => {
  it('passes conforming hex through and drops alpha pairs', () => {
    expect(toBackgroundHex('#1a2b3c')).toBe('#1a2b3c');
    expect(toBackgroundHex('#1A2B3CFF')).toBe('#1A2B3C');
  });

  it("maps the unset state ('empty', undefined, '') to white, not black", () => {
    expect(toBackgroundHex('empty')).toBe('#ffffff');
    expect(toBackgroundHex(undefined)).toBe('#ffffff');
    expect(toBackgroundHex('')).toBe('#ffffff');
  });
});

// Live-editor stand-in with the exact surface syncSelection reads.
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

describe('useEditorFormatState — table context', () => {
  it('reports isInTable=false for plain text and true for every table context', () => {
    const editor = makeEditor();
    const { result } = renderHook(() => useEditorFormatState(editor));
    expect(result.current.isInTable).toBe(false);

    for (const ctx of [
      'TableText',
      'TableImage',
      'HeaderTableText',
      'HeaderTableImage',
      'FooterTableText',
      'FooterTableImage'
    ]) {
      editor.selection.contextType = ctx;
      act(() => editor.emit('selectionChange'));
      expect(result.current.isInTable).toBe(true);
    }

    for (const ctx of ['Text', 'Image', 'List', 'HeaderText', 'FooterText']) {
      editor.selection.contextType = ctx;
      act(() => editor.emit('selectionChange'));
      expect(result.current.isInTable).toBe(false);
    }
  });

  it('mirrors enableTrackChanges on every selection change', () => {
    const editor = makeEditor();
    const { result } = renderHook(() => useEditorFormatState(editor));
    expect(result.current.trackChangesOn).toBe(false);

    editor.enableTrackChanges = true;
    act(() => editor.emit('selectionChange'));
    expect(result.current.trackChangesOn).toBe(true);

    editor.enableTrackChanges = false;
    act(() => editor.emit('selectionChange'));
    expect(result.current.trackChangesOn).toBe(false);
  });

  it('snapshots cell shading while in a table, unset reads as white', () => {
    const editor = makeEditor();
    const { result } = renderHook(() => useEditorFormatState(editor));

    editor.selection.contextType = 'TableText';
    editor.selection.cellFormat.background = '#FFEE00';
    act(() => editor.emit('selectionChange'));
    expect(result.current.cellShading).toBe('#FFEE00');

    editor.selection.cellFormat.background = 'empty';
    act(() => editor.emit('selectionChange'));
    expect(result.current.cellShading).toBe('#ffffff');
  });
});
