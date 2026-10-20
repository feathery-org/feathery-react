// Config passed from the action (button / logic rule).
export interface MappingHubConfig {
  hub_id: string;
  excluded_field_ids?: string[];
  // Hub field that identifies the import batch; the current user's key is
  // stamped into it server-side. Never mapped from the spreadsheet.
  id_field_id?: string;
}

// A hub field's settings. Open-ended: only the keys the SDK reads are typed.
export interface HubFieldMetadata {
  options?: string[];
  // Display names for `options`, same order and length. The backend fills
  // both (read-only) for the `us_state` / `country` formats.
  option_labels?: string[];
  // Number fields: 'currency' | 'percentage'. Text fields: 'us_zip' |
  // 'us_state' | 'country'. Absent means no format.
  format?: string | null;
  // ISO 4217 code for the `currency` format; USD when absent.
  currency?: string;
  // `us_state` only: include territories and military codes.
  include_territories?: boolean;
  min_length?: number;
  max_length?: number;
  min_value?: number;
  max_value?: number;
  decimal_digits?: number;
  date_range?: 'past_only' | 'future_only';
  min_date?: string;
  max_date?: string;
  [key: string]: any;
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
  metadata?: HubFieldMetadata;
  default_value?: any;
  constraint_rules?: any[];
  order?: number;
}

export interface HubSchema {
  id: string;
  key: string;
  fields: HubFieldSchema[];
  // Whether the hub stages unverified rows. Older backends omit it.
  unverified_enabled?: boolean;
}

// Minimal client surface the modal needs (FeatheryClient satisfies this).
export interface DataMappingClient {
  getHubSchemas: (hubIds: string[]) => Promise<{ hubs: HubSchema[] }>;
  dataHubAction: (options: any) => Promise<any>;
}
