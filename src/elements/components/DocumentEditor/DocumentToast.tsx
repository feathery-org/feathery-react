import React from 'react';
import { CheckIcon, CloseIcon } from '../DocxEditor/icons';

export default function DocumentToast({
  message,
  type = 'success'
}: {
  message: string;
  type?: 'success' | 'error' | 'info';
}) {
  return (
    <div
      role='status'
      aria-label='Document notification'
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      css={{
        position: 'absolute',
        bottom: 40,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 356,
        maxWidth: 'calc(100% - 32px)',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '12px 36px',
        borderRadius: 6,
        background: '#fff',
        color: '#27272a',
        border: '1px solid #e4e4e7',
        fontSize: 14,
        fontWeight: 400,
        lineHeight: 1.4,
        boxShadow:
          '0 0 0 1px rgb(0 9 50 / 3%), 0 12px 32px -16px rgb(0 9 50 / 12%)',
        zIndex: 20,
        pointerEvents: 'none'
      }}
    >
      {type === 'success' && (
        <CheckIcon
          width={16}
          height={16}
          css={{
            position: 'absolute',
            left: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            color: '#10b981'
          }}
        />
      )}
      {type === 'error' && (
        <CloseIcon
          width={16}
          height={16}
          css={{
            position: 'absolute',
            left: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            color: '#ef4444'
          }}
        />
      )}
      {message}
    </div>
  );
}
