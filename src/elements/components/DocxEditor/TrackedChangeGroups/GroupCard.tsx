import React from 'react';
import ChangeChip from './ChangeChip';
import { ChipView, GroupView } from './types';
import {
  CARD_SHADOW,
  INK_3,
  LINE,
  MONO,
  PANEL_2,
  PAPER,
  btn,
  rejectBtn
} from './styles';

const caretSvg = (
  <svg width='11' height='11' viewBox='0 0 16 16' fill='none' aria-hidden>
    <path
      d='M6 3.5 10.5 8 6 12.5'
      stroke='currentColor'
      strokeWidth='1.8'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

interface Props {
  group: GroupView;
  isOpen: boolean;
  onToggle: () => void;
  /** The document's active edit; the matching chip rings and shows actions. */
  activeRevision: any;
  /** Row-element registrar per chip (scroll-into-view bookkeeping). */
  chipRef: (chip: ChipView) => (el: HTMLDivElement | null) => void;
  onFocusChip: (chip: ChipView) => void;
  onResolveGroup: (isAccept: boolean) => void;
  onResolveChips: (chips: ChipView[], isAccept: boolean) => void;
}

// One accept group: expandable header with tally, group-wide Accept/Reject,
// and — while open — the chip list joined by a spine.
export default function GroupCard({
  group,
  isOpen,
  onToggle,
  activeRevision,
  chipRef,
  onFocusChip,
  onResolveGroup,
  onResolveChips
}: Props) {
  return (
    <div
      css={{
        position: 'relative',
        flex: 'none',
        background: PAPER,
        border: `1px solid ${LINE}`,
        borderRadius: 10,
        boxShadow: CARD_SHADOW,
        overflow: 'hidden'
      }}
    >
      <button
        type='button'
        aria-expanded={isOpen}
        aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${group.title}`}
        onClick={onToggle}
        css={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: '11px 11px 11px 10px',
          width: '100%',
          border: 'none',
          background: 'none',
          textAlign: 'left',
          font: 'inherit',
          color: 'inherit',
          cursor: 'pointer',
          '&:hover': { background: PANEL_2 }
        }}
      >
        <span
          aria-hidden
          css={{
            flex: 'none',
            marginTop: 2,
            color: INK_3,
            display: 'inline-flex',
            transform: isOpen ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.18s ease'
          }}
        >
          {caretSvg}
        </span>
        <span
          css={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'baseline',
            gap: 7
          }}
        >
          <b css={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.35 }}>
            {group.title}
          </b>
          <span
            css={{
              flex: 'none',
              fontFamily: MONO,
              fontSize: 10,
              color: INK_3,
              background: PANEL_2,
              border: `1px solid ${LINE}`,
              borderRadius: 99,
              padding: '1px 6px',
              whiteSpace: 'nowrap'
            }}
          >
            {`${group.chips.length} ${
              group.chips.length === 1 ? 'edit' : 'edits'
            }`}
          </span>
        </span>
      </button>
      <div css={{ display: 'flex', gap: 6, padding: '0 11px 10px 31px' }}>
        <button type='button' css={btn} onClick={() => onResolveGroup(true)}>
          Accept {group.chips.length}
        </button>
        <button
          type='button'
          css={rejectBtn}
          onClick={() => onResolveGroup(false)}
        >
          Reject {group.chips.length}
        </button>
      </div>
      {isOpen && (
        <div
          css={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '2px 11px 13px 31px'
          }}
        >
          {/* Spine descending from the caret through the chips. */}
          <span
            aria-hidden
            css={{
              position: 'absolute',
              left: 15,
              top: -4,
              bottom: 13,
              width: 1,
              background: LINE
            }}
          />
          {group.chips.map((chip, index) => (
            <ChangeChip
              key={index}
              chip={chip}
              isActive={
                !!activeRevision &&
                (chip.revision === activeRevision ||
                  chip.partner === activeRevision)
              }
              rowRef={chipRef(chip)}
              onFocus={() => onFocusChip(chip)}
              onResolve={(isAccept) => onResolveChips([chip], isAccept)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
