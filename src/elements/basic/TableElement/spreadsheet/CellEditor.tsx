import React from 'react';
import { TABLE_CLASS } from '../classNames';
import { CellRule } from './validation';
import { cellEditorStyle, cellSelectStyle } from './styles';
import {
  acceptsNumericInput,
  choicesFor,
  editorKindFor,
  toEditorValue
} from './fieldEditors';

export type CellEditorProps = {
  /** The column's rule, when it has one. Absent columns get a text input. */
  rule?: CellRule;
  draft: string;
  /** The editor was opened by typing, so `draft` is that first character. */
  seeded: boolean;
  label: string;
  onChange: (draft: string) => void;
  /** Commit a value and close, without moving the selection. */
  onCommit: (draft: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onBlur: () => void;
};

// Native input types per editor kind. `text` covers the rest: a half-typed
// email or number must stay in the box, and `type="number"` blanks its own
// value the moment it disagrees with what was typed.
const INPUT_TYPES: Record<string, string> = {
  date: 'date',
  datetime: 'datetime-local'
};

/**
 * Input types with a text selection to move a caret around in.
 *
 * `setSelectionRange` THROWS `InvalidStateError` on the others — and a throw
 * inside the layout effect below tears down the whole grid, not just the cell.
 * A date input is exactly that case.
 */
const SELECTABLE_TYPES = new Set(['text', 'search', 'url', 'tel', 'password']);

/**
 * The editor for one cell, shaped by what the column actually holds: a fixed
 * set of values is picked, a date gets the native picker, a number refuses
 * letters outright, and an upload reference cannot be typed at all.
 */
export function CellEditor({
  rule,
  draft,
  seeded,
  label,
  onChange,
  onCommit,
  onKeyDown,
  onBlur
}: CellEditorProps) {
  const kind = editorKindFor(rule);
  const choices = choicesFor(rule);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const selectRef = React.useRef<HTMLSelectElement>(null);

  /**
   * Focus and place the caret once, on open.
   *
   * Not `autoFocus` + `onFocus`: autoFocus fires during mount, which in Chrome
   * can land before React has committed `value`, so a `select()` there selects
   * an empty box. A layout effect runs after the value is in the DOM.
   */
  React.useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    // A picker has no caret to place, and asking for one throws.
    if (!SELECTABLE_TYPES.has(input.type)) return;
    if (seeded) {
      // Type-to-edit must NOT select: the character that opened the editor
      // would be highlighted, and the next keystroke would replace it — which
      // reads as the first letter being swallowed.
      const end = input.value.length;
      input.setSelectionRange(end, end);
    } else {
      // F2 and double-click open on the stored value, ready to replace it.
      input.select();
    }
    // Deliberately empty deps: this runs only on open, so a later re-render
    // never moves the user's caret.
  }, []);

  // Type-to-edit seeds the draft with the character that opened the editor.
  // For a dropdown that character is a jump-to rather than a value, so it is
  // resolved to the first matching choice once, on open.
  const resolvedRef = React.useRef(false);
  React.useEffect(() => {
    if (!choices || resolvedRef.current) return;
    resolvedRef.current = true;
    if (choices.includes(draft)) return;
    const prefix = draft.trim().toLowerCase();
    const match = prefix
      ? choices.find((choice) => choice.toLowerCase().startsWith(prefix))
      : undefined;
    onChange(match ?? '');
  }, [choices, draft, onChange]);

  /**
   * Drop the menu as soon as the editor opens, so Enter or a double-click
   * lands the user on the choices instead of on a closed box they then have to
   * click again. `showPicker` is recent and throws where it is unsupported or
   * disallowed, in which case the select is simply focused and Space or a
   * click opens it as usual.
   */
  React.useLayoutEffect(() => {
    const select = selectRef.current;
    if (!select) return;
    select.focus({ preventScroll: true });
    try {
      (select as any).showPicker?.();
    } catch {
      // Not user-initiated enough for this browser; focus is still correct.
    }
  }, []);

  if (choices) {
    return (
      <select
        ref={selectRef}
        className={TABLE_CLASS.gridCellSelect}
        aria-label={label}
        value={choices.includes(draft) ? draft : ''}
        css={cellSelectStyle}
        onMouseDown={(event) => event.stopPropagation()}
        onChange={(event) => {
          const picked = event.target.value;
          onChange(picked);
          // A pick is the whole edit, so it lands as soon as it is made — and
          // it has to carry its own value, since the draft setState above has
          // not been applied yet.
          onCommit(picked);
        }}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      >
        {/* Clearing the cell has to stay reachable from the dropdown. */}
        <option value=''>{rule?.required ? '—' : '(empty)'}</option>
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      ref={inputRef}
      className={TABLE_CLASS.gridCellEditor}
      aria-label={label}
      type={INPUT_TYPES[kind] ?? 'text'}
      value={toEditorValue(draft, kind)}
      // The numeric keypad on touch. The keystroke filter below is what
      // actually keeps letters out.
      inputMode={kind === 'number' ? 'decimal' : undefined}
      readOnly={kind === 'readonly'}
      css={cellEditorStyle}
      onMouseDown={(event) => event.stopPropagation()}
      onChange={(event) => {
        const next = event.target.value;
        // A number column refuses anything that is not on its way to being a
        // number, rather than accepting it and failing validation later.
        if (kind === 'number' && !acceptsNumericInput(next)) return;
        if (kind === 'readonly') return;
        onChange(next);
      }}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    />
  );
}
