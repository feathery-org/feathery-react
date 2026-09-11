import React from 'react';

import {
  INK,
  INK_2,
  INK_3,
  LINE,
  PANEL_2
} from '../TrackedChangeGroups/styles';
import { FEATHERY_RED, TOOLBAR_HEIGHT } from '../DocxToolbar/styles';
import { ArrowLeftIcon, ChevronDownIcon } from '../icons';
import { DocxVersion } from './types';

interface Props {
  version: DocxVersion;
  onExit: () => void;
  /** Text-edit / formatting-change counts, when highlights are available. */
  editCount?: number;
  formatCount?: number;
  /** Assistant edits still tracked (unapproved) in this version. */
  pendingCount?: number;
  /** Whether detailed highlights exist for this version (gates the controls). */
  highlightsAvailable?: boolean;
  /** Highlight-changes toggle state + handler. */
  highlightsOn?: boolean;
  onToggleHighlights?: (on: boolean) => void;
  /** Step the viewer's caret to the previous / next tracked change. */
  onPrevChange?: () => void;
  onNextChange?: () => void;
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

// Replaces the editing toolbar while a version is open: exit + label, then the
// change controls (highlight toggle, edit count, prev/next steppers) mirroring
// the design. Restore lives in the panel footer.
export default function VersionBar({
  version,
  onExit,
  editCount,
  pendingCount,
  highlightsAvailable,
  highlightsOn = true,
  onToggleHighlights,
  onPrevChange,
  onNextChange
}: Props) {
  const canStep = highlightsAvailable && highlightsOn;
  return (
    <div
      css={{
        height: TOOLBAR_HEIGHT,
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
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
      <span
        css={{
          fontSize: 13,
          fontWeight: 600,
          color: INK,
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {version.name || formatWhen(version.ended_at)}
      </span>
      <span css={{ flex: 1 }} />
      {highlightsAvailable && (
        <div css={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type='button'
            role='switch'
            aria-checked={highlightsOn}
            onClick={() => onToggleHighlights?.(!highlightsOn)}
            css={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              height: 30,
              padding: '0 4px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: 12.5,
              whiteSpace: 'nowrap',
              color: highlightsOn ? INK : INK_2
            }}
          >
            <span
              css={{
                width: 28,
                height: 16,
                borderRadius: 999,
                position: 'relative',
                flex: 'none',
                background: highlightsOn ? FEATHERY_RED : LINE,
                transition: 'background .15s'
              }}
            >
              <span
                css={{
                  position: 'absolute',
                  top: 2,
                  left: 2,
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: '#fff',
                  boxShadow: '0 1px 2px rgba(0,0,0,.2)',
                  transform: highlightsOn ? 'translateX(12px)' : 'none',
                  transition: 'transform .15s'
                }}
              />
            </span>
            Highlight changes
          </button>
          {editCount != null && (
            <span css={{ fontSize: 12.5, color: INK_3, whiteSpace: 'nowrap' }}>
              {editCount} {editCount === 1 ? 'edit' : 'edits'}
            </span>
          )}
          {pendingCount != null && pendingCount > 0 && (
            <span
              title={`${pendingCount} unapproved Robin ${
                pendingCount === 1 ? 'edit' : 'edits'
              } still tracked`}
              css={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 12,
                fontWeight: 600,
                color: FEATHERY_RED,
                background: 'rgba(176, 48, 43, 0.10)',
                border: '1px dashed rgba(176, 48, 43, 0.55)',
                borderRadius: 999,
                padding: '2px 8px',
                whiteSpace: 'nowrap'
              }}
            >
              {pendingCount} pending
            </span>
          )}
          <button
            type='button'
            aria-label='Previous change'
            title='Previous change'
            disabled={!canStep}
            onClick={onPrevChange}
            css={arrowCss}
          >
            <ChevronDownIcon
              width={15}
              height={15}
              css={{ transform: 'rotate(180deg)' }}
            />
          </button>
          <button
            type='button'
            aria-label='Next change'
            title='Next change'
            disabled={!canStep}
            onClick={onNextChange}
            css={arrowCss}
          >
            <ChevronDownIcon width={15} height={15} />
          </button>
        </div>
      )}
    </div>
  );
}

const arrowCss = {
  width: 30,
  height: 30,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: `1px solid ${LINE}`,
  borderRadius: 6,
  background: '#fff',
  color: INK_2,
  cursor: 'pointer',
  '&:disabled': { opacity: 0.4, cursor: 'default' },
  '&:not(:disabled):hover': { color: INK, borderColor: INK_3 }
} as const;
