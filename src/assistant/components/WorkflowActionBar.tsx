import { useState } from 'react';

import { ChatColors, GRAY_50, GRAY_200 } from '../colors';
import type { WorkflowAction } from '../types';

type WorkflowActionBarProps = {
  actions: WorkflowAction[];
  disabled: boolean;
  onAction: (action: WorkflowAction) => void;
  colors: ChatColors;
};

const WorkflowActionBar = ({
  actions,
  disabled,
  onAction,
  colors
}: WorkflowActionBarProps) => {
  const [tooltip, setTooltip] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);

  if (actions.length === 0) return null;

  return (
    <div
      css={{
        position: 'relative',
        zIndex: 1,
        borderTop: `1px solid ${GRAY_200}`,
        backgroundColor: GRAY_50,
        padding: '8px 16px',
        display: 'flex',
        gap: '6px',
        overflowX: 'auto'
      }}
    >
      {actions.map((action, index) => (
        <button
          key={index}
          type='button'
          disabled={disabled}
          onClick={() => onAction(action)}
          onMouseEnter={(e: React.MouseEvent) => {
            if (!action.description) return;
            const r = e.currentTarget.getBoundingClientRect();
            setTooltip({
              text: action.description,
              x: r.left + r.width / 2,
              y: r.top
            });
          }}
          onMouseLeave={() => setTooltip(null)}
          css={{
            flexShrink: 0,
            padding: '4px 10px',
            fontSize: '12px',
            border: `1px solid ${colors.primary}`,
            borderRadius: '12px',
            backgroundColor: 'white',
            color: colors.primary,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            ':disabled': { opacity: 0.5, cursor: 'not-allowed' },
            ':hover:not(:disabled)': { backgroundColor: colors.light },
            transition: 'background-color 0.15s, color 0.15s'
          }}
        >
          {action.name}
        </button>
      ))}
      {tooltip && (
        <div
          css={{
            position: 'fixed',
            top: tooltip.y - 34,
            left: tooltip.x,
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(0,0,0,0.9)',
            color: 'white',
            fontSize: '12px',
            padding: '4px 8px',
            borderRadius: '4px',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 10000
          }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
};

export default WorkflowActionBar;
