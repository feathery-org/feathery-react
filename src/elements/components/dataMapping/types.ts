// Config passed from the action (button / logic rule).
export interface MappingHubConfig {
  hub_id: string;
  excluded_field_ids?: string[];
}

// Field schema returned by GET /api/hub/schema/.
export interface HubFieldSchema {
  id: string;
  key: string;
  type: string;
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

// A staged row as returned by get_staged (values keyed by field key).
export interface StagedEntry {
  entry_id: string;
  data: Record<string, any>;
}

// Errors reported by stage / get_staged / update_staged (row-level).
export interface StagedError {
  entry_id?: string;
  row_index?: number;
  field_key?: string;
  message: string;
}

// Minimal client surface the modal needs (FeatheryClient satisfies this).
export interface DataMappingClient {
  getHubSchemas: (hubIds: string[]) => Promise<{ hubs: HubSchema[] }>;
  dataHubAction: (options: any) => Promise<any>;
}
