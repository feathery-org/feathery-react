import React, { useEffect, useRef, useState } from 'react';
import CloseIcon from '../../elements/components/icons/Close';
import { featheryWindow } from '../../utils/browser';
import { MODAL_Z_INDEX } from '../../utils/styles';
import { CONFIG_COMPONENTS, PROVIDER_LABELS } from './providers';

const MODAL_TITLE_ID = 'feathery-connect-account-modal-title';

export type ConnectAccountModalProps = {
  show: boolean;
  provider: string;
  client: any;
  accountEmail: string;
  // Resolves with an error message on failure (popup blocked, OAuth
  // rejected, etc.) so handleChangeAccount can surface it, or undefined on
  // success. Must never reject: this is called fire-and-forget from a click
  // handler, so an unhandled rejection would fail silently.
  onChangeAccount: () => Promise<string | void>;
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
  const [changingAccount, setChangingAccount] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Clears any stale error whenever the modal opens/closes or the provider
  // changes, so a message from a previous account/provider never reappears.
  useEffect(() => {
    setError('');
  }, [show, provider]);

  // Move focus into the dialog on open; there is otherwise no keyboard path
  // into it.
  useEffect(() => {
    if (show) closeButtonRef.current?.focus();
  }, [show]);

  // Escape dismisses the dialog, matching native dialog expectations.
  useEffect(() => {
    if (!show) return undefined;
    const win = featheryWindow();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    win.addEventListener('keydown', handleKeyDown);
    return () => win.removeEventListener('keydown', handleKeyDown);
  }, [show, onClose]);

  const handleChangeAccount = async () => {
    if (changingAccount) return;
    setError('');
    // window.open must stay the first statement in onChangeAccount's own
    // body - setChangingAccount here is a synchronous state update, not an
    // await, so it doesn't delay that call and doesn't break the
    // user-gesture chain the popup relies on.
    setChangingAccount(true);
    try {
      const errorMessage = await onChangeAccount();
      if (errorMessage) setError(errorMessage);
    } finally {
      setChangingAccount(false);
    }
  };

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
        role='dialog'
        aria-modal='true'
        aria-labelledby={MODAL_TITLE_ID}
        css={{
          position: 'relative',
          backgroundColor: '#fff',
          borderRadius: '14px',
          width: '100%',
          maxWidth: '600px',
          maxHeight: '90vh',
          overflowY: 'auto'
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
          <h3 id={MODAL_TITLE_ID} css={{ padding: 0, margin: 0, flex: '1' }}>
            Connect your {providerLabel} account
          </h3>
          <button
            ref={closeButtonRef}
            type='button'
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
            <span>
              {accountEmail || `Your ${providerLabel} account is connected`}
            </span>
            <button
              type='button'
              onClick={handleChangeAccount}
              disabled={changingAccount}
              css={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: '#5e5e5e',
                textDecoration: 'underline',
                '&:hover': { cursor: 'pointer' },
                '&:disabled': { cursor: 'not-allowed', opacity: 0.6 }
              }}
            >
              Change account
            </button>
          </div>
          {ConfigComponent && (
            <ConfigComponent
              key={accountEmail}
              client={client}
              provider={provider}
              onSaved={onSaved}
              onError={setError}
            />
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
