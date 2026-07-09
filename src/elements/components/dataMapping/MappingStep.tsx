import React, { useRef, useState } from 'react';
import { UseDataMapping } from './useDataMapping';

const MAX_PREVIEW_ROWS = 5;
const ACCEPTED_EXTENSIONS = '.csv,.xlsx,.xls,.xlsm';

interface MappingStepProps {
  hook: UseDataMapping;
  fontFamily: string;
}

function MappingStep({ hook, fontFamily }: MappingStepProps) {
  const {
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
    busy,
    requestError
  } = hook;

  const [sheetIndex, setSheetIndex] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const btn = (primary: boolean, disabled = false) => ({
    padding: '8px 18px',
    borderRadius: '8px',
    border: primary ? 'none' : '1px solid #e4e4e7',
    backgroundColor: primary ? (disabled ? '#a1a1aa' : '#0b1324') : '#fff',
    color: primary ? '#fff' : '#0b1324',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily
  });

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) loadFile(file);
  };

  if (sheets.length === 0) {
    return (
      <div
        css={{
          flex: '1 1 auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          padding: '40px'
        }}
      >
        <div
          data-testid='data-mapping-dropzone'
          role='button'
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ')
              fileInputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
          css={{
            width: '100%',
            maxWidth: '480px',
            padding: '48px 24px',
            border: `2px dashed ${dragOver ? '#0b1324' : '#e4e4e7'}`,
            borderRadius: '12px',
            textAlign: 'center',
            cursor: 'pointer',
            color: '#71717a',
            backgroundColor: dragOver ? '#fafafa' : '#fff'
          }}
        >
          Drag and drop a CSV or Excel file here, or click to browse
        </div>
        <input
          ref={fileInputRef}
          type='file'
          accept={ACCEPTED_EXTENSIONS}
          data-testid='data-mapping-file-input'
          css={{ display: 'none' }}
          onChange={(e) => handleFiles(e.target.files)}
        />
        {parseError && (
          <div css={{ color: '#b91c1c', fontSize: '13px' }}>{parseError}</div>
        )}
      </div>
    );
  }

  const activeSheet = sheets[sheetIndex] ?? sheets[0];
  const currentTab = tabs[Math.min(activeTab, tabs.length - 1)];
  const isLastTab = activeTab >= tabs.length - 1;
  const tabMappedCount = (currentTab?.fields ?? []).filter(
    (f) => mapping[f.key] !== undefined
  ).length;
  const previewRows = activeSheet?.rows.slice(0, MAX_PREVIEW_ROWS) ?? [];

  const missingTitle =
    requiredUnmapped.length > 0
      ? `Missing required fields: ${requiredUnmapped.join(', ')}`
      : undefined;

  return (
    <>
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
            {tabs.map((tab, i) => (
              <button
                key={tab.hubId}
                type='button'
                onClick={() => setActiveTab(i)}
                css={{
                  padding: '6px 12px',
                  borderRadius: '999px',
                  border: '1px solid',
                  borderColor: i === activeTab ? '#0b1324' : '#e4e4e7',
                  backgroundColor: i === activeTab ? '#0b1324' : '#fff',
                  color: i === activeTab ? '#fff' : '#3f3f46',
                  cursor: 'pointer',
                  fontFamily,
                  fontSize: '13px',
                  whiteSpace: 'nowrap'
                }}
              >
                {i + 1}. {tab.hubKey}
              </button>
            ))}
          </div>
          {sheets.length > 1 && (
            <div css={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span css={{ fontWeight: 600, color: '#3f3f46' }}>Sheet</span>
              <select
                value={sheetIndex}
                onChange={(e) => setSheetIndex(Number(e.target.value))}
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

        <div
          css={{
            flex: '1 1 auto',
            minHeight: 0,
            display: 'flex',
            gap: '28px'
          }}
        >
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
                marginBottom: '10px'
              }}
            >
              <span>{currentTab?.hubKey}</span>
              <span css={{ color: '#71717a', fontWeight: 500 }}>
                {tabMappedCount}/{currentTab?.fields.length ?? 0} mapped
              </span>
            </div>
            <div
              css={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
            >
              {(currentTab?.fields ?? []).map((field) => {
                const ref = mapping[field.key];
                const value = ref ? `${ref.sheetIndex}::${ref.header}` : '';
                return (
                  <div
                    key={field.key}
                    css={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                  >
                    <div
                      title={field.key}
                      css={{
                        flexShrink: 0,
                        minWidth: 160,
                        whiteSpace: 'nowrap',
                        padding: '8px 10px',
                        border: '1px solid #e4e4e7',
                        borderRadius: '6px',
                        backgroundColor: '#fafafa'
                      }}
                    >
                      {field.key}
                      {field.required && ' *'}
                    </div>
                    <span css={{ color: '#a1a1aa' }}>=</span>
                    <select
                      value={value}
                      onChange={(e) => {
                        if (e.target.value === '') {
                          setFieldColumn(field.key, null);
                          return;
                        }
                        const [sIdx, ...rest] = e.target.value.split('::');
                        setFieldColumn(field.key, {
                          sheetIndex: Number(sIdx),
                          header: rest.join('::')
                        });
                      }}
                      css={{
                        flex: 1,
                        padding: '8px 10px',
                        border: '1px solid #e4e4e7',
                        borderRadius: '6px',
                        backgroundColor: '#fff',
                        fontFamily,
                        cursor: 'pointer'
                      }}
                    >
                      <option value=''>Select column...</option>
                      {sheets.map((sheet, sIdx) => (
                        <optgroup
                          key={sIdx}
                          label={sheet.name || `Sheet ${sIdx + 1}`}
                        >
                          {sheet.headers.map((header) => (
                            <option
                              key={`${sIdx}::${header}`}
                              value={`${sIdx}::${header}`}
                            >
                              {header}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>

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
              css={{ fontWeight: 600, color: '#3f3f46', marginBottom: '10px' }}
            >
              Preview
            </div>
            <div css={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
              <table css={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    {(activeSheet?.headers ?? []).map((header, i) => (
                      <th
                        key={i}
                        css={{
                          textAlign: 'left',
                          padding: '6px 10px',
                          borderBottom: '1px solid #e4e4e7',
                          backgroundColor: '#fafafa',
                          fontWeight: 600,
                          whiteSpace: 'nowrap'
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
                      {(activeSheet?.headers ?? []).map((_h, c) => (
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
          </div>
        </div>
      </div>

      {requestError && (
        <div
          css={{
            padding: '0 20px',
            color: '#b91c1c',
            fontSize: '13px'
          }}
        >
          {requestError}
        </div>
      )}

      <div
        css={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: '10px',
          padding: '16px 20px',
          borderTop: '1px solid #e9e9e9',
          flex: '0 0 auto'
        }}
      >
        {activeTab > 0 && (
          <button
            type='button'
            onClick={() => setActiveTab(activeTab - 1)}
            css={btn(false)}
          >
            Back
          </button>
        )}
        {!isLastTab && (
          <button
            type='button'
            onClick={() => setActiveTab(activeTab + 1)}
            css={btn(true)}
          >
            Next
          </button>
        )}
        {isLastTab && (
          <button
            type='button'
            disabled={requiredUnmapped.length > 0 || busy}
            title={missingTitle}
            onClick={() => stageAll()}
            css={btn(true, requiredUnmapped.length > 0 || busy)}
          >
            Save
          </button>
        )}
      </div>
    </>
  );
}

export default MappingStep;
