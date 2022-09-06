import { useEffect, useMemo, useRef, useState } from 'react';

function useTextEdit({
  editable,
  focused,
  onTextSelect = null,
  onTextKeyDown = null,
  onTextBlur = null
}: any) {
  const spanRef = useRef();
  const [editMode, setEditMode] = useState('hover');

  useEffect(() => {
    if (editMode === 'edit') {
      // @ts-expect-error TS(2532): Object is possibly 'undefined'.
      const node = spanRef.current.childNodes[0];
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 0);
      const sel = window.getSelection();
      // @ts-expect-error TS(2531): Object is possibly 'null'.
      sel.removeAllRanges();
      // @ts-expect-error TS(2531): Object is possibly 'null'.
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
        onMouseDown: (e: any) => !focused && e.preventDefault(),
        onSelect: (e: any) => {
          if (!focused) e.preventDefault();
          onTextSelect && onTextSelect(window.getSelection());
        },
        onKeyDown: (e: any) => {
          if (!focused) e.preventDefault();
          if (onTextKeyDown)
            onTextKeyDown(e, spanRef.current, window.getSelection());
        },
        onBlur: (e: any) => {
          setEditMode('hover');
          onTextBlur && onTextBlur(e);
        }
      };

      if (focused) {
        if (editMode === 'hover') {
          editableProps = { onClick: () => setEditMode('edit') };
          // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
          css['&:hover'] = { backgroundColor: 'rgb(230, 240, 252)' };
        } else if (editMode === 'edit') css.cursor = 'text';
      }
    }
    (editableProps as any).css = css;
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
