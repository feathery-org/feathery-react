import { useEffect, useState } from 'react';
import { asciiOption } from '../utils/asciiOptions';
import FeatheryClient from '../utils/featheryClient';
import { featheryWindow } from '../utils/browser';
import { registerDynamicOptionLabels } from '../utils/optionLabels';

type SalesforceOption = {
  value: string;
  label: string;
};

export default function useSalesforceSync(
  servar: any,
  editMode: boolean,
  asciiOnly = false,
  formKey = ''
) {
  const [connectionRevision, setConnectionRevision] = useState(0);
  useEffect(() => {
    const win = featheryWindow();
    const changed = () => setConnectionRevision((revision) => revision + 1);
    win.addEventListener('feathery:salesforce-connection-changed', changed);
    return () =>
      win.removeEventListener(
        'feathery:salesforce-connection-changed',
        changed
      );
  }, []);
  const [dynamicOptions, setDynamicOptions] = useState<SalesforceOption[]>([]);
  const [loadingDynamicOptions, setLoadingDynamicOptions] = useState(false);
  const salesforceSync = servar?.metadata?.salesforce_sync;
  const shouldSalesforceSync = !editMode && salesforceSync;

  useEffect(() => {
    if (!salesforceSync || editMode) return;

    let cancelled = false;
    const fetchSalesforceOptions = async () => {
      setLoadingDynamicOptions(true);
      try {
        const client = new FeatheryClient(formKey);
        const data = await client.fetchSalesforcePicklistOptions(
          salesforceSync.object_name,
          salesforceSync.field_name,
          salesforceSync.credential_key,
          salesforceSync.auth_source
        );
        if (cancelled) return;
        const rawOptions = data.options || [];
        const options = asciiOnly ? rawOptions.map(asciiOption) : rawOptions;
        setDynamicOptions(options);
        // These options replace the schema's in the field, so text variables
        // have to resolve labels against them too - nothing else registers
        // them, since they never reach servar.metadata.
        registerDynamicOptionLabels(servar.key, options);
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to fetch Salesforce options:', error);
        setDynamicOptions([]);
        // Release the key rather than leave a stale fetch's labels behind; the
        // field falls back to its schema options, and so should text variables.
        registerDynamicOptionLabels(servar.key, []);
      } finally {
        setLoadingDynamicOptions(false);
      }
    };

    fetchSalesforceOptions();
    return () => {
      cancelled = true;
    };
  }, [salesforceSync, asciiOnly, formKey, connectionRevision]);

  return {
    dynamicOptions,
    loadingDynamicOptions,
    shouldSalesforceSync
  };
}
