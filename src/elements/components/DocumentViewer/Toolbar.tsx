import React from 'react';
import { color, fontSize } from './tokens';
import {
  primaryButtonCss,
  secondaryButtonCss,
  iconButtonCss
} from './buttonStyles';
import { ChevronLeftIcon, SpinnerIcon } from './icons';

export interface ToolbarAction {
  // Stable id used to show the spinner on the in-flight action.
  key: string;
  label: string;
  variant?: 'primary' | 'secondary';
  onClick: () => void;
}

export interface ToolbarProps {
  title: string;
  onBack: () => void;
  // Right-aligned actions, rendered in order (primary last / rightmost). The
  // Generate Documents review flow supplies Sign / Save as Draft / Download /
  // Continue / Save depending on the action config.
  actions: ToolbarAction[];
  // Key of the action currently running: that button shows a spinner and all
  // actions are disabled. null when idle.
  busyKey: string | null;
}

export default function Toolbar({
  title,
  onBack,
  actions,
  busyKey
}: ToolbarProps) {
  const busy = busyKey !== null;
  return (
    <header
      css={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        height: 56,
        padding: '0 16px',
        backgroundColor: color.surface,
        borderBottom: `1px solid ${color.border}`,
        flexShrink: 0
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
        <button
          type='button'
          aria-label='Back'
          onClick={onBack}
          css={iconButtonCss}
        >
          <ChevronLeftIcon size={20} />
        </button>
        <span
          css={{
            fontWeight: 600,
            fontSize: fontSize.lg,
            color: color.text,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {title}
        </span>
      </div>
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          justifyContent: 'flex-end'
        }}
      >
        {actions.map((action) => (
          <button
            key={action.key}
            type='button'
            disabled={busy}
            onClick={action.onClick}
            css={
              action.variant === 'primary'
                ? primaryButtonCss
                : secondaryButtonCss
            }
          >
            {busyKey === action.key && <SpinnerIcon size={16} />}
            {action.label}
          </button>
        ))}
      </div>
    </header>
  );
}
