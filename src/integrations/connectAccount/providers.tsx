import React from 'react';
import BoxFolderPicker from './BoxFolderPicker';
import { fieldValues } from '../../utils/init';
import { ACTION_CONNECT_ACCOUNT } from '../../utils/elementActions';

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
 *  this map connects with no further configuration and never shows the modal on
 *  a fresh connect - only on a repeat click, where the modal's sole purpose is
 *  the "Change account" option. */
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

/**
 * "Managed by Feathery" (the builder default): the button reports the
 * connection's status - which account is attached, or that none is yet -
 * instead of the builder's static label. `manage_button_label: false` opts out,
 * leaving the builder to compose their own with text variables (e.g.
 * {{feathery.connections.box.email}}), which resolve on their own.
 *
 * Returns a copy of the element carrying the managed label, or null when the
 * button's label isn't managed. Lives here rather than in the form runtime so
 * the builder canvas previews the same label a form renders - with no field
 * values there, that's the disconnected prompt.
 */
export const managedConnectAccountElement = (element: any) => {
  const action = (element.properties?.actions ?? []).find(
    (a: any) => a.type === ACTION_CONNECT_ACCOUNT
  );
  if (!action || action.manage_button_label === false) return null;

  const text = connectAccountButtonLabel(
    action.provider,
    fieldValues[connectionFieldKey(action.provider)] as string | undefined
  );
  // Keep the first run's attributes: they carry the label's font styling, and
  // a bare insert would render the managed label unstyled.
  const [firstRun] = element.properties.text_formatted ?? [];
  return {
    ...element,
    properties: {
      ...element.properties,
      text,
      text_formatted: [{ ...firstRun, insert: text }]
    }
  };
};
