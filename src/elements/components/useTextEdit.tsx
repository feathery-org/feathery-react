import { useEffect, useMemo, useRef, useState } from 'react';
import { featheryDoc, featheryWindow } from '../../utils/browser';

function useTextEdit({
  editable,
  focused,
  onTextSelect = null,
  onTextKeyDown = null,
  onTextBlur = null,
  onEditModeChange = null
}: any) {
  const spanRef = useRef();
  const [editMode, setEditMode] = useState('hover');

  const updateEditMode = (newMode: string) => {
    setEditMode(newMode);
    onEditModeChange && onEditModeChange(newMode === 'edit');
  };

  useEffect(() => {
    if (editMode === 'edit') {
      // @ts-expect-error TS(2532): Object is possibly 'undefined'.
      const node = spanRef.current.childNodes[0];
      const range = featheryDoc().createRange();
      range.setStart(node, 0);
      range.setEnd(node, 0);
      const sel = featheryWindow().getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  }, [editMode]);

  useEffect(() => {
    if (!focused) updateEditMode('hover');
  }, [focused]);

  const editableProps = useMemo(() => {
    let editableProps: any = {};
    const css = {
      outline: 'none',
      minWidth: '5px',
      display: 'inline-block',
      cursor: 'inherit',
      position: 'relative',
      // Make text in button appear more vertically centered
      paddingBottom: '1px'
    };

    if (editable) {
      css.cursor = 'default';
      // Unfocused text can't be selected or edited, but we need to keep
      // contenteditable = true so when losing focus, blur event is still propagated
      editableProps = {
        contentEditable: true,
        suppressContentEditableWarning: true,
        onMouseDown: (e: MouseEvent) => !focused && e.preventDefault(),
        onSelect: (e: any) => {
          if (!focused) e.preventDefault();
          onTextSelect && onTextSelect(featheryWindow().getSelection());
        },
        onKeyDown: (e: any) => {
          if (!focused) e.preventDefault();
          if (onTextKeyDown)
            onTextKeyDown(e, spanRef.current, featheryWindow().getSelection());
        },
        onBlur: (e: any) => {
          updateEditMode('hover');
          onTextBlur && onTextBlur(e);
        }
      };

      if (focused) {
        if (editMode === 'hover') {
          editableProps = { onClick: () => updateEditMode('edit') };
          // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
          css['&:hover'] = { backgroundColor: 'rgb(230, 240, 252)' };
        } else if (editMode === 'edit') css.cursor = 'text';
      }
    }

    editableProps.css = css;
    return editableProps;
  }, [
    editable,
    focused,
    editMode,
    spanRef,
    onTextBlur,
    onTextSelect,
    onTextKeyDown
  ]);

  return { spanRef, editableProps };
}

export default useTextEdit;
