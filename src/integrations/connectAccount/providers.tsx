import React from 'react';
import BoxFolderPicker from './BoxFolderPicker';

// The modal shell remounts the config component (via a `key` keyed on
// accountEmail) whenever the connected account changes, so any state a
// provider's config component holds - selections, pagination, fetched lists -
// is always for the currently connected account. A provider component never
// needs to detect an account change itself; don't add ad hoc handling for it
// here, and don't remove the shell's key.
export type ProviderConfigProps = {
  client: any;
  provider: string;
  onSaved: (values: Record<string, string>) => void;
  onError: (message: string) => void;
};

/** Providers whose post-connect setup needs its own UI. A provider absent from
 *  this map connects and closes with no further configuration. */
export const CONFIG_COMPONENTS: Record<
  string,
  React.ComponentType<ProviderConfigProps>
> = {
  box: BoxFolderPicker
};

export const PROVIDER_LABELS: Record<string, string> = {
  box: 'Box',
  'charles-schwab': 'Charles Schwab'
};

/** The field under `feathery.connections.<provider>.` whose presence means
 *  "this respondent has connected an account". Most providers report the
 *  connected account's email; a provider whose API exposes no identity for the
 *  authorizing user (Schwab) records only that a connection exists. */
const PROVIDER_CONNECTION_FIELD: Record<string, string> = {
  'charles-schwab': 'connected'
};

export const connectionFieldKey = (provider: string) =>
  `feathery.connections.${provider}.${
    PROVIDER_CONNECTION_FIELD[provider] ?? 'email'
  }`;

/** Whether a connection's stored value is the account's email, and so worth
 *  showing as the button's label. */
export const hasEmailIdentity = (provider: string) =>
  !(provider in PROVIDER_CONNECTION_FIELD);

/** The label a Feathery-managed Connect Account button shows. Reports status in
 *  both directions: which account is attached, or that none is yet. A provider
 *  with no account identity (Schwab) has only its name to report. */
export const connectAccountButtonLabel = (
  provider: string,
  connectionValue?: string
) => {
  const label = PROVIDER_LABELS[provider] ?? provider;
  if (!connectionValue) return `Connect your ${label} account`;
  return hasEmailIdentity(provider) ? connectionValue : `${label} connected`;
};
