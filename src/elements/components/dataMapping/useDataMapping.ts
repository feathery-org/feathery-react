import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildMappedRows,
  ColumnRef,
  coerceToHubType,
  FieldMapping,
  NormalizedSheet,
  normalizeSpreadsheet,
  parseWorkbook
} from '../../../utils/spreadsheet';
import type {
  HubSchema,
  HubSchemaField,
  HubValidationError,
  StagedHubOperation
} from '../../../utils/featheryClient/hubMapping';

// Canonical wire-shape types (HubSchemaField, HubValidationError,
// StagedHubOperation) now live in featheryClient/hubMapping.ts (added by
// R4) and are re-exported here so existing imports of this module keep
// working unchanged.
export type { HubSchemaField, HubValidationError, StagedHubOperation };

// Alias retained for backwards compatibility with this module's existing
// naming (identical shape to HubSchema).
export type HubSchemaResponse = HubSchema;

export interface StagedEntry {
  entry_id: string;
  data: Record<string, any>;
  row_index?: number;
}

export interface StagedHubActionParams {
  hubId: string;
  operation: StagedHubOperation;
  entryId?: string;
  data?: Record<string, any>;
  rows?: Record<string, any>[];
}

export interface StagedHubActionResponse {
  entries?: StagedEntry[];
  errors?: HubValidationError[];
  entry_id?: string;
  data?: Record<string, any>;
  finalized_count?: number;
}

// Minimal client interface this hook depends on. The real Feathery client
// (added in R4) satisfies this structurally. stagedHubAction may resolve to
// null when the underlying request never produced a response (e.g. the
// client is offline) — callers must guard against that explicitly.
export interface DataMappingClient {
  fetchHubSchemas: (hubIds: string[]) => Promise<HubSchemaResponse[]>;
  stagedHubAction: (
    params: StagedHubActionParams
  ) => Promise<StagedHubActionResponse | null>;
}

export interface DataMappingHubConfig {
  hub_id: string;
  excluded_field_ids: string[];
}

export interface DataMappingModalConfig {
  hubs: DataMappingHubConfig[];
}

export interface HubTabState {
  hubId: string;
  hubKey: string;
  fields: HubSchemaField[];
  staged: { entryId: string; data: Record<string, any> }[];
  errors: HubValidationError[];
}

export type DataMappingMode = 'loading' | 'error' | 'import' | 'review';

export interface UseDataMapping {
  mode: DataMappingMode;
  loadError: string | null;
  tabs: HubTabState[];
  activeTab: number;
  setActiveTab: (i: number) => void;
  // import mode
  sheets: NormalizedSheet[];
  loadFile: (file: File) => Promise<void>;
  parseError: string | null;
  mapping: FieldMapping;
  setFieldColumn: (fieldKey: string, ref: ColumnRef | null) => void;
  requiredUnmapped: string[];
  stageAll: () => Promise<void>;
  // review mode
  updateCell: (
    hubId: string,
    entryId: string,
    fieldKey: string,
    value: any
  ) => Promise<void>;
  finalizeAll: () => Promise<{ ok: boolean }>;
  startReupload: () => void;
  busy: boolean;
  requestError: string | null;
}

export const PARSE_ERROR_MESSAGE =
  "Couldn't read this file. Please upload a valid CSV or Excel file.";
export const REQUEST_ERROR_MESSAGE =
  'Something went wrong. Your data is saved — try again.';
export const STAGE_ERROR_MESSAGE =
  "Something went wrong and your import wasn't saved. Please try again.";

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return 'Unknown error';
};

const buildTab = (
  hubConfig: DataMappingHubConfig,
  schemas: HubSchemaResponse[],
  staged: StagedHubActionResponse
): HubTabState => {
  const schema = schemas.find((s) => s.id === hubConfig.hub_id);
  const excluded = new Set(hubConfig.excluded_field_ids ?? []);
  const fields = (schema?.fields ?? [])
    .filter((field) => !excluded.has(field.id))
    .slice()
    .sort((a, b) => a.order - b.order);

  return {
    hubId: hubConfig.hub_id,
    hubKey: schema?.key ?? '',
    fields,
    staged: (staged.entries ?? []).map((entry) => ({
      entryId: entry.entry_id,
      data: entry.data
    })),
    errors: staged.errors ?? []
  };
};

// Replace all errors belonging to a given entry with a fresh set (an empty
// fresh set clears prior errors for that row).
const replaceRowErrors = (
  errors: HubValidationError[],
  entryId: string,
  freshErrors: HubValidationError[]
): HubValidationError[] => [
  ...errors.filter((e) => e.entry_id !== entryId),
  ...freshErrors
];

export default function useDataMapping(
  config: DataMappingModalConfig,
  client: DataMappingClient
): UseDataMapping {
  const [mode, setMode] = useState<DataMappingMode>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<HubTabState[]>([]);
  const [activeTab, setActiveTab] = useState(0);

  const [sheets, setSheets] = useState<NormalizedSheet[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<FieldMapping>({});

  const [busy, setBusy] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  // Refs so async callbacks always see the latest state without needing to
  // recreate the callback (and without stale closures).
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const sheetsRef = useRef(sheets);
  sheetsRef.current = sheets;

  useEffect(() => {
    let cancelled = false;
    const hubIds = config.hubs.map((h) => h.hub_id);

    (async () => {
      setBusy(true);
      try {
        const [schemas, ...stagedResults] = await Promise.all([
          client.fetchHubSchemas(hubIds),
          ...hubIds.map((hubId) =>
            client.stagedHubAction({ hubId, operation: 'get_staged' })
          )
        ]);
        if (cancelled) return;

        const newTabs = config.hubs.map((hubConfig, i) =>
          buildTab(
            hubConfig,
            schemas,
            stagedResults[i] ?? { entries: [], errors: [] }
          )
        );
        const anyStaged = newTabs.some((tab) => tab.staged.length > 0);
        setTabs(newTabs);
        setMode(anyStaged ? 'review' : 'import');
      } catch (error: unknown) {
        if (cancelled) return;
        setLoadError(getErrorMessage(error));
        setMode('error');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Config/client are provided once per modal instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const autoMap = useCallback((normalizedSheets: NormalizedSheet[]) => {
    setMapping((prev) => {
      const next = { ...prev };
      tabsRef.current.forEach((tab) => {
        tab.fields.forEach((field) => {
          if (next[field.key] !== undefined) return;
          for (let i = 0; i < normalizedSheets.length; i++) {
            const header = normalizedSheets[i].headers.find(
              (h) => h.toLowerCase() === field.key.toLowerCase()
            );
            if (header !== undefined) {
              next[field.key] = { sheetIndex: i, header };
              break;
            }
          }
        });
      });
      return next;
    });
  }, []);

  const loadFile = useCallback(
    async (file: File) => {
      setParseError(null);
      try {
        const rawSheets = await parseWorkbook(file);
        const normalized: NormalizedSheet[] = rawSheets
          .map((sheet) => ({
            name: sheet.name,
            ...normalizeSpreadsheet(sheet.rows)
          }))
          .filter((sheet) => sheet.headers.length > 0);

        if (normalized.length === 0) {
          setParseError(PARSE_ERROR_MESSAGE);
          return;
        }

        setSheets(normalized);
        autoMap(normalized);
      } catch {
        setParseError(PARSE_ERROR_MESSAGE);
      }
    },
    [autoMap]
  );

  const setFieldColumn = useCallback(
    (fieldKey: string, ref: ColumnRef | null) => {
      setMapping((prev) => {
        const next = { ...prev };
        if (ref === null) delete next[fieldKey];
        else next[fieldKey] = ref;
        return next;
      });
    },
    []
  );

  const requiredUnmapped = useMemo(() => {
    const keys = new Set<string>();
    tabs.forEach((tab) =>
      tab.fields.forEach((field) => {
        if (field.required && mapping[field.key] === undefined) {
          keys.add(field.key);
        }
      })
    );
    return Array.from(keys);
  }, [tabs, mapping]);

  const stageAll = useCallback(async () => {
    if (requiredUnmapped.length > 0) return;

    setBusy(true);
    setRequestError(null);
    try {
      const updatedTabs: HubTabState[] = [];
      for (const tab of tabsRef.current) {
        const tabMapping: FieldMapping = {};
        const fieldTypeByKey: Record<string, string> = {};
        tab.fields.forEach((field) => {
          fieldTypeByKey[field.key] = field.type;
          if (mapping[field.key] !== undefined) {
            tabMapping[field.key] = mapping[field.key];
          }
        });

        const rows = buildMappedRows(
          sheetsRef.current,
          tabMapping,
          (fieldKey, raw) => coerceToHubType(raw, fieldTypeByKey[fieldKey])
        );

        const stageResp = (await client.stagedHubAction({
          hubId: tab.hubId,
          operation: 'stage',
          rows
        })) ?? { entries: [], errors: [] };
        const stagedResp = (await client.stagedHubAction({
          hubId: tab.hubId,
          operation: 'get_staged'
        })) ?? { entries: [], errors: [] };

        updatedTabs.push({
          ...tab,
          staged: (stagedResp.entries ?? []).map((entry) => ({
            entryId: entry.entry_id,
            data: entry.data
          })),
          errors: stageResp.errors ?? stagedResp.errors ?? []
        });
      }
      setTabs(updatedTabs);
      setMode('review');
    } catch {
      setRequestError(STAGE_ERROR_MESSAGE);
    } finally {
      setBusy(false);
    }
  }, [requiredUnmapped, mapping, client]);

  const updateCell = useCallback(
    async (hubId: string, entryId: string, fieldKey: string, value: any) => {
      setBusy(true);
      setRequestError(null);
      try {
        const tab = tabsRef.current.find((t) => t.hubId === hubId);
        const fieldType =
          tab?.fields.find((f) => f.key === fieldKey)?.type ?? 'text';
        const coerced = coerceToHubType(String(value ?? ''), fieldType);

        const resp = await client.stagedHubAction({
          hubId,
          operation: 'update_staged',
          entryId,
          data: { [fieldKey]: coerced }
        });

        if (!resp) {
          setRequestError(REQUEST_ERROR_MESSAGE);
          return;
        }

        setTabs((prev) =>
          prev.map((t) => {
            if (t.hubId !== hubId) return t;
            return {
              ...t,
              staged: t.staged.map((s) =>
                s.entryId === entryId
                  ? {
                      ...s,
                      data: {
                        ...s.data,
                        [fieldKey]: resp.data?.[fieldKey] ?? coerced
                      }
                    }
                  : s
              ),
              errors: replaceRowErrors(t.errors, entryId, resp.errors ?? [])
            };
          })
        );
      } catch {
        setRequestError(REQUEST_ERROR_MESSAGE);
      } finally {
        setBusy(false);
      }
    },
    [client]
  );

  const finalizeAll = useCallback(async (): Promise<{ ok: boolean }> => {
    setBusy(true);
    setRequestError(null);
    try {
      let anyErrors = false;
      const updatedTabs: HubTabState[] = [];
      for (const tab of tabsRef.current) {
        const resp = await client.stagedHubAction({
          hubId: tab.hubId,
          operation: 'finalize'
        });
        if (!resp) {
          setRequestError(REQUEST_ERROR_MESSAGE);
          return { ok: false };
        }
        if (resp.errors && resp.errors.length > 0) {
          anyErrors = true;
          updatedTabs.push({ ...tab, errors: resp.errors });
        } else {
          updatedTabs.push(tab);
        }
      }
      setTabs(updatedTabs);
      return { ok: !anyErrors };
    } catch {
      setRequestError(REQUEST_ERROR_MESSAGE);
      return { ok: false };
    } finally {
      setBusy(false);
    }
  }, [client]);

  const startReupload = useCallback(() => {
    setMode('import');
  }, []);

  return {
    mode,
    loadError,
    tabs,
    activeTab,
    setActiveTab,
    sheets,
    loadFile,
    parseError,
    mapping,
    setFieldColumn,
    requiredUnmapped,
    stageAll,
    updateCell,
    finalizeAll,
    startReupload,
    busy,
    requestError
  };
}
