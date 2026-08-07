import React from 'react';
import BoxFolderPicker from './BoxFolderPicker';

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
