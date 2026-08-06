/**
 * A development-only side panel for editing the block document directly:
 * insert/delete blocks, edit paragraph and table text, and — the one thing
 * that has nowhere else to live — edit a computed token's formula.
 *
 * Enabled per-session, matching the `featherySyncfusion` override convention:
 *
 *     window.featheryDocxBlocks = { panel: true };
 */
import React, { useEffect, useRef, useState } from 'react';

import { BlockStore } from './store';
import {
  deleteBlock,
  insertBlock,
  updateBlockContent,
  updateCell
} from './store';
import { Block, BlockType, blockIds, DocumentData, Inline } from './types';
import { valueKey } from '../documentTokens/plan';

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
  heading: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 8,
    fontWeight: 600
  },
  historyButtons: { display: 'flex', gap: 4 },
  smallButton: {
    font: 'inherit',
    padding: '2px 6px',
    border: '1px solid #d4d4d8',
    borderRadius: 4,
    background: '#fff',
    cursor: 'pointer'
  },
  sectionLabel: {
    marginTop: 10,
    marginBottom: 4,
    fontWeight: 600,
    color: '#71717a'
  },
  card: {
    border: '1px solid #e4e4e7',
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
    background: '#fafafa'
  },
  badge: {
    display: 'inline-block',
    padding: '1px 6px',
    marginBottom: 6,
    borderRadius: 3,
    background: '#e4e4e7',
    fontWeight: 600
  },
  textarea: {
    width: '100%',
    marginBottom: 4,
    padding: '2px 4px',
    border: '1px solid #d4d4d8',
    borderRadius: 3,
    font: 'inherit',
    resize: 'vertical' as const
  },
  chip: {
    display: 'inline-block',
    padding: '1px 6px',
    margin: '2px 0',
    borderRadius: 10,
    background: '#dbeafe',
    color: '#1d4ed8',
    cursor: 'default'
  },
  computedChip: {
    background: '#ede9fe',
    color: '#6d28d9',
    cursor: 'pointer'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    marginBottom: 4
  },
  cellInput: {
    width: '100%',
    padding: '2px 4px',
    border: '1px solid #d4d4d8',
    borderRadius: 3,
    font: 'inherit'
  },
  footerRow: {
    display: 'flex',
    gap: 4,
    flexWrap: 'wrap' as const,
    marginTop: 4
  },
  formulaForm: { marginTop: 6, display: 'flex', gap: 4 }
};

export const blockPanelEnabled = (windowLike: any): boolean =>
  Boolean(windowLike?.featheryDocxBlocks?.panel);

const freshId = (data: DocumentData): string => {
  const existing = new Set(blockIds(data));
  let id = 'blk_' + Math.random().toString(36).slice(2, 8);
  while (existing.has(id)) id = 'blk_' + Math.random().toString(36).slice(2, 8);
  return id;
};

const TYPE_BADGE: Record<BlockType, string> = {
  h1: 'H1',
  h2: 'H2',
  h3: 'H3',
  paragraph: 'P',
  table: 'TABLE'
};

const INSERT_TYPES: { type: BlockType; label: string }[] = [
  { type: 'h1', label: '＋ h1' },
  { type: 'h2', label: '＋ h2' },
  { type: 'h3', label: '＋ h3' },
  { type: 'paragraph', label: '＋ ¶' },
  { type: 'table', label: '＋ table' }
];

/**
 * Replace `spec.formula` on every token inline (across every section, block,
 * and cell) whose value key matches `key`. Formula editing lives only in this
 * panel — nowhere in the live document can a formula be typed — so this is
 * the sole writer of `spec.formula`.
 */
const setFormulaForValueKey =
  (key: string, formula: string) =>
  (data: DocumentData): DocumentData => {
    const replaceInline = (inline: Inline): Inline =>
      inline.kind === 'token' && valueKey(inline.spec) === key
        ? { ...inline, spec: { ...inline.spec, formula } }
        : inline;

    return {
      ...data,
      sections: data.sections.map((section) => ({
        ...section,
        blocks: section.blocks.map((block) =>
          block.rows
            ? {
                ...block,
                rows: block.rows.map((row) =>
                  row.map((cell) => ({
                    ...cell,
                    content: cell.content.map(replaceInline)
                  }))
                )
              }
            : {
                ...block,
                content: (block.content ?? []).map(replaceInline)
              }
        )
      }))
    };
  };

const TokenChip = ({
  inline,
  onFormulaEdit
}: {
  inline: Inline & { kind: 'token' };
  onFormulaEdit: (key: string, formula: string) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const computed = Boolean(inline.spec.formula);
  const label = computed ? `${inline.spec.id} ƒ` : inline.spec.id;

  return (
    <span>
      <span
        style={{ ...styles.chip, ...(computed ? styles.computedChip : {}) }}
        onClick={computed ? () => setEditing(true) : undefined}
      >
        {label}
      </span>
      {editing && (
        <form
          style={styles.formulaForm}
          onSubmit={(e) => {
            e.preventDefault();
            const value = (
              e.currentTarget.elements.namedItem('formula') as HTMLInputElement
            ).value;
            onFormulaEdit(valueKey(inline.spec), value);
            setEditing(false);
          }}
        >
          <input
            name='formula'
            style={styles.cellInput}
            defaultValue={inline.spec.formula ?? ''}
            aria-label={`${inline.spec.id} formula`}
          />
          <button type='submit' style={styles.smallButton}>
            Save
          </button>
        </form>
      )}
    </span>
  );
};

// Content edits (paragraph text, table cell text) commit on blur or after
// this much idle time, whichever comes first — one apply/undo entry per
// pause in typing, not per keystroke. Insert/delete/formula edits stay
// immediate; they are discrete actions, not prose.
const CONTENT_EDIT_DEBOUNCE_MS = 500;

/**
 * Local-state buffer for a text field whose real commit (`onCommit`) is
 * debounced. Keeps the input responsive to every keystroke while only
 * calling `onCommit` on blur or after the idle delay — never both for the
 * same edit (blur cancels the pending timer first).
 */
const useDebouncedText = (value: string, onCommit: (value: string) => void) => {
  const [local, setLocal] = useState(value);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  // Only resync from the external value while the user isn't mid-edit —
  // otherwise a store update elsewhere (undo, sync) would clobber what they
  // just typed before their own debounce/blur commits it.
  useEffect(() => {
    if (!dirtyRef.current) setLocal(value);
  }, [value]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const onChange = (next: string) => {
    dirtyRef.current = true;
    setLocal(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      dirtyRef.current = false;
      commitRef.current(next);
    }, CONTENT_EDIT_DEBOUNCE_MS);
  };

  const onBlur = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (dirtyRef.current) {
      dirtyRef.current = false;
      commitRef.current(local);
    }
  };

  return { value: local, onChange, onBlur };
};

const DebouncedTextarea = ({
  value,
  onCommit,
  style
}: {
  value: string;
  onCommit: (value: string) => void;
  style?: React.CSSProperties;
}) => {
  const field = useDebouncedText(value, onCommit);
  return (
    <textarea
      style={style}
      value={field.value}
      onChange={(e) => field.onChange(e.target.value)}
      onBlur={field.onBlur}
    />
  );
};

const DebouncedCellInput = ({
  value,
  onCommit,
  style
}: {
  value: string;
  onCommit: (value: string) => void;
  style?: React.CSSProperties;
}) => {
  const field = useDebouncedText(value, onCommit);
  return (
    <input
      style={style}
      value={field.value}
      onChange={(e) => field.onChange(e.target.value)}
      onBlur={field.onBlur}
    />
  );
};

const ParagraphBlock = ({
  block,
  onEdit,
  onFormulaEdit
}: {
  block: Block;
  onEdit: (content: Inline[]) => void;
  onFormulaEdit: (key: string, formula: string) => void;
}) => {
  const content = block.content ?? [];
  return (
    <>
      {content.map((inline, i) =>
        inline.kind === 'text' ? (
          <DebouncedTextarea
            key={i}
            style={styles.textarea}
            value={inline.text}
            onCommit={(text) => {
              const next = [...content];
              next[i] = { kind: 'text', text };
              onEdit(next);
            }}
          />
        ) : (
          <TokenChip key={i} inline={inline} onFormulaEdit={onFormulaEdit} />
        )
      )}
    </>
  );
};

const TableBlock = ({
  block,
  onEditCell,
  onFormulaEdit
}: {
  block: Block;
  onEditCell: (row: number, col: number, content: Inline[]) => void;
  onFormulaEdit: (key: string, formula: string) => void;
}) => (
  <table style={styles.table}>
    <tbody>
      {(block.rows ?? []).map((row, ri) => (
        <tr key={ri}>
          {row.map((cell, ci) => {
            const onlyText =
              cell.content.length === 1 && cell.content[0].kind === 'text';
            return (
              <td key={ci}>
                {onlyText ? (
                  <DebouncedCellInput
                    style={styles.cellInput}
                    value={
                      (cell.content[0] as { kind: 'text'; text: string }).text
                    }
                    onCommit={(text) =>
                      onEditCell(ri, ci, [{ kind: 'text', text }])
                    }
                  />
                ) : (
                  cell.content.map((inline, i) =>
                    inline.kind === 'token' ? (
                      <TokenChip
                        key={i}
                        inline={inline}
                        onFormulaEdit={onFormulaEdit}
                      />
                    ) : (
                      <span key={i}>{inline.text}</span>
                    )
                  )
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </tbody>
  </table>
);

const BlockCard = ({
  sectionId,
  block,
  store
}: {
  sectionId: string;
  block: Block;
  store: BlockStore;
}) => {
  const onFormulaEdit = (key: string, formula: string) =>
    store.apply(setFormulaForValueKey(key, formula), 'panel');

  return (
    <div style={styles.card} data-testid='docx-block-card'>
      <div style={styles.badge}>{TYPE_BADGE[block.type]}</div>

      {block.type === 'table' ? (
        <TableBlock
          block={block}
          onEditCell={(row, col, content) =>
            store.apply(updateCell(block.id, row, col, content), 'panel')
          }
          onFormulaEdit={onFormulaEdit}
        />
      ) : (
        <ParagraphBlock
          block={block}
          onEdit={(content) =>
            store.apply(updateBlockContent(block.id, content), 'panel')
          }
          onFormulaEdit={onFormulaEdit}
        />
      )}

      <div style={styles.footerRow}>
        {INSERT_TYPES.map(({ type, label }) => (
          <button
            key={type}
            type='button'
            style={styles.smallButton}
            onClick={() =>
              store.apply(
                insertBlock(
                  sectionId,
                  block.id,
                  type,
                  freshId(store.getData())
                ),
                'panel'
              )
            }
          >
            {label}
          </button>
        ))}
        <button
          type='button'
          style={styles.smallButton}
          onClick={() => store.apply(deleteBlock(block.id), 'panel')}
        >
          ✕ delete
        </button>
      </div>
    </div>
  );
};

export default function BlockPanel({ store }: { store: BlockStore }) {
  const [data, setData] = useState<DocumentData>(() => store.getData());

  useEffect(() => store.subscribe(setData), [store]);

  return (
    <div style={styles.panel} data-testid='docx-block-panel'>
      <div style={styles.heading}>
        <span>Blocks</span>
        <div style={styles.historyButtons}>
          <button
            type='button'
            style={styles.smallButton}
            disabled={!store.canUndo()}
            onClick={() => store.undo()}
          >
            Undo
          </button>
          <button
            type='button'
            style={styles.smallButton}
            disabled={!store.canRedo()}
            onClick={() => store.redo()}
          >
            Redo
          </button>
        </div>
      </div>

      {data.sections.map((section) => (
        <div key={section.id}>
          <div style={styles.sectionLabel}>{section.id}</div>
          {section.blocks.map((block) => (
            <BlockCard
              key={block.id}
              sectionId={section.id}
              block={block}
              store={store}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
