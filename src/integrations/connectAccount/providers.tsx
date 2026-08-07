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
  box: 'Box'
};
