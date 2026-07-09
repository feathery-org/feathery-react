import React, { useState } from 'react';
import { HubValidationError, UseDataMapping } from './useDataMapping';

interface ReviewStepProps {
  hook: UseDataMapping;
  fontFamily: string;
  onClose: () => void;
}

interface EditableCellProps {
  hubId: string;
  entryId: string;
  fieldKey: string;
  value: any;
  error?: HubValidationError;
  fontFamily: string;
  updateCell: UseDataMapping['updateCell'];
}

function EditableCell({
  hubId,
  entryId,
  fieldKey,
  value,
  error,
  fontFamily,
  updateCell
}: EditableCellProps) {
  const [draft, setDraft] = useState(value ?? '');

  const commit = () => {
    if (draft !== value) updateCell(hubId, entryId, fieldKey, draft);
  };

  return (
    <div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
        css={{
          width: '100%',
          padding: '6px 8px',
          border: `1px solid ${error ? '#dc2626' : '#e4e4e7'}`,
          borderRadius: '4px',
          fontFamily
        }}
      />
      {error && (
        <div css={{ color: '#dc2626', fontSize: '12px', marginTop: '2px' }}>
          {error.message}
        </div>
      )}
    </div>
  );
}

function ReviewStep({ hook, fontFamily, onClose }: ReviewStepProps) {
  const {
    tabs,
    activeTab,
    setActiveTab,
    updateCell,
    finalizeAll,
    startReupload,
    busy,
    requestError
  } = hook;

  const currentTab = tabs[Math.min(activeTab, tabs.length - 1)];
  const anyErrors = tabs.some((tab) => tab.errors.length > 0);

  const handleFinalize = async () => {
    const result = await finalizeAll();
    if (result.ok) onClose();
  };

  const errorFor = (entryId: string, fieldKey: string) =>
    currentTab?.errors.find(
      (e) => e.entry_id === entryId && e.field_key === fieldKey
    );

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
              {tab.errors.length > 0 && ` (${tab.errors.length})`}
            </button>
          ))}
        </div>

        <div
          data-testid='data-mapping-review-table'
          css={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}
        >
          <table css={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                {(currentTab?.fields ?? []).map((field) => (
                  <th
                    key={field.key}
                    css={{
                      textAlign: 'left',
                      padding: '6px 10px',
                      borderBottom: '1px solid #e4e4e7',
                      backgroundColor: '#fafafa',
                      fontWeight: 600,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {field.key}
                    {field.required && ' *'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(currentTab?.staged ?? []).map((row) => (
                <tr key={row.entryId}>
                  {(currentTab?.fields ?? []).map((field) => {
                    const error = errorFor(row.entryId, field.key);
                    return (
                      <td
                        key={field.key}
                        css={{
                          padding: '6px 10px',
                          borderBottom: '1px solid #f4f4f5',
                          verticalAlign: 'top'
                        }}
                      >
                        {error ? (
                          <EditableCell
                            hubId={currentTab.hubId}
                            entryId={row.entryId}
                            fieldKey={field.key}
                            value={row.data[field.key]}
                            error={error}
                            fontFamily={fontFamily}
                            updateCell={updateCell}
                          />
                        ) : (
                          <span>{row.data[field.key] ?? ''}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
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
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '10px',
          padding: '16px 20px',
          borderTop: '1px solid #e9e9e9',
          flex: '0 0 auto'
        }}
      >
        <button
          type='button'
          onClick={startReupload}
          css={{
            padding: '8px 18px',
            borderRadius: '8px',
            border: '1px solid #e4e4e7',
            backgroundColor: '#fff',
            color: '#0b1324',
            cursor: 'pointer',
            fontFamily
          }}
        >
          Re-upload file
        </button>
        <button
          type='button'
          disabled={anyErrors || busy}
          onClick={handleFinalize}
          css={{
            padding: '8px 18px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: anyErrors || busy ? '#a1a1aa' : '#0b1324',
            color: '#fff',
            cursor: anyErrors || busy ? 'not-allowed' : 'pointer',
            fontFamily
          }}
        >
          Confirm & finalize
        </button>
      </div>
    </>
  );
}

export default ReviewStep;
