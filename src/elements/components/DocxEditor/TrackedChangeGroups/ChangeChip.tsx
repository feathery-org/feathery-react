import React from 'react';
import { CheckIcon, CloseIcon } from '../icons';
import { ChipView } from './types';
import {
  ADD,
  ADD_WASH,
  DEL,
  DEL_WASH,
  INK_3,
  MOD,
  MOD_WASH,
  MONO,
  PANEL,
  PANEL_2,
  PANEL_3,
  rowAcceptBtn,
  rowRejectBtn
} from './styles';

const badgeOf = (revisionType: string) => {
  if (revisionType === 'Insertion' || revisionType === 'MoveTo')
    return { label: 'Added', color: ADD, background: ADD_WASH };
  if (revisionType === 'Deletion' || revisionType === 'MoveFrom')
    return { label: 'Removed', color: DEL, background: DEL_WASH };
  if (revisionType === 'Replace')
    return { label: 'Replaced', color: MOD, background: MOD_WASH };
  return { label: 'Edit', color: INK_3, background: PANEL_3 };
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
  /** This chip is the document's active edit: subtly tinted (no border). */
  isActive: boolean;
  /** Registers the row element so the rail can scroll the active chip into
   *  view. */
  rowRef: (el: HTMLDivElement | null) => void;
  onFocus: () => void;
  onResolve: (isAccept: boolean) => void;
}

// One edit (A2 layout): a type badge and its −/+ diff on the left, its own
// Accept/Reject on the right. No border around the row — an active edit is
// shown by a faint background tint instead.
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
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 8px',
        borderRadius: 8,
        background: isActive ? PANEL_2 : 'transparent',
        cursor: 'pointer',
        '&:hover': { background: isActive ? PANEL_2 : PANEL }
      }}
    >
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flex: 1,
          minWidth: 0
        }}
      >
        <span
          css={{
            flex: 'none',
            fontFamily: MONO,
            fontSize: 9.5,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            fontWeight: 700,
            padding: '2px 6px',
            borderRadius: 4,
            color: badge.color,
            background: badge.background
          }}
        >
          {badge.label}
        </span>
        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            flex: 1,
            minWidth: 0
          }}
        >
          {diffRowsOf(chip).map((row, rowIndex) => (
            <div
              key={rowIndex}
              css={{
                display: 'flex',
                gap: 6,
                alignItems: 'baseline',
                padding: '2px 8px',
                borderRadius: 5,
                fontFamily: MONO,
                fontSize: 12,
                fontStyle: 'italic',
                lineHeight: 1.5,
                background: row.del ? DEL_WASH : ADD_WASH,
                color: row.del ? DEL : ADD
              }}
            >
              <span css={{ flex: 'none', fontWeight: 700 }}>{row.sign}</span>
              <span
                css={{
                  minWidth: 0,
                  overflowWrap: 'anywhere',
                  ...(row.text ? {} : { color: INK_3 })
                }}
              >
                {row.text || 'Structural change'}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div css={{ display: 'flex', gap: 2, flex: 'none' }}>
        <button
          type='button'
          aria-label='Accept this edit'
          css={rowAcceptBtn}
          onClick={(event) => {
            event.stopPropagation();
            onResolve(true);
          }}
        >
          <CheckIcon width={14} height={14} />
        </button>
        <button
          type='button'
          aria-label='Reject this edit'
          css={rowRejectBtn}
          onClick={(event) => {
            event.stopPropagation();
            onResolve(false);
          }}
        >
          <CloseIcon width={14} height={14} />
        </button>
      </div>
    </div>
  );
}
