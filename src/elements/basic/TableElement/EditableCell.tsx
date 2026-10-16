import { useState, useRef, useEffect } from 'react';
import { featheryDoc } from '../../../utils/browser';
import { stringifyWithNull } from '../../../utils/primitives';
import {
  clickToEditStyle,
  cellInputStyle,
  editableCellContentStyle,
  editableCellTextStyle,
  editingCellContentStyle,
  editingCellInputStyle,
  editingCellSizerStyle
} from './styles';
import { TABLE_CLASS } from './classNames';

type EditableCellProps = {
  value: any;
  fieldKey: string;
  rowIndex: number;
  isEditing: boolean;
  onEdit: (fieldKey: string, rowIndex: number, newValue: any) => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onNavigate: (backward: boolean) => void;
};

export function EditableCell({
  value,
  fieldKey,
  rowIndex,
  isEditing,
  onEdit,
  onStartEdit,
  onStopEdit,
  onNavigate
}: EditableCellProps) {
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shouldSaveRef = useRef(true);
  // Suppresses the blur that fires when focus moves to the next cell during Tab
  // navigation, so it does not re-save or clear the freshly-set editing cell.
  const skipBlurRef = useRef(false);

  const displayValue = stringifyWithNull(value) ?? '';
  const isEmpty = displayValue === '';

  // Seed the draft value the moment this cell becomes the active editor, before
  // paint, so the textarea shows the right content on first render (no flash).
  const prevEditingRef = useRef(false);
  if (isEditing && !prevEditingRef.current) {
    setEditValue(displayValue);
    skipBlurRef.current = false;
    shouldSaveRef.current = true;
  }
  prevEditingRef.current = isEditing;

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const startEditing = () => {
    // Force any other cell that is mid-edit to commit and close via its own
    // blur handler before opening this one. Clicking a cell's (non-focusable)
    const active = featheryDoc().activeElement as HTMLElement | null;
    if (active && active !== inputRef.current) active.blur();
    onStartEdit();
  };

  const saveValue = () => {
    if (editValue !== displayValue) {
      onEdit(fieldKey, rowIndex, editValue);
    }
  };

  const handleBlur = () => {
    if (skipBlurRef.current) {
      skipBlurRef.current = false;
      return;
    }
    if (shouldSaveRef.current) saveValue();
    shouldSaveRef.current = true;
    onStopEdit();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      shouldSaveRef.current = false;
      inputRef.current?.blur();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      skipBlurRef.current = true;
      saveValue();
      onNavigate(e.shiftKey);
    }
  };

  if (isEditing) {
    return (
      <div className={TABLE_CLASS.editableCell} css={editingCellContentStyle}>
        <div css={editingCellSizerStyle}>{`${editValue}\u200b`}</div>
        <textarea
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className={TABLE_CLASS.cellInput}
          css={{ ...cellInputStyle, ...editingCellInputStyle }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    );
  }

  if (isEmpty) {
    return (
      <span
        className={TABLE_CLASS.editableCell}
        css={clickToEditStyle}
        onClick={startEditing}
      >
        Click to edit
      </span>
    );
  }

  return (
    <div className={TABLE_CLASS.editableCell} css={editableCellContentStyle}>
      <span
        css={{ ...editableCellTextStyle, cursor: 'pointer' }}
        onClick={startEditing}
      >
        {displayValue}
      </span>
    </div>
  );
}
