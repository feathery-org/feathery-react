import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  INK,
  INK_2,
  INK_3,
  LINE,
  PANEL_2,
  PAPER
} from '../TrackedChangeGroups/styles';
import { RobinIcon } from '../icons';
import {
  colorForAuthor,
  firstUserActorKey,
  initialsForAuthor
} from './authorColors';
import { groupVersions, MonthSection } from './versionGrouping';
import {
  DocxHistoryHost,
  DocxVersion,
  LiveSessionAuthors,
  VersionAuthor
} from './types';

interface Props {
  host: DocxHistoryHost;
  currentUser: VersionAuthor;
  /** Selecting a version opens it in the viewer (later PR). */
  onSelect?: (version: DocxVersion) => void;
  /** Reports the loaded version list up (for auto-selecting the latest). */
  onVersionsLoaded?: (versions: DocxVersion[]) => void;
  /** Id of the version currently open in the viewer (highlights that row). */
  selectedId?: string | null;
  /** Assistant edits still tracked (unapproved) in the in-progress current
   *  version; shown as a "pending" chip on its row. 0/undefined hides it. */
  currentPendingCount?: number;
  liveSessionAuthors?: LiveSessionAuthors | null;
  /** Bump to reload the list (e.g. after a session closes). */
  refreshKey?: number | string;
}

type Author = { kind: string; label: string; key?: string };

// "Current" pill + selected/hover row backgrounds, matched to the design.
const PILL_BLUE = '#2563eb';
const PILL_WASH = '#eff6ff';
const ROW_ACTIVE = '#f4f4f5';
// "N pending" chip — dashed red, echoing the viewer's pending-edit outline.
const PENDING_RED = '#b0302b';
const PENDING_WASH = 'rgba(176, 48, 43, 0.10)';
const PENDING_BORDER = 'rgba(176, 48, 43, 0.55)';

// A version's timestamp label. Only the latest version reads "Just now" (and
// only when truly recent); every other row shows its actual time — full month,
// day and time for past days, just the time for earlier today.
function formatWhen(iso: string, relative = false): string {
  const d = new Date(iso);
  const now = new Date();
  if (relative && now.getTime() - d.getTime() < 60_000) return 'Just now';
  const time = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  });
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return time;
  const day = d.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric'
  });
  return `${day}, ${time}`;
}

function Avatar({
  author,
  firstUserKey
}: {
  author: Author;
  firstUserKey: string;
}) {
  const color = colorForAuthor(author, firstUserKey);
  return (
    <span
      title={author.kind === 'assistant' ? 'Robin' : author.label || 'You'}
      css={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        background: color,
        color: '#fff',
        fontSize: 10,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
        boxShadow: `0 0 0 1.5px ${PAPER}`
      }}
    >
      {author.kind === 'assistant' ? (
        <RobinIcon width={12} height={12} />
      ) : (
        initialsForAuthor(author)
      )}
    </span>
  );
}

const authorName = (a: Author): string =>
  a.kind === 'assistant' ? 'Robin' : a.label || 'You';

// One author line: avatar + name, stacked (a version can list several).
function AuthorLine({
  author,
  firstUserKey
}: {
  author: Author;
  firstUserKey: string;
}) {
  return (
    <div
      css={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 13,
        color: INK_2
      }}
    >
      <Avatar author={author} firstUserKey={firstUserKey} />
      <span>{authorName(author)}</span>
    </div>
  );
}

function VersionRow({
  version,
  authors,
  isCurrent,
  selected,
  pendingCount,
  liveAuthors,
  firstUserKey,
  onSelect
}: {
  version: DocxVersion;
  authors: Author[];
  isCurrent: boolean;
  selected?: boolean;
  pendingCount?: number;
  liveAuthors?: VersionAuthor[];
  firstUserKey: string;
  onSelect?: (v: DocxVersion) => void;
}) {
  // Activity alone is not proof of a surviving edit. A live diff supplies the
  // same evidence as a saved checkpoint, including an empty list after undo.
  const hasTrackedChanges =
    Boolean(version.changes) &&
    ((version.change_count ?? 0) > 0 || (version.format_change_count ?? 0) > 0);
  // A saved snapshot without a diff retains known authors; a temporary diff
  // failure must not erase them from the list. Unsaved activity stays hidden.
  const hasSavedFallback = Boolean(version.final_sfdt) && !version.changes;
  const effectiveAuthors: Author[] =
    liveAuthors ?? (hasTrackedChanges || hasSavedFallback ? authors : []);
  // The session writes "You" in the browser; the saved actor identifies who
  // that session belonged to. Use the durable label for display and colour.
  const displayedAuthors = effectiveAuthors.map((author) =>
    author.kind === 'user' &&
    (!author.label || author.label === 'You') &&
    (version.actor_name || version.actor_label)
      ? {
          ...author,
          label: version.actor_name || version.actor_label,
          key: version.actor_label || version.actor_name
        }
      : author
  );
  return (
    <div
      onClick={() => onSelect?.(version)}
      aria-current={selected ? 'true' : undefined}
      css={{
        // No dividers; spacing comes from the padding + rounded active fill.
        padding: '10px 12px',
        borderRadius: 8,
        cursor: onSelect ? 'pointer' : 'default',
        background: selected ? ROW_ACTIVE : 'transparent',
        '&:hover': { background: selected ? ROW_ACTIVE : PANEL_2 }
      }}
    >
      <div css={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span
          css={{
            flex: 1,
            minWidth: 0,
            fontSize: 15,
            fontWeight: 600,
            color: INK
          }}
        >
          {version.name || formatWhen(version.ended_at, isCurrent)}
        </span>
        {isCurrent && (
          <span
            css={{
              flex: '0 0 auto',
              fontSize: 12.5,
              fontWeight: 600,
              color: PILL_BLUE,
              background: PILL_WASH,
              borderRadius: 10,
              padding: '2px 9px'
            }}
          >
            Current
          </span>
        )}
        {pendingCount != null && pendingCount > 0 && (
          <span
            title={`${pendingCount} unapproved Robin ${
              pendingCount === 1 ? 'edit' : 'edits'
            } still tracked`}
            css={{
              flex: '0 0 auto',
              fontSize: 12,
              fontWeight: 600,
              color: PENDING_RED,
              background: PENDING_WASH,
              border: `1px dashed ${PENDING_BORDER}`,
              borderRadius: 10,
              padding: '1px 8px',
              whiteSpace: 'nowrap'
            }}
          >
            {pendingCount} pending
          </span>
        )}
      </div>
      {version.restored_from_at && (
        <div css={{ marginTop: 2, fontSize: 13, color: INK_3 }}>
          Restored from {formatWhen(version.restored_from_at)}
        </div>
      )}
      <div
        css={{
          marginTop: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 6
        }}
      >
        {version.is_baseline ? (
          <span css={{ fontSize: 13, color: INK_2 }}>Original document</span>
        ) : (
          displayedAuthors.map((a) => (
            <AuthorLine
              key={`${a.kind}:${a.label}`}
              author={a}
              firstUserKey={firstUserKey}
            />
          ))
        )}
      </div>
    </div>
  );
}

const Message = ({ children }: { children: React.ReactNode }) => (
  <div css={{ padding: 24, textAlign: 'center', color: INK_3, fontSize: 13 }}>
    {children}
  </div>
);

export default function HistoryPanel({
  host,
  onSelect,
  onVersionsLoaded,
  selectedId,
  currentPendingCount,
  liveSessionAuthors,
  refreshKey
}: Props) {
  const [versions, setVersions] = useState<DocxVersion[] | null>(null);
  const [error, setError] = useState(false);
  const reqId = useRef(0);
  const onVersionsLoadedRef = useRef(onVersionsLoaded);
  onVersionsLoadedRef.current = onVersionsLoaded;

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setError(false);
    try {
      const rows = await host.listVersions();
      if (id === reqId.current) {
        setVersions(rows);
        onVersionsLoadedRef.current?.(rows);
      }
    } catch {
      if (id === reqId.current) setError(true);
    }
  }, [host]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (error) {
    return (
      <Message>
        <div>Couldn’t load version history.</div>
        <button
          type='button'
          onClick={load}
          css={{
            marginTop: 8,
            border: `1px solid ${LINE}`,
            background: PAPER,
            borderRadius: 6,
            padding: '4px 10px',
            cursor: 'pointer',
            color: INK
          }}
        >
          Retry
        </button>
      </Message>
    );
  }
  if (versions === null) return <Message>Loading…</Message>;
  if (versions.length === 0) {
    return (
      <Message>
        <div>No versions yet.</div>
        <div>Saved versions will appear here.</div>
      </Message>
    );
  }

  const currentSeq =
    versions.reduce((max, v) => (v.seq > max ? v.seq : max), -1) ?? null;
  const sections: MonthSection[] = groupVersions(versions);
  const firstUserKey = firstUserActorKey(versions);

  return (
    <div css={{ overflowY: 'auto', height: '100%', padding: '6px 8px 12px' }}>
      {sections.map((section) => (
        <div key={section.key}>
          <div
            css={{
              padding: '14px 8px 8px',
              fontSize: 14,
              fontWeight: 600,
              color: INK_3
            }}
          >
            {section.label}
          </div>
          {section.clusters.map((cluster) => (
            <VersionRow
              key={cluster.primary.id}
              version={cluster.primary}
              authors={cluster.authors}
              liveAuthors={
                cluster.primary.is_current &&
                !cluster.primary.closed_at &&
                cluster.primary.session_id === liveSessionAuthors?.sessionId
                  ? liveSessionAuthors.authors
                  : undefined
              }
              firstUserKey={firstUserKey}
              isCurrent={cluster.primary.seq === currentSeq}
              selected={selectedId != null && cluster.primary.id === selectedId}
              pendingCount={
                cluster.primary.seq === currentSeq
                  ? currentPendingCount
                  : undefined
              }
              onSelect={onSelect}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
