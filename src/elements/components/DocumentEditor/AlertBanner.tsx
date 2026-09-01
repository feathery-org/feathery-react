import React from 'react';
import { AlertIcon, CloseIcon } from './icons';
import { color, fontSize } from './tokens';

interface AlertBannerProps {
  message: string;
  onDismiss?: () => void;
}

export default function AlertBanner({ message, onDismiss }: AlertBannerProps) {
  return (
    <div
      role='alert'
      css={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 24px',
        backgroundColor: color.errorBg,
        color: color.errorText,
        fontSize: fontSize.base
      }}
    >
      <AlertIcon size={16} />
      <span css={{ flex: 1 }}>{message}</span>
      {onDismiss && (
        <button
          type='button'
          aria-label='Dismiss'
          onClick={onDismiss}
          css={{
            display: 'inline-flex',
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
            padding: 4
          }}
        >
          <CloseIcon size={14} />
        </button>
      )}
    </div>
  );
}
