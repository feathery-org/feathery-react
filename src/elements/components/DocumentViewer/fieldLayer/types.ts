export type QuikFieldOverride = {
  form_id: string;
  group_index: number;
  form_fields: { FieldName: string; FieldValue: string }[];
};

export type ValidationIssue = { docIndex: number; fieldName: string };

export interface FieldLayer {
  getOverrides(): Promise<QuikFieldOverride[]>;
  reset(): void;
  validate(): Promise<ValidationIssue[]>;
}
