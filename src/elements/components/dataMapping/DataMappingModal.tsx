import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MODAL_Z_INDEX } from '../../../utils/styles';
import { featheryDoc } from '../../../utils/browser';
import { initInfo } from '../../../utils/init';
import {
  buildUnverifiedRows,
  ColumnRef,
  FieldMapping,
  isSpreadsheetFile,
  NormalizedSheet,
  normalizeSpreadsheet,
  parseWorkbook
} from '../../../utils/spreadsheet';
import HoverTooltip from '../HoverTooltip';
import {
  DataMappingClient,
  HubFieldSchema,
  HubSchema,
  MappingHubConfig
} from './types';

const MAX_PREVIEW_ROWS = 5;
// Progress bar shows at least this long so fast parses still read as activity.
const MIN_PARSE_DISPLAY_MS = 1400;

interface DataMappingModalProps {
  hubs: MappingHubConfig[];
  client: DataMappingClient;
  responsiveStyles?: any;
  onClose: () => void;
}

interface HubImportState {
  selectedSheet: number;
  mapping: FieldMapping;
}

const enc = (sheet: string, header: string) => JSON.stringify([sheet, header]);

const deriveSheets = (
  rawSheets: { name: string; rows: string[][] }[],
  headerRows: number[]
): NormalizedSheet[] =>
  rawSheets.map((rs, i) => ({
    name: rs.name,
    ...normalizeSpreadsheet(rs.rows.slice(headerRows[i] ?? 0))
  }));

interface MappingDraft {
  fileName: string;
  rawSheets: { name: string; rows: string[][] }[];
  headerRows: number[];
  perHub: Record<string, HubImportState>;
}
const draftCache = new Map<string, MappingDraft>();
const draftKey = (hubIds: string[]) => hubIds.join(',');

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

// Field help icon; the shared HoverTooltip portals to document.body, so it
// escapes the modal's scrolling panes and flips when out of room.
function FieldInfoTip({
  field,
  fontFamily
}: {
  field: HubFieldSchema;
  fontFamily: string;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [show, setShow] = useState(false);

  const description = (field.description ?? '').trim();

  if (!description) return null;

  return (
    <>
      <button
        ref={btnRef}
        type='button'
        aria-label={`About ${field.key}`}
        // Presentational only: hover/focus reveals the tip, click does nothing.
        onClick={(e) => e.preventDefault()}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        css={{
          flexShrink: 0,
          marginLeft: '6px',
          width: '16px',
          height: '16px',
          padding: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '9999px',
          border: '1px solid #d4d4d8',
          backgroundColor: '#fff',
          color: '#71717a',
          fontSize: '11px',
          fontWeight: 600,
          lineHeight: 1,
          fontFamily,
          cursor: 'help',
          '&:hover': { borderColor: '#a1a1aa', color: '#3f3f46' }
        }}
      >
        i
      </button>
      <HoverTooltip
        show={show}
        triggerRef={btnRef}
        text={description}
        id={`hub-field-${field.id}`}
        placement='top'
        offset={8}
        maxWidth='280px'
        onHide={() => setShow(false)}
      />
    </>
  );
}

// "Activity" bar while the dropped file is read + parsed. Fills most of the
// way on a CSS transition; real completion unmounts it, so it never stalls at
// an awkward 100%.
function ParseProgressBar({
  label,
  fontFamily
}: {
  label: string;
  fontFamily: string;
}) {
  const [width, setWidth] = useState(4);
  useEffect(() => {
    const id = requestAnimationFrame(() => setWidth(92));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div css={{ padding: '48px 24px', textAlign: 'center' }}>
      <div
        css={{
          marginBottom: '12px',
          color: '#3f3f46',
          fontFamily,
          fontSize: '14px',
          overflowWrap: 'anywhere'
        }}
      >
        {label}
      </div>
      <div
        css={{
          height: '8px',
          borderRadius: '999px',
          backgroundColor: '#f4f4f5',
          overflow: 'hidden'
        }}
      >
        <div
          css={{
            height: '100%',
            width: `${width}%`,
            backgroundColor: '#0b1324',
            borderRadius: '999px',
            transition: 'width 1.6s cubic-bezier(0.2, 0.6, 0.3, 1)',
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' }
          }}
        />
      </div>
    </div>
  );
}

function DataMappingModal({
  hubs,
  client,
  responsiveStyles,
  onClose
}: DataMappingModalProps) {
  // Draft restore is synchronous so reopening the modal is instant; only the
  // hub schemas/counts load over the network.
  const initialDraft = draftCache.get(draftKey(hubs.map((h) => h.hub_id)));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [schemas, setSchemas] = useState<HubSchema[]>([]);
  const [view, setView] = useState<'resume' | 'import'>('import');
  const [activeStep, setActiveStep] = useState(0);

  const [unverifiedCounts, setUnverifiedCounts] = useState<Record<string, number>>({});

  // Header row is NOT assumed to be line 1; `sheets` slices at the chosen one.
  const [rawSheets, setRawSheets] = useState<
    { name: string; rows: string[][] }[]
  >(() => initialDraft?.rawSheets ?? []);
  const [headerRows, setHeaderRows] = useState<number[]>(
    () => initialDraft?.headerRows ?? []
  );
  const sheets = useMemo<NormalizedSheet[]>(
    () => deriveSheets(rawSheets, headerRows),
    [rawSheets, headerRows]
  );
  const [fileName, setFileName] = useState(() => initialDraft?.fileName ?? '');
  const [fileError, setFileError] = useState('');
  const [parsingFile, setParsingFile] = useState('');
  const [perHub, setPerHub] = useState<Record<string, HubImportState>>(
    () => initialDraft?.perHub ?? {}
  );
  // Once the user drops a file, a late-arriving count must not yank them to
  // the resume screen.
  const interactedRef = useRef(false);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const [confirmingSave, setConfirmingSave] = useState(false);

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

  const idFieldByHub = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    hubs.forEach((h) => {
      map[h.hub_id] = h.id_field_id || undefined;
    });
    return map;
  }, [hubs]);

  const fieldsForHub = (hubId: string): HubFieldSchema[] => {
    const schema = schemas.find((h) => h.id === hubId);
    const excluded = excludedByHub[hubId];
    const idField = idFieldByHub[hubId];
    return (schema?.fields || []).filter(
      (f) => !excluded?.has(f.id) && f.id !== idField
    );
  };

  const refreshUnverifiedCounts = async (hubList: HubSchema[]) => {
    const results = await Promise.all(
      hubList.map((hub) => {
        // Scope to this user's import batch when the action configures an ID
        // field. `where` conditions use field keys, so translate the id.
        const idFieldId = idFieldByHub[hub.id];
        const idFieldKey = idFieldId
          ? (hub.fields || []).find((f) => f.id === idFieldId)?.key
          : undefined;
        // Configured batch field no longer exists on the hub: fail closed
        // (report nothing) instead of silently counting every user's rows.
        if (idFieldId && !idFieldKey)
          return Promise.resolve({ hubId: hub.id, count: 0 });
        return client
          .dataHubAction({
            hubId: hub.id,
            operation: 'get',
            verificationStatus: 'unverified',
            where: idFieldKey
              ? [{ fieldId: idFieldKey, value: initInfo().userId }]
              : undefined
          })
          .then((r: any) => ({
            hubId: hub.id,
            count: (Array.isArray(r) ? r : []).length
          }));
      })
    );
    const counts: Record<string, number> = {};
    results.forEach((r) => {
      counts[r.hubId] = r.count;
    });
    setUnverifiedCounts(counts);
    return counts;
  };

  // Entry screen: in-memory draft -> mapping step, else leftover unverified rows ->
  // resume, else dropzone.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const schemaResp = await client.getHubSchemas(hubIds);
        const orderedSchemas: HubSchema[] = hubIds
          .map((id) => schemaResp.hubs.find((h) => h.id === id))
          .filter(Boolean) as HubSchema[];

        const counts = await refreshUnverifiedCounts(orderedSchemas);
        if (cancelled) return;

        const hasUnverified = Object.values(counts).some((n) => n > 0);
        setSchemas(orderedSchemas);
        if (!initialDraft && !interactedRef.current && hasUnverified)
          setView('resume');
        setLoading(false);
      } catch {
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

  // Cache the in-progress work so closing before confirming doesn't lose it.
  useEffect(() => {
    if (rawSheets.length === 0) return;
    draftCache.set(draftKey(hubIds), {
      fileName,
      rawSheets,
      headerRows,
      perHub
    });
  }, [hubIds, fileName, rawSheets, headerRows, perHub]);

  const clearDraft = () => draftCache.delete(draftKey(hubIds));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Match the backdrop: no closing mid-upload or mid-parse.
      if (e.key === 'Escape' && !busy && !parsingFile) onClose();
    };
    const doc = featheryDoc();
    doc.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => doc.removeEventListener('keydown', onKey);
  }, [onClose, busy, parsingFile]);

  const fontFamily =
    responsiveStyles?.getTarget?.('fc')?.fontFamily ?? 'sans-serif';

  const activeHubId = schemas[activeStep]?.id ?? '';
  const activeFields = fieldsForHub(activeHubId);
  const activeState = perHub[activeHubId];
  const activeSheet =
    sheets[activeState?.selectedSheet ?? 0] ?? sheets[0] ?? null;

  const isLastStep = activeStep >= schemas.length - 1;

  const totalUnverified = Object.values(unverifiedCounts).reduce((n, c) => n + c, 0);
  // Memoized: buildUnverifiedRows walks every row of every mapped column.
  const totalMappedRows = useMemo(
    () =>
      sheets.length === 0
        ? 0
        : schemas.reduce((n, hub) => {
            const st = perHub[hub.id];
            return (
              n + (st ? buildUnverifiedRows(sheets, st.mapping).length : 0)
            );
          }, 0),
    [sheets, schemas, perHub]
  );

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

  // If the file was parsed before the hub schemas arrived, auto-map each hub
  // as soon as they do.
  useEffect(() => {
    if (schemas.length === 0 || sheets.length === 0) return;
    setPerHub((prev) => {
      const missing = schemas.filter((hub) => !prev[hub.id]);
      if (missing.length === 0) return prev;
      const next = { ...prev };
      missing.forEach((hub) => {
        next[hub.id] = {
          selectedSheet: 0,
          mapping: autoMap(fieldsForHub(hub.id), sheets, sheets[0]?.name)
        };
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemas, sheets]);

  const handleFile = async (file: File) => {
    if (!isSpreadsheetFile(file)) {
      setFileError('Unsupported file type. Upload a CSV or Excel file.');
      return;
    }
    interactedRef.current = true;
    setFileError('');
    setParsingFile(file.name);
    const parseStart = Date.now();
    // Let the progress bar paint before the CPU-bound parse starts.
    await new Promise((resolve) => setTimeout(resolve, 30));
    try {
      const raw = (await parseWorkbook(file)).filter(
        (s) => (s.rows || []).length > 0
      );
      // Keep the bar up for a beat, then jump straight to the mapping step.
      const remaining = MIN_PARSE_DISPLAY_MS - (Date.now() - parseStart);
      if (remaining > 0)
        await new Promise((resolve) => setTimeout(resolve, remaining));
      if (raw.length === 0) {
        setFileError("Couldn't find any data in this file.");
        return;
      }
      const derived = deriveSheets(raw, []);
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
    } catch {
      setFileError(
        "Couldn't read this file. Make sure it's a valid CSV or Excel file."
      );
    } finally {
      setParsingFile('');
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

  // Column meanings change, so re-auto-map every hub against the new headers.
  const setHeaderRow = (sheetIndex: number, rowIndex: number) => {
    const nextHeaderRows = headerRows.map((h, i) =>
      i === sheetIndex ? rowIndex : h
    );
    const derived = deriveSheets(rawSheets, nextHeaderRows);
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

  // Rows are left unverified on purpose: unverified rows are exempt from the hub's field
  // requirements, so an import never fails validation. Nothing calls `verify`.
  // Uploading clears this batch's existing unverified rows first, so this
  // replaces them.
  const handleConfirm = async () => {
    setBusy(true);
    setActionError('');
    setConfirmingSave(false);
    try {
      for (const hub of schemas) {
        const st = perHub[hub.id];
        if (!st) continue;
        // A restored draft can reference since-deleted hub fields; those keys
        // would 400 the whole upload, so drop them.
        const validKeys = new Set(fieldsForHub(hub.id).map((f) => f.key));
        const mapping = Object.fromEntries(
          Object.entries(st.mapping).filter(([key]) => validKeys.has(key))
        );
        const rows = buildUnverifiedRows(sheets, mapping);
        if (rows.length === 0) continue;
        await client.dataHubAction({
          hubId: hub.id,
          operation: 'create',
          verificationStatus: 'unverified',
          rows,
          idFieldId: idFieldByHub[hub.id]
        });
      }
    } catch (e: any) {
      setActionError(e?.message || 'Failed to save the mapped rows.');
      await refreshUnverifiedCounts(schemas).catch(() => ({}));
      setBusy(false);
      return;
    }
    clearDraft();
    setBusy(false);
    onClose();
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
        onClick={() => {
          if (busy || parsingFile) return;
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
          width: compact ? 'auto' : '90vw',
          maxWidth: compact ? '600px' : '90vw',
          height: compact ? 'auto' : '90vh',
          maxHeight: '90vh',
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

  if (loadError) {
    return shell(
      <div css={{ color: '#ef4444' }}>{loadError}</div>,
      undefined,
      true
    );
  }

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

  // ---- Resume: rows from a previous import are still in the hub ----
  if (view === 'resume') {
    const resumeBody = (
      <div css={{ color: '#3f3f46', lineHeight: 1.5 }}>
        <div css={{ fontWeight: 600, marginBottom: '6px' }}>
          {totalUnverified} row{totalUnverified === 1 ? '' : 's'} already imported
        </div>
        <div css={{ color: '#71717a' }}>
          A previous upload put {totalUnverified === 1 ? 'this row' : 'these rows'}{' '}
          into {schemas.length > 1 ? 'these data hubs' : 'this data hub'}.
          Uploading a new file replaces {totalUnverified === 1 ? 'it' : 'them'}.
        </div>
      </div>
    );
    const resumeFooter = (
      <>
        <button
          type='button'
          disabled={busy}
          onClick={onClose}
          css={btn(false, busy)}
        >
          Done
        </button>
        <button
          type='button'
          disabled={busy}
          // Uploading clears the old unverified rows, so no delete call is needed.
          onClick={() => {
            setActionError('');
            setView('import');
          }}
          css={btn(true, busy)}
        >
          Upload a new file
        </button>
      </>
    );
    return shell(resumeBody, resumeFooter, true);
  }

  // ---- Import: upload + map ----
  // Resume needs counts; the mapping step needs schemas. Only block once the
  // user is past the dropzone and the background load hasn't finished.
  if (loading && sheets.length > 0) {
    return shell(
      <div css={{ color: '#71717a' }}>Loading…</div>,
      undefined,
      true
    );
  }

  if (sheets.length === 0) {
    if (parsingFile) {
      return shell(
        <ParseProgressBar
          label={`Opening ${parsingFile}…`}
          fontFamily={fontFamily}
        />,
        undefined,
        true
      );
    }
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
            minWidth: 0,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
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
              width: '100%'
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
              <div css={{ flex: '1 1 auto', minWidth: 0, padding: '0 10px' }}>
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
                      flex: '1 1 auto',
                      minWidth: 0,
                      display: 'flex',
                      alignItems: 'center',
                      padding: '8px 10px',
                      border: '1px solid #e4e4e7',
                      borderRadius: '6px',
                      backgroundColor: '#fafafa'
                    }}
                  >
                    <span
                      css={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {field.key}
                    </span>
                    {field.required && (
                      <span css={{ color: '#ef4444', flexShrink: 0 }}>
                        &nbsp;*
                      </span>
                    )}
                    <FieldInfoTip field={field} fontFamily={fontFamily} />
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

  const importFooter = confirmingSave ? (
    <>
      <span css={{ color: '#3f3f46', fontSize: '13px', marginRight: '4px' }}>
        Save {totalMappedRows} row{totalMappedRows === 1 ? '' : 's'} into{' '}
        {schemas.length > 1 ? 'the data hubs' : 'the data hub'}?
        {totalUnverified > 0 &&
          ` This replaces the ${totalUnverified} row${
            totalUnverified === 1 ? '' : 's'
          } from your previous upload.`}
      </span>
      <button
        type='button'
        disabled={busy}
        onClick={() => setConfirmingSave(false)}
        css={btn(false, busy)}
      >
        Cancel
      </button>
      <button
        type='button'
        disabled={busy}
        onClick={handleConfirm}
        css={btn(true, busy)}
      >
        {busy ? 'Saving…' : 'Yes, save'}
      </button>
    </>
  ) : (
    <>
      {activeStep > 0 && (
        <button
          type='button'
          disabled={busy}
          onClick={() => setActiveStep((s) => s - 1)}
          css={btn(false, busy)}
        >
          Back
        </button>
      )}
      {!isLastStep && (
        <button
          type='button'
          disabled={busy}
          onClick={() => setActiveStep((s) => s + 1)}
          css={btn(false, busy)}
        >
          Next
        </button>
      )}
      {
        // pointer-events:none so hover reaches the wrapper; a disabled button
        // never fires hover itself.
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
            onClick={() => {
              setActionError('');
              setConfirmingSave(true);
            }}
            css={{
              ...btn(true, busy || !allRequiredMapped),
              pointerEvents: busy || !allRequiredMapped ? 'none' : 'auto'
            }}
          >
            Confirm
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
      }
    </>
  );

  return shell(importBody, importFooter);
}

export default DataMappingModal;
