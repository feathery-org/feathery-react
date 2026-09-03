import React from 'react';

import {
  INK,
  INK_2,
  INK_3,
  LINE,
  PANEL_2
} from '../TrackedChangeGroups/styles';
import { TOOLBAR_HEIGHT } from '../DocxToolbar/styles';
import { ArrowLeftIcon, RestoreIcon } from '../icons';
import { DocxVersion } from './types';

interface Props {
  version: DocxVersion;
  onExit: () => void;
  /** Restore this version. Absent → the button is shown disabled (the restore
   *  flow lands in a later PR). */
  onRestore?: () => void;
  /** Text-edit / formatting-change counts, when highlights are available. */
  editCount?: number;
  formatCount?: number;
  /** Whether detailed highlights exist for this version (drives the toggle). */
  highlightsAvailable?: boolean;
  highlightsOn?: boolean;
  onToggleHighlights?: (on: boolean) => void;
}

function summarizeChanges(edits?: number, formats?: number): string {
  const parts: string[] = [];
  if (edits != null) parts.push(`${edits} ${edits === 1 ? 'edit' : 'edits'}`);
  if (formats) parts.push(`${formats} formatting`);
  return parts.join(' · ');
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  });
  const day = d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  });
  return `${day}, ${time}`;
}

// Replaces the editing toolbar while an older version is open, so it reads as a
// distinct, read-only mode: exit + label + change summary + highlight toggle +
// Restore. Prev/next stepping is a follow-up.
export default function VersionBar({
  version,
  onExit,
  onRestore,
  editCount,
  formatCount,
  highlightsAvailable,
  highlightsOn = true,
  onToggleHighlights
}: Props) {
  const summary = summarizeChanges(editCount, formatCount);
  return (
    <div
      css={{
        height: TOOLBAR_HEIGHT,
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 10px',
        borderBottom: `1px solid ${LINE}`,
        background: PANEL_2
      }}
    >
      <button
        type='button'
        aria-label='Back to current version'
        title='Back to current'
        onClick={onExit}
        css={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          border: 'none',
          background: 'transparent',
          color: INK_2,
          cursor: 'pointer',
          padding: '4px 6px',
          borderRadius: 6,
          '&:hover': { background: '#fff', color: INK }
        }}
      >
        <ArrowLeftIcon width={18} height={18} />
      </button>
      <span css={{ flex: 1, minWidth: 0, fontSize: 13, color: INK }}>
        <span css={{ color: INK_3 }}>Viewing version · </span>
        {version.name || formatWhen(version.ended_at)}
        {highlightsAvailable && summary && (
          <span css={{ color: INK_3 }}> · {summary}</span>
        )}
      </span>
      {highlightsAvailable && (
        <label
          css={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            color: INK_2,
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          <input
            type='checkbox'
            checked={highlightsOn}
            onChange={(e) => onToggleHighlights?.(e.target.checked)}
          />
          Highlight changes
        </label>
      )}
      <button
        type='button'
        onClick={onRestore}
        disabled={!onRestore}
        title={onRestore ? 'Restore this version' : 'Restore is coming soon'}
        css={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          border: `1px solid ${LINE}`,
          background: '#fff',
          color: INK,
          borderRadius: 6,
          padding: '5px 10px',
          fontSize: 13,
          cursor: onRestore ? 'pointer' : 'default',
          opacity: onRestore ? 1 : 0.5
        }}
      >
        <RestoreIcon width={16} height={16} />
        Restore this version
      </button>
    </div>
  );
}
