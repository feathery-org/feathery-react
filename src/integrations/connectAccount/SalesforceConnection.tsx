import React, { useCallback, useEffect, useState } from 'react';
import type { ProviderConfigProps } from './providers';

type SyncRun = {
  id: string;
  envelope_id: string;
  status: string;
  error: string;
};

export default function SalesforceConnection({
  client,
  onError,
  onSaved,
  onFooterActionChange
}: ProviderConfigProps) {
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    async () => (await client.listSalesforceDocumentSync()).runs as SyncRun[],
    [client]
  );
  useEffect(() => {
    let active = true;
    load()
      .then((loaded) => {
        if (active) setRuns(loaded);
      })
      .catch((error: Error) => {
        if (active) onError(error.message);
      });
    return () => {
      active = false;
    };
  }, [load, onError]);
  useEffect(() => {
    onFooterActionChange?.({
      label: 'Done',
      disabled: busy,
      onClick: () => onSaved({})
    });
    return () => onFooterActionChange?.(null);
  }, [busy, onSaved, onFooterActionChange]);
  const retry = async (id: string) => {
    setBusy(true);
    try {
      await client.retrySalesforceDocumentSync(id);
      setRuns(await load());
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : 'Unable to retry Salesforce sync.'
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <p>
        Salesforce requests use this connected account. Values saved into this
        form follow the form’s sharing rules.
      </p>
      {runs.length > 0 && <h4>Document sync</h4>}
      {runs.map((run) => (
        <div key={run.id} style={{ marginTop: 12 }}>
          <div>
            {run.envelope_id || 'Document awaiting send'}:{' '}
            {run.status.replace(/_/g, ' ')}
          </div>
          {run.error && <p role='status'>{run.error}</p>}
          {['paused', 'retry', 'waiting'].includes(run.status) && (
            <button type='button' disabled={busy} onClick={() => retry(run.id)}>
              Retry with original connection
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
