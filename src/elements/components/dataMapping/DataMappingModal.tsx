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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleBackdropClick = () => {
    if (mode === 'import' && Object.keys(hook.mapping).length > 0) {
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
