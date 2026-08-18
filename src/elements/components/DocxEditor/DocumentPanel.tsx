import React from 'react';
import TrackedChangeGroups from './TrackedChangeGroups';
import SectionList from './sections/SectionPanel';
import { RailErrorBoundary } from './RailErrorBoundary';
import { INK, INK_3, LINE, PANEL, PANEL_2 } from './TrackedChangeGroups/styles';

export type PanelTab = 'changes' | 'sections';

// Shared right-hand side panel. The slim edge rail decides which panel is open;
// this component just shows the active one with a matching title (no in-panel
// tabs). Collapses to zero width when closed but stays mounted so the
// tracked-changes body keeps reporting its pending count for the rail badge.

const PANEL_WIDTH = 341;

const TITLES: Record<PanelTab, string> = {
  changes: 'Suggested changes',
  sections: 'Sections'
};

interface Props {
  editor: any;
  open: boolean;
  /** Which panel the rail has open; also drives the header title. */
  tab: PanelTab;
  onClose: () => void;
  /** Show the Suggested changes panel + keep its body mounted for the count. */
  reviewChanges: boolean;
  onChangesCount: (count: number) => void;
  markDirty?: () => void;
  /** Remounts the panel bodies' error boundaries on editor/document changes. */
  boundaryKey: string;
}

export default function DocumentPanel({
  editor,
  open,
  tab,
  onClose,
  reviewChanges,
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
        {/* Header — title reflects the panel the rail opened */}
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            padding: '10px 12px',
            borderBottom: `1px solid ${LINE}`,
            flex: '0 0 auto'
          }}
        >
          <span css={{ flex: 1, fontSize: 15, fontWeight: 600, color: INK }}>
            {TITLES[tab]}
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
