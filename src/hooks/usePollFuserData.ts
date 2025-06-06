import { useEffect, useRef } from 'react';
import { featheryWindow } from '../utils/browser';

export default function usePollFuserData(client: any, updateFieldValues: any) {
  const pollingData = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(featheryWindow().location.search);
    if (client && params.has('_pa') && !pollingData.current) {
      pollingData.current = true;
      setInterval(() => {
        client.pollUserData().then(async (res: any) => {
          const data = await res.json();
          if (Object.keys(data).length) updateFieldValues(data);
        });
      }, 1000);
    }
  }, [client]);
}
