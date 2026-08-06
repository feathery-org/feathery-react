import { useEffect, useState } from 'react';

// EJ2 reports fontColor as 8-digit hex when alpha is involved — '#00000000'
// (transparent black) IS its "automatic" color, i.e. most ordinary text. The
// value feeds <input type='color'>, which accepts ONLY '#rrggbb'; anything
// else logs a browser warning on every selection change. Drop the alpha pair
// and map anything still non-conforming (named colors, 'empty') to black.
export const toInputHex = (color: string): string => {
  const hex = /^#[0-9a-fA-F]{8}$/.test(color) ? color.slice(0, 7) : color;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#000000';
};

// Cell/table backgrounds go through the same alpha-hex normalization, but
// their "unset" state ('empty', undefined) must surface as white — no shading
// — not black.
export const toBackgroundHex = (color: string | undefined): string => {
  if (!color) return '#ffffff';
  const hex = /^#[0-9a-fA-F]{8}$/.test(color) ? color.slice(0, 7) : color;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#ffffff';
};

// Selection contexts that put the cursor/selection inside a table — tables
// live in the body, headers and footers alike.
const IN_TABLE_CONTEXTS = new Set([
  'TableText',
  'TableImage',
  'HeaderTableText',
  'HeaderTableImage',
  'FooterTableText',
  'FooterTableImage'
]);

// Formatting state mirrored from the live Syncfusion DocumentEditor: tracks
// the editor's selectionChange / zoomFactorChange events so the toolbar's
// active states follow the cursor.
export function useEditorFormatState(editor: any) {
  const [zoom, setZoom] = useState(100);
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [strike, setStrike] = useState(false);
  const [fontFamily, setFontFamily] = useState('Calibri');
  const [fontSize, setFontSize] = useState(11);
  const [styleName, setStyleName] = useState('Normal');
  const [alignment, setAlignment] = useState('Left');
  const [fontColor, setFontColor] = useState('#000000');
  const [isInTable, setIsInTable] = useState(false);
  const [trackChangesOn, setTrackChangesOn] = useState(false);
  const [cellShading, setCellShading] = useState('#ffffff');

  useEffect(() => {
    const syncSelection = () => {
      const cf = editor.selection.characterFormat;
      const pf = editor.selection.paragraphFormat;
      setBold(cf.bold);
      setItalic(cf.italic);
      setStrike(cf.strikethrough !== 'None');
      if (cf.fontFamily) setFontFamily(cf.fontFamily);
      if (cf.fontSize) setFontSize(cf.fontSize);
      if (cf.fontColor) setFontColor(toInputHex(cf.fontColor));
      setStyleName(pf.styleName || 'Normal');
      setAlignment(pf.textAlignment || 'Left');
      const inTable = IN_TABLE_CONTEXTS.has(editor.selection.contextType);
      setIsInTable(inTable);
      // Plain property, no change event of its own — selectionChange fires
      // often enough (every cursor move) to keep the gating fresh.
      setTrackChangesOn(!!editor.enableTrackChanges);
      if (inTable) {
        setCellShading(
          toBackgroundHex(editor.selection.cellFormat?.background)
        );
      }
    };
    const syncZoom = () => setZoom(Math.round(editor.zoomFactor * 100));

    editor.addEventListener('selectionChange', syncSelection);
    editor.addEventListener('zoomFactorChange', syncZoom);
    syncSelection();
    syncZoom();
    return () => {
      // On step navigation React destroys the deleted subtree parent-first,
      // so useDocxEditor has already destroy()ed the editor by the time this
      // cleanup runs — removeEventListener on a destroyed ej2 instance throws
      // ("Cannot convert undefined or null to object").
      if (editor.isDestroyed) return;
      try {
        editor.removeEventListener('selectionChange', syncSelection);
        editor.removeEventListener('zoomFactorChange', syncZoom);
      } catch {
        /* editor already torn down */
      }
    };
  }, [editor]);

  const applyZoom = (pct: number) => {
    editor.zoomFactor = Math.min(500, Math.max(50, pct)) / 100;
  };
  // Re-read the zoom from the editor for operations that don't fire
  // zoomFactorChange (e.g. fitPage).
  const refreshZoom = () => setZoom(Math.round(editor.zoomFactor * 100));

  return {
    zoom,
    applyZoom,
    refreshZoom,
    bold,
    italic,
    strike,
    fontFamily,
    fontSize,
    setFontSize,
    styleName,
    alignment,
    fontColor,
    setFontColor,
    isInTable,
    trackChangesOn,
    cellShading,
    setCellShading
  };
}
