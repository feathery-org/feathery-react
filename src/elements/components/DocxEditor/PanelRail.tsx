import React from 'react';
import { ChangesIcon, NotebookIcon } from './icons';
import { FEATHERY_RED } from './DocxToolbar/styles';
import {
  ACCENT_LINE,
  ACCENT_WASH,
  INK,
  INK_3,
  LINE,
  PANEL_3,
  PAPER
} from './TrackedChangeGroups/styles';

// Slim icon rail pinned to the editor's right edge (the artifact's "edge rail"
// pattern). One button per side panel — Sections (draggable reorder) and, when
// review is on, Suggested changes — each toggling its panel in the slot to the
// rail's left. Always visible; scales to future panels (comments, history).

export type PanelKind = 'changes' | 'sections';

export const PANEL_RAIL_WIDTH = 44;

interface Props {
  activePanel: PanelKind | null;
  onToggle: (panel: PanelKind) => void;
  /** Show the tracked-changes button (review mode). */
  showChanges: boolean;
  /** Pending tracked-change count, badged on the changes button. */
  changesCount: number;
}

function RailButton({
  label,
  active,
  disabled,
  onClick,
  badge,
  children
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type='button'
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
      css={{
        position: 'relative',
        width: 34,
        height: 34,
        borderRadius: 8,
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: active ? ACCENT_WASH : 'transparent',
        color: active ? INK : INK_3,
        boxShadow: active ? `inset 0 0 0 1px ${ACCENT_LINE}` : 'none',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        '&:hover': disabled
          ? {}
          : { background: active ? ACCENT_WASH : PANEL_3, color: INK }
      }}
    >
      {children}
      {!!badge && badge > 0 && (
        <span
          css={{
            position: 'absolute',
            top: -3,
            right: -3,
            minWidth: 15,
            height: 15,
            padding: '0 3px',
            borderRadius: 8,
            background: FEATHERY_RED,
            color: '#fff',
            fontSize: 10,
            fontWeight: 600,
            lineHeight: '15px',
            textAlign: 'center',
            boxShadow: `0 0 0 2px ${PAPER}`
          }}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

export default function PanelRail({
  activePanel,
  onToggle,
  showChanges,
  changesCount
}: Props) {
  return (
    <div
      css={{
        flex: '0 0 auto',
        alignSelf: 'stretch',
        width: PANEL_RAIL_WIDTH,
        minWidth: PANEL_RAIL_WIDTH,
        borderLeft: `1px solid ${LINE}`,
        background: PAPER,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        paddingTop: 10
      }}
    >
      {showChanges && (
        <RailButton
          label='Suggested changes'
          active={activePanel === 'changes'}
          disabled={changesCount === 0}
          badge={changesCount}
          onClick={() => onToggle('changes')}
        >
          <ChangesIcon width={18} height={18} />
        </RailButton>
      )}
      <RailButton
        label='Sections'
        active={activePanel === 'sections'}
        onClick={() => onToggle('sections')}
      >
        <NotebookIcon width={18} height={18} />
      </RailButton>
    </div>
  );
}
