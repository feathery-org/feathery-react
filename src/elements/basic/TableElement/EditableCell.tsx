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
  onEdit: (fieldKey: string, rowIndex: number, newValue: any) => void;
};

export function EditableCell({
  value,
  fieldKey,
  rowIndex,
  onEdit
}: EditableCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shouldSaveRef = useRef(true);

  const displayValue = stringifyWithNull(value) ?? '';
  const isEmpty = displayValue === '';

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
    setEditValue(displayValue);
    setIsEditing(true);
  };

  const saveEdit = () => {
    if (editValue !== displayValue) {
      onEdit(fieldKey, rowIndex, editValue);
    }
    setIsEditing(false);
  };

  const cancelEdit = () => {
    shouldSaveRef.current = false;
    setIsEditing(false);
  };

  const handleBlur = () => {
    if (shouldSaveRef.current) saveEdit();
    shouldSaveRef.current = true;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    } else if (e.key === 'Tab') {
      shouldSaveRef.current = false;
      saveEdit();
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
