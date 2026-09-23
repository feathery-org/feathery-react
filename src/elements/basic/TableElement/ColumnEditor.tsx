import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { featheryDoc } from '../../../utils/browser';
import {
  confirmPopoverStyle,
  confirmButtonRowStyle,
  confirmCancelButtonStyle,
  confirmPrimaryButtonStyle,
  confirmTextStyle,
  columnEditorStyle,
  columnEditorLabelStyle,
  columnEditorInputStyle
} from './styles';
import { TABLE_CLASS } from './classNames';
import { ColumnDraft } from './types';
import type { CellValueType } from './spreadsheet/validation';

type ColumnEditorProps = {
  anchorEl: HTMLElement;
  /** The column being edited, or null to define a new one. */
  initial: ColumnDraft | null;
  typeOptions: { value: CellValueType; label: string }[];
  onSave: (draft: ColumnDraft) => void;
  onCancel: () => void;
};

/**
 * A popover for a column's name and type, anchored under the control that
 * opened it. Like `DeleteConfirm`, it closes on a click elsewhere, a scroll or
 * Escape.
 */
export function ColumnEditor({
  anchorEl,
  initial,
  typeOptions,
  onSave,
  onCancel
}: ColumnEditorProps) {
  const popoverRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(initial?.name ?? '');
  const [fieldType, setFieldType] = useState<CellValueType>(
    initial?.field_type ?? 'text'
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!popoverRef.current?.contains(target) && !anchorEl.contains(target)) {
        onCancel();
      }
    };
    // A scroll inside the popover (the type list) must not close it.
    const handleScroll = (event: Event) => {
      if (!popoverRef.current?.contains(event.target as Node)) onCancel();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };

    const doc = featheryDoc();
    doc.addEventListener('mousedown', handleClickOutside);
    doc.addEventListener('scroll', handleScroll, true);
    doc.addEventListener('keydown', handleKeyDown);
    return () => {
      doc.removeEventListener('mousedown', handleClickOutside);
      doc.removeEventListener('scroll', handleScroll, true);
      doc.removeEventListener('keydown', handleKeyDown);
    };
  }, [onCancel, anchorEl]);

  const anchorRect = anchorEl.getBoundingClientRect();
  const title = initial ? 'Edit column' : 'Add column';
  const trimmed = name.trim();

  return createPortal(
    <form
      ref={popoverRef}
      role='dialog'
      aria-label={title}
      className={TABLE_CLASS.columnEditor}
      css={{
        ...confirmPopoverStyle,
        ...columnEditorStyle,
        top: `${anchorRect.bottom + 4}px`,
        left: `${Math.max(anchorRect.right, 280)}px`,
        transform: 'translateX(-100%)'
      }}
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (trimmed) onSave({ name: trimmed, field_type: fieldType });
      }}
      // Keep the table's own handlers (sorting, grid selection) out of it.
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <p css={{ ...confirmTextStyle, margin: 0 }}>{title}</p>
      <label css={columnEditorLabelStyle}>
        Name
        <input
          type='text'
          value={name}
          autoFocus
          css={columnEditorInputStyle}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label css={columnEditorLabelStyle}>
        Type
        <select
          value={fieldType}
          css={columnEditorInputStyle}
          onChange={(event) =>
            setFieldType(event.target.value as CellValueType)
          }
        >
          {typeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div css={confirmButtonRowStyle}>
        <button type='button' css={confirmCancelButtonStyle} onClick={onCancel}>
          Cancel
        </button>
        <button
          type='submit'
          css={confirmPrimaryButtonStyle}
          disabled={!trimmed}
        >
          {initial ? 'Save' : 'Add'}
        </button>
      </div>
    </form>,
    featheryDoc().body
  );
}
