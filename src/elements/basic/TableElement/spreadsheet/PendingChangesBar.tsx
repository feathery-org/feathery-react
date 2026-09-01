import React from 'react';
import { featheryWindow } from '../../../../utils/browser';
import { TABLE_CLASS } from '../classNames';
import {
  discardButtonStyle,
  issueCountStyle,
  issueGroupStyle,
  issueStepperStyle,
  pendingActionsStyle,
  pendingBarStyle,
  pendingCountStyle,
  saveButtonStyle
} from './styles';

export type PendingChangesBarProps = {
  /** Buffered cell edits plus row deletions. */
  pendingCount: number;
  /** Errors that must be fixed before the table can save. */
  blockingCount: number;
  /** Errors on staged rows, which the hub accepts until they are verified. */
  warningCount: number;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  /** Steps the grid's focus through the failing cells. */
  onStepIssue: (delta: 1 | -1) => void;
};

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * The status strip above a spreadsheet: what is waiting to be saved, what is
 * wrong with it, and the two actions that resolve it.
 *
 * It renders only when there is something to say, so a spreadsheet with no
 * outstanding work is exactly as tall as it was before.
 */
export function PendingChangesBar({
  pendingCount,
  blockingCount,
  warningCount,
  saving,
  onSave,
  onDiscard,
  onStepIssue
}: PendingChangesBarProps) {
  const issueCount = blockingCount + warningCount;
  if (!pendingCount && !issueCount && !saving) return null;

  const blocked = blockingCount > 0;

  // Discarding cannot be undone — the buffer is the only copy of these edits.
  const confirmDiscard = () => {
    const message =
      pendingCount === 1
        ? 'Discard your unsaved change?'
        : `Discard your ${pendingCount} unsaved changes?`;
    if (featheryWindow().confirm(message)) onDiscard();
  };

  return (
    <div
      role='status'
      aria-live='polite'
      className={TABLE_CLASS.gridPendingBar}
      css={pendingBarStyle}
    >
      {issueCount > 0 && (
        <span css={issueGroupStyle}>
          <span css={issueCountStyle(blocked)}>
            {blockingCount > 0 && plural(blockingCount, 'error')}
            {blockingCount > 0 && warningCount > 0 && ', '}
            {warningCount > 0 && plural(warningCount, 'warning')}
          </span>
          <button
            type='button'
            aria-label='Go to previous issue'
            className={TABLE_CLASS.gridIssueStep}
            css={issueStepperStyle(blocked)}
            onClick={() => onStepIssue(-1)}
          >
            ↑
          </button>
          <button
            type='button'
            aria-label='Go to next issue'
            className={TABLE_CLASS.gridIssueStep}
            css={issueStepperStyle(blocked)}
            onClick={() => onStepIssue(1)}
          >
            ↓
          </button>
        </span>
      )}

      <span css={pendingActionsStyle}>
        <span css={pendingCountStyle}>
          {pendingCount
            ? plural(pendingCount, 'unsaved change')
            : saving
            ? 'Saving…'
            : 'No unsaved changes'}
        </span>
        <button
          type='button'
          className={TABLE_CLASS.gridDiscardButton}
          css={discardButtonStyle}
          disabled={saving || !pendingCount}
          onClick={confirmDiscard}
        >
          Discard
        </button>
        <button
          type='button'
          className={TABLE_CLASS.gridSaveButton}
          css={saveButtonStyle}
          disabled={saving || !pendingCount || blocked}
          // A disabled button has no tooltip of its own, so the reason it is
          // disabled has to come from the accessible name.
          title={blocked ? 'Fix the errors below before saving' : undefined}
          onClick={onSave}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </span>
    </div>
  );
}
