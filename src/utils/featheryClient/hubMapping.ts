import { apiFetch, getApiUrl, parseAPIError } from '@feathery/client-utils';

export type StagedHubOperation =
  | 'stage'
  | 'get_staged'
  | 'update_staged'
  | 'finalize';

export interface HubValidationError {
  entry_id: string;
  field_key: string;
  message: string;
}

export interface HubSchemaField {
  id: string;
  key: string;
  type: string;
  required: boolean;
  unique: boolean;
  metadata: Record<string, any>;
  constraint_rules: any[];
  order: number;
}

export interface HubSchema {
  id: string;
  key: string;
  fields: HubSchemaField[];
}

export async function fetchHubSchemas(
  sdkKey: string,
  formKey: string,
  hubIds: string[]
): Promise<HubSchema[]> {
  const params = `hub_ids=${hubIds.join(',')}&form_key=${formKey}`;
  const url = `${getApiUrl()}hub/schema/?${params}`;
  const res = await apiFetch(sdkKey, url, { method: 'GET' }, false);
  if (res?.ok) return await res.json();
  throw Error(parseAPIError(await res?.json()));
}

export async function stagedHubAction(
  sdkKey: string,
  formKey: string,
  fuserKey: string | null,
  {
    hubId,
    operation,
    entryId,
    data,
    rows
  }: {
    hubId: string;
    operation: StagedHubOperation;
    entryId?: string;
    data?: Record<string, any>;
    rows?: Record<string, any>[];
  }
): Promise<Record<string, any> | null> {
  const url = `${getApiUrl()}hub/${hubId}/action/`;
  const res = await apiFetch(
    sdkKey,
    url,
    {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({
        operation,
        entry_id: entryId,
        data,
        rows,
        form_key: formKey,
        fuser_key: fuserKey
      })
    },
    false
  );
  if (!res) return null;
  if (res.ok) return await res.json();
  if (operation === 'finalize' && res.status === 400) {
    // Expected flow: finalize blocked by validation errors — callers need
    // the error list, not an exception.
    return await res.json(); // { errors: HubValidationError[] }
  }
  throw Error(parseAPIError(await res.json()));
}
