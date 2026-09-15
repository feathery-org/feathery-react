import React from 'react';
import ChangeChip from './ChangeChip';
import { ChipView, GroupView } from './types';
import {
  CARD_SHADOW,
  INK,
  INK_2,
  INK_3,
  LINE,
  PAPER,
  groupPrimaryBtn,
  groupSecondaryBtn
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

// Chevron width + gap; the subtitle is indented by this so it lines up under
// the title, not under the chevron.
const TITLE_INDENT = 20;

interface Props {
  group: GroupView;
  /** Registers the card element so the rail can scroll its header into view. */
  cardRef: (el: HTMLDivElement | null) => void;
  isOpen: boolean;
  onToggle: () => void;
  /** Navigate the document to the group's first edit without expanding. */
  onNavigateFirst: () => void;
  /** The document's active edit(s); matching chips tint. */
  activeRevisions: Set<any>;
  /** Row-element registrar per chip (scroll-into-view bookkeeping). */
  chipRef: (chip: ChipView) => (el: HTMLDivElement | null) => void;
  onFocusChip: (chip: ChipView) => void;
  onResolveGroup: (isAccept: boolean) => void;
  onResolveChips: (chips: ChipView[], isAccept: boolean) => void;
}

// One accept group (A2 layout): the chevron (left of the title) toggles the
// chip list; the title navigates without expanding; the author sits on a line
// under the title; group Accept/Reject sit at the top-right.
export default function GroupCard({
  group,
  cardRef,
  isOpen,
  onToggle,
  onNavigateFirst,
  activeRevisions,
  chipRef,
  onFocusChip,
  onResolveGroup,
  onResolveChips
}: Props) {
  const count = group.chips.length;
  return (
    <div
      ref={cardRef}
      css={{
        position: 'relative',
        flex: 'none',
        background: PAPER,
        border: `1px solid ${LINE}`,
        borderRadius: 12,
        boxShadow: CARD_SHADOW,
        overflow: 'hidden'
      }}
    >
      <div
        css={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          padding: '14px 14px 12px'
        }}
      >
        <div css={{ minWidth: 0, flex: 1 }}>
          {/* Line 1: chevron (left of the title), aligned to the title row. */}
          <div
            css={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}
          >
            <button
              type='button'
              aria-expanded={isOpen}
              aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${group.title}`}
              onClick={onToggle}
              css={{
                flex: 'none',
                width: 14,
                height: 14,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                background: 'none',
                padding: 0,
                color: INK_3,
                cursor: 'pointer',
                transform: isOpen ? 'rotate(90deg)' : 'none',
                transition: 'transform 0.18s ease'
              }}
            >
              {caretSvg}
            </button>
            <button
              type='button'
              aria-label={`Go to ${group.title}`}
              onClick={onNavigateFirst}
              css={{
                flex: 1,
                minWidth: 0,
                border: 'none',
                background: 'none',
                padding: 0,
                textAlign: 'left',
                font: 'inherit',
                color: INK,
                fontSize: 13.5,
                fontWeight: 600,
                lineHeight: 1.3,
                cursor: 'pointer',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                '&:hover': { textDecoration: 'underline' }
              }}
            >
              {group.title}
            </button>
          </div>
          {/* Line 2: "N changes · Author", under the title. */}
          <div
            css={{
              marginTop: 3,
              paddingLeft: TITLE_INDENT,
              fontSize: 12,
              lineHeight: 1.3,
              color: INK_3,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            <span css={{ color: INK_2 }}>
              {`${count} ${count === 1 ? 'change' : 'changes'}`}
            </span>
            {group.author && (
              <>
                <span>{' · '}</span>
                <span css={{ fontWeight: 600 }}>{group.author}</span>
              </>
            )}
          </div>
        </div>
        <div css={{ display: 'flex', gap: 8, flex: 'none' }}>
          <button
            type='button'
            css={groupPrimaryBtn}
            onClick={() => onResolveGroup(true)}
          >
            Accept
          </button>
          <button
            type='button'
            css={groupSecondaryBtn}
            onClick={() => onResolveGroup(false)}
          >
            Reject
          </button>
        </div>
      </div>
      {isOpen && (
        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: '0 12px 10px'
          }}
        >
          {group.chips.map((chip, index) => (
            <ChangeChip
              key={index}
              chip={chip}
              isActive={
                activeRevisions.has(chip.revision) ||
                activeRevisions.has(chip.partner)
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
