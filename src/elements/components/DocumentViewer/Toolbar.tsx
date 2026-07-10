import React, { useEffect, useRef, useState } from 'react';
import { color, fontSize, radius, shadow } from './tokens';
import {
  primaryButtonCss,
  secondaryButtonCss,
  quietButtonCss,
  iconButtonCss
} from './buttonStyles';
import {
  ChevronLeftIcon,
  DownloadIcon,
  EllipsisIcon,
  SpinnerIcon
} from './icons';
import { featheryDoc } from '../../../utils/browser';

export interface ToolbarProps {
  title: string;
  onBack: () => void;
  onDownload: () => void;
  onSaveDraft?: () => void;
  onPrimary: () => void;
  primaryLabel: string;
  busy: boolean;
  isNarrow: boolean;
}

export default function Toolbar({
  title,
  onBack,
  onDownload,
  onSaveDraft,
  onPrimary,
  primaryLabel,
  busy,
  isNarrow
}: ToolbarProps) {
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
        {isNarrow ? (
          <OverflowMenu
            onDownload={onDownload}
            onSaveDraft={onSaveDraft}
            busy={busy}
          />
        ) : (
          <>
            <button
              type='button'
              disabled={busy}
              onClick={onDownload}
              css={quietButtonCss}
            >
              <DownloadIcon size={16} /> Download
            </button>
            {onSaveDraft && (
              <button
                type='button'
                disabled={busy}
                onClick={onSaveDraft}
                css={secondaryButtonCss}
              >
                Save Draft
              </button>
            )}
          </>
        )}
        <button
          type='button'
          disabled={busy}
          onClick={onPrimary}
          css={primaryButtonCss}
        >
          {busy && <SpinnerIcon size={16} />}
          {primaryLabel}
        </button>
      </div>
    </header>
  );
}

interface OverflowMenuProps {
  onDownload: () => void;
  onSaveDraft?: () => void;
  busy: boolean;
}

function OverflowMenu({ onDownload, onSaveDraft, busy }: OverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const doc = featheryDoc();
    const onDocMouseDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    doc.addEventListener('mousedown', onDocMouseDown);
    return () => doc.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const item = (label: string, onClick: () => void) => (
    <button
      type='button'
      disabled={busy}
      onClick={() => {
        setOpen(false);
        onClick();
      }}
      css={{
        border: 'none',
        background: 'transparent',
        textAlign: 'left',
        padding: '8px 12px',
        fontSize: fontSize.base,
        color: color.text,
        cursor: 'pointer',
        borderRadius: radius.sm,
        '&:hover:not(:disabled)': { backgroundColor: color.surfaceHover },
        '&:disabled': { opacity: 0.5, cursor: 'default' }
      }}
    >
      {label}
    </button>
  );

  return (
    <div ref={wrapperRef} css={{ position: 'relative' }}>
      <button
        type='button'
        aria-label='More actions'
        aria-haspopup='menu'
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        css={iconButtonCss}
      >
        <EllipsisIcon size={18} />
      </button>
      {open && (
        <div
          role='menu'
          css={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 4px)',
            minWidth: 160,
            display: 'flex',
            flexDirection: 'column',
            padding: 4,
            backgroundColor: color.surface,
            border: `1px solid ${color.border}`,
            borderRadius: radius.md,
            boxShadow: shadow.menu,
            zIndex: 20
          }}
        >
          {item('Download', onDownload)}
          {onSaveDraft && item('Save Draft', onSaveDraft)}
        </div>
      )}
    </div>
  );
}
