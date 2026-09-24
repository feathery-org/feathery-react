import React, { useCallback, useEffect, useRef, useState } from 'react';
import CloseIcon from '../../elements/components/icons/Close';
import TrashIcon from '../../elements/components/icons/TrashIcon';
import { featheryDoc, featheryWindow } from '../../utils/browser';
import { MODAL_Z_INDEX } from '../../utils/styles';
import { CONFIG_COMPONENTS, PROVIDER_LABELS } from './providers';
import type { ProviderFooterAction } from './providers';

const MODAL_TITLE_ID = 'feathery-connect-account-modal-title';
const NEW_ACCOUNT = '__new_account__';
const CONNECTED_ACCOUNT = '__connected_account__';
const menuItemStyles = {
  display: 'block',
  width: '100%',
  padding: '9px 10px',
  border: 0,
  borderRadius: '5px',
  background: 'transparent',
  color: '#18181b',
  fontSize: '14px',
  textAlign: 'left',
  cursor: 'pointer',
  '&:hover': { background: '#f4f4f5' }
} as const;
const confirmButtonStyles = {
  padding: '5px 10px',
  border: '1px solid #dc2626',
  borderRadius: '6px',
  background: '#dc2626',
  color: '#fff',
  fontSize: '13px',
  cursor: 'pointer',
  '&:disabled': { opacity: 0.6, cursor: 'not-allowed' }
} as const;
const cancelButtonStyles = {
  padding: '5px 10px',
  border: '1px solid #d4d4d8',
  borderRadius: '6px',
  background: '#fff',
  color: '#18181b',
  fontSize: '13px',
  cursor: 'pointer',
  '&:disabled': { opacity: 0.6, cursor: 'not-allowed' }
} as const;
const deleteButtonStyles = {
  display: 'grid',
  flex: '0 0 32px',
  placeItems: 'center',
  width: '32px',
  height: '32px',
  margin: '3px 0 3px 4px',
  padding: 0,
  border: 0,
  borderRadius: '6px',
  background: 'transparent',
  color: '#71717a',
  cursor: 'pointer',
  '&:hover': { background: '#fef2f2', color: '#dc2626' },
  '&:focus-visible': { outline: '2px solid #2563eb', outlineOffset: '1px' }
} as const;

export type SavedAccountCredential = {
  id: string;
  account_email: string;
  account_name: string;
  preferred?: boolean;
};

export type ConnectAccountModalProps = {
  show: boolean;
  provider: string;
  client: any;
  accountEmail: string;
  credentials?: SavedAccountCredential[];
  chooseCredential?: boolean;
  canSaveCredential?: boolean;
  // The current connection was attached by another signed-in user and is
  // locked to them: hide its settings and offer only to replace it.
  lockedByOwner?: boolean;
  onCredentialSelected?: (values: Record<string, string>) => void;
  onDisconnected?: (values: Record<string, string>) => void;
  // Resolves with an error message on failure (popup blocked, OAuth
  // rejected, etc.) so handleChangeAccount can surface it, or undefined on
  // success. Must never reject: this is called fire-and-forget from a click
  // handler, so an unhandled rejection would fail silently.
  onChangeAccount: (saveCredential?: boolean) => Promise<string | void>;
  onSaved: (values: Record<string, string>) => void;
  onClose: () => void;
};

// A shared default keeps the prop referentially stable across renders: the
// selection-sync effect depends on `credentials`, so a fresh `[]` default each
// render would fire it (and its setState calls) forever.
const NO_CREDENTIALS: SavedAccountCredential[] = [];

function ConnectAccountModal({
  show,
  provider,
  client,
  accountEmail,
  credentials = NO_CREDENTIALS,
  chooseCredential = false,
  canSaveCredential = false,
  lockedByOwner = false,
  onCredentialSelected,
  onDisconnected,
  onChangeAccount,
  onSaved,
  onClose
}: ConnectAccountModalProps) {
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(!chooseCredential);
  const [locked, setLocked] = useState(lockedByOwner);
  const [selectedCredential, setSelectedCredential] = useState('');
  const [pendingDelete, setPendingDelete] = useState('');
  const [deletingCredential, setDeletingCredential] = useState(false);
  const [rememberCredential, setRememberCredential] = useState(false);
  const [configurationVersion, setConfigurationVersion] = useState(0);
  const [changingAccount, setChangingAccount] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [visibleCredentials, setVisibleCredentials] = useState(credentials);
  const [footerAction, setFooterAction] = useState<ProviderFooterAction | null>(
    null
  );
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const autoSelectedCredential = useRef('');
  const handleFooterActionChange = useCallback(
    (action: ProviderFooterAction | null) => setFooterAction(action),
    []
  );
  // Stable identity matters: the picker's select handler depends on this
  // callback and its footer effect depends on that handler, so an inline
  // function here re-renders the modal on every render, forever.
  const handleClearError = useCallback(() => setError(''), []);

  // Clears any stale error whenever the modal opens/closes or the provider
  // changes, so a message from a previous account/provider never reappears.
  useEffect(() => {
    setError('');
  }, [show, provider]);

  useEffect(() => {
    setVisibleCredentials(credentials);
    setPendingDelete('');
    setLocked(lockedByOwner);
    const preferred = credentials.find((credential) => credential.preferred);
    // Nothing is chosen until the user (or a remembered preference) picks;
    // pre-highlighting the first account would misreport it as attached.
    setSelectedCredential(preferred?.id ?? '');
    // Authenticated users can reuse credentials across submissions. The
    // explicit save checkbox was removed from the picker, so eligible users
    // now get the remember behavior by default.
    setRememberCredential(canSaveCredential || Boolean(preferred));
    autoSelectedCredential.current = '';
  }, [canSaveCredential, credentials, lockedByOwner, show, provider]);

  // Move focus into the dialog on open; there is otherwise no keyboard path
  // into it.
  useEffect(() => {
    if (show) closeButtonRef.current?.focus();
  }, [show]);

  // Escape closes the account menu first if it is open (returning focus to
  // its trigger), otherwise dismisses the dialog like a native one.
  useEffect(() => {
    if (!show) return undefined;
    const win = featheryWindow();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (accountMenuOpen) {
        event.stopPropagation();
        setAccountMenuOpen(false);
        accountMenuTriggerRef.current?.focus();
        return;
      }
      onClose();
    };
    win.addEventListener('keydown', handleKeyDown);
    return () => win.removeEventListener('keydown', handleKeyDown);
  }, [show, onClose, accountMenuOpen]);

  // Keyboard users land on the first option when the menu opens.
  useEffect(() => {
    if (!accountMenuOpen) return;
    accountMenuRef.current
      ?.querySelector<HTMLElement>('[role="option"]')
      ?.focus();
  }, [accountMenuOpen]);

  const handleMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const options = Array.from(
      accountMenuRef.current?.querySelectorAll<HTMLElement>(
        '[role="option"]'
      ) ?? []
    );
    if (!options.length) return;
    const index = options.indexOf(featheryDoc().activeElement as HTMLElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    options[(index + step + options.length) % options.length].focus();
  };

  useEffect(() => {
    if (!accountMenuOpen) return undefined;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node))
        setAccountMenuOpen(false);
    };
    featheryDoc().addEventListener('mousedown', closeOnOutsideClick);
    return () =>
      featheryDoc().removeEventListener('mousedown', closeOnOutsideClick);
  }, [accountMenuOpen]);

  const handleChangeAccount = async () => {
    if (changingAccount) return;
    setError('');
    // window.open must stay the first statement in onChangeAccount's own
    // body - setChangingAccount here is a synchronous state update, not an
    // await, so it doesn't delay that call and doesn't break the
    // user-gesture chain the popup relies on.
    setChangingAccount(true);
    try {
      const errorMessage = await onChangeAccount(
        canSaveCredential && rememberCredential
      );
      if (errorMessage) setError(errorMessage);
      else {
        setConnected(true);
        setLocked(false);
        setSelectedCredential(CONNECTED_ACCOUNT);
        setConfigurationVersion((version) => version + 1);
      }
    } finally {
      setChangingAccount(false);
    }
  };

  const handleSelectCredential = async (
    credentialId = selectedCredential,
    remember = rememberCredential
  ) => {
    if (!credentialId || changingAccount) return;
    setError('');
    setChangingAccount(true);
    try {
      const result = await client.selectAccountCredential(
        provider,
        credentialId,
        ...(remember ? [true] : [])
      );
      onCredentialSelected?.(result.values);
      setConnected(true);
      setLocked(false);
      setSelectedCredential(CONNECTED_ACCOUNT);
      setConfigurationVersion((version) => version + 1);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to select this account.'
      );
    } finally {
      setChangingAccount(false);
    }
  };

  // Only a remembered (preferred) account is attached on its own when the
  // picker opens for a fresh connection; any other choice is the user's to
  // make explicitly.
  useEffect(() => {
    if (!show || connected || !chooseCredential || changingAccount) return;
    const credentialId = credentials.find(
      (credential) => credential.preferred
    )?.id;
    if (!credentialId || autoSelectedCredential.current === credentialId)
      return;
    autoSelectedCredential.current = credentialId;
    // Runs in the same commit as the effect that sets rememberCredential, so
    // pass the intent explicitly: a remembered account stays remembered.
    handleSelectCredential(credentialId, true).catch(() => undefined);
  }, [
    changingAccount,
    chooseCredential,
    connected,
    credentials,
    show,
    selectedCredential
  ]);

  if (!show) return null;

  const providerLabel = PROVIDER_LABELS[provider] ?? provider;
  const ConfigComponent = CONFIG_COMPONENTS[provider];
  const availableCredentials =
    connected && accountEmail
      ? visibleCredentials.filter(
          (credential) => credential.account_email !== accountEmail
        )
      : visibleCredentials;
  const hasSavedAccounts = connected || availableCredentials.length > 0;
  const handleCredentialChange = (value: string) => {
    setAccountMenuOpen(false);
    if (value === NEW_ACCOUNT) {
      handleChangeAccount();
    } else if (value !== CONNECTED_ACCOUNT) {
      setSelectedCredential(value);
      setConnected(false);
      handleSelectCredential(value).catch(() => undefined);
    }
  };

  const handleDisconnect = async () => {
    if (changingAccount) return;
    setAccountMenuOpen(false);
    setChangingAccount(true);
    try {
      const result = await client.disconnectAccount(provider);
      onDisconnected?.(result.values);
      setConnected(false);
      setSelectedCredential('');
      setConfigurationVersion((version) => version + 1);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to disconnect this account.'
      );
    } finally {
      setChangingAccount(false);
    }
  };

  // Forgetting a saved account is permanent and affects other submissions,
  // so the trash icon only asks; this runs from the confirmation.
  const handleDeleteCredential = async (credentialId: string) => {
    if (changingAccount || deletingCredential) return;
    setError('');
    setDeletingCredential(true);
    try {
      await client.deleteAccountCredential(provider, credentialId);
      setVisibleCredentials((current) =>
        current.filter((credential) => credential.id !== credentialId)
      );
      setPendingDelete('');
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to delete this saved account.'
      );
    } finally {
      setDeletingCredential(false);
    }
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
        onClick={(event) => event.stopPropagation()}
        css={{
          position: 'relative',
          backgroundColor: '#fff',
          borderRadius: '14px',
          width: '100%',
          maxWidth: '600px',
          maxHeight: '90vh',
          overflow: 'visible'
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
            padding: '24px 28px 28px'
          }}
        >
          <div css={{ paddingBottom: '16px' }}>
            <h4
              css={{
                margin: 0,
                color: '#18181b',
                fontSize: '18px',
                fontWeight: 600,
                lineHeight: 1.4
              }}
            >
              {locked
                ? `Replace the connected ${providerLabel} account`
                : `Choose a ${providerLabel} account`}
            </h4>
            <p
              css={{
                margin: '4px 0 0',
                color: '#71717a',
                fontSize: '14px',
                lineHeight: 1.5
              }}
            >
              {locked
                ? 'This connection was set up by another user and is locked to them. Choose one of your saved accounts or connect a new one to use your own instead.'
                : 'Select a saved account or connect a new one.'}
            </p>
            {!credentials.length && !canSaveCredential && (
              <button
                type='button'
                onClick={handleChangeAccount}
                disabled={changingAccount}
                css={{
                  marginTop: '12px',
                  padding: 0,
                  border: 0,
                  background: 'none',
                  color: '#52525b',
                  textDecoration: 'underline',
                  cursor: 'pointer'
                }}
              >
                {locked
                  ? 'Connect your own account'
                  : connected
                  ? 'Change account'
                  : 'Connect a new account'}
              </button>
            )}
          </div>
          {(credentials.length > 0 || canSaveCredential) && (
            <div
              css={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                marginBottom: '20px'
              }}
            >
              <div
                css={{ display: 'flex', gap: '10px', alignItems: 'stretch' }}
              >
                <div
                  ref={accountMenuRef}
                  css={{ position: 'relative', flex: 1 }}
                >
                  <button
                    ref={accountMenuTriggerRef}
                    type='button'
                    aria-haspopup='listbox'
                    aria-expanded={accountMenuOpen}
                    aria-label={`Saved ${providerLabel} accounts`}
                    disabled={changingAccount}
                    onClick={() => setAccountMenuOpen((open) => !open)}
                    css={{
                      width: '100%',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 12px',
                      border: '1px solid #d4d4d8',
                      borderRadius: '7px',
                      background: '#fff',
                      color: '#18181b',
                      fontSize: '14px',
                      textAlign: 'left'
                    }}
                  >
                    {connected
                      ? accountEmail || `Current ${providerLabel} account`
                      : visibleCredentials.find(
                          (c) => c.id === selectedCredential
                        )?.account_email || 'Select an account'}
                    <svg
                      aria-hidden='true'
                      viewBox='0 0 24 24'
                      width='20'
                      height='20'
                      css={{
                        flexShrink: 0,
                        marginLeft: '12px',
                        color: '#71717a',
                        transform: accountMenuOpen
                          ? 'rotate(180deg)'
                          : 'rotate(0deg)',
                        transition: 'transform 0.15s ease'
                      }}
                    >
                      <path
                        d='m6 9 6 6 6-6'
                        fill='none'
                        stroke='currentColor'
                        strokeWidth='2.5'
                        strokeLinecap='round'
                        strokeLinejoin='round'
                      />
                    </svg>
                  </button>
                  {accountMenuOpen && (
                    <div
                      role='listbox'
                      aria-label={`Saved ${providerLabel} accounts`}
                      onKeyDown={handleMenuKeyDown}
                      css={{
                        position: 'absolute',
                        zIndex: 2,
                        left: 0,
                        right: 0,
                        top: 'calc(100% + 4px)',
                        padding: '4px',
                        border: '1px solid #d4d4d8',
                        borderRadius: '8px',
                        background: '#fff',
                        boxShadow: '0 8px 24px rgba(0,0,0,.12)'
                      }}
                    >
                      {connected && !locked && (
                        <div
                          css={{
                            position: 'relative',
                            display: 'flex',
                            alignItems: 'center',
                            borderRadius: '5px',
                            '&:hover': { background: '#f4f4f5' }
                          }}
                        >
                          <button
                            type='button'
                            role='option'
                            aria-selected
                            onClick={() =>
                              handleCredentialChange(CONNECTED_ACCOUNT)
                            }
                            css={{
                              ...menuItemStyles,
                              flex: 1,
                              '&:hover': { background: 'transparent' }
                            }}
                          >
                            {accountEmail || `Current ${providerLabel} account`}
                          </button>
                          <button
                            type='button'
                            aria-label='Disconnect current account'
                            onClick={handleDisconnect}
                            css={deleteButtonStyles}
                          >
                            <TrashIcon width={16} height={16} />
                          </button>
                        </div>
                      )}
                      {availableCredentials.map((credential) =>
                        pendingDelete === credential.id ? (
                          <div
                            key={credential.id}
                            role='group'
                            aria-label={`Forget ${
                              credential.account_email || providerLabel
                            }?`}
                            css={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              padding: '6px 10px',
                              borderRadius: '5px',
                              background: '#fef2f2',
                              color: '#7f1d1d',
                              fontSize: '13px'
                            }}
                          >
                            <span css={{ flex: 1 }}>
                              Forget {credential.account_email || providerLabel}
                              ? Other submissions using it will be disconnected.
                            </span>
                            <button
                              type='button'
                              disabled={deletingCredential}
                              onClick={() =>
                                handleDeleteCredential(credential.id)
                              }
                              css={confirmButtonStyles}
                            >
                              Forget
                            </button>
                            <button
                              type='button'
                              disabled={deletingCredential}
                              onClick={() => setPendingDelete('')}
                              css={cancelButtonStyles}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div
                            key={credential.id}
                            css={{
                              position: 'relative',
                              display: 'flex',
                              alignItems: 'center',
                              borderRadius: '5px',
                              '&:hover': { background: '#f4f4f5' }
                            }}
                          >
                            <button
                              type='button'
                              role='option'
                              aria-selected={
                                !connected &&
                                selectedCredential === credential.id
                              }
                              onClick={() =>
                                handleCredentialChange(credential.id)
                              }
                              css={{
                                ...menuItemStyles,
                                flex: 1,
                                '&:hover': { background: 'transparent' }
                              }}
                            >
                              {credential.account_email ||
                                credential.account_name ||
                                providerLabel}
                            </button>
                            <button
                              type='button'
                              aria-label={`Forget saved ${providerLabel} account ${
                                credential.account_email || ''
                              }`}
                              disabled={changingAccount || deletingCredential}
                              onClick={() => setPendingDelete(credential.id)}
                              css={deleteButtonStyles}
                            >
                              <TrashIcon width={16} height={16} />
                            </button>
                          </div>
                        )
                      )}
                      {hasSavedAccounts && (
                        <div
                          css={{
                            margin: '4px 0',
                            borderTop: '1px solid #e4e4e7'
                          }}
                        />
                      )}
                      <button
                        type='button'
                        role='option'
                        onClick={() => handleCredentialChange(NEW_ACCOUNT)}
                        css={{
                          ...menuItemStyles,
                          color: '#71717a',
                          fontWeight: 600
                        }}
                      >
                        Connect a new account...
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {connected && !locked && ConfigComponent && (
            <fieldset
              disabled={changingAccount}
              css={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
            >
              <ConfigComponent
                key={`${accountEmail}:${configurationVersion}`}
                client={client}
                provider={provider}
                onSaved={onSaved}
                onError={setError}
                onClearError={handleClearError}
                onFooterActionChange={handleFooterActionChange}
              />
            </fieldset>
          )}
          {error && (
            <div
              role='alert'
              css={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                marginTop: '16px',
                padding: '12px 14px',
                border: '1px solid #fecaca',
                borderRadius: '8px',
                background: '#fef2f2',
                color: '#b91c1c',
                fontSize: '14px',
                lineHeight: 1.45
              }}
            >
              <span aria-hidden='true' css={{ fontWeight: 700 }}>
                !
              </span>
              <span>{error}</span>
            </div>
          )}
          {connected && !locked && footerAction && (
            <div
              css={{
                display: 'flex',
                justifyContent: 'flex-end',
                marginTop: '20px',
                paddingTop: '16px'
              }}
            >
              <button
                type='button'
                onClick={footerAction.onClick}
                disabled={footerAction.disabled || changingAccount}
                css={{
                  border: '1px solid #2563eb',
                  borderRadius: '7px',
                  padding: '9px 16px',
                  background: '#2563eb',
                  color: '#fff',
                  fontSize: '14px',
                  lineHeight: 1.4,
                  cursor: 'pointer',
                  '&:hover:not(:disabled)': { background: '#1d4ed8' },
                  '&:disabled': {
                    borderColor: '#d4d4d8',
                    background: '#e4e4e7',
                    color: '#71717a',
                    cursor: 'not-allowed'
                  }
                }}
              >
                {footerAction.label}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ConnectAccountModal;
