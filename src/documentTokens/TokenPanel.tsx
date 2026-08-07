/**
 * A development-only view of the token graph.
 *
 * Not customer-facing. Formulas only make sense as text and there is nowhere
 * in a Word document to put them, so this is where you see what the document
 * actually believes: every token, its value, what it derives from, and
 * anything that failed.
 *
 * Enabled per-session, matching the `featherySyncfusion` override convention:
 *
 *     window.featheryDocxTokens = { panel: true };
 */

import React, { useEffect, useState } from 'react';

import { TokenCycle, TokenState } from './tokenCycle';

const INPUT_COLOR = '#2563EB';
const COMPUTED_COLOR = '#9CA3AF';

const styles = {
  panel: {
    position: 'absolute' as const,
    top: 8,
    right: 8,
    bottom: 8,
    width: 300,
    overflowY: 'auto' as const,
    background: '#ffffff',
    border: '1px solid #d4d4d8',
    borderRadius: 8,
    boxShadow: '0 4px 16px rgba(0,0,0,.08)',
    padding: 12,
    font: '12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
    zIndex: 20
  },
  heading: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 8,
    fontWeight: 600
  },
  muted: { color: '#71717a', fontWeight: 400 },
  card: {
    borderLeft: '3px solid transparent',
    padding: '6px 8px',
    marginBottom: 6,
    background: '#fafafa',
    borderRadius: 4
  },
  id: { fontWeight: 600 },
  formula: { color: '#71717a', wordBreak: 'break-all' as const },
  error: { color: '#b91c1c' },
  input: {
    width: '100%',
    marginTop: 4,
    padding: '2px 4px',
    border: '1px solid #d4d4d8',
    borderRadius: 3,
    font: 'inherit'
  }
};

export const tokenPanelEnabled = (windowLike: any): boolean =>
  Boolean(windowLike?.featheryDocxTokens?.panel);

export default function TokenPanel({ cycle }: { cycle: TokenCycle }) {
  const [state, setState] = useState<TokenState>(() => cycle.getState());
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => cycle.subscribe(setState), [cycle]);

  const failing = state.errors.size + state.invalid.size;

  return (
    <div style={styles.panel} data-testid='docx-token-panel'>
      <div style={styles.heading}>
        <span>Tokens</span>
        <span style={styles.muted}>
          {state.specs.length}
          {failing > 0 ? ` · ${failing} issue${failing > 1 ? 's' : ''}` : ''}
        </span>
      </div>

      {state.specs.length === 0 && (
        <div style={styles.muted}>This document declares no tokens.</div>
      )}

      {state.specs.map((spec) => {
        const computed = Boolean(spec.formula);
        const error = state.errors.get(spec.id) ?? state.invalid.get(spec.id);
        const value = state.values.get(spec.id);

        return (
          <div
            key={spec.id}
            style={{
              ...styles.card,
              borderLeftColor: error
                ? '#b91c1c'
                : computed
                ? COMPUTED_COLOR
                : INPUT_COLOR,
              outline:
                state.focused === spec.id ? `1px solid ${INPUT_COLOR}` : 'none'
            }}
          >
            <div style={styles.id}>{spec.id}</div>

            {computed ? (
              <>
                <div style={styles.formula}>{spec.formula}</div>
                <div>= {value ?? '—'}</div>
              </>
            ) : (
              <input
                style={styles.input}
                aria-label={spec.id}
                value={draft[spec.id] ?? (value ?? '').toString()}
                onChange={(e) =>
                  setDraft({ ...draft, [spec.id]: e.target.value })
                }
                onBlur={() => {
                  const typed = draft[spec.id];
                  if (typed !== undefined) cycle.setTokenValue(spec.id, typed);
                  const next = { ...draft };
                  delete next[spec.id];
                  setDraft(next);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
            )}

            {error && <div style={styles.error}>{error}</div>}
          </div>
        );
      })}
    </div>
  );
}
