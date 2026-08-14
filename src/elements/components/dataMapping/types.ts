// Config passed from the action (button / logic rule).
export interface MappingHubConfig {
  hub_id: string;
  excluded_field_ids?: string[];
  // Hub field identifying each import batch; the importing user's key is
  // stamped into it server-side. Unset means the hub has one shared batch.
  id_field_id?: string | null;
}

// Field schema returned by GET /api/hub/schema/.
export interface HubFieldSchema {
  id: string;
  key: string;
  type: string;
  // Author-provided help text from the data hub field. Surfaced on the
  // hoverable info button next to each field.
  description?: string;
  required: boolean;
  unique: boolean;
  metadata?: Record<string, any>;
  constraint_rules?: any[];
  order?: number;
}

export interface HubSchema {
  id: string;
  key: string;
  fields: HubFieldSchema[];
}

// Minimal client surface the modal needs (FeatheryClient satisfies this).
export interface DataMappingClient {
  getHubSchemas: (hubIds: string[]) => Promise<{ hubs: HubSchema[] }>;
  dataHubAction: (options: any) => Promise<any>;
}
