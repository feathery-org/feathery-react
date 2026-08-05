import React from 'react';
import { INK, INK_3, LINE, PANEL, PANEL_2 } from './styles';

// Bookmark-tab handle, shown only while the rail is collapsed (its ✕ closes
// the panel). Overlaid, so it consumes no layout width.
export default function BookmarkTab({ onExpand }: { onExpand: () => void }) {
  return (
    <button
      aria-label='Expand suggested changes'
      aria-expanded={false}
      title='Expand suggested changes'
      onClick={onExpand}
      css={{
        position: 'absolute',
        left: -26,
        top: 24,
        width: 26,
        height: 56,
        border: `1px solid ${LINE}`,
        borderRight: 'none',
        borderRadius: '8px 0 0 8px',
        background: PANEL,
        boxShadow: '-2px 0 4px rgba(0, 0, 0, 0.06)',
        cursor: 'pointer',
        padding: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 14,
        color: INK_3,
        zIndex: 1,
        '&:hover': { background: PANEL_2, color: INK }
      }}
    >
      ‹
    </button>
  );
}
