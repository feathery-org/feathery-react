import React, { useEffect, useRef, useState } from 'react';
import { featheryDoc } from '../../utils/browser';

// Strip html from pasted content
// TODO (tyler): replace with proper handling once bug (#33542) in React is fixed
const handlePaste = (e: React.ClipboardEvent) => {
  e.preventDefault();
  const plainText = e.clipboardData?.getData('text/plain') || '';
  featheryDoc().execCommand('insertText', false, plainText);
};

// Field label text that can be edited in place in the form builder canvas,
// mirroring how text elements behave (useTextEdit):
// - Clicking an unselected field selects it without placing a caret.
// - Once the field is selected, a single click places the caret in the label.
// - Double click selects all label text via the builder's control layer,
//   which looks up `span-${elementId}` and places a native selection.
// Enter or blur commits, Shift+Enter inserts a newline, Escape cancels.
export default function EditableFieldLabel({
  elementId,
  label,
  focused = false,
  setLabel
}: {
  elementId: string;
  label: string;
  focused?: boolean;
  setLabel: (newLabel: string) => void;
}) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const [editing, setEditing] = useState(false);

  // Deselecting the element ends label editing
  useEffect(() => {
    if (!focused) setEditing(false);
  }, [focused]);

  const commit = () => {
    setEditing(false);
    const span = spanRef.current;
    if (!span) return;
    const newLabel = (span.textContent ?? '').trim();
    // An empty label can't be re-selected on the canvas, so revert instead
    if (!newLabel || newLabel === label) span.textContent = label;
    else setLabel(newLabel);
  };

  const cancel = () => {
    const span = spanRef.current;
    if (span) span.textContent = label;
    setEditing(false);
    span?.blur();
  };

  return (
    <span
      // Remount when the label changes externally (e.g. the properties panel)
      key={label}
      id={`span-${elementId}`}
      ref={spanRef}
      // Must already be editable when a caret or selection lands in it
      contentEditable
      suppressContentEditableWarning
      css={{
        outline: 'none',
        cursor: focused || editing ? 'text' : 'inherit',
        // Field containers are pointer-events: none on the canvas, so restore
        // events here for the single-click caret placement
        pointerEvents: 'auto'
      }}
      onMouseDown={(e) => {
        // Don't place a caret before the element is selected, but still
        // bubble so the builder selects it
        if (!focused) e.preventDefault();
      }}
      onClick={() => {
        if (focused) setEditing(true);
      }}
      onFocus={() => setEditing(true)}
      onKeyDown={(e) => {
        if (!editing) return;
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          if (e.shiftKey) {
            // Shift+Enter inserts a plain newline (labels render pre-wrap);
            // insertText keeps the browser from adding <div>/<br> nodes
            featheryDoc().execCommand?.('insertText', false, '\n');
          } else {
            // Enter confirms, identical to clicking outside
            spanRef.current?.blur();
          }
        } else if (e.key === 'Escape') cancel();
      }}
      onBlur={() => {
        if (editing) commit();
      }}
      onPaste={handlePaste}
    >
      {label}
    </span>
  );
}
