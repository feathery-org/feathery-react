import React, { useEffect, useMemo, useState } from 'react';
import { MODAL_Z_INDEX } from '../../../../utils/styles';
import {
  buildReversedFieldValues,
  FieldColumnMapping
} from '../../../../utils/spreadsheet';
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
  // One field->column mapping per sheet index, so switching sheets keeps each
  // sheet's mapping.
  const [mappings, setMappings] = useState<Record<number, FieldColumnMapping>>(
    {}
  );

  // Reset everything whenever a new file (new sheet set) is loaded.
  useEffect(() => {
    setSelectedSheet(0);
    setStep(0);
    setMappings({});
  }, [sheets]);

  const activeSheet = sheets[selectedSheet] ?? sheets[0] ?? EMPTY_SHEET;
  const { headers, rows } = activeSheet;

  // Pre-fill: a field whose label matches a column header (case-insensitive)
  // maps to that column.
  const prefill = useMemo(() => {
    const headerToIndex = new Map(
      headers.map((h, i) => [h.toLowerCase(), i] as const)
    );
    const initial: FieldColumnMapping = {};
    sections.forEach((sec) =>
      sec.fields.forEach((field) => {
        const idx = headerToIndex.get(field.label.toLowerCase());
        if (idx !== undefined) initial[field.key] = idx;
      })
    );
    return initial;
  }, [headers, sections]);

  // Seed the prefill the first time a sheet is viewed; never clobber existing.
  useEffect(() => {
    setMappings((prev) =>
      prev[selectedSheet] ? prev : { ...prev, [selectedSheet]: prefill }
    );
  }, [prefill, selectedSheet]);

  if (!show || sections.length === 0) return null;

  const mapping = mappings[selectedSheet] ?? {};
  const currentSection = sections[Math.min(step, sections.length - 1)];
  const isLastStep = step >= sections.length - 1;
  const previewRows = rows.slice(0, MAX_PREVIEW_ROWS);

  const sectionMappedCount = currentSection.fields.filter(
    (f) => mapping[f.key] != null
  ).length;
  const totalMapped = Object.values(mappings).reduce(
    (n, m) => n + Object.keys(m).length,
    0
  );

  const setFieldColumn = (fieldKey: string, value: string) =>
    setMappings((prev) => {
      const current = { ...(prev[selectedSheet] ?? {}) };
      if (value === '') delete current[fieldKey];
      else current[fieldKey] = Number(value);
      return { ...prev, [selectedSheet]: current };
    });

  // Aggregate mapped values across every sheet the user has configured.
  const handleSave = () => {
    const values: Record<string, string[]> = {};
    sheets.forEach((sheet, i) => {
      Object.assign(
        values,
        buildReversedFieldValues(sheet.rows, mappings[i] ?? {})
      );
    });
    onSave(values);
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
                      {headers.map((header, i) => (
                        <option key={i} value={i}>
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
                Showing {previewRows.length} of {rows.length} rows. All values in
                each mapped column are saved to the field as a list.
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
