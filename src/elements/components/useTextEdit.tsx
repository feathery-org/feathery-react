import { useEffect, useMemo, useRef, useState } from 'react';
import { featheryWindow } from '../../utils/browser';

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

  const updateEditMode = (newMode: 'edit' | 'hover') => {
    setEditMode(newMode);
    onEditModeChange && onEditModeChange(newMode === 'edit');
  };

  useEffect(() => {
    if (!focused) {
      updateEditMode('hover');
    }
  }, [focused]);

  const editableProps = useMemo(() => {
    let editableProps: any = {};
    const css = {
      outline: 'none',
      display: 'inline-block',
      cursor: 'inherit',
      position: 'relative',
      // Make text appear more vertically centered
      paddingBottom: '2px'
    };

    if (editable) {
      css.cursor = 'default';
      // Unfocused text can't be selected or edited, but we need to keep
      // contenteditable = true so when losing focus, blur event is still propagated
      editableProps = {
        contentEditable: true,
        suppressContentEditableWarning: true,
        onMouseDown: (e: MouseEvent) => {
          if (!focused) e.preventDefault();
        },
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
        editableProps = {
          ...editableProps,
          onClick: () => {
            updateEditMode('edit');
          }
        };
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
