import React, { useState } from 'react';
import CloseIcon from '../../elements/components/icons/Close';
import { MODAL_Z_INDEX } from '../../utils/styles';
import { CONFIG_COMPONENTS, PROVIDER_LABELS } from './providers';

export type ConnectAccountModalProps = {
  show: boolean;
  provider: string;
  client: any;
  accountEmail: string;
  onChangeAccount: () => void;
  onSaved: (values: Record<string, string>) => void;
  onClose: () => void;
};

function ConnectAccountModal({
  show,
  provider,
  client,
  accountEmail,
  onChangeAccount,
  onSaved,
  onClose
}: ConnectAccountModalProps) {
  const [error, setError] = useState('');

  if (!show) return null;

  const providerLabel = PROVIDER_LABELS[provider] ?? provider;
  const ConfigComponent = CONFIG_COMPONENTS[provider];

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
        fontSize: '16px',
        fontFamily: 'sans-serif'
      }}
    >
      <div
        onClick={onClose}
        css={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%'
        }}
      />
      <div
        className='feathery-modal'
        css={{
          position: 'relative',
          backgroundColor: '#fff',
          borderRadius: '14px',
          width: '100%',
          maxWidth: '600px'
        }}
      >
        <div
          css={{
            position: 'relative',
            display: 'flex',
            padding: '20px',
            borderBottom: '1px solid #e9e9e9'
          }}
        >
          <h3 css={{ padding: 0, margin: 0, flex: '1' }}>
            Connect your {providerLabel} account
          </h3>
          <button
            aria-label='Close'
            onClick={onClose}
            css={{
              background: 'none',
              border: 'none',
              padding: 0,
              lineHeight: 0,
              '&:hover': { cursor: 'pointer' }
            }}
          >
            <CloseIcon />
          </button>
        </div>
        <div
          css={{
            position: 'relative',
            padding: '20px'
          }}
        >
          <div
            css={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingBottom: '20px'
            }}
          >
            <span>{accountEmail}</span>
            <button
              onClick={onChangeAccount}
              css={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: '#5e5e5e',
                textDecoration: 'underline',
                '&:hover': { cursor: 'pointer' }
              }}
            >
              Change account
            </button>
          </div>
          {ConfigComponent ? (
            <ConfigComponent
              client={client}
              provider={provider}
              onSaved={onSaved}
              onError={setError}
            />
          ) : (
            <div>This account needs no additional setup.</div>
          )}
          {error && (
            <div css={{ color: '#d32f2f', paddingTop: '10px' }}>{error}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ConnectAccountModal;
