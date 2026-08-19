import React from 'react';
import { CheckIcon, CloseIcon, SpinnerIcon } from '../icons';
import { INK, INK_3, LINE, MONO, PANEL_3, btn, rejectBtn } from './styles';

// Shared by both bulk buttons: fixed icon slot so the spinner swap doesn't
// resize them.
const bulkBtn = {
  height: 29,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 5
} as const;

interface Props {
  pendingCount: number;
  /** Collapses the rail; omitted when the host owns no drawer state. */
  onHide?: () => void;
  onResolveAll: (isAccept: boolean) => void;
  /** Which bulk action is running, if any - disables both buttons and swaps
   *  the running one's label icon for a spinner, same as the toolbar's Save
   *  button while autosaving. */
  resolvingAll?: 'accept' | 'reject' | null;
}

// Rail head: title, pending counter, bulk actions.
export default function RailHead({
  pendingCount,
  onHide,
  onResolveAll,
  resolvingAll
}: Props) {
  return (
    <div
      css={{
        padding: '14px 14px 12px',
        borderBottom: `1px solid ${LINE}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        flex: '0 0 auto'
      }}
    >
      <div css={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div css={{ fontWeight: 650, fontSize: 13 }}>Suggested changes</div>
        <em
          css={{
            fontFamily: MONO,
            fontSize: 10.5,
            fontStyle: 'normal',
            color: INK_3
          }}
        >
          {`${pendingCount} pending`}
        </em>
        {onHide && (
          <button
            type='button'
            aria-label='Hide suggested changes'
            title='Hide suggested changes'
            onClick={onHide}
            css={{
              marginLeft: 'auto',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              padding: 2,
              borderRadius: 4,
              fontSize: 12,
              lineHeight: 1,
              color: INK_3,
              '&:hover': { background: PANEL_3, color: INK }
            }}
          >
            ✕
          </button>
        )}
      </div>
      <div css={{ display: 'flex', gap: 6 }}>
        <button
          type='button'
          css={{ ...btn, ...bulkBtn }}
          disabled={!!resolvingAll}
          onClick={() => onResolveAll(true)}
        >
          {resolvingAll === 'accept' ? (
            <SpinnerIcon width={11} height={11} />
          ) : (
            <CheckIcon width={12} height={12} />
          )}
          Accept all
        </button>
        <button
          type='button'
          css={{ ...rejectBtn, ...bulkBtn }}
          disabled={!!resolvingAll}
          onClick={() => onResolveAll(false)}
        >
          {resolvingAll === 'reject' ? (
            <SpinnerIcon width={11} height={11} />
          ) : (
            <CloseIcon width={12} height={12} />
          )}
          Reject all
        </button>
      </div>
    </div>
  );
}
