import { useEffect, useRef } from 'react';

export default function usePollFuserData(
  poll: boolean,
  client: any,
  updateFieldValues: any
) {
  const pollingData = useRef(false);
  useEffect(() => {
    if (!poll || !client || pollingData.current) return;

    pollingData.current = true;
    setInterval(() => {
      client.pollUserData().then(async (res: any) => {
        const data = await res.json();
        if (Object.keys(data).length) updateFieldValues(data);
      });
    }, 1000);
  }, [client, poll]);
}
