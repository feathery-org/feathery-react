import React, { useEffect, useRef, useState } from 'react';
import Client from '../../utils/client';
import { useHistory } from 'react-router-dom';

const ONE_MINUTE = 60 * 1000;

export default function VersionListener({
  formName,
  children
}: {
  formName: string;
  children: any;
}) {
  const version = useRef('');
  const [refresh, setRefresh] = useState(false);
  const history = useHistory();

  useEffect(() => {
    const formClient = new Client(formName);

    const triggerRefresh = () => {
      history.replace(location.pathname + location.search);
      setRefresh((refresh) => !refresh);
    };

    const interval = setInterval(async () => {
      const newVersion = (
        await formClient.fetchVersion().catch(() => ({ version: -1 }))
      ).version.toString();
      if (newVersion !== version.current) {
        if (newVersion === '-1') {
          triggerRefresh();
          clearInterval(interval);
        } else if (version.current && newVersion) triggerRefresh();

        version.current = newVersion;
      }
    }, ONE_MINUTE);
    return () => clearInterval(interval);
  }, []);

  return version.current === '-1' ? null : (
    <React.Fragment key={refresh.toString()}>{children}</React.Fragment>
  );
}
