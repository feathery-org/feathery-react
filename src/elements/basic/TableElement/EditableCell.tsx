import React, { useState, useRef, useEffect } from 'react';
import { featheryDoc } from '../../../utils/browser';
import { stringifyWithNull } from '../../../utils/primitives';
import {
  clickToEditStyle,
  cellInputStyle,
  cellSelectStyle,
  editableCellContentStyle,
  editableCellTextStyle,
  editingCellContentStyle,
  editingCellInputStyle,
  editingCellSizerStyle
} from './styles';
import { TABLE_CLASS } from './classNames';
import { CellRule } from './spreadsheet/validation';
import { CellValue } from './spreadsheet/model';
import { EMPTY_CHOICE_LABEL } from './spreadsheet/ChoiceMenu';
import {
  acceptsNumericInput,
  choiceLabel,
  choicesFor,
  editorKindFor,
  formatCellDisplay,
  fromEditorValue,
  parseCellInput,
  toEditorValue
} from './spreadsheet/fieldEditors';

type EditorElement = HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement;

type EditableCellProps = {
  value: any;
  fieldKey: string;
  rowIndex: number;
  isEditing: boolean;
  /**
   * The column's rule, when it has one. It decides what the cell opens as —
   * a choice list, a date picker, a number box — and how the stored value is
   * shown. Without one the cell is the plain text box it always was.
   */
  rule?: CellRule;
  onEdit: (fieldKey: string, rowIndex: number, newValue: any) => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onNavigate: (backward: boolean) => void;
};

// Native input types per editor kind; `text` for the rest, since a half-typed
// email or number must stay in the box.
const INPUT_TYPES: Record<string, string> = {
  date: 'date',
  datetime: 'datetime-local'
};

export function EditableCell({
  value,
  fieldKey,
  rowIndex,
  isEditing,
  rule,
  onEdit,
  onStartEdit,
  onStopEdit,
  onNavigate
}: EditableCellProps) {
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<EditorElement>(null);
  const shouldSaveRef = useRef(true);
  // Suppresses the blur that fires when focus moves to the next cell during Tab
  // navigation, so it does not re-save or clear the freshly-set editing cell.
  const skipBlurRef = useRef(false);
  // Whether the next `change` on the choice list comes from the keyboard. A
  // closed native select changes value on every arrow press or typed letter,
  // and each of those would otherwise commit and close the cell, so a
  // keyboard change only moves the draft; Enter or leaving the cell commits.
  const keyboardChoiceRef = useRef(false);

  const kind = editorKindFor(rule);
  const choices = choicesFor(rule);

  // The stored value as text: what an editor opens on, and what a draft is
  // compared against to decide whether anything changed.
  const storedText = stringifyWithNull(value) ?? '';
  // What the cell shows at rest. A ruled column formats its value (a readable
  // date, an option's label, a masked tax ID); an unruled one shows it as is.
  const displayText = rule
    ? formatCellDisplay(value as CellValue, rule)
    : storedText;
  const isEmpty = displayText === '';

  // Seed the draft value the moment this cell becomes the active editor, before
  // paint, so the editor shows the right content on first render (no flash).
  const prevEditingRef = useRef(false);
  if (isEditing && !prevEditingRef.current) setEditValue(storedText);
  prevEditingRef.current = isEditing;

  useEffect(() => {
    const input = inputRef.current;
    if (!isEditing || !input) return;
    input.focus();
    keyboardChoiceRef.current = false;
    // Only a text box has a selection to make; a picker or a list does not.
    if (
      input instanceof HTMLTextAreaElement ||
      (input instanceof HTMLInputElement && input.type === 'text')
    ) {
      input.select();
    } else if (input instanceof HTMLSelectElement) {
      // The click that opened the cell is the click that opens the list, so
      // a mouse user picks straight away rather than clicking twice. Older
      // browsers have no `showPicker`, and some refuse it without a fresh
      // gesture; either way the list still opens on the next click.
      try {
        (input as any).showPicker?.();
      } catch {
        // The select is focused and usable without the picker.
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

  // `text` is passed explicitly by a change that commits on the spot (a pick
  // from the list), since the draft state has not applied yet at that point.
  const saveValue = (text: string = editValue) => {
    if (text === storedText) return;
    // A ruled column stores what its type calls for (a number as a number, a
    // cleared cell as empty); an unruled one stores the text as typed.
    const next = rule ? parseCellInput(text, rule, value as CellValue) : text;
    // A number column never stores what is not a number: a half-typed "-" or
    // "1." left behind on blur is dropped rather than saved as text.
    if (rule?.type === 'number' && typeof next === 'string') return;
    onEdit(fieldKey, rowIndex, next);
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

  const handleKeyDown = (e: React.KeyboardEvent<EditorElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      shouldSaveRef.current = false;
      inputRef.current?.blur();
    } else if (e.key === 'Tab') {
      // A date picker is several fields (month, day, year, hour...) and Tab
      // is how the keyboard moves between them, so it stays with the picker.
      // Tabbing out of the last field leaves the input, and that blur
      // commits like any other.
      if (kind === 'date' || kind === 'datetime') return;
      e.preventDefault();
      skipBlurRef.current = true;
      saveValue();
      onNavigate(e.shiftKey);
    }
  };

  // A pick is the whole edit: it lands at once and closes the cell. The blur
  // that follows must not save again from a draft that may not have applied.
  const handleChoice = (choice: string) => {
    setEditValue(choice);
    if (keyboardChoiceRef.current) return;
    saveValue(choice);
    shouldSaveRef.current = false;
    inputRef.current?.blur();
  };

  // Arrows and type-ahead letters change a closed select's value in place.
  const handleChoiceKeyDown = (e: React.KeyboardEvent<HTMLSelectElement>) => {
    keyboardChoiceRef.current =
      e.key.startsWith('Arrow') ||
      ['Home', 'End', 'PageUp', 'PageDown'].includes(e.key) ||
      (e.key.length === 1 && e.key !== ' ');
    handleKeyDown(e);
  };

  const editorProps = {
    className: TABLE_CLASS.cellInput,
    'aria-label': rule ? `Edit ${rule.label}` : undefined,
    onBlur: handleBlur,
    onKeyDown: handleKeyDown,
    onClick: (e: React.MouseEvent) => e.stopPropagation()
  };

  const renderEditor = () => {
    if (choices) {
      // A stored value no longer among the choices (an option removed since
      // the row was written) stays pickable, so opening the cell never
      // silently changes it.
      const stale = storedText && !choices.includes(storedText);
      // A boolean has no blank: a checkbox is true or false, so once set it
      // cannot be cleared to a value the field never holds. A cell that was
      // never set still shows its blank as the current state.
      const offersEmpty = rule?.type !== 'boolean' || storedText === '';
      return (
        <select
          {...editorProps}
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={editValue}
          onChange={(e) => handleChoice(e.target.value)}
          onKeyDown={handleChoiceKeyDown}
          onMouseDown={() => {
            keyboardChoiceRef.current = false;
          }}
          css={{ ...cellInputStyle, ...cellSelectStyle }}
        >
          {offersEmpty && <option value=''>{EMPTY_CHOICE_LABEL}</option>}
          {stale && <option value={storedText}>{storedText}</option>}
          {choices.map((choice) => (
            <option key={choice} value={choice}>
              {choiceLabel(rule, choice)}
            </option>
          ))}
        </select>
      );
    }

    if (kind === 'date' || kind === 'datetime' || kind === 'number') {
      return (
        <input
          {...editorProps}
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type={INPUT_TYPES[kind] ?? 'text'}
          // A datetime picker shows local wall-clock time for the stored
          // UTC instant; the conversion runs both ways.
          value={kind === 'number' ? editValue : toEditorValue(editValue, kind)}
          // The numeric keypad on touch; the filter below keeps letters out.
          inputMode={kind === 'number' ? 'decimal' : undefined}
          onChange={(e) => {
            const next = e.target.value;
            if (kind === 'number' && !acceptsNumericInput(next)) return;
            setEditValue(fromEditorValue(next, kind));
          }}
          css={cellInputStyle}
        />
      );
    }

    return (
      <>
        <div css={editingCellSizerStyle}>{`${editValue}\u200b`}</div>
        <textarea
          {...editorProps}
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          css={{ ...cellInputStyle, ...editingCellInputStyle }}
        />
      </>
    );
  };

  if (isEditing) {
    return (
      <div className={TABLE_CLASS.editableCell} css={editingCellContentStyle}>
        {renderEditor()}
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
        {displayText}
      </span>
    </div>
  );
}
