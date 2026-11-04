import React, { useEffect, useState } from 'react';
import TrackedChangeGroups from './TrackedChangeGroups';
import SectionList from './sections/SectionPanel';
import { RailErrorBoundary } from './RailErrorBoundary';
import { INK, INK_3, LINE, PANEL, PANEL_2 } from './TrackedChangeGroups/styles';
import { FEATHERY_RED } from './DocxToolbar/styles';
import { SpinnerIcon } from './icons';
import HistoryPanel from './history/HistoryPanel';
import {
  DocxHistoryHost,
  DocxVersion,
  LiveSessionAuthors,
  VersionAuthor
} from './history/types';
import type { TrackedChangeAcceptance } from './history/useDocxHistorySession';

export type PanelTab = 'changes' | 'sections' | 'history';

// The panel's typographic system, matched to the version-history design (DM
// Sans, falling back to the system stack when the face is not loaded).
const SANS =
  "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Shared right-hand side panel. The slim edge rail decides which panel is open;
// this component just shows the active one with a matching title (no in-panel
// tabs). Collapses to zero width when closed but stays mounted so the
// tracked-changes body keeps reporting its pending count for the rail badge.

export const PANEL_WIDTH = 341;

const TITLES: Record<PanelTab, string> = {
  changes: 'Suggested changes',
  sections: 'Sections',
  history: 'Version History'
};

export interface DocumentPanelProps {
  active?: boolean;
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
  /** Version-history I/O adapter; when present the History panel is available. */
  history?: DocxHistoryHost;
  currentUser?: VersionAuthor;
  onSelectVersion?: (version: DocxVersion) => void;
  /** Reports the loaded version list up (for auto-selecting the latest). */
  onVersionsLoaded?: (versions: DocxVersion[]) => void;
  /** Restore the version currently open in the viewer (footer button). */
  onRestoreVersion?: () => void;
  /** Whether a version is open in the viewer, enabling the Restore button. */
  versionSelected?: boolean;
  /** Disable Restore even when a version is open — e.g. the current version is
   *  showing, which is already the live state and can't be restored to. */
  restoreDisabled?: boolean;
  /** Tooltip explaining why Restore is disabled. */
  restoreDisabledReason?: string;
  restoring?: boolean;
  /** Id of the version open in the viewer (highlights its row). */
  selectedVersionId?: string | null;
  /** Unapproved Robin edits still tracked in the current version (its chip). */
  currentPendingCount?: number;
  liveSessionAuthors?: LiveSessionAuthors | null;
  /** Bump to reload the version list (e.g. after a session closes). */
  historyRefreshKey?: number | string;
  onAcceptTrackedChanges?: (
    acceptance: TrackedChangeAcceptance,
    accept: () => void
  ) => Promise<void>;
}

export type DocumentPanelFrameProps = Pick<
  DocumentPanelProps,
  | 'open'
  | 'tab'
  | 'onClose'
  | 'onRestoreVersion'
  | 'versionSelected'
  | 'restoreDisabled'
  | 'restoreDisabledReason'
  | 'restoring'
> & { children: React.ReactNode; animate?: boolean };

export function DocumentPanelFrame({
  open,
  tab,
  onClose,
  onRestoreVersion,
  versionSelected,
  restoreDisabled,
  restoreDisabledReason,
  restoring = false,
  children,
  animate = true
}: DocumentPanelFrameProps) {
  // Restore is offered only for an older version that is open — never for the
  // current version (it's already the live document).
  const canRestore = !!versionSelected && !restoreDisabled && !restoring;
  return (
    <div
      role='complementary'
      aria-label='Document panel'
      css={{
        flex: '0 0 auto',
        alignSelf: 'stretch',
        width: open ? PANEL_WIDTH : 0,
        minHeight: 0,
        overflow: 'hidden',
        transition: animate ? 'width .15s ease' : 'none'
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
          minHeight: 0,
          fontFamily: SANS
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
            disabled={restoring}
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
          {children}
        </div>

        {/* Footer (version history): Close returns to the live editor; Restore
            replaces the current document with the open version. Mirrors the
            design's bottom action bar. */}
        {open && tab === 'history' && (
          <div
            css={{
              display: 'flex',
              flex: '0 0 auto',
              gap: 8,
              justifyContent: 'flex-end',
              padding: '12px 14px',
              borderTop: `1px solid ${LINE}`,
              background: PANEL
            }}
          >
            <button
              type='button'
              onClick={onClose}
              disabled={restoring}
              css={{
                height: 32,
                padding: '0 14px',
                border: `1px solid ${LINE}`,
                borderRadius: 6,
                background: '#fff',
                fontFamily: SANS,
                fontSize: 12.5,
                fontWeight: 600,
                color: INK,
                cursor: 'pointer',
                '&:hover': { background: PANEL_2 }
              }}
            >
              Close
            </button>
            <button
              type='button'
              onClick={onRestoreVersion}
              disabled={!canRestore}
              title={
                versionSelected && restoreDisabled
                  ? restoreDisabledReason ?? 'This is the current version'
                  : undefined
              }
              css={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 32,
                padding: '0 14px',
                border: `1px solid ${FEATHERY_RED}`,
                borderRadius: 6,
                background: FEATHERY_RED,
                fontFamily: SANS,
                fontSize: 12.5,
                fontWeight: 600,
                color: '#fff',
                cursor: canRestore ? 'pointer' : 'default',
                opacity: canRestore ? 1 : 0.5,
                '&:hover': canRestore ? { filter: 'brightness(0.95)' } : {}
              }}
            >
              {restoring && <SpinnerIcon width={14} height={14} aria-hidden />}
              {restoring ? 'Restoring…' : 'Restore version'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function DocumentPanelBodies({
  editor,
  open,
  active = true,
  tab,
  reviewChanges,
  onChangesCount,
  markDirty,
  boundaryKey,
  history,
  currentUser,
  onSelectVersion,
  onVersionsLoaded,
  selectedVersionId,
  currentPendingCount,
  liveSessionAuthors,
  historyRefreshKey,
  onAcceptTrackedChanges
}: DocumentPanelProps) {
  const [historyOpened, setHistoryOpened] = useState(false);
  const [sectionsOpened, setSectionsOpened] = useState(false);
  useEffect(() => {
    if (!active || !open) return;
    if (tab === 'history') setHistoryOpened(true);
    if (tab === 'sections') setSectionsOpened(true);
  }, [active, open, tab]);
  return (
    <>
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
              onAcceptTrackedChanges={onAcceptTrackedChanges}
            />
          </RailErrorBoundary>
        </div>
      )}
      {(sectionsOpened || (active && open && tab === 'sections')) && (
        <div
          css={{
            position: 'absolute',
            inset: 0,
            display: open && tab === 'sections' ? 'block' : 'none'
          }}
        >
          <RailErrorBoundary key={`sections:${boundaryKey}`}>
            <SectionList editor={editor} markDirty={markDirty} />
          </RailErrorBoundary>
        </div>
      )}
      {(historyOpened || (active && open && tab === 'history')) && history && (
        <div
          css={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            display: open && tab === 'history' ? 'block' : 'none'
          }}
        >
          <RailErrorBoundary key={`history:${boundaryKey}`}>
            <HistoryPanel
              active={active && open && tab === 'history'}
              host={history}
              currentUser={
                currentUser ?? { kind: 'user', key: 'you', label: 'You' }
              }
              onSelect={onSelectVersion}
              onVersionsLoaded={onVersionsLoaded}
              selectedId={selectedVersionId}
              currentPendingCount={currentPendingCount}
              liveSessionAuthors={liveSessionAuthors}
              refreshKey={historyRefreshKey}
            />
          </RailErrorBoundary>
        </div>
      )}
    </>
  );
}

export default function DocumentPanel(props: DocumentPanelProps) {
  return (
    <DocumentPanelFrame {...props}>
      <DocumentPanelBodies {...props} />
    </DocumentPanelFrame>
  );
}
