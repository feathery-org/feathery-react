import { useEffect, useState } from 'react';

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

  useEffect(() => {
    const syncSelection = () => {
      const cf = editor.selection.characterFormat;
      const pf = editor.selection.paragraphFormat;
      setBold(cf.bold);
      setItalic(cf.italic);
      setStrike(cf.strikethrough !== 'None');
      if (cf.fontFamily) setFontFamily(cf.fontFamily);
      if (cf.fontSize) setFontSize(cf.fontSize);
      if (cf.fontColor) setFontColor(cf.fontColor);
      setStyleName(pf.styleName || 'Normal');
      setAlignment(pf.textAlignment || 'Left');
    };
    const syncZoom = () => setZoom(Math.round(editor.zoomFactor * 100));

    editor.addEventListener('selectionChange', syncSelection);
    editor.addEventListener('zoomFactorChange', syncZoom);
    syncSelection();
    syncZoom();
    return () => {
      editor.removeEventListener('selectionChange', syncSelection);
      editor.removeEventListener('zoomFactorChange', syncZoom);
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
    setFontColor
  };
}
