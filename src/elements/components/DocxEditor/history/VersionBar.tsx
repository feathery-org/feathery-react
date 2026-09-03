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
// distinct, read-only mode. PR 4: exit + label + Restore. The highlight toggle,
// edit counts, and prev/next stepping arrive with the highlights PR.
export default function VersionBar({ version, onExit, onRestore }: Props) {
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
      </span>
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
