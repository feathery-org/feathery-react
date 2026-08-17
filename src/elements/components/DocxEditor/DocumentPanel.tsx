import React from 'react';
import TrackedChangeGroups from './TrackedChangeGroups';
import SectionList from './sections/SectionPanel';
import { RailErrorBoundary } from './RailErrorBoundary';
import { INK, INK_3, LINE, PANEL, PANEL_2 } from './TrackedChangeGroups/styles';

export type PanelTab = 'changes' | 'sections';

// Shared right-hand "Document" panel: a header, a tab bar (Suggested changes ·
// Sections), and the active tab's body. Collapses to zero width when closed but
// stays mounted so the tracked-changes tab keeps reporting its pending count for
// the edge-rail badge.

const PANEL_WIDTH = 341;
const TAB_ACTIVE = '#2e63d1';
const TAB_INACTIVE = '#5a6372';

interface Props {
  editor: any;
  open: boolean;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  onClose: () => void;
  /** Show the Suggested changes tab + keep its rail mounted for the count. */
  reviewChanges: boolean;
  changesCount: number;
  onChangesCount: (count: number) => void;
  markDirty?: () => void;
  /** Remounts the tab bodies' error boundaries on editor/document changes. */
  boundaryKey: string;
}

function Tab({
  label,
  active,
  onClick,
  badge,
  disabled
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
  disabled?: boolean;
}) {
  return (
    <button
      type='button'
      role='tab'
      aria-selected={active}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      css={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        border: 'none',
        background: 'transparent',
        padding: '9px 2px',
        marginRight: 18,
        fontSize: 13.5,
        fontWeight: active ? 600 : 500,
        color: active ? TAB_ACTIVE : TAB_INACTIVE,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        borderBottom: `2px solid ${active ? TAB_ACTIVE : 'transparent'}`,
        marginBottom: -1,
        '&:hover': disabled ? {} : { color: active ? TAB_ACTIVE : INK }
      }}
    >
      {label}
      {badge != null && badge > 0 && (
        <span
          css={{
            minWidth: 18,
            height: 18,
            padding: '0 5px',
            borderRadius: 9,
            background: '#6b7276',
            color: '#fff',
            fontSize: 11,
            fontWeight: 600,
            lineHeight: '18px',
            textAlign: 'center'
          }}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

export default function DocumentPanel({
  editor,
  open,
  tab,
  onTab,
  onClose,
  reviewChanges,
  changesCount,
  onChangesCount,
  markDirty,
  boundaryKey
}: Props) {
  return (
    <div
      css={{
        flex: '0 0 auto',
        alignSelf: 'stretch',
        width: open ? PANEL_WIDTH : 0,
        minHeight: 0,
        overflow: 'hidden',
        transition: 'width .15s ease'
      }}
    >
      <div
        css={{
          width: PANEL_WIDTH,
          height: '100%',
          borderLeft: `1px solid ${LINE}`,
          background: PANEL,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0
        }}
      >
        {/* Header */}
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            padding: '10px 12px 0',
            flex: '0 0 auto'
          }}
        >
          <span css={{ flex: 1, fontSize: 15, fontWeight: 600, color: INK }}>
            Document
          </span>
          <button
            type='button'
            aria-label='Close panel'
            title='Close'
            onClick={onClose}
            css={{
              width: 24,
              height: 24,
              border: 'none',
              borderRadius: 6,
              background: 'transparent',
              color: INK_3,
              fontSize: 16,
              lineHeight: '16px',
              cursor: 'pointer',
              '&:hover': { background: PANEL_2, color: INK }
            }}
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div
          role='tablist'
          css={{
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px',
            borderBottom: `1px solid ${LINE}`,
            flex: '0 0 auto'
          }}
        >
          {reviewChanges && (
            <Tab
              label='Suggested changes'
              active={tab === 'changes'}
              onClick={() => onTab('changes')}
              badge={changesCount}
              disabled={changesCount === 0}
            />
          )}
          <Tab
            label='Sections'
            active={tab === 'sections'}
            onClick={() => onTab('sections')}
          />
        </div>

        {/* Bodies */}
        <div css={{ position: 'relative', flex: 1, minHeight: 0 }}>
          {reviewChanges && (
            // display:flex so TrackedChangeGroups' outer (a flex child that
            // stretches to full height) sizes correctly and owns a single
            // internal scroll — a block wrapper left its absolute inner
            // mis-sized, producing a stray nested scrollbar.
            <div
              css={{
                position: 'absolute',
                inset: 0,
                display: open && tab === 'changes' ? 'flex' : 'none'
              }}
            >
              <RailErrorBoundary key={`changes:${boundaryKey}`}>
                <TrackedChangeGroups
                  editor={editor}
                  onPendingCountChange={onChangesCount}
                />
              </RailErrorBoundary>
            </div>
          )}
          {open && tab === 'sections' && (
            <div css={{ position: 'absolute', inset: 0 }}>
              <RailErrorBoundary key={`sections:${boundaryKey}`}>
                <SectionList editor={editor} markDirty={markDirty} />
              </RailErrorBoundary>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
