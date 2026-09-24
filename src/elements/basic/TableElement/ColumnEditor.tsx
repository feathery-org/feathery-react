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
  columnEditorCheckboxLabelStyle,
  columnEditorInputStyle,
  columnEditorErrorStyle
} from './styles';
import { TABLE_CLASS } from './classNames';
import { ColumnDraft } from './types';
import { CellValueType, validateCellValue } from './spreadsheet/validation';
import { parseCellInput } from './spreadsheet/fieldEditors';

const BOOLEAN_DEFAULTS = [
  { value: '', label: 'None' },
  { value: 'true', label: 'True' },
  { value: 'false', label: 'False' }
];

const defaultText = (value: ColumnDraft['default']) =>
  value === undefined || value === null ? '' : String(value);

type ColumnEditorProps = {
  anchorEl: HTMLElement;
  /** The column being edited, or null to define a new one. */
  initial: ColumnDraft | null;
  typeOptions: { value: CellValueType; label: string }[];
  onSave: (draft: ColumnDraft) => void;
  onCancel: () => void;
};

/**
 * A popover for a column's name, type and default, anchored under the control that
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
  const [required, setRequired] = useState(!!initial?.required);
  // Typed as text and read as the column's type, the way a cell edit is, so
  // "18" in a number column is stored as 18.
  const [defaultInput, setDefaultInput] = useState(
    defaultText(initial?.default)
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
  const isBoolean = fieldType === 'boolean';
  const defaultValue = parseCellInput(defaultInput, {
    label: trimmed,
    type: fieldType
  });
  const defaultError =
    defaultValue === null
      ? null
      : validateCellValue(defaultValue, { label: trimmed, type: fieldType });
  const canSave = !!trimmed && !defaultError;

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
        if (canSave) {
          onSave({
            name: trimmed,
            field_type: fieldType,
            required,
            default: defaultValue
          });
        }
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
          onChange={(event) => {
            const next = event.target.value as CellValueType;
            setFieldType(next);
            // A true/false default is picked from a list that has nothing
            // else to show, so any other text is dropped rather than hidden.
            if (
              next === 'boolean' &&
              !BOOLEAN_DEFAULTS.some((option) => option.value === defaultInput)
            ) {
              setDefaultInput('');
            }
          }}
        >
          {typeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label css={columnEditorCheckboxLabelStyle}>
        <input
          type='checkbox'
          checked={required}
          onChange={(event) => setRequired(event.target.checked)}
        />
        Required
      </label>
      <label css={columnEditorLabelStyle}>
        Default for new rows
        {isBoolean ? (
          <select
            value={defaultInput}
            css={columnEditorInputStyle}
            onChange={(event) => setDefaultInput(event.target.value)}
          >
            {BOOLEAN_DEFAULTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            type='text'
            value={defaultInput}
            placeholder='None'
            aria-invalid={!!defaultError}
            css={columnEditorInputStyle}
            onChange={(event) => setDefaultInput(event.target.value)}
          />
        )}
        {defaultError && (
          <span role='alert' css={columnEditorErrorStyle}>
            {defaultError}
          </span>
        )}
      </label>
      <div css={confirmButtonRowStyle}>
        <button type='button' css={confirmCancelButtonStyle} onClick={onCancel}>
          Cancel
        </button>
        <button
          type='submit'
          css={confirmPrimaryButtonStyle}
          disabled={!canSave}
        >
          {initial ? 'Save' : 'Add'}
        </button>
      </div>
    </form>,
    featheryDoc().body
  );
}
