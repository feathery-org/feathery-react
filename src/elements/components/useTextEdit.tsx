import { useEffect, useMemo, useRef, useState } from 'react';
import { featheryWindow } from '../../utils/browser';

// Strip html from pasted content
// TODO (tyler): replace with proper handling once bug (#33542) in React is fixed
const handlePaste = (e: ClipboardEvent) => {
  e.preventDefault();
  const plainText = e.clipboardData?.getData('text/plain') || '';
  document.execCommand('insertText', false, plainText);
};

function useTextEdit({
  editable,
  focused,
  expand,
  onTextSelect = null,
  onTextKeyDown = null,
  onTextBlur = null,
  onEditModeChange = null
}: any) {
  const spanRef = useRef(undefined);
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
      minWidth: '5px',
      display: 'inline-block',
      cursor: 'inherit',
      position: 'relative',
      width: 'auto',
      // Make text appear more vertically centered
      paddingBottom: '2px'
    };

    if (editable) {
      css.cursor = 'default';
      if (expand) css.width = '100%';
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
        },
        onPaste: handlePaste
      };

      if (focused) {
        editableProps = {
          ...editableProps,
          onClick: () => {
            updateEditMode('edit');
          }
        };
        css.cursor = 'text';
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
