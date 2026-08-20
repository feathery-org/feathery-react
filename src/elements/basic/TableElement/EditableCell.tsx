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
  // Spreadsheet mode: replace the cell content with this draft when the
  // editor opens (type-to-edit), instead of seeding from the current value
  seedValue?: string | null;
  // Spreadsheet mode sets this false: a click selects the cell instead of
  // opening the editor (editing starts via double-click or keyboard)
  clickToEdit?: boolean;
  onEnterCommit?: () => void;
};

export function EditableCell({
  value,
  fieldKey,
  rowIndex,
  isEditing,
  onEdit,
  onStartEdit,
  onStopEdit,
  onNavigate,
  seedValue = null,
  clickToEdit = true,
  onEnterCommit
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
  const seededRef = useRef(false);
  if (isEditing && !prevEditingRef.current) {
    seededRef.current = seedValue != null;
    setEditValue(seedValue ?? displayValue);
  }
  prevEditingRef.current = isEditing;

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      if (seededRef.current) {
        // Type-to-edit: keep typing after the seeded character
        const len = inputRef.current.value.length;
        inputRef.current.setSelectionRange(len, len);
      } else {
        inputRef.current.select();
      }
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
      onEnterCommit?.();
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
    if (!clickToEdit) {
      return <span className={TABLE_CLASS.editableCell} />;
    }
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
        css={{
          ...editableCellTextStyle,
          ...(clickToEdit ? { cursor: 'pointer' } : {})
        }}
        onClick={clickToEdit ? startEditing : undefined}
      >
        {displayValue}
      </span>
    </div>
  );
}
