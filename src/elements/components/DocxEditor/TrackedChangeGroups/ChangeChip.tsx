import React from 'react';
import { ChipView } from './types';
import {
  ACCENT_LINE,
  ACCENT_WASH,
  ADD,
  ADD_WASH,
  CARD_SHADOW,
  DEL,
  DEL_WASH,
  INK_2,
  INK_3,
  LINE,
  MOD,
  MOD_WASH,
  MONO,
  PANEL_2,
  PANEL_3,
  PAPER,
  btn,
  rejectBtn
} from './styles';

const badgeOf = (revisionType: string) => {
  if (revisionType === 'Insertion' || revisionType === 'MoveTo')
    return { label: 'Added', color: ADD, background: ADD_WASH };
  if (revisionType === 'Deletion' || revisionType === 'MoveFrom')
    return { label: 'Removed', color: DEL, background: DEL_WASH };
  if (revisionType === 'Replace')
    return { label: 'Replaced', color: MOD, background: MOD_WASH };
  return { label: 'Edit', color: INK_2, background: PANEL_3 };
};

// The −/+ rows a chip's diff shows.
const diffRowsOf = (chip: ChipView) => {
  const rows: Array<{ sign: '−' | '+'; text: string; del: boolean }> = [];
  if (chip.revisionType === 'Replace') {
    rows.push({ sign: '−', text: chip.beforeText ?? '', del: true });
    rows.push({ sign: '+', text: chip.text, del: false });
  } else if (
    chip.revisionType === 'Deletion' ||
    chip.revisionType === 'MoveFrom'
  ) {
    rows.push({ sign: '−', text: chip.text, del: true });
  } else {
    rows.push({ sign: '+', text: chip.text, del: false });
  }
  return rows;
};

interface Props {
  chip: ChipView;
  /** This chip is the document's active edit: ringed, own actions shown. */
  isActive: boolean;
  /** Registers the row element so the rail can scroll the active chip into
   *  view. */
  rowRef: (el: HTMLDivElement | null) => void;
  onFocus: () => void;
  onResolve: (isAccept: boolean) => void;
}

// One edit: type badge + author, −/+ diff rows, and — while active — its own
// Accept/Reject pair.
export default function ChangeChip({
  chip,
  isActive,
  rowRef,
  onFocus,
  onResolve
}: Props) {
  const badge = badgeOf(chip.revisionType);
  return (
    <div
      role='button'
      tabIndex={0}
      ref={rowRef}
      onClick={onFocus}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onFocus();
        }
      }}
      aria-current={isActive || undefined}
      css={{
        position: 'relative',
        background: PAPER,
        border: `1px solid ${isActive ? ACCENT_LINE : LINE}`,
        borderRadius: 9,
        padding: '9px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        cursor: 'pointer',
        boxShadow: isActive
          ? `0 0 0 3px ${ACCENT_WASH}, ${CARD_SHADOW}`
          : undefined,
        '&:hover': { background: PANEL_2 }
      }}
    >
      {/* Connector from the group's spine to this chip. */}
      <span
        aria-hidden
        css={{
          position: 'absolute',
          left: -16,
          top: 18,
          width: 12,
          height: 1,
          background: LINE
        }}
      />
      <div css={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span
          css={{
            flex: 'none',
            fontFamily: MONO,
            fontSize: 9.5,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            fontWeight: 600,
            padding: '1.5px 6px',
            borderRadius: 4,
            color: badge.color,
            background: badge.background
          }}
        >
          {badge.label}
        </span>
        {chip.author && (
          <span
            css={{
              fontSize: 10.5,
              color: INK_3,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              minWidth: 0
            }}
          >
            {chip.author}
          </span>
        )}
      </div>
      <div
        css={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          fontFamily: MONO,
          fontSize: 11,
          lineHeight: 1.55
        }}
      >
        {diffRowsOf(chip).map((row, rowIndex) => (
          <div
            key={rowIndex}
            css={{
              display: 'flex',
              gap: 7,
              padding: '3px 7px',
              borderRadius: 5,
              background: row.del ? DEL_WASH : ADD_WASH,
              color: row.del ? DEL : ADD
            }}
          >
            <span css={{ flex: 'none', fontWeight: 700, opacity: 0.8 }}>
              {row.sign}
            </span>
            <span
              css={{
                minWidth: 0,
                overflowWrap: 'anywhere',
                ...(row.text ? {} : { fontStyle: 'italic', color: INK_3 })
              }}
            >
              {row.text || 'Structural change'}
            </span>
          </div>
        ))}
      </div>
      {isActive && (
        <div css={{ display: 'flex', gap: 6 }}>
          <button
            type='button'
            aria-label='Accept this edit'
            css={{ ...btn, height: 26 }}
            onClick={(event) => {
              event.stopPropagation();
              onResolve(true);
            }}
          >
            Accept
          </button>
          <button
            type='button'
            aria-label='Reject this edit'
            css={{ ...rejectBtn, height: 26 }}
            onClick={(event) => {
              event.stopPropagation();
              onResolve(false);
            }}
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
