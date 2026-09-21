import React from 'react';
import { RailErrorBoundary } from '../../DocxEditor/RailErrorBoundary';
import {
  INK,
  INK_3,
  LINE,
  PANEL,
  PANEL_2
} from '../../DocxEditor/TrackedChangeGroups/styles';
import type { PptxPanelKind } from './PptxPanelRail';

// Shared right-hand side panel, mirroring the DOCX DocumentPanel: the slim edge
// rail decides which panel is open; this shows the active one with a matching
// title. Collapses to zero width when closed. Panel bodies register here - the
// tracked-edits body ships with Phase 6, version history plugs in later.

export const PPTX_PANEL_WIDTH = 341;

const TITLES: Record<PptxPanelKind, string> = {
  changes: 'Tracked edits',
  history: 'Version history'
};

interface Props {
  open: boolean;
  tab: PptxPanelKind;
  onClose: () => void;
  /** Remounts the panel bodies' error boundaries on document changes. */
  boundaryKey: string;
  /** Body for the tracked-edits panel (kept mounted for its rail badge). */
  changesBody?: React.ReactNode;
  historyBody?: React.ReactNode;
}

export default function PptxRightPanel({
  open,
  tab,
  onClose,
  boundaryKey,
  changesBody,
  historyBody
}: Props) {
  return (
    <div
      css={{
        flex: '0 0 auto',
        alignSelf: 'stretch',
        width: open ? PPTX_PANEL_WIDTH : 0,
        minHeight: 0,
        overflow: 'hidden',
        transition: 'width .15s ease'
      }}
    >
      <div
        css={{
          width: PPTX_PANEL_WIDTH,
          height: '100%',
          borderLeft: `1px solid ${LINE}`,
          background: PANEL,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0
        }}
      >
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

        <div css={{ position: 'relative', flex: 1, minHeight: 0 }}>
          <div
            css={{
              position: 'absolute',
              inset: 0,
              display: open && tab === 'changes' ? 'flex' : 'none'
            }}
          >
            <RailErrorBoundary key={`changes:${boundaryKey}`}>
              {changesBody ?? (
                <div css={{ padding: 16, color: INK_3, fontSize: 13 }}>
                  Edits you make will be tracked here.
                </div>
              )}
            </RailErrorBoundary>
          </div>
          {open && tab === 'history' && (
            <div css={{ position: 'absolute', inset: 0 }}>
              <RailErrorBoundary key={`history:${boundaryKey}`}>
                {historyBody ?? (
                  <div css={{ padding: 16, color: INK_3, fontSize: 13 }}>
                    Version history is coming soon.
                  </div>
                )}
              </RailErrorBoundary>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
