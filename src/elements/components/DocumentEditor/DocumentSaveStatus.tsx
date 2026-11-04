import React from 'react';

/** Unsaved status immediately before Save. Container queries respond to
 * embedded editor width, including when the surrounding page stays wide. */
export default function DocumentSaveStatus({
  dirty,
  compact = false
}: {
  dirty?: boolean;
  compact?: boolean;
}) {
  if (!dirty) return null;
  const label = 'Unsaved changes';
  return (
    <span
      role='status'
      aria-live='polite'
      aria-label={label}
      title={label}
      css={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 6,
        flex: '0 0 auto',
        width: compact ? 14 : 'auto',
        fontSize: 12,
        color: '#71717a',
        whiteSpace: 'nowrap',
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
          color: '#e63b54'
        }}
      >
        ●
      </span>
      {!compact && (
        <span className='document-status-label' aria-hidden='true'>
          {label}
        </span>
      )}
    </span>
  );
}
