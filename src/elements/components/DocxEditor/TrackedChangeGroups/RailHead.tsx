import React from 'react';
import { INK, INK_3, LINE, MONO, PANEL_3, btn, rejectBtn } from './styles';

interface Props {
  pendingCount: number;
  /** Collapses the rail; omitted when the host owns no drawer state. */
  onHide?: () => void;
  onResolveAll: (isAccept: boolean) => void;
}

// Rail head: title, pending counter, bulk actions.
export default function RailHead({
  pendingCount,
  onHide,
  onResolveAll
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
        <button css={{ ...btn, height: 29 }} onClick={() => onResolveAll(true)}>
          Accept all
        </button>
        <button
          css={{ ...rejectBtn, height: 29 }}
          onClick={() => onResolveAll(false)}
        >
          Reject all
        </button>
      </div>
    </div>
  );
}
