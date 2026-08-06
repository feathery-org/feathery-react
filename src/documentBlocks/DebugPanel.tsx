/**
 * A development-only view of the block store, the live SFDT, and the sync
 * log. Not customer-facing.
 *
 * Enabled per-session, matching the `featherySyncfusion` override convention:
 *
 *     window.featheryDocxBlocks = { debug: true };
 */

import React, { useEffect, useState } from 'react';

import { BlockStore } from './store';
import { BlockSync, EditorSurface, SyncLogEntry } from './blockSync';

const styles = {
  panel: {
    position: 'absolute' as const,
    top: 8,
    left: 8,
    bottom: 8,
    width: 340,
    overflowY: 'auto' as const,
    background: '#ffffff',
    border: '1px solid #d4d4d8',
    borderRadius: 8,
    boxShadow: '0 4px 16px rgba(0,0,0,.08)',
    padding: 12,
    font: '12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
    zIndex: 20
  },
  section: { marginBottom: 8 },
  sectionHeading: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    cursor: 'pointer',
    fontWeight: 600,
    padding: '4px 0'
  },
  muted: { color: '#71717a', fontWeight: 400 },
  pre: {
    margin: 0,
    maxHeight: 240,
    overflow: 'auto' as const,
    background: '#fafafa',
    border: '1px solid #e4e4e7',
    borderRadius: 4,
    padding: 8,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const
  },
  textarea: {
    width: '100%',
    height: 160,
    boxSizing: 'border-box' as const,
    font: 'inherit',
    border: '1px solid #d4d4d8',
    borderRadius: 4,
    padding: 6
  },
  buttonRow: { display: 'flex', gap: 6, margin: '6px 0' },
  button: {
    border: '1px solid #d4d4d8',
    borderRadius: 4,
    background: '#f4f4f5',
    padding: '4px 10px',
    font: 'inherit',
    cursor: 'pointer'
  },
  error: { color: '#b91c1c', marginTop: 4 },
  logRow: { padding: '2px 0', borderBottom: '1px solid #f4f4f5' }
};

export const debugPanelEnabled = (windowLike: any): boolean =>
  Boolean(windowLike?.featheryDocxBlocks?.debug);

const formatTime = (at: number): string =>
  new Date(at).toISOString().slice(11, 19);

const CollapsibleSection = ({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) => {
  const [open, setOpen] = useState(true);
  return (
    <div style={styles.section}>
      <div style={styles.sectionHeading} onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <span style={styles.muted}>{open ? '▾' : '▸'}</span>
      </div>
      {open && children}
    </div>
  );
};

export default function DebugPanel({
  store,
  sync,
  editor
}: {
  store: BlockStore;
  sync: BlockSync;
  editor: EditorSurface;
}) {
  const [data, setData] = useState(() => store.getData());
  const [log, setLog] = useState<SyncLogEntry[]>(() => sync.getLog());
  const [sfdt, setSfdt] = useState('');
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => store.subscribe(setData), [store]);
  useEffect(() => sync.subscribeLog(setLog), [sync]);

  return (
    <div style={styles.panel} data-testid='docx-debug-panel'>
      <CollapsibleSection title='Data'>
        <pre style={styles.pre} data-testid='docx-debug-data'>
          {JSON.stringify(data, null, 2)}
        </pre>
      </CollapsibleSection>

      <CollapsibleSection title='SFDT'>
        <textarea
          style={styles.textarea}
          data-testid='docx-debug-sfdt'
          value={sfdt}
          onChange={(e) => setSfdt(e.target.value)}
        />
        <div style={styles.buttonRow}>
          <button
            style={styles.button}
            onClick={() => {
              setSfdt(editor.serialize());
              setApplyError(null);
            }}
          >
            Pull
          </button>
          <button
            style={styles.button}
            onClick={() => {
              try {
                editor.open(sfdt);
                setApplyError(null);
              } catch (err) {
                setApplyError(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            Apply
          </button>
        </div>
        {applyError && <div style={styles.error}>{applyError}</div>}
      </CollapsibleSection>

      <CollapsibleSection title='Log'>
        <div data-testid='docx-debug-log'>
          {log.length === 0 && <div style={styles.muted}>No events yet.</div>}
          {[...log].reverse().map((entry, i) => (
            <div key={i} style={styles.logRow}>
              {formatTime(entry.at)} {entry.kind} {entry.detail}
            </div>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  );
}
