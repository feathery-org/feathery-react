import React, { useEffect, useRef } from 'react';
import { MODAL_Z_INDEX } from '../../../utils/styles';
import CloseIcon from '../icons/Close';
import useDataMapping, {
  DataMappingClient,
  DataMappingModalConfig
} from './useDataMapping';
import MappingStep from './MappingStep';
import ReviewStep from './ReviewStep';

export interface DataMappingModalProps {
  config: DataMappingModalConfig;
  client: DataMappingClient;
  onClose: () => void;
  responsiveStyles?: any;
}

function DataMappingModal({
  config,
  client,
  onClose,
  responsiveStyles
}: DataMappingModalProps) {
  const hook = useDataMapping(config, client);
  const { mode, loadError } = hook;
  const panelRef = useRef<HTMLDivElement>(null);

  const fontFamily =
    responsiveStyles?.getTarget?.('fc')?.fontFamily ?? 'sans-serif';

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    const FOCUSABLE_SELECTOR =
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const activeInPanel = !!active && panel.contains(active);

      if (event.shiftKey) {
        if (!activeInPanel || active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!activeInPanel || active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleBackdropClick = () => {
    const hasAnyMapping = Object.values(hook.mapping).some(
      (hubMapping) => Object.keys(hubMapping).length > 0
    );
    if (mode === 'import' && hasAnyMapping) {
      if (!window.confirm('Discard this mapping?')) return;
    }
    onClose();
  };

  return (
    <div
      css={{
        position: 'fixed',
        display: 'flex',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: 'rgba(0, 0, 0, 0.2)',
        zIndex: MODAL_Z_INDEX,
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '14px',
        fontFamily
      }}
    >
      <div
        onClick={handleBackdropClick}
        data-testid='data-mapping-backdrop'
        css={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%'
        }}
      />
      <div
        ref={panelRef}
        role='dialog'
        aria-modal='true'
        aria-label='Map your data'
        tabIndex={-1}
        className='feathery-modal'
        css={{
          position: 'relative',
          backgroundColor: '#fff',
          borderRadius: '14px',
          width: '95vw',
          maxWidth: '1200px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
          outline: 'none'
        }}
      >
        <div
          css={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '2px',
            padding: '20px',
            borderBottom: '1px solid #e9e9e9',
            flex: '0 0 auto'
          }}
        >
          <div css={{ fontSize: '18px', fontWeight: 600 }}>
            {mode === 'review' ? 'Review Imported Data' : 'Map Your Data'}
          </div>
          <button
            type='button'
            aria-label='Close'
            onClick={onClose}
            css={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0
            }}
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>

        <div
          css={{
            flex: '1 1 auto',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {mode === 'loading' && (
            <div
              css={{ padding: '40px', textAlign: 'center', color: '#71717a' }}
            >
              Loading...
            </div>
          )}
          {mode === 'error' && (
            <div
              css={{ padding: '40px', textAlign: 'center', color: '#b91c1c' }}
            >
              {loadError ?? 'Something went wrong loading your data.'}
            </div>
          )}
          {mode === 'import' && (
            <MappingStep hook={hook} fontFamily={fontFamily} />
          )}
          {mode === 'review' && (
            <ReviewStep hook={hook} fontFamily={fontFamily} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}

export default DataMappingModal;
