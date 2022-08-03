import { useEffect, useMemo, useRef, useState } from 'react';

function useTextEdit({
  editable,
  focused,
  onTextSelect = null,
  onTextKeyDown = null,
  onTextBlur = null
}) {
  const spanRef = useRef();
  const [editMode, setEditMode] = useState('hover');

  useEffect(() => {
    if (editMode === 'edit') {
      const node = spanRef.current.childNodes[0];
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 0);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, [editMode]);

  useEffect(() => {
    if (!focused) setEditMode('hover');
  }, [focused]);

  const editableProps = useMemo(() => {
    let editableProps = {};
    const css = {
      outline: 'none',
      minWidth: '5px',
      display: 'inline-block',
      cursor: 'inherit'
    };

    if (editable) {
      css.cursor = 'default';
      // Unfocused text can't be selected or edited, but we need to keep
      // contenteditable = true so when losing focus, blur event is still propagated
      editableProps = {
        contentEditable: true,
        suppressContentEditableWarning: true,
        onMouseDown: (e) => !focused && e.preventDefault(),
        onSelect: (e) => {
          if (!focused) e.preventDefault();
          onTextSelect && onTextSelect(window.getSelection());
        },
        onKeyDown: (e) => {
          if (!focused) e.preventDefault();
          if (onTextKeyDown)
            onTextKeyDown(e, spanRef.current, window.getSelection());
        },
        onBlur: (e) => {
          setEditMode('hover');
          onTextBlur && onTextBlur(e);
        }
      };

      if (focused) {
        if (editMode === 'hover') {
          editableProps = { onClick: () => setEditMode('edit') };
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
