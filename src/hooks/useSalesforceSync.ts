import { useEffect, useState } from 'react';
import FeatheryClient from '../utils/featheryClient';
import { registerDynamicOptionLabels } from '../utils/optionLabels';

type SalesforceOption = {
  value: string;
  label: string;
};

export default function useSalesforceSync(servar: any, editMode: boolean) {
  const [dynamicOptions, setDynamicOptions] = useState<SalesforceOption[]>([]);
  const [loadingDynamicOptions, setLoadingDynamicOptions] = useState(false);
  const salesforceSync = servar?.metadata?.salesforce_sync;
  const shouldSalesforceSync = !editMode && salesforceSync;

  useEffect(() => {
    if (!salesforceSync || editMode) return;

    const fetchSalesforceOptions = async () => {
      setLoadingDynamicOptions(true);
      try {
        const client = new FeatheryClient();
        const data = await client.fetchSalesforcePicklistOptions(
          salesforceSync.object_name,
          salesforceSync.field_name,
          salesforceSync.credential_key
        );
        const options = data.options || [];
        setDynamicOptions(options);
        // These options replace the schema's in the field, so text variables
        // have to resolve labels against them too - nothing else registers
        // them, since they never reach servar.metadata.
        registerDynamicOptionLabels(servar.key, options);
      } catch (error) {
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
  }, [salesforceSync]);

  return { dynamicOptions, loadingDynamicOptions, shouldSalesforceSync };
}
