import React from 'react';

interface ViewerHeaderProps {
  title: string;
  onBack: () => void;
  onReset: () => void;
  onDownload: () => void;
  onSaveDraft?: () => void;
  onPrimary: () => void;
  primaryLabel: string; // 'Sign' | 'Submit'
  busy: boolean;
}

export default function ViewerHeader({
  title,
  onBack,
  onReset,
  onDownload,
  onSaveDraft,
  onPrimary,
  primaryLabel,
  busy
}: ViewerHeaderProps) {
  return (
    <header
      css={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '12px 24px',
        backgroundColor: '#333849',
        color: 'white'
      }}
    >
      <button type='button' onClick={onBack} aria-label='Back' css={buttonCss}>
        ←
      </button>
      <div css={{ flex: 1, fontWeight: 600 }}>{title}</div>
      <button type='button' onClick={onReset} disabled={busy} css={buttonCss}>
        Reset
      </button>
      <button
        type='button'
        onClick={onDownload}
        disabled={busy}
        css={buttonCss}
      >
        Download
      </button>
      {onSaveDraft && (
        <button
          type='button'
          onClick={onSaveDraft}
          disabled={busy}
          css={buttonCss}
        >
          Save Draft
        </button>
      )}
      <button
        type='button'
        onClick={onPrimary}
        disabled={busy}
        css={{
          ...buttonCss,
          backgroundColor: '#0ac769',
          borderColor: '#0ac769'
        }}
      >
        {busy ? 'Working…' : primaryLabel}
      </button>
    </header>
  );
}

const buttonCss = {
  padding: '8px 16px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.3)',
  background: 'transparent',
  color: 'white',
  cursor: 'pointer',
  '&:hover:not(:disabled)': { background: 'rgba(255,255,255,0.1)' },
  '&:disabled': { opacity: 0.5, cursor: 'default' }
} as const;
