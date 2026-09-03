import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  ACCENT_LINE,
  ACCENT_WASH,
  INK,
  INK_2,
  INK_3,
  LINE,
  PANEL_2,
  PAPER
} from '../TrackedChangeGroups/styles';
import { ChevronDownIcon, RobinIcon } from '../icons';
import { colorForAuthor, initialsForAuthor } from './authorColors';
import { groupVersions, MonthSection, VersionCluster } from './versionGrouping';
import { DocxHistoryHost, DocxVersion, VersionAuthor } from './types';

interface Props {
  host: DocxHistoryHost;
  currentUser: VersionAuthor;
  /** Selecting a version opens it in the viewer (later PR). */
  onSelect?: (version: DocxVersion) => void;
  /** Bump to reload the list (e.g. after a session closes). */
  refreshKey?: number | string;
}

type Author = { kind: string; label: string };

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  });
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) return time;
  const day = d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  });
  return `${day}, ${time}`;
}

function Avatar({ author }: { author: Author }) {
  const color = colorForAuthor(author);
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

function Avatars({ authors }: { authors: Author[] }) {
  const shown = authors.slice(0, 3);
  return (
    <span css={{ display: 'inline-flex', marginRight: 2 }}>
      {shown.map((a, i) => (
        <span
          key={`${a.kind}:${a.label}`}
          css={{ marginLeft: i === 0 ? 0 : -6 }}
        >
          <Avatar author={a} />
        </span>
      ))}
    </span>
  );
}

function authorSummary(authors: Author[]): string {
  const names = authors.map((a) =>
    a.kind === 'assistant' ? 'Robin' : a.label || 'You'
  );
  if (names.length <= 1) return names[0] ?? 'You';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}

function VersionRow({
  version,
  authors,
  isCurrent,
  indented,
  host,
  onSelect,
  onRenamed
}: {
  version: DocxVersion;
  authors: Author[];
  isCurrent: boolean;
  indented?: boolean;
  host: DocxHistoryHost;
  onSelect?: (v: DocxVersion) => void;
  onRenamed: (v: DocxVersion) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(version.name);

  const commit = async () => {
    setEditing(false);
    const name = draft.trim();
    if (name === version.name) return;
    try {
      const updated = await host.renameVersion(version.id, name);
      onRenamed(updated);
    } catch {
      setDraft(version.name); // revert on failure
    }
  };

  return (
    <div
      css={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: indented ? '6px 12px 6px 34px' : '8px 12px',
        cursor: onSelect ? 'pointer' : 'default',
        '&:hover': { background: PANEL_2 }
      }}
      onClick={() => !editing && onSelect?.(version)}
    >
      {!indented && <Avatars authors={authors} />}
      <span css={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft(version.name);
                setEditing(false);
              }
            }}
            css={{
              width: '100%',
              font: 'inherit',
              border: `1px solid ${ACCENT_LINE}`,
              borderRadius: 4,
              padding: '2px 4px'
            }}
          />
        ) : (
          <>
            <div
              css={{
                fontSize: 13,
                color: INK,
                fontWeight: version.name ? 600 : 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {version.name || formatWhen(version.ended_at)}
            </div>
            <div css={{ fontSize: 11, color: INK_3 }}>
              {version.name ? formatWhen(version.ended_at) : null}
              {version.name ? ' · ' : ''}
              {authorSummary(authors)}
              {version.restored_from_at
                ? ` · Restored from ${formatWhen(version.restored_from_at)}`
                : ''}
            </div>
          </>
        )}
      </span>
      {isCurrent && (
        <span
          css={{
            fontSize: 10,
            fontWeight: 600,
            color: INK_2,
            background: ACCENT_WASH,
            border: `1px solid ${ACCENT_LINE}`,
            borderRadius: 10,
            padding: '1px 7px',
            flex: '0 0 auto'
          }}
        >
          Current
        </span>
      )}
      {!indented && !isCurrent && !editing && (
        <button
          type='button'
          aria-label='Rename version'
          title='Rename'
          onClick={(e) => {
            e.stopPropagation();
            setDraft(version.name);
            setEditing(true);
          }}
          css={{
            border: 'none',
            background: 'transparent',
            color: INK_3,
            cursor: 'pointer',
            fontSize: 12,
            padding: 2,
            '&:hover': { color: INK }
          }}
        >
          ✎
        </button>
      )}
    </div>
  );
}

function Cluster({
  cluster,
  currentSeq,
  host,
  onSelect,
  onRenamed
}: {
  cluster: VersionCluster;
  currentSeq: number | null;
  host: DocxHistoryHost;
  onSelect?: (v: DocxVersion) => void;
  onRenamed: (v: DocxVersion) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasEarlier = cluster.earlier.length > 0;
  return (
    <div css={{ borderBottom: `1px solid ${LINE}` }}>
      <div css={{ display: 'flex', alignItems: 'stretch' }}>
        <div css={{ flex: 1, minWidth: 0 }}>
          <VersionRow
            version={cluster.primary}
            authors={cluster.authors}
            isCurrent={cluster.primary.seq === currentSeq}
            host={host}
            onSelect={onSelect}
            onRenamed={onRenamed}
          />
        </div>
        {hasEarlier && (
          <button
            type='button'
            aria-label={expanded ? 'Collapse' : 'Expand'}
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            css={{
              border: 'none',
              background: 'transparent',
              color: INK_3,
              cursor: 'pointer',
              padding: '0 10px',
              '&:hover': { color: INK }
            }}
          >
            <ChevronDownIcon
              width={16}
              height={16}
              css={{
                transform: expanded ? 'none' : 'rotate(-90deg)',
                transition: 'transform .12s ease'
              }}
            />
          </button>
        )}
      </div>
      {expanded &&
        cluster.earlier.map((v) => (
          <VersionRow
            key={v.id}
            version={v}
            authors={v.authors}
            isCurrent={v.seq === currentSeq}
            indented
            host={host}
            onSelect={onSelect}
            onRenamed={onRenamed}
          />
        ))}
    </div>
  );
}

const Message = ({ children }: { children: React.ReactNode }) => (
  <div css={{ padding: 24, textAlign: 'center', color: INK_3, fontSize: 13 }}>
    {children}
  </div>
);

export default function HistoryPanel({ host, onSelect, refreshKey }: Props) {
  const [versions, setVersions] = useState<DocxVersion[] | null>(null);
  const [error, setError] = useState(false);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setError(false);
    try {
      const rows = await host.listVersions();
      if (id === reqId.current) setVersions(rows);
    } catch {
      if (id === reqId.current) setError(true);
    }
  }, [host]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const onRenamed = useCallback((updated: DocxVersion) => {
    setVersions((rows) =>
      rows ? rows.map((r) => (r.id === updated.id ? updated : r)) : rows
    );
  }, []);

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

  return (
    <div css={{ overflowY: 'auto', height: '100%' }}>
      {sections.map((section) => (
        <div key={section.key}>
          <div
            css={{
              position: 'sticky',
              top: 0,
              zIndex: 1,
              padding: '8px 12px 4px',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              color: INK_3,
              background: PAPER,
              borderBottom: `1px solid ${LINE}`
            }}
          >
            {section.label}
          </div>
          {section.clusters.map((cluster) => (
            <Cluster
              key={cluster.primary.id}
              cluster={cluster}
              currentSeq={currentSeq}
              host={host}
              onSelect={onSelect}
              onRenamed={onRenamed}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
