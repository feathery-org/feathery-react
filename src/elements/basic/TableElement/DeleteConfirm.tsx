import { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { featheryDoc } from '../../../utils/browser';
import {
  confirmPopoverStyle,
  confirmTextStyle,
  confirmButtonRowStyle,
  confirmDeleteButtonStyle,
  confirmCancelButtonStyle
} from './styles';

type DeleteConfirmProps = {
  anchorEl: HTMLElement | null;
  onConfirm: () => void;
  onCancel: () => void;
  message?: string;
  confirmLabel?: string;
};

export function DeleteConfirm({
  anchorEl,
  onConfirm,
  onCancel,
  message = 'Delete this row?',
  confirmLabel = 'Delete'
}: DeleteConfirmProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  const anchorRect = anchorEl?.getBoundingClientRect();
  const top = (anchorRect?.bottom ?? 0) + 4;
  const left = anchorRect?.right ?? 0;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        anchorEl &&
        !anchorEl.contains(event.target as Node)
      ) {
        onCancel();
      }
    };

    const handleScroll = () => onCancel();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };

    const doc = featheryDoc();
    doc.addEventListener('mousedown', handleClickOutside);
    doc.addEventListener('scroll', handleScroll, true);
    doc.addEventListener('keydown', handleKeyDown);

    return () => {
      doc.removeEventListener('mousedown', handleClickOutside);
      doc.removeEventListener('scroll', handleScroll, true);
      doc.removeEventListener('keydown', handleKeyDown);
    };
  }, [onCancel, anchorEl]);

  return createPortal(
    <div
      ref={popoverRef}
      role='alertdialog'
      aria-label={message}
      css={{
        ...confirmPopoverStyle,
        top: `${top}px`,
        left: `${left}px`,
        transform: 'translateX(-100%)'
      }}
    >
      <p css={confirmTextStyle}>{message}</p>
      <div css={confirmButtonRowStyle}>
        <button
          type='button'
          css={confirmCancelButtonStyle}
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
        >
          Cancel
        </button>
        <button
          type='button'
          css={confirmDeleteButtonStyle}
          onClick={(e) => {
            e.stopPropagation();
            onConfirm();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </div>,
    featheryDoc().body
  );
}
