export interface DocumentGenerationWarning {
  code: 'pdf_option_unmatched' | 'pdf_field_unsupported' | 'pdf_field_missing';
  document_name: string;
  field_name: string;
  page: number;
  supplied_values: string[];
  allowed_options: string[];
  message: string;
}

export function mergeDocumentWarnings(
  ...groups: (DocumentGenerationWarning[] | undefined)[]
): DocumentGenerationWarning[] {
  const unique = new Map<string, DocumentGenerationWarning>();
  groups.forEach((warnings) =>
    warnings?.forEach((warning) => {
      const key = JSON.stringify([
        warning.code,
        warning.document_name,
        warning.field_name,
        warning.page,
        warning.supplied_values,
        warning.allowed_options,
        warning.message
      ]);
      unique.set(key, warning);
    })
  );
  return [...unique.values()];
}

// Review finalization can return only files/signers. Keep generation diagnostics
// available to the logic rule that awaited the full review flow.
export function withDocumentWarnings<T extends object>(
  result: T,
  ...groups: (DocumentGenerationWarning[] | undefined)[]
): T & { warnings?: DocumentGenerationWarning[] } {
  const warnings = mergeDocumentWarnings(...groups);
  return warnings.length
    ? { ...result, warnings }
    : (result as T & { warnings?: DocumentGenerationWarning[] });
}
