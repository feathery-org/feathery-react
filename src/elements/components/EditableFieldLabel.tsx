import React, { useRef, useState } from 'react';
import { featheryDoc } from '../../utils/browser';

// Strip html from pasted content
// TODO (tyler): replace with proper handling once bug (#33542) in React is fixed
const handlePaste = (e: React.ClipboardEvent) => {
  e.preventDefault();
  const plainText = e.clipboardData?.getData('text/plain') || '';
  featheryDoc().execCommand('insertText', false, plainText);
};

// Field label text that can be edited in place in the form builder canvas.
//
// The builder's control layer covers the canvas, so this span never receives
// mouse events directly. Instead, on double click the control layer looks up
// `span-${elementId}` and places a native selection inside it — the same
// mechanism text elements use — which focuses the span and starts editing.
// Enter or blur commits, Escape cancels.
export default function EditableFieldLabel({
  elementId,
  label,
  setLabel
}: {
  elementId: string;
  label: string;
  setLabel: (newLabel: string) => void;
}) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const [editing, setEditing] = useState(false);

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
      // Must already be editable when the control layer places the selection
      contentEditable
      suppressContentEditableWarning
      css={{
        outline: 'none',
        cursor: editing ? 'text' : 'inherit'
      }}
      onFocus={() => setEditing(true)}
      onKeyDown={(e) => {
        if (!editing) return;
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          spanRef.current?.blur();
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
