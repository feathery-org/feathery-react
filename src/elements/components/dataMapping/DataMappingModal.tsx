import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MODAL_Z_INDEX } from '../../../utils/styles';
import { featheryDoc } from '../../../utils/browser';
import {
  buildStagedRows,
  ColumnRef,
  FieldMapping,
  isSpreadsheetFile,
  NormalizedSheet,
  normalizeSpreadsheet,
  parseWorkbook
} from '../../../utils/spreadsheet';
import {
  DataMappingClient,
  HubFieldSchema,
  HubSchema,
  MappingHubConfig,
  StagedEntry,
  StagedError
} from './types';

const MAX_PREVIEW_ROWS = 5;
// Delimiter for internal error-map keys only (never used in DOM values).
const SEP = '\u001f';

interface DataMappingModalProps {
  hubs: MappingHubConfig[];
  client: DataMappingClient;
  responsiveStyles?: any;
  onClose: () => void;
}

// Per-hub import state: which uploaded sheet feeds this hub and how its fields
// map onto that workbook's columns (keyed by field key -> {sheet, header}).
interface HubImportState {
  selectedSheet: number;
  mapping: FieldMapping;
}

const enc = (sheet: string, header: string) => JSON.stringify([sheet, header]);

// Auto-map each field to a column whose header matches its key
// (case-insensitive), searching the preferred sheet first, then the rest.
function autoMap(
  fields: HubFieldSchema[],
  sheets: NormalizedSheet[],
  preferSheet?: string
): FieldMapping {
  const ordered = preferSheet
    ? [
        ...sheets.filter((s) => s.name === preferSheet),
        ...sheets.filter((s) => s.name !== preferSheet)
      ]
    : sheets;
  const mapping: FieldMapping = {};
  fields.forEach((field) => {
    for (const sheet of ordered) {
      const header = sheet.headers.find(
        (h) => h.toLowerCase() === field.key.toLowerCase()
      );
      if (header) {
        mapping[field.key] = { sheet: sheet.name, header };
        break;
      }
    }
  });
  return mapping;
}

function DataMappingModal({
  hubs,
  client,
  responsiveStyles,
  onClose
}: DataMappingModalProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [schemas, setSchemas] = useState<HubSchema[]>([]);
  const [mode, setMode] = useState<'import' | 'review'>('import');
  const [activeStep, setActiveStep] = useState(0);

  const [staged, setStaged] = useState<Record<string, StagedEntry[]>>({});
  const [stagedErrors, setStagedErrors] = useState<
    Record<string, StagedError[]>
  >({});

  // Raw parsed sheets (header row NOT yet assumed) + the chosen header-row
  // index per sheet. `sheets` is derived by slicing each raw sheet at its
  // header row, so the user can point at a header that isn't on line 1.
  const [rawSheets, setRawSheets] = useState<
    { name: string; rows: string[][] }[]
  >([]);
  const [headerRows, setHeaderRows] = useState<number[]>([]);
  const sheets = useMemo<NormalizedSheet[]>(
    () =>
      rawSheets.map((rs, i) => ({
        name: rs.name,
        ...normalizeSpreadsheet(rs.rows.slice(headerRows[i] ?? 0))
      })),
    [rawSheets, headerRows]
  );
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const [perHub, setPerHub] = useState<Record<string, HubImportState>>({});

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  // Review-mode toolbar state (per-active-hub filtering/grouping).
  const [reviewSearch, setReviewSearch] = useState('');
  const [groupBy, setGroupBy] = useState('');
  // Group values whose section is expanded (default: all collapsed).
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  // Two-step finalize: first click asks for confirmation.
  const [confirmingFinalize, setConfirmingFinalize] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const excludedByHub = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    hubs.forEach((h) => {
      map[h.hub_id] = new Set(h.excluded_field_ids || []);
    });
    return map;
  }, [hubs]);

  const hubIds = useMemo(() => hubs.map((h) => h.hub_id), [hubs]);

  const fieldsForHub = (hubId: string): HubFieldSchema[] => {
    const schema = schemas.find((h) => h.id === hubId);
    const excluded = excludedByHub[hubId];
    return (schema?.fields || []).filter((f) => !excluded?.has(f.id));
  };

  const refreshAllStaged = async (hubList: HubSchema[]) => {
    const results = await Promise.all(
      hubList.map((hub) =>
        client
          .dataHubAction({ hubId: hub.id, operation: 'get_staged' })
          .then((r: any) => ({ hubId: hub.id, ...r }))
      )
    );
    const stagedMap: Record<string, StagedEntry[]> = {};
    const errorMap: Record<string, StagedError[]> = {};
    results.forEach((r: any) => {
      stagedMap[r.hubId] = r.entries || [];
      errorMap[r.hubId] = r.errors || [];
    });
    setStaged(stagedMap);
    setStagedErrors(errorMap);
    return stagedMap;
  };

  // Load schemas + staged rows for every configured hub on open. If any hub
  // already has staged data, open straight into the editable review preview.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const schemaResp = await client.getHubSchemas(hubIds);
        const orderedSchemas: HubSchema[] = hubIds
          .map((id) => schemaResp.hubs.find((h) => h.id === id))
          .filter(Boolean) as HubSchema[];

        const stagedMap = await refreshAllStaged(orderedSchemas);
        if (cancelled) return;

        const hasStaged = Object.values(stagedMap).some(
          (e) => (e || []).length > 0
        );
        setSchemas(orderedSchemas);
        setMode(hasStaged ? 'review' : 'import');
        setActiveStep(0);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setLoadError("Couldn't load the data hubs. Please try again.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, hubIds]);

  // Escape closes; focus the dialog on open for basic accessibility.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const doc = featheryDoc();
    doc.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => doc.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fontFamily =
    responsiveStyles?.getTarget?.('fc')?.fontFamily ?? 'sans-serif';

  const activeHubId = schemas[activeStep]?.id ?? '';
  const activeFields = fieldsForHub(activeHubId);
  const activeState = perHub[activeHubId];
  const activeSheet =
    sheets[activeState?.selectedSheet ?? 0] ?? sheets[0] ?? null;

  const isLastStep = activeStep >= schemas.length - 1;

  // Required fields not yet mapped, labeled by hub when there are several.
  const missingRequired =
    sheets.length === 0
      ? []
      : schemas.flatMap((hub) => {
          const st = perHub[hub.id];
          return fieldsForHub(hub.id)
            .filter((f) => f.required && !st?.mapping[f.key])
            .map((f) => (schemas.length > 1 ? `${hub.key}: ${f.key}` : f.key));
        });
  const allRequiredMapped = sheets.length > 0 && missingRequired.length === 0;

  const handleFile = async (file: File) => {
    if (!isSpreadsheetFile(file)) {
      setFileError('Unsupported file type. Upload a CSV or Excel file.');
      return;
    }
    try {
      const raw = (await parseWorkbook(file)).filter(
        (s) => (s.rows || []).length > 0
      );
      if (raw.length === 0) {
        setFileError("Couldn't find any data in this file.");
        return;
      }
      // Default header row = first row of each sheet.
      const derived: NormalizedSheet[] = raw.map((rs) => ({
        name: rs.name,
        ...normalizeSpreadsheet(rs.rows)
      }));
      const nextPerHub: Record<string, HubImportState> = {};
      schemas.forEach((hub) => {
        nextPerHub[hub.id] = {
          selectedSheet: 0,
          mapping: autoMap(fieldsForHub(hub.id), derived, derived[0]?.name)
        };
      });
      setRawSheets(raw);
      setHeaderRows(raw.map(() => 0));
      setFileName(file.name);
      setPerHub(nextPerHub);
      setFileError('');
      setActionError('');
    } catch (e) {
      setFileError(
        "Couldn't read this file. Make sure it's a valid CSV or Excel file."
      );
    }
  };

  const setSelectedSheet = (hubId: string, index: number) =>
    setPerHub((prev) => ({
      ...prev,
      [hubId]: {
        selectedSheet: index,
        mapping: prev[hubId]?.mapping ?? {}
      }
    }));

  // Change which row is the header for a sheet. Column meanings change, so
  // re-auto-map every hub against the newly derived headers.
  const setHeaderRow = (sheetIndex: number, rowIndex: number) => {
    const nextHeaderRows = headerRows.map((h, i) =>
      i === sheetIndex ? rowIndex : h
    );
    const derived: NormalizedSheet[] = rawSheets.map((rs, i) => ({
      name: rs.name,
      ...normalizeSpreadsheet(rs.rows.slice(nextHeaderRows[i] ?? 0))
    }));
    setHeaderRows(nextHeaderRows);
    setPerHub((prev) => {
      const next = { ...prev };
      schemas.forEach((hub) => {
        const sel = prev[hub.id]?.selectedSheet ?? 0;
        next[hub.id] = {
          selectedSheet: sel,
          mapping: autoMap(fieldsForHub(hub.id), derived, derived[sel]?.name)
        };
      });
      return next;
    });
  };

  const setFieldColumn = (fieldKey: string, ref: ColumnRef | null) =>
    setPerHub((prev) => {
      const cur = prev[activeHubId];
      if (!cur) return prev;
      const mapping = { ...cur.mapping };
      if (ref) mapping[fieldKey] = ref;
      else delete mapping[fieldKey];
      return { ...prev, [activeHubId]: { ...cur, mapping } };
    });

  const handleSave = async () => {
    setBusy(true);
    setActionError('');
    try {
      for (const hub of schemas) {
        const st = perHub[hub.id];
        if (!st) continue;
        const rows = buildStagedRows(sheets, st.mapping);
        await client.dataHubAction({
          hubId: hub.id,
          operation: 'stage',
          rows
        });
      }
      await refreshAllStaged(schemas);
      setMode('review');
      setActiveStep(0);
    } catch (e: any) {
      setActionError(e?.message || 'Failed to save the mapped rows.');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateCell = async (
    entryId: string,
    fieldKey: string,
    value: string
  ) => {
    try {
      const resp = await client.dataHubAction({
        hubId: activeHubId,
        operation: 'update_staged',
        entryId,
        data: { [fieldKey]: value }
      });
      const newData: Record<string, any> = resp?.data ?? undefined;
      setStaged((prev) => ({
        ...prev,
        [activeHubId]: (prev[activeHubId] || []).map((en) =>
          en.entry_id === entryId
            ? {
                ...en,
                data: newData ?? { ...en.data, [fieldKey]: value }
              }
            : en
        )
      }));
      setStagedErrors((prev) => {
        const others = (prev[activeHubId] || []).filter(
          (er) => er.entry_id !== entryId
        );
        const fresh = (resp?.errors || []).map((er: StagedError) => ({
          ...er,
          entry_id: er.entry_id ?? entryId
        }));
        return { ...prev, [activeHubId]: [...others, ...fresh] };
      });
    } catch (e: any) {
      setActionError(e?.message || 'Failed to update this value.');
    }
  };

  const handleDeleteRow = async (entryId: string) => {
    setBusy(true);
    setActionError('');
    try {
      await client.dataHubAction({
        hubId: activeHubId,
        operation: 'delete_staged',
        entryId
      });
      setStaged((prev) => ({
        ...prev,
        [activeHubId]: (prev[activeHubId] || []).filter(
          (en) => en.entry_id !== entryId
        )
      }));
      setStagedErrors((prev) => ({
        ...prev,
        [activeHubId]: (prev[activeHubId] || []).filter(
          (er) => er.entry_id !== entryId
        )
      }));
    } catch (e: any) {
      setActionError(e?.message || 'Failed to delete this row.');
    } finally {
      setBusy(false);
    }
  };

  const handleFinalize = async () => {
    setBusy(true);
    setActionError('');
    setConfirmingFinalize(false);
    let failed = false;
    let msg = '';
    for (const hub of schemas) {
      if ((staged[hub.id] || []).length === 0) continue;
      try {
        const resp = await client.dataHubAction({
          hubId: hub.id,
          operation: 'finalize'
        });
        if (resp?.errors?.length) {
          failed = true;
          msg = msg || resp.errors[0]?.message;
        }
      } catch (e: any) {
        failed = true;
        msg = msg || e?.message;
      }
    }
    if (failed) {
      setActionError(
        msg || 'Some rows are still invalid. Fix them and try again.'
      );
      await refreshAllStaged(schemas).catch(() => ({}));
      setBusy(false);
    } else {
      setBusy(false);
      onClose();
    }
  };

  const btn = (primary: boolean, disabled = false) => ({
    padding: '8px 18px',
    borderRadius: '8px',
    border: primary ? 'none' : '1px solid #e4e4e7',
    backgroundColor: primary ? (disabled ? '#a1a1aa' : '#0b1324') : '#fff',
    color: primary ? '#fff' : '#0b1324',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily
  });

  const shell = (
    body: React.ReactNode,
    footer?: React.ReactNode,
    compact = false
  ) => (
    <div
      css={{
        position: 'fixed',
        display: 'flex',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: 'rgba(0, 0, 0, 0.2)',
        zIndex: MODAL_Z_INDEX,
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '14px',
        fontFamily
      }}
    >
      <div
        // Backdrop click closes, but never mid-operation.
        onClick={() => {
          if (busy) return;
          onClose();
        }}
        css={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%'
        }}
      />
      <div
        ref={dialogRef}
        role='dialog'
        aria-modal='true'
        aria-label='Map Spreadsheet Columns'
        tabIndex={-1}
        className='feathery-modal'
        css={{
          position: 'relative',
          backgroundColor: '#fff',
          borderRadius: '14px',
          width: compact ? 'auto' : '85vw',
          maxWidth: compact ? '600px' : '1600px',
          height: compact ? 'auto' : '85vh',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
          outline: 'none'
        }}
      >
        {/* Header */}
        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            padding: '20px',
            borderBottom: '1px solid #e9e9e9',
            flex: '0 0 auto'
          }}
        >
          <div css={{ fontSize: '18px', fontWeight: 600 }}>
            Map Spreadsheet Columns
          </div>
          {fileName && (
            <div css={{ color: '#71717a', fontSize: '13px' }}>{fileName}</div>
          )}
        </div>

        {/* Body */}
        <div
          css={{
            flex: '1 1 auto',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            padding: '20px',
            gap: '16px'
          }}
        >
          {body}
        </div>

        {/* Footer */}
        <div
          css={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '10px',
            padding: '16px 20px',
            borderTop: '1px solid #e9e9e9',
            flex: '0 0 auto'
          }}
        >
          <button type='button' onClick={onClose} css={btn(false)}>
            Cancel
          </button>
          <div css={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {actionError && (
              <span css={{ color: '#ef4444', fontSize: '13px' }}>
                {actionError}
              </span>
            )}
            {footer}
          </div>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return shell(
      <div css={{ color: '#71717a' }}>Loading…</div>,
      undefined,
      true
    );
  }
  if (loadError) {
    return shell(
      <div css={{ color: '#ef4444' }}>{loadError}</div>,
      undefined,
      true
    );
  }

  // Numbered hub tabs shared by both modes.
  const tabs = (
    <div css={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
      {schemas.map((hub, i) => (
        <button
          key={hub.id}
          type='button'
          onClick={() => setActiveStep(i)}
          css={{
            padding: '6px 12px',
            borderRadius: '999px',
            border: '1px solid',
            borderColor: i === activeStep ? '#0b1324' : '#e4e4e7',
            backgroundColor: i === activeStep ? '#0b1324' : '#fff',
            color: i === activeStep ? '#fff' : '#3f3f46',
            cursor: 'pointer',
            fontFamily,
            fontSize: '13px',
            whiteSpace: 'nowrap'
          }}
        >
          {i + 1}. {hub.key}
        </button>
      ))}
    </div>
  );

  // ---- Review mode: editable staged preview ----
  if (mode === 'review') {
    const entries = staged[activeHubId] || [];
    const hubErrors = stagedErrors[activeHubId] || [];
    const rowErrors: Record<string, string> = {};
    const cellErrors: Record<string, string> = {};
    hubErrors.forEach((er) => {
      if (er.entry_id && !er.field_key) rowErrors[er.entry_id] = er.message;
      if (er.entry_id && er.field_key)
        cellErrors[`${er.entry_id}${SEP}${er.field_key}`] = er.message;
    });

    // Client-side required-field check across ALL hubs (finalize runs them all),
    // so we can block finalize and point the user at the empty required values.
    const rowsMissingRequired = schemas.reduce((n, hub) => {
      const reqFields = fieldsForHub(hub.id).filter((f) => f.required);
      return (
        n +
        (staged[hub.id] || []).filter((en) =>
          reqFields.some((f) => String(en.data[f.key] ?? '').trim() === '')
        ).length
      );
    }, 0);

    // 1. Search filter: keep rows where any mapped value contains the query.
    const query = reviewSearch.trim().toLowerCase();
    const filteredEntries = query
      ? entries.filter((entry) =>
          activeFields.some((f) =>
            String(entry.data[f.key] ?? '')
              .toLowerCase()
              .includes(query)
          )
        )
      : entries;

    // 2. Group filter survivors by the selected field's value (if any).
    const EMPTY_GROUP = '(empty)';
    const groups: { value: string; entries: StagedEntry[] }[] = [];
    if (groupBy) {
      const order: string[] = [];
      const byValue: Record<string, StagedEntry[]> = {};
      filteredEntries.forEach((entry) => {
        const raw = String(entry.data[groupBy] ?? '').trim();
        const value = raw === '' ? EMPTY_GROUP : raw;
        if (!byValue[value]) {
          byValue[value] = [];
          order.push(value);
        }
        byValue[value].push(entry);
      });
      order.forEach((value) => groups.push({ value, entries: byValue[value] }));
    }

    const toggleGroup = (value: string) =>
      setExpandedGroups((prev) => {
        const next = new Set(prev);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        return next;
      });

    const colCount = activeFields.length + 1;

    const isMissingRequired = (entry: StagedEntry, f: HubFieldSchema) =>
      f.required && String(entry.data[f.key] ?? '').trim() === '';

    // A row "needs attention" if it has a server error or an empty required
    // field — used to badge collapsed groups so problems aren't hidden.
    const rowHasIssue = (entry: StagedEntry) =>
      !!rowErrors[entry.entry_id] ||
      activeFields.some(
        (f) =>
          isMissingRequired(entry, f) ||
          !!cellErrors[`${entry.entry_id}${SEP}${f.key}`]
      );

    const renderRow = (entry: StagedEntry) => {
      const rowMsg = rowErrors[entry.entry_id];
      const rowMissing = activeFields.some((f) => isMissingRequired(entry, f));
      return (
        <tr
          key={entry.entry_id}
          css={{
            backgroundColor: rowMsg || rowMissing ? '#fef2f2' : undefined
          }}
          title={rowMsg || (rowMissing ? 'Missing required values' : undefined)}
        >
          {activeFields.map((f) => {
            const cellMsg = cellErrors[`${entry.entry_id}${SEP}${f.key}`];
            const missing = isMissingRequired(entry, f);
            const invalid = !!cellMsg || missing;
            return (
              <td
                key={f.id}
                css={{
                  padding: '4px 6px',
                  borderBottom: '1px solid #f4f4f5'
                }}
                title={cellMsg || (missing ? 'Required field' : undefined)}
              >
                <input
                  defaultValue={entry.data[f.key] ?? ''}
                  placeholder={f.required ? 'Required' : undefined}
                  onBlur={(e) => {
                    if (e.target.value !== (entry.data[f.key] ?? ''))
                      handleUpdateCell(entry.entry_id, f.key, e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter')
                      (e.target as HTMLInputElement).blur();
                  }}
                  css={{
                    width: '150px',
                    padding: '6px 8px',
                    border: `1px solid ${invalid ? '#ef4444' : '#e4e4e7'}`,
                    borderRadius: '6px',
                    backgroundColor: invalid ? '#fef2f2' : '#fff',
                    fontFamily
                  }}
                />
              </td>
            );
          })}
          <td
            css={{
              padding: '4px 6px',
              borderBottom: '1px solid #f4f4f5',
              textAlign: 'center'
            }}
          >
            <button
              type='button'
              disabled={busy}
              title='Delete this row'
              aria-label='Delete this row'
              onClick={() => handleDeleteRow(entry.entry_id)}
              css={{
                border: 'none',
                background: 'none',
                color: busy ? '#a1a1aa' : '#71717a',
                cursor: busy ? 'not-allowed' : 'pointer',
                fontSize: '16px',
                lineHeight: 1,
                padding: '4px 8px',
                borderRadius: '6px',
                fontFamily,
                '&:hover': busy ? undefined : { color: '#ef4444' }
              }}
            >
              ×
            </button>
          </td>
        </tr>
      );
    };

    const inputStyle = {
      padding: '8px 10px',
      border: '1px solid #e4e4e7',
      borderRadius: '6px',
      backgroundColor: '#fff',
      fontFamily
    };

    const reviewBody = (
      <>
        {schemas.length > 1 && tabs}
        <div css={{ color: '#71717a', fontSize: '13px', flex: '0 0 auto' }}>
          {entries.length} row{entries.length === 1 ? '' : 's'} staged
          {hubErrors.length > 0 && ` · ${hubErrors.length} need fixing`}
          {rowsMissingRequired > 0 &&
            ` · ${rowsMissingRequired} missing required`}
          . Edit any value below, then save your changes or finalize to submit.
        </div>
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
            flex: '0 0 auto'
          }}
        >
          <input
            type='text'
            value={reviewSearch}
            placeholder='Search staged rows…'
            onChange={(e) => setReviewSearch(e.target.value)}
            css={{ ...inputStyle, minWidth: '220px', flex: '0 1 280px' }}
          />
          <div css={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span css={{ fontWeight: 600, color: '#3f3f46' }}>Group by</span>
            <select
              value={groupBy}
              onChange={(e) => {
                setGroupBy(e.target.value);
                setExpandedGroups(new Set());
              }}
              css={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value=''>None</option>
              {activeFields.map((f) => (
                <option key={f.id} value={f.key}>
                  {f.key}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div css={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
          <table css={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                {activeFields.map((f) => (
                  <th
                    key={f.id}
                    css={{
                      textAlign: 'left',
                      padding: '6px 10px',
                      borderBottom: '1px solid #e4e4e7',
                      backgroundColor: '#fafafa',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      position: 'sticky',
                      top: 0
                    }}
                  >
                    {f.key}
                    {f.required && <span css={{ color: '#ef4444' }}> *</span>}
                  </th>
                ))}
                <th
                  css={{
                    padding: '6px 10px',
                    borderBottom: '1px solid #e4e4e7',
                    backgroundColor: '#fafafa',
                    position: 'sticky',
                    top: 0,
                    width: '40px'
                  }}
                />
              </tr>
            </thead>
            <tbody>
              {!groupBy && filteredEntries.map((entry) => renderRow(entry))}
              {groupBy &&
                groups.map((group) => {
                  const collapsed = !expandedGroups.has(group.value);
                  const issueCount = group.entries.filter(rowHasIssue).length;
                  return (
                    <React.Fragment key={group.value}>
                      <tr>
                        <td
                          colSpan={colCount}
                          onClick={() => toggleGroup(group.value)}
                          css={{
                            padding: '8px 10px',
                            borderBottom: '1px solid #e4e4e7',
                            backgroundColor:
                              issueCount > 0 ? '#fef2f2' : '#f4f4f5',
                            fontWeight: 600,
                            color: '#3f3f46',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          <span css={{ marginRight: '8px' }}>
                            {collapsed ? '▸' : '▾'}
                          </span>
                          {group.value}
                          {issueCount > 0 && (
                            <span
                              css={{
                                marginLeft: '10px',
                                backgroundColor: '#fee2e2',
                                color: '#b91c1c',
                                borderRadius: '9999px',
                                padding: '2px 8px',
                                fontSize: '12px',
                                fontWeight: 600
                              }}
                            >
                              ⚠ {issueCount} need
                              {issueCount === 1 ? 's' : ''} attention
                            </span>
                          )}
                        </td>
                      </tr>
                      {!collapsed &&
                        group.entries.map((entry) => renderRow(entry))}
                    </React.Fragment>
                  );
                })}
              {filteredEntries.length === 0 && (
                <tr>
                  <td
                    css={{ padding: '10px', color: '#71717a' }}
                    colSpan={colCount}
                  >
                    {entries.length === 0
                      ? 'No staged rows for this hub.'
                      : 'No rows match your search.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </>
    );

    const totalStaged = schemas.reduce(
      (n, hub) => n + (staged[hub.id] || []).length,
      0
    );

    const reviewFooter = confirmingFinalize ? (
      <>
        <span
          css={{
            marginRight: 'auto',
            color: '#3f3f46',
            fontWeight: 600
          }}
        >
          Finalize {totalStaged} row{totalStaged === 1 ? '' : 's'} into the data
          hub? This moves them into live data and can&apos;t be undone.
        </span>
        <button
          type='button'
          disabled={busy}
          onClick={() => setConfirmingFinalize(false)}
          css={btn(false, busy)}
        >
          Cancel
        </button>
        <button
          type='button'
          disabled={busy}
          onClick={handleFinalize}
          css={btn(true, busy)}
        >
          Yes, finalize
        </button>
      </>
    ) : (
      <>
        <button
          type='button'
          disabled={busy}
          onClick={() => {
            setActionError('');
            setMode('import');
            setActiveStep(0);
          }}
          css={btn(false, busy)}
        >
          Back
        </button>
        <button
          type='button'
          disabled={busy}
          // Edits are already persisted as staged (dirty) data on each change,
          // so "Save changes" just closes without promoting to live data.
          onClick={onClose}
          css={btn(false, busy)}
        >
          Save changes
        </button>
        <span
          css={{
            position: 'relative',
            display: 'inline-block',
            '&:hover .dm-final-tip': { opacity: 1, visibility: 'visible' }
          }}
        >
          <button
            type='button'
            disabled={busy || rowsMissingRequired > 0}
            onClick={() => setConfirmingFinalize(true)}
            css={{
              ...btn(true, busy || rowsMissingRequired > 0),
              pointerEvents: busy || rowsMissingRequired > 0 ? 'none' : 'auto'
            }}
          >
            Finalize
          </button>
          {rowsMissingRequired > 0 && (
            <div
              className='dm-final-tip'
              css={{
                position: 'absolute',
                bottom: 'calc(100% + 8px)',
                right: 0,
                zIndex: 1,
                opacity: 0,
                visibility: 'hidden',
                transition: 'opacity 0.1s ease',
                backgroundColor: '#18181b',
                color: '#fff',
                padding: '8px 10px',
                borderRadius: '6px',
                fontSize: '12px',
                lineHeight: 1.4,
                width: 'max-content',
                maxWidth: '320px',
                whiteSpace: 'normal',
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
              }}
            >
              {rowsMissingRequired} row{rowsMissingRequired === 1 ? '' : 's'}{' '}
              missing required values (highlighted). Fill them in before
              finalizing.
            </div>
          )}
        </span>
      </>
    );

    return shell(reviewBody, reviewFooter);
  }

  // ---- Import mode ----
  if (sheets.length === 0) {
    const dropzone = (
      <div
        onClick={() => fileInputRef.current?.click()}
        css={{
          border: '2px dashed #e4e4e7',
          borderRadius: '10px',
          padding: '48px',
          textAlign: 'center',
          cursor: 'pointer',
          color: '#71717a'
        }}
      >
        Click to upload a CSV or Excel file
        <div css={{ fontSize: '12px', marginTop: '6px' }}>
          .csv, .xlsx, .xls, .xlsm
        </div>
        {fileError && (
          <div css={{ color: '#ef4444', marginTop: '10px' }}>{fileError}</div>
        )}
        <input
          ref={fileInputRef}
          type='file'
          accept='.csv,.xlsx,.xls,.xlsm'
          css={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) handleFile(file);
          }}
        />
      </div>
    );
    return shell(dropzone, undefined, true);
  }

  const headers = activeSheet?.headers || [];
  const previewRows = (activeSheet?.rows || []).slice(0, MAX_PREVIEW_ROWS);
  const mapping = activeState?.mapping || {};
  const mappedCount = activeFields.filter((f) => !!mapping[f.key]).length;

  const importBody = (
    <>
      {/* Tabs + sheet selector */}
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          flexWrap: 'wrap',
          flex: '0 0 auto'
        }}
      >
        {tabs}
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            flexWrap: 'wrap'
          }}
        >
          {sheets.length > 1 && (
            <div css={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span css={{ fontWeight: 600, color: '#3f3f46' }}>Sheet</span>
              <select
                value={activeState?.selectedSheet ?? 0}
                onChange={(e) =>
                  setSelectedSheet(activeHubId, Number(e.target.value))
                }
                css={{
                  padding: '8px 10px',
                  border: '1px solid #e4e4e7',
                  borderRadius: '6px',
                  backgroundColor: '#fff',
                  fontFamily,
                  cursor: 'pointer'
                }}
              >
                {sheets.map((s, i) => (
                  <option key={i} value={i}>
                    {s.name || `Sheet ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div css={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span css={{ fontWeight: 600, color: '#3f3f46' }}>Header row</span>
            <select
              value={headerRows[activeState?.selectedSheet ?? 0] ?? 0}
              onChange={(e) =>
                setHeaderRow(
                  activeState?.selectedSheet ?? 0,
                  Number(e.target.value)
                )
              }
              css={{
                maxWidth: '260px',
                padding: '8px 10px',
                border: '1px solid #e4e4e7',
                borderRadius: '6px',
                backgroundColor: '#fff',
                fontFamily,
                cursor: 'pointer'
              }}
            >
              {(rawSheets[activeState?.selectedSheet ?? 0]?.rows || [])
                .slice(0, 20)
                .map((row, i) => {
                  const preview = (row || [])
                    .map((c) => (c ?? '').trim())
                    .filter(Boolean)
                    .slice(0, 3)
                    .join(', ');
                  const label = `Row ${i + 1}${
                    preview
                      ? ` — ${
                          preview.length > 40
                            ? `${preview.slice(0, 40)}…`
                            : preview
                        }`
                      : ''
                  }`;
                  return (
                    <option key={i} value={i}>
                      {label}
                    </option>
                  );
                })}
            </select>
          </div>
        </div>
      </div>

      {/* Panels */}
      <div
        css={{ flex: '1 1 auto', minHeight: 0, display: 'flex', gap: '28px' }}
      >
        {/* Field -> column list */}
        <div
          css={{
            flex: '0 0 620px',
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'auto',
            paddingRight: '4px'
          }}
        >
          <div
            css={{
              display: 'flex',
              justifyContent: 'flex-end',
              color: '#71717a',
              marginBottom: '10px',
              position: 'sticky',
              top: 0,
              backgroundColor: '#fff'
            }}
          >
            {mappedCount}/{activeFields.length} mapped
          </div>
          <div
            css={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              width: 'max-content',
              minWidth: '100%'
            }}
          >
            <div
              css={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: 600,
                color: '#3f3f46'
              }}
            >
              <div css={{ flexShrink: 0, minWidth: 320, padding: '0 10px' }}>
                Data Hub
              </div>
              <span css={{ color: 'transparent' }}>=</span>
              <div css={{ flexShrink: 0, width: 240, padding: '0 10px' }}>
                Spreadsheet Columns
              </div>
            </div>
            {activeFields.map((field) => {
              const cur = mapping[field.key];
              const value = cur ? enc(cur.sheet, cur.header) : '';
              const curOnSheet =
                cur &&
                cur.sheet === (activeSheet?.name ?? '') &&
                headers.includes(cur.header);
              return (
                <div
                  key={field.id}
                  css={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <div
                    title={field.key}
                    css={{
                      flexShrink: 0,
                      minWidth: 320,
                      whiteSpace: 'nowrap',
                      padding: '8px 10px',
                      border: '1px solid #e4e4e7',
                      borderRadius: '6px',
                      backgroundColor: '#fafafa'
                    }}
                  >
                    {field.key}
                    {field.required && (
                      <span css={{ color: '#ef4444' }}> *</span>
                    )}
                  </div>
                  <span css={{ color: '#a1a1aa' }}>=</span>
                  <select
                    value={value}
                    onChange={(e) => {
                      if (!e.target.value)
                        return setFieldColumn(field.key, null);
                      const [sheet, header] = JSON.parse(e.target.value) as [
                        string,
                        string
                      ];
                      setFieldColumn(field.key, { sheet, header });
                    }}
                    css={{
                      flexShrink: 0,
                      width: 240,
                      padding: '8px 10px',
                      border: '1px solid #e4e4e7',
                      borderRadius: '6px',
                      backgroundColor: '#fff',
                      fontFamily,
                      cursor: 'pointer'
                    }}
                  >
                    <option value=''>Select column...</option>
                    {/* Keep a selection made on another sheet visible. */}
                    {cur && !curOnSheet && (
                      <option value={enc(cur.sheet, cur.header)}>
                        {sheets.length > 1
                          ? `${cur.sheet}: ${cur.header}`
                          : cur.header}
                      </option>
                    )}
                    {headers.map((header, i) => (
                      <option
                        key={i}
                        value={enc(activeSheet?.name ?? '', header)}
                      >
                        {header}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>

        {/* Preview */}
        <div
          css={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <div
            css={{
              fontWeight: 600,
              color: '#3f3f46',
              marginBottom: '10px',
              flex: '0 0 auto'
            }}
          >
            Preview
          </div>
          <div css={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
            <table css={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  {headers.map((header, i) => (
                    <th
                      key={i}
                      css={{
                        textAlign: 'left',
                        padding: '6px 10px',
                        borderBottom: '1px solid #e4e4e7',
                        backgroundColor: '#fafafa',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        position: 'sticky',
                        top: 0
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, r) => (
                  <tr key={r}>
                    {headers.map((_h, c) => (
                      <td
                        key={c}
                        css={{
                          padding: '6px 10px',
                          borderBottom: '1px solid #f4f4f5',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {row[c] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div
            css={{
              marginTop: '8px',
              color: '#71717a',
              fontSize: '13px',
              flex: '0 0 auto'
            }}
          >
            Showing {previewRows.length} of {activeSheet?.rows.length ?? 0}{' '}
            rows. All values in each mapped column are saved to the field as a
            list.
          </div>
        </div>
      </div>
    </>
  );

  const importFooter = (
    <>
      {activeStep > 0 && (
        <button
          type='button'
          onClick={() => setActiveStep((s) => s - 1)}
          css={btn(false)}
        >
          Back
        </button>
      )}
      {!isLastStep && (
        <button
          type='button'
          onClick={() => setActiveStep((s) => s + 1)}
          css={btn(true)}
        >
          Next
        </button>
      )}
      {isLastStep && (
        // Wrapper shows a custom tooltip on hover. The disabled button has
        // pointer-events:none so the hover reaches the wrapper (a disabled
        // button never fires hover/title itself).
        <span
          css={{
            position: 'relative',
            display: 'inline-block',
            '&:hover .dm-req-tip': { opacity: 1, visibility: 'visible' }
          }}
        >
          <button
            type='button'
            disabled={busy || !allRequiredMapped}
            onClick={handleSave}
            css={{
              ...btn(true, busy || !allRequiredMapped),
              pointerEvents: busy || !allRequiredMapped ? 'none' : 'auto'
            }}
          >
            Save
          </button>
          {missingRequired.length > 0 && (
            <div
              className='dm-req-tip'
              css={{
                position: 'absolute',
                bottom: 'calc(100% + 8px)',
                right: 0,
                zIndex: 1,
                opacity: 0,
                visibility: 'hidden',
                transition: 'opacity 0.1s ease',
                backgroundColor: '#18181b',
                color: '#fff',
                padding: '8px 10px',
                borderRadius: '6px',
                fontSize: '12px',
                lineHeight: 1.4,
                width: 'max-content',
                maxWidth: '320px',
                whiteSpace: 'normal',
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
              }}
            >
              Map required field{missingRequired.length > 1 ? 's' : ''}:{' '}
              {missingRequired.join(', ')}
            </div>
          )}
        </span>
      )}
    </>
  );

  return shell(importBody, importFooter);
}

export default DataMappingModal;
