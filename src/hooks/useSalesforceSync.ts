import { useEffect, useState } from 'react';
import FeatheryClient from '../utils/featheryClient';

type SalesforceOption = {
  value: string;
  label: string;
};

export default function useSalesforceSync(salesforceSync: any) {
  const [dynamicOptions, setDynamicOptions] = useState<SalesforceOption[]>([]);
  const [loadingDynamicOptions, setLoadingDynamicOptions] = useState(false);

  useEffect(() => {
    if (!salesforceSync) return;

    const fetchSalesforceOptions = async () => {
      setLoadingDynamicOptions(true);
      try {
        const client = new FeatheryClient();
        const data = await client.fetchSalesforcePicklistOptions(
          salesforceSync.object_name,
          salesforceSync.field_name,
          salesforceSync.credential_key
        );
        setDynamicOptions(data.options || []);
      } catch (error) {
        console.error('Failed to fetch Salesforce options:', error);
        setDynamicOptions([]);
      } finally {
        setLoadingDynamicOptions(false);
      }
    };

    fetchSalesforceOptions();
  }, [salesforceSync]);

  return { dynamicOptions, loadingDynamicOptions };
}
