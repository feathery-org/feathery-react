import React, { useEffect, useMemo, useState } from 'react';
import {
  clearNetworkDebug,
  NetworkDebugEntry,
  NetworkDebugKind,
  subscribeNetworkDebug
} from '../../utils/networkDebug';
import { DEV_NAV_BAR_Z_INDEX } from '../../utils/styles';

const COLORS = {
  surface: '#14161a',
  raised: '#1d2026',
  border: '#2c313a',
  text: '#e6e8eb',
  muted: '#8b929c',
  success: '#3ecf8e',
  pending: '#f5b544',
  error: '#ff6b6b',
  accent: '#7aa2ff'
};
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const KIND_LABELS: Record<NetworkDebugKind, string> = {
  event: 'Event',
  custom_submit: 'Field save',
  step_submit: 'Step submit',
  file_submit: 'File',
  form: 'Form',
  session: 'Session',
  other: 'Other'
};

type Filter = 'all' | 'submits' | 'events';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'submits', label: 'Submits' },
  { value: 'events', label: 'Events' }
];
const SUBMIT_KINDS: NetworkDebugKind[] = [
  'custom_submit',
  'step_submit',
  'file_submit'
];

const matchesFilter = (entry: NetworkDebugEntry, filter: Filter) => {
  if (filter === 'submits') return SUBMIT_KINDS.includes(entry.kind);
  if (filter === 'events') return entry.kind === 'event';
  return true;
};

const formatTime = (ms: number) => {
  const date = new Date(ms);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}.${pad(date.getMilliseconds(), 3)}`;
};

const statusColor = (entry: NetworkDebugEntry) =>
  COLORS[entry.status === 'success' ? 'success' : entry.status];

const statusText = (entry: NetworkDebugEntry) => {
  if (entry.status === 'pending') return 'pending';
  if (entry.httpStatus) return String(entry.httpStatus);
  return entry.status === 'success' ? 'ok' : 'failed';
};

const buttonReset = {
  background: 'none',
  border: 'none',
  font: 'inherit',
  color: 'inherit',
  cursor: 'pointer',
  padding: 0
};

const focusRing = {
  '&:focus-visible': { outline: `2px solid ${COLORS.accent}`, outlineOffset: 2 }
};

function EntryRow({
  entry,
  expanded,
  onToggle
}: {
  entry: NetworkDebugEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const color = statusColor(entry);
  return (
    <li css={{ borderBottom: `1px solid ${COLORS.border}` }}>
      <button
        type='button'
        aria-expanded={expanded}
        onClick={onToggle}
        css={{
          ...buttonReset,
          ...focusRing,
          width: '100%',
          display: 'grid',
          gridTemplateColumns: '84px 84px 1fr auto',
          alignItems: 'center',
          gap: 8,
          padding: '7px 12px',
          textAlign: 'left',
          borderLeft: `3px solid ${color}`,
          '&:hover': { background: COLORS.raised }
        }}
      >
        <span css={{ fontFamily: MONO, fontSize: 11, color: COLORS.muted }}>
          {formatTime(entry.startedAt)}
        </span>
        <span
          css={{
            fontSize: 11,
            fontWeight: 600,
            color: SUBMIT_KINDS.includes(entry.kind)
              ? COLORS.accent
              : COLORS.text
          }}
        >
          {KIND_LABELS[entry.kind]}
          {entry.retry && (
            <span css={{ color: COLORS.pending, fontWeight: 500 }}> retry</span>
          )}
        </span>
        <span css={{ minWidth: 0 }}>
          <span
            css={{
              display: 'block',
              fontFamily: MONO,
              fontSize: 11,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {entry.method} {entry.path}
          </span>
          {entry.stepKey && (
            <span css={{ fontSize: 10, color: COLORS.muted }}>
              on {entry.stepKey}
            </span>
          )}
        </span>
        <span css={{ textAlign: 'right', fontFamily: MONO, fontSize: 11 }}>
          <span css={{ color, fontWeight: 600 }}>{statusText(entry)}</span>
          {entry.durationMs != null && (
            <span css={{ display: 'block', color: COLORS.muted, fontSize: 10 }}>
              {entry.durationMs} ms
            </span>
          )}
        </span>
      </button>
      {expanded && (
        <div css={{ padding: '0 12px 10px 15px', background: COLORS.raised }}>
          {entry.error && (
            <p
              css={{
                margin: '0 0 6px',
                paddingTop: 8,
                color: COLORS.error,
                fontFamily: MONO,
                fontSize: 11
              }}
            >
              {entry.error}
            </p>
          )}
          <pre
            css={{
              margin: 0,
              paddingTop: entry.error ? 0 : 8,
              fontFamily: MONO,
              fontSize: 11,
              lineHeight: 1.5,
              color: COLORS.text,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 240,
              overflow: 'auto'
            }}
          >
            {entry.body === undefined
              ? 'No request body'
              : JSON.stringify(entry.body, null, 2)}
          </pre>
        </div>
      )}
    </li>
  );
}

/**
 * Lists the SDK's requests as they happen: events, field saves and step
 * submits, with the step that was showing, the payload and how each settled.
 */
export default function NetworkDebugPanel() {
  const [entries, setEntries] = useState<NetworkDebugEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => subscribeNetworkDebug(setEntries), []);

  const visible = useMemo(
    () => entries.filter((entry) => matchesFilter(entry, filter)).reverse(),
    [entries, filter]
  );
  const errorCount = entries.filter((e) => e.status === 'error').length;
  const pendingCount = entries.filter((e) => e.status === 'pending').length;
  const indicator = errorCount
    ? COLORS.error
    : pendingCount
    ? COLORS.pending
    : COLORS.success;

  return (
    <aside
      aria-label='Feathery network debug'
      css={{
        position: 'fixed',
        left: 16,
        bottom: 16,
        zIndex: DEV_NAV_BAR_Z_INDEX,
        fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
        color: COLORS.text,
        maxWidth: 'calc(100vw - 32px)'
      }}
    >
      {open && (
        <section
          css={{
            width: 560,
            maxWidth: '100%',
            marginBottom: 8,
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 10,
            boxShadow: '0 18px 48px rgba(0, 0, 0, 0.35)',
            overflow: 'hidden'
          }}
        >
          <header
            css={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              borderBottom: `1px solid ${COLORS.border}`
            }}
          >
            <h2 css={{ margin: 0, fontSize: 13, fontWeight: 600, flex: 1 }}>
              Network
              <span css={{ color: COLORS.muted, fontWeight: 400 }}>
                {' '}
                · {entries.length} requests
              </span>
            </h2>
            <div
              role='group'
              aria-label='Filter requests'
              css={{ display: 'flex', gap: 4 }}
            >
              {FILTERS.map(({ value, label }) => (
                <button
                  key={value}
                  type='button'
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                  css={{
                    ...buttonReset,
                    ...focusRing,
                    fontSize: 11,
                    padding: '3px 8px',
                    borderRadius: 999,
                    border: `1px solid ${
                      filter === value ? COLORS.accent : COLORS.border
                    }`,
                    color: filter === value ? COLORS.text : COLORS.muted
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type='button'
              onClick={clearNetworkDebug}
              css={{
                ...buttonReset,
                ...focusRing,
                fontSize: 11,
                color: COLORS.muted,
                '&:hover': { color: COLORS.text }
              }}
            >
              Clear
            </button>
          </header>
          <ul
            css={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              maxHeight: '55vh',
              overflowY: 'auto'
            }}
          >
            {visible.length === 0 && (
              <li css={{ padding: 16, fontSize: 12, color: COLORS.muted }}>
                No requests yet.
              </li>
            )}
            {visible.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                expanded={expandedId === entry.id}
                onToggle={() =>
                  setExpandedId(expandedId === entry.id ? null : entry.id)
                }
              />
            ))}
          </ul>
        </section>
      )}
      <button
        type='button'
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        css={{
          ...buttonReset,
          ...focusRing,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 12px',
          borderRadius: 999,
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          boxShadow: '0 6px 20px rgba(0, 0, 0, 0.25)',
          fontSize: 12,
          fontWeight: 600,
          '&:hover': { borderColor: COLORS.muted }
        }}
      >
        <span
          aria-hidden
          css={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: indicator
          }}
        />
        Network
        <span css={{ fontFamily: MONO, color: COLORS.muted }}>
          {entries.length}
        </span>
        {errorCount > 0 && (
          <span css={{ color: COLORS.error }}>{errorCount} failed</span>
        )}
      </button>
    </aside>
  );
}
