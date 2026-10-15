import React from 'react';

/** A stable status slot immediately before Save. Container queries respond to
 * embedded editor width, including when the surrounding page stays wide. */
export default function DocumentSaveStatus({
  message,
  dirty,
  compact = false
}: {
  message?: string;
  dirty?: boolean;
  compact?: boolean;
}) {
  const label = dirty ? 'Unsaved changes' : message;
  return (
    <span
      role='status'
      aria-live='polite'
      aria-label={label}
      aria-hidden={!label}
      title={label}
      css={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 6,
        flex: '0 0 auto',
        width: compact ? 14 : 166,
        fontSize: 12,
        color: dirty ? '#71717a' : '#15803d',
        whiteSpace: 'nowrap',
        visibility: label ? 'visible' : 'hidden',
        '@container document-editor (max-width: 560px)': {
          width: 14,
          '& .document-status-label': { display: 'none' }
        }
      }}
    >
      <span
        aria-hidden='true'
        css={{
          width: 14,
          textAlign: 'center',
          color: dirty ? '#e63b54' : 'inherit'
        }}
      >
        {dirty ? '●' : '✓'}
      </span>
      {!compact && (
        <span className='document-status-label' aria-hidden='true'>
          {label || 'Unsaved changes'}
        </span>
      )}
    </span>
  );
}
