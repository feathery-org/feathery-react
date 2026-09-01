import React from 'react';
import { TABLE_CLASS } from '../classNames';
import { CellRule } from './validation';
import { cellEditorStyle, cellSelectStyle } from './styles';

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

/** A column whose value is one of a fixed set is picked, not typed. */
const choicesFor = (rule?: CellRule): string[] | null => {
  if (rule?.options?.length) return rule.options;
  if (rule?.type === 'boolean') return ['true', 'false'];
  return null;
};

/**
 * The editor for one cell, shaped by what the column actually holds: a fixed
 * set of values is a dropdown, a number gets a numeric keypad on touch, and
 * everything else is a plain text box.
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
  const choices = choicesFor(rule);
  const inputRef = React.useRef<HTMLInputElement>(null);

  /**
   * Focus and place the caret once, on open.
   *
   * Not `autoFocus` + `onFocus`: autoFocus fires during mount, which in Chrome
   * can land before React has committed `value`, so a `select()` there selects
   * an empty box and the caret ends up at the end anyway. A layout effect runs
   * after the value is in the DOM, so both cases are deterministic.
   */
  React.useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
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

  if (choices) {
    return (
      <select
        autoFocus
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
      value={draft}
      // A numeric column gets the numeric keypad on touch; the value stays a
      // string so a half-typed number is never clamped or reformatted mid-edit.
      inputMode={rule?.type === 'number' ? 'decimal' : undefined}
      css={cellEditorStyle}
      onMouseDown={(event) => event.stopPropagation()}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    />
  );
}
