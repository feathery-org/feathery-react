import React, { useEffect, useMemo, useRef, useState } from 'react';
import { deckToJSON } from '../core/model/json';
import { featheryDoc } from '../../../../utils/browser';
import {
  usePptxEditorState,
  usePptxEditorStore
} from '../state/PptxEditorContext';

// flash keyframe for changed lines (injected once, on first mount - never at
// module import time, which would be an SSR-unsafe side effect)
function ensureFlashStyle() {
  const doc = featheryDoc();
  if (!doc.getElementById || doc.getElementById('pptx-jsonflash-style')) return;
  const st = doc.createElement('style');
  st.id = 'pptx-jsonflash-style';
  st.textContent =
    '@keyframes jsonflash{0%{background:rgba(240,200,80,0.55)}100%{background:transparent}}';
  doc.head.appendChild(st);
}

// Live JSON of the active slide. The selected shape's block is highlighted (blue),
// and lines that changed since the last edit flash (yellow) — so you can see the
// diff as you edit.
export function JsonPanel() {
  const store = usePptxEditorStore();
  const state = usePptxEditorState();
  useEffect(ensureFlashStyle, []);
  const deck = state.deck;
  const activeSlide = state.activeSlide;
  const selectedId = state.selectedId;
  const rev = state.rev;
  const structureRev = state.structureRev;
  const historyRevision = state.historyRevision;

  const prevLines = useRef<string[]>([]);
  const previousHistoryRevision = useRef(historyRevision);
  const firstSelRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [baseSnapshot, setBaseSnapshot] = useState('');
  const [error, setError] = useState('');

  // A draft belongs to one slide; never apply it to a different slide or deck.
  useEffect(() => {
    setDraft(null);
    setError('');
  }, [deck, activeSlide]);

  const startEditing = () => {
    store.commitSvgTextEdit?.();
    const state = store.getState();
    if (!state.deck) return;
    const snapshot = JSON.stringify(
      deckToJSON(state.deck).slides[state.activeSlide]
    );
    setBaseSnapshot(snapshot);
    setDraft(JSON.stringify(JSON.parse(snapshot), null, 2));
    setError('');
  };

  const applyDraft = () => {
    if (draft === null) return;
    const state = store.getState();
    const slide = state.deck?.slides[state.activeSlide];
    if (!state.deck || !slide) return;
    try {
      const current = JSON.stringify(
        deckToJSON(state.deck).slides[state.activeSlide]
      );
      if (current !== baseSnapshot)
        throw new Error(
          'The slide changed while this JSON draft was open. Reload JSON to include those changes.'
        );
      store.applyActiveSlideJSON(JSON.parse(draft));
      setDraft(null);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not apply JSON');
    }
  };

  const { lines, selStart, selEnd, changed } = useMemo(() => {
    if (!deck)
      return {
        lines: [] as string[],
        selStart: -1,
        selEnd: -1,
        changed: new Set<number>()
      };
    const slideJson = deckToJSON(deck).slides[activeSlide];
    const text = JSON.stringify(slideJson, null, 2);
    const lines = text.split('\n');

    // find the selected shape's object bounds (id line → nearest `{` above → brace match down)
    let selStart = -1;
    let selEnd = -1;
    if (selectedId) {
      const idLine = lines.findIndex((l) =>
        l.includes(`"id": "${selectedId}"`)
      );
      if (idLine >= 0) {
        let s = idLine;
        while (s > 0 && lines[s].trim() !== '{') s--;
        let depth = 0;
        for (let i = s; i < lines.length; i++) {
          depth +=
            (lines[i].match(/[{[]/g) || []).length -
            (lines[i].match(/[}\]]/g) || []).length;
          if (depth <= 0 && i > s) {
            selEnd = i;
            break;
          }
        }
        selStart = s;
        if (selEnd < 0) selEnd = lines.length - 1;
      }
    }

    // changed lines vs the previous render (simple multiset diff)
    const prevCount = new Map<string, number>();
    for (const l of prevLines.current)
      prevCount.set(l, (prevCount.get(l) || 0) + 1);
    const changed = new Set<number>();
    const isFirstRender = prevLines.current.length === 0;
    const historyNavigation =
      historyRevision !== previousHistoryRevision.current;
    if (!historyNavigation)
      lines.forEach((l, i) => {
        const c = prevCount.get(l) || 0;
        if (c > 0) prevCount.set(l, c - 1);
        else if (!isFirstRender) changed.add(i);
      });
    return { lines, selStart, selEnd, changed };
  }, [deck, activeSlide, selectedId, rev, structureRev, historyRevision]);

  // remember this render's lines for the next diff
  useEffect(() => {
    prevLines.current = lines;
    previousHistoryRevision.current = historyRevision;
  }, [lines, historyRevision]);
  // scroll the selected block into view
  useEffect(() => {
    firstSelRef.current?.scrollIntoView?.({
      block: 'nearest',
      behavior: 'smooth'
    });
  }, [selStart, selEnd]);

  if (!deck) return <div style={styles.panel} />;

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span>
          slide {activeSlide + 1} · {draft === null ? 'live JSON' : 'edit JSON'}
        </span>
        {draft === null ? (
          <button type='button' style={styles.button} onClick={startEditing}>
            Edit JSON
          </button>
        ) : (
          <span style={styles.actions}>
            <button type='button' style={styles.button} onClick={applyDraft}>
              Apply
            </button>
            <button
              type='button'
              style={styles.button}
              onClick={() => {
                setDraft(null);
                setError('');
              }}
            >
              Cancel
            </button>
          </span>
        )}
      </div>
      {draft !== null ? (
        <>
          <textarea
            aria-label='Slide JSON editor'
            spellCheck={false}
            style={styles.editor}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setError('');
            }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                applyDraft();
              }
            }}
          />
          {error && (
            <div role='alert' style={styles.error}>
              {error}
            </div>
          )}
          <div style={styles.hint}>
            Edit existing shapes, text runs, solid colors, and table rows,
            columns, sizes, or cell text. Other fields are read-only.
          </div>
        </>
      ) : (
        <div style={styles.code}>
          {lines.map((l, i) => {
            const selected = selStart >= 0 && i >= selStart && i <= selEnd;
            const isChanged = changed.has(i);
            return (
              <div
                key={isChanged ? `${i}:${rev}:${structureRev}` : i}
                ref={selected && i === selStart ? firstSelRef : undefined}
                style={{
                  ...styles.line,
                  ...(selected ? styles.selected : null),
                  ...(isChanged ? styles.changed : null)
                }}
              >
                {l || ' '}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 380,
    minWidth: 300,
    display: 'flex',
    flexDirection: 'column',
    background: '#12151b',
    borderLeft: '1px solid #000',
    overflow: 'hidden'
  },
  header: {
    padding: '8px 12px',
    fontSize: 12,
    color: '#8ea2c8',
    fontFamily: 'system-ui',
    borderBottom: '1px solid #222',
    background: '#161a22',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8
  },
  actions: { display: 'flex', gap: 5 },
  button: {
    border: '1px solid #45516a',
    borderRadius: 4,
    padding: '3px 6px',
    color: '#dbe4f5',
    background: '#27334a',
    cursor: 'pointer',
    fontSize: 11
  },
  editor: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    resize: 'none',
    boxSizing: 'border-box',
    border: 0,
    outline: 'none',
    background: '#12151b',
    color: '#cfd6e4',
    fontFamily: 'ui-monospace, JetBrains Mono, monospace',
    fontSize: 11.5,
    lineHeight: '1.5',
    padding: '8px 12px'
  },
  error: {
    color: '#ffadb0',
    background: '#352126',
    padding: '7px 12px',
    fontSize: 11,
    overflowWrap: 'anywhere'
  },
  hint: {
    color: '#8994aa',
    padding: '7px 12px',
    fontSize: 10,
    borderTop: '1px solid #29313f'
  },
  code: {
    flex: 1,
    overflow: 'auto',
    fontFamily: 'ui-monospace, JetBrains Mono, monospace',
    fontSize: 11.5,
    lineHeight: '1.5',
    color: '#cfd6e4',
    padding: '6px 0'
  },
  line: {
    padding: '0 12px',
    whiteSpace: 'pre',
    borderLeft: '2px solid transparent'
  },
  selected: {
    background: 'rgba(91,141,239,0.14)',
    borderLeft: '2px solid #5b8def'
  },
  changed: { animation: 'jsonflash 1.1s ease-out' }
};
