import React, { useEffect, useMemo, useState } from 'react';
import { MODAL_Z_INDEX } from '../../../../utils/styles';
import { buildReversedFieldValues } from '../../../../utils/spreadsheet';
import { MappingSection } from '../spreadsheetMappingSections';

const MAX_PREVIEW_ROWS = 5;

export interface MappingSheet {
  name: string;
  headers: string[];
  rows: string[][];
}

interface SpreadsheetMappingModalProps {
  show: boolean;
  sheets: MappingSheet[];
  sections: MappingSection[];
  fileName?: string;
  responsiveStyles?: any;
  onClose: () => void;
  onSave: (values: Record<string, string[]>) => void;
}

const EMPTY_SHEET: MappingSheet = { name: '', headers: [], rows: [] };

function SpreadsheetMappingModal({
  show,
  sheets,
  sections,
  fileName,
  responsiveStyles,
  onClose,
  onSave
}: SpreadsheetMappingModalProps) {
  const [selectedSheet, setSelectedSheet] = useState(0);
  const [step, setStep] = useState(0);
  // A single field->column mapping shared across sheets and steps, keyed by
  // column HEADER (not position) so switching to a sheet with different columns
  // never loses or misapplies a selection. Save resolves headers to the
  // selected sheet's columns.
  const [mapping, setMapping] = useState<Record<string, string>>({});

  // Reset everything whenever a new file (new sheet set) is loaded.
  useEffect(() => {
    setSelectedSheet(0);
    setStep(0);
    setMapping({});
  }, [sheets]);

  const activeSheet = sheets[selectedSheet] ?? sheets[0] ?? EMPTY_SHEET;
  const { headers, rows } = activeSheet;

  // Pre-fill: a field whose label matches a column header (case-insensitive)
  // maps to that header.
  const prefill = useMemo(() => {
    const initial: Record<string, string> = {};
    sections.forEach((sec) =>
      sec.fields.forEach((field) => {
        const match = headers.find(
          (h) => h.toLowerCase() === field.label.toLowerCase()
        );
        if (match !== undefined) initial[field.key] = match;
      })
    );
    return initial;
  }, [headers, sections]);

  // Auto-fill matching columns for the active sheet, but only for fields the
  // user hasn't already mapped — never clobber existing selections.
  useEffect(() => {
    setMapping((prev) => {
      const next = { ...prev };
      Object.entries(prefill).forEach(([key, header]) => {
        if (next[key] === undefined) next[key] = header;
      });
      return next;
    });
  }, [prefill]);

  if (!show || sections.length === 0) return null;

  const headerSet = new Set(headers);

  const currentSection = sections[Math.min(step, sections.length - 1)];
  const isLastStep = step >= sections.length - 1;
  const previewRows = rows.slice(0, MAX_PREVIEW_ROWS);

  // Counts reflect every mapped field and don't change when the sheet is swapped.
  const sectionMappedCount = currentSection.fields.filter(
    (f) => mapping[f.key] !== undefined
  ).length;
  const totalMapped = Object.keys(mapping).length;

  const setFieldColumn = (fieldKey: string, header: string) =>
    setMapping((prev) => {
      const next = { ...prev };
      if (header === '') delete next[fieldKey];
      else next[fieldKey] = header;
      return next;
    });

  // Resolve each mapped header to a column in the selected sheet, then pull data.
  const handleSave = () => {
    const indexMapping: Record<string, number> = {};
    Object.entries(mapping).forEach(([fieldKey, header]) => {
      const idx = headers.indexOf(header);
      if (idx >= 0) indexMapping[fieldKey] = idx;
    });
    onSave(buildReversedFieldValues(activeSheet.rows, indexMapping));
  };

  const fontFamily =
    responsiveStyles?.getTarget?.('fc')?.fontFamily ?? 'sans-serif';

  const btn = (primary: boolean, disabled = false) => ({
    padding: '8px 18px',
    borderRadius: '8px',
    border: primary ? 'none' : '1px solid #e4e4e7',
    backgroundColor: primary ? (disabled ? '#a1a1aa' : '#0b1324') : '#fff',
    color: primary ? '#fff' : '#0b1324',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily
  });

  return (
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
        onClick={onClose}
        css={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%'
        }}
      />
      <div
        className='feathery-modal'
        css={{
          position: 'relative',
          backgroundColor: '#fff',
          borderRadius: '14px',
          width: '90vw',
          maxWidth: '900px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 10px 40px rgba(0,0,0,0.15)'
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
          {/* Sheet selector + step tabs */}
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
            <div css={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {sections.map((sec, i) => (
                <button
                  key={i}
                  type='button'
                  onClick={() => setStep(i)}
                  css={{
                    padding: '6px 12px',
                    borderRadius: '999px',
                    border: '1px solid',
                    borderColor: i === step ? '#0b1324' : '#e4e4e7',
                    backgroundColor: i === step ? '#0b1324' : '#fff',
                    color: i === step ? '#fff' : '#3f3f46',
                    cursor: 'pointer',
                    fontFamily,
                    fontSize: '13px',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {i + 1}. {sec.title}
                </button>
              ))}
            </div>
            {sheets.length > 1 && (
              <div css={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span css={{ fontWeight: 600, color: '#3f3f46' }}>Sheet</span>
                <select
                  value={selectedSheet}
                  onChange={(e) => setSelectedSheet(Number(e.target.value))}
                  css={{
                    padding: '8px 10px',
                    border: '1px solid #e4e4e7',
                    borderRadius: '6px',
                    backgroundColor: '#fff',
                    fontFamily,
                    cursor: 'pointer'
                  }}
                >
                  {sheets.map((sheet, i) => (
                    <option key={i} value={i}>
                      {sheet.name || `Sheet ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Panels: each scrolls independently so the preview stays visible */}
          <div
            css={{
              flex: '1 1 auto',
              minHeight: 0,
              display: 'flex',
              gap: '28px'
            }}
          >
            {/* Field list for the current section */}
            <div
              css={{
                flex: '0 0 420px',
                minHeight: 0,
                overflowY: 'auto',
                paddingRight: '4px'
              }}
            >
              <div
                css={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontWeight: 600,
                  color: '#3f3f46',
                  marginBottom: '10px',
                  position: 'sticky',
                  top: 0,
                  backgroundColor: '#fff'
                }}
              >
                <span>{currentSection.title}</span>
                <span css={{ color: '#71717a', fontWeight: 500 }}>
                  {sectionMappedCount}/{currentSection.fields.length} mapped
                </span>
              </div>
              <div
                css={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}
              >
                {currentSection.fields.map((field) => (
                  <div
                    key={field.key}
                    css={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                  >
                    <div
                      title={field.label}
                      css={{
                        flex: 1,
                        minWidth: 0,
                        padding: '8px 10px',
                        border: '1px solid #e4e4e7',
                        borderRadius: '6px',
                        backgroundColor: '#fafafa'
                      }}
                    >
                      {field.label}
                    </div>
                    <span css={{ color: '#a1a1aa' }}>=</span>
                    <select
                      value={mapping[field.key] ?? ''}
                      onChange={(e) =>
                        setFieldColumn(field.key, e.target.value)
                      }
                      css={{
                        flex: 1,
                        minWidth: 0,
                        padding: '8px 10px',
                        border: '1px solid #e4e4e7',
                        borderRadius: '6px',
                        backgroundColor: '#fff',
                        fontFamily,
                        cursor: 'pointer'
                      }}
                    >
                      <option value=''>Select column...</option>
                      {/* Keep a mapped column visible even if it's not on the
                          current sheet, so the selection (and count) persists. */}
                      {mapping[field.key] !== undefined &&
                        !headerSet.has(mapping[field.key]) && (
                          <option value={mapping[field.key]}>
                            {mapping[field.key]} (not on this sheet)
                          </option>
                        )}
                      {headers.map((header, i) => (
                        <option key={i} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Read-only preview */}
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
                Showing {previewRows.length} of {rows.length} rows. All values
                in each mapped column are saved to the field as a list.
              </div>
            </div>
          </div>
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
          <div css={{ display: 'flex', gap: '10px' }}>
            {step > 0 && (
              <button
                type='button'
                onClick={() => setStep((s) => s - 1)}
                css={btn(false)}
              >
                Back
              </button>
            )}
            {!isLastStep && (
              <button
                type='button'
                onClick={() => setStep((s) => s + 1)}
                css={btn(true)}
              >
                Next
              </button>
            )}
            {isLastStep && (
              <button
                type='button'
                disabled={totalMapped === 0}
                onClick={handleSave}
                css={btn(true, totalMapped === 0)}
              >
                Save
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SpreadsheetMappingModal;
