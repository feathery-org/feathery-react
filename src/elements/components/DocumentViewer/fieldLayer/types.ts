export type QuikFieldOverride = {
  form_id: string;
  group_index: number;
  form_fields: { FieldName: string; FieldValue: string }[];
};

// Flat per-envelope override shape expected by the generic Generate
// Documents review flow's `finalizeDocumentReview` (`envelopes[].envelope_id`
// + `envelopes[].field_overrides`) — distinct from Quik's
// `QuikFieldOverride`, which is keyed by `form_id`/`group_index` instead.
export type EnvelopeFieldOverride = {
  envelopeId: string;
  fieldOverrides: Record<string, string>;
};

export type ValidationIssue = { docIndex: number; fieldName: string };

export interface FieldLayer {
  getOverrides(): Promise<QuikFieldOverride[]>;
  getEnvelopeOverrides(): Promise<EnvelopeFieldOverride[]>;
  reset(): void;
  validate(): Promise<ValidationIssue[]>;
}
