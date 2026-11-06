import React, { useEffect, useRef, useState } from 'react';
import { featheryDoc, featheryWindow } from '../../utils/browser';
import FieldLabelRuns from './FieldLabelRuns';
import {
  isPlainRuns,
  LabelRun,
  runsFromNodes,
  trimLabelRuns
} from '../utils/fieldLabelRuns';

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
// Formatted runs survive editing, and selections are reported so the
// builder can format part of the label like a text element.
export default function EditableFieldLabel({
  elementId,
  label,
  runs = null,
  responsiveStyles,
  focused = false,
  setLabel,
  onTextSelect
}: {
  elementId: string;
  label: string;
  runs?: LabelRun[] | null;
  responsiveStyles: any;
  focused?: boolean;
  // newRuns is null when the label carries no formatting
  setLabel: (newLabel: string, newRuns: LabelRun[] | null) => void;
  onTextSelect?: (selection: Selection | null) => void;
}) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const [editing, setEditing] = useState(false);
  // Bumped to remount the span, discarding uncommitted DOM edits
  const [revision, setRevision] = useState(0);
  const revert = () => setRevision((r) => r + 1);
  // Escape blurs to leave the label, and that blur must not commit
  const cancellingRef = useRef(false);

  // Deselecting the element ends label editing
  useEffect(() => {
    if (!focused) setEditing(false);
  }, [focused]);

  const commit = () => {
    setEditing(false);
    const span = spanRef.current;
    if (!span) return;
    const newRuns = trimLabelRuns(
      runsFromNodes(span.childNodes, runs ?? [{ insert: label }])
    );
    const newLabel = newRuns.map((run) => run.insert).join('');
    // An empty label can't be re-selected on the canvas, so revert instead
    if (!newLabel || newLabel === label) revert();
    else setLabel(newLabel, isPlainRuns(newRuns) ? null : newRuns);
  };

  const cancel = () => {
    setEditing(false);
    cancellingRef.current = true;
    spanRef.current?.blur();
    cancellingRef.current = false;
    revert();
  };

  return (
    <span
      // Remount when the label changes externally (e.g. the properties panel)
      key={`${revision}:${label}:${JSON.stringify(runs)}`}
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
      onSelect={() => {
        if (focused) onTextSelect?.(featheryWindow().getSelection());
      }}
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
        if (editing && !cancellingRef.current) commit();
      }}
      onPaste={handlePaste}
    >
      <FieldLabelRuns
        label={label}
        runs={runs}
        responsiveStyles={responsiveStyles}
      />
    </span>
  );
}
