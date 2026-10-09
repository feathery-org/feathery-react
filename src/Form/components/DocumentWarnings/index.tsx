import { useCallback, useState } from 'react';
import {
  DocumentGenerationWarning,
  mergeDocumentWarnings
} from '../../../utils/documentGenerationWarnings';

export function useDocumentWarnings() {
  const [warnings, setWarnings] = useState<DocumentGenerationWarning[]>([]);
  const [continueSigning, setContinueSigning] = useState<(() => void) | null>(
    null
  );
  const showWarnings = useCallback((next?: DocumentGenerationWarning[]) => {
    if (next?.length) {
      setWarnings((previous) => mergeDocumentWarnings(previous, next));
    }
  }, []);
  const dismissWarnings = useCallback(() => setWarnings([]), []);
  const acknowledgeSigningWarnings = useCallback(
    () =>
      new Promise<void>((resolve) => {
        setContinueSigning(() => () => {
          setContinueSigning(null);
          resolve();
        });
      }),
    []
  );
  return {
    warnings,
    showWarnings,
    dismissWarnings,
    continueSigning,
    acknowledgeSigningWarnings
  };
}

export default function DocumentWarnings({
  warnings = [],
  onDismiss,
  onContinueSigning
}: {
  warnings?: DocumentGenerationWarning[];
  onDismiss?: () => void;
  onContinueSigning?: () => void;
}) {
  const unique = mergeDocumentWarnings(warnings);
  if (!unique.length) return null;

  return (
    <div
      role='status'
      aria-label='PDF mapping warnings'
      css={{
        background: '#fffbeb',
        color: '#92400e',
        padding: '12px 16px',
        fontSize: 14,
        overflow: 'auto',
        maxHeight: 240,
        flexShrink: 0
      }}
    >
      <strong>Some PDF fields could not be filled.</strong>
      <p css={{ margin: '8px 0' }}>
        Review the affected fields before using these documents. Update the form
        values or ask the form owner to check the document mapping.
      </p>
      <details>
        <summary css={{ cursor: 'pointer' }}>
          View {unique.length} mapping{' '}
          {unique.length === 1 ? 'warning' : 'warnings'}
        </summary>
        <ul css={{ margin: '8px 0', paddingLeft: 20 }}>
          {unique.map((warning, index) => (
            <li key={index} css={{ marginBottom: 8 }}>
              <strong>
                {warning.document_name}, page {warning.page}:{' '}
                {warning.field_name}
              </strong>{' '}
              {warning.message}
            </li>
          ))}
        </ul>
      </details>
      {onContinueSigning && (
        <button
          type='button'
          onClick={onContinueSigning}
          css={{
            background: '#92400e',
            border: 0,
            borderRadius: 4,
            color: 'white',
            padding: '8px 12px',
            marginTop: 8,
            cursor: 'pointer'
          }}
        >
          Continue to signing
        </button>
      )}
      {onDismiss && !onContinueSigning && (
        <button
          type='button'
          onClick={onDismiss}
          css={{
            background: 'transparent',
            border: 0,
            color: 'inherit',
            padding: '8px 0 0',
            textDecoration: 'underline',
            cursor: 'pointer'
          }}
        >
          Dismiss mapping warnings
        </button>
      )}
    </div>
  );
}
