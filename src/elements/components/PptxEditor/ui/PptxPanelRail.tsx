import React from 'react';
import { ChangesIcon } from '../../DocxEditor/icons';
import { FEATHERY_RED } from '../../DocxEditor/DocxToolbar/styles';
import {
  ACCENT_LINE,
  ACCENT_WASH,
  INK,
  INK_3,
  LINE,
  PANEL_3,
  PAPER
} from '../../DocxEditor/TrackedChangeGroups/styles';

// Slim icon rail pinned to the editor's right edge, mirroring the DOCX editor's
// edge-rail pattern. One button per side panel - Tracked edits now, Version
// history as a visible-but-disabled slot until its host contract ships.

export type PptxPanelKind = 'changes' | 'history';

const HistoryIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth={1.8}
    strokeLinecap='round'
    strokeLinejoin='round'
    {...p}
  >
    <circle cx={12} cy={12} r={8.4} />
    <path d='M12 7.6V12l3.1 1.9' />
  </svg>
);

export const PPTX_PANEL_RAIL_WIDTH = 44;

interface Props {
  activePanel: PptxPanelKind | null;
  onToggle: (panel: PptxPanelKind) => void;
  /** Pending tracked-edit count, badged on the changes button. */
  changesCount: number;
  /** Version history becomes clickable once a history host is wired. */
  historyEnabled: boolean;
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

export default function PptxPanelRail({
  activePanel,
  onToggle,
  changesCount,
  historyEnabled
}: Props) {
  return (
    <div
      css={{
        flex: '0 0 auto',
        alignSelf: 'stretch',
        width: PPTX_PANEL_RAIL_WIDTH,
        minWidth: PPTX_PANEL_RAIL_WIDTH,
        borderLeft: `1px solid ${LINE}`,
        background: PAPER,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        paddingTop: 10
      }}
    >
      <RailButton
        label='Tracked edits'
        active={activePanel === 'changes'}
        badge={changesCount}
        onClick={() => onToggle('changes')}
      >
        <ChangesIcon width={18} height={18} />
      </RailButton>
      <RailButton
        label={
          historyEnabled ? 'Version history' : 'Version history (coming soon)'
        }
        active={activePanel === 'history'}
        disabled={!historyEnabled}
        onClick={() => onToggle('history')}
      >
        <HistoryIcon width={18} height={18} />
      </RailButton>
    </div>
  );
}
