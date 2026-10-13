// Form tools mirror WebMCP's ModelContextTool shape; webmcp.tsx publishes
// them on document.modelContext.

export type FormToolAnnotations = {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  consequentialHint?: boolean;
};

export type FormTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: FormToolAnnotations;
  execute(input: any): Promise<any>;
};

export type GetStepField = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  visible: boolean;
  disabled: boolean;
  value: unknown;
  options: Array<{ value: string; label: string }>;
  error: string;
  repeated: boolean;
  repeatContainerId: string | null;
  rowCount: number | null;
  errorRows: Record<string, string> | null;
  // Row indexes hidden by the row's own hide-if; null if not repeated
  hiddenRows: number[] | null;
};

export type GetStepButton = {
  id: string;
  text: string;
  navigatesTo: string | null;
  saves: boolean;
};

export type GetStepResult = {
  step: { id: string; key: string };
  fields: GetStepField[];
  buttons: GetStepButton[];
};

export type FillFieldStatus =
  | 'filled'
  | 'changed'
  | 'rejected'
  | 'disabled'
  | 'not_shown'
  | 'unsupported'
  | 'left_for_user';

export type RowResult =
  | { status: 'filled' | 'changed'; value?: unknown }
  | {
      status: 'rejected' | 'hidden' | 'max_repeats_exceeded' | 'left_for_user';
      message?: string;
    }
  // The input gave this row null, so it was left as it is
  | { status: 'skipped' };

export type FillFieldResult =
  | { status: FillFieldStatus; value?: unknown; message?: string }
  | { status: 'repeated'; rows: RowResult[] };

export type FillStepResult = {
  step: string;
  fields: Record<string, FillFieldResult>;
  newlyShown: string[];
  errors: Record<string, string>;
  snapshot: GetStepResult;
};

export type FileInput = { name: string; mimeType: string; dataBase64: string };

export type NextStepStatus = 'advanced' | 'errors' | 'refused' | 'no_change';

export type NextStepResult = {
  status: NextStepStatus;
  fromStep: string;
  toStep?: string;
  // Whether the press submitted the step; a Next button can be set to only navigate
  saved?: boolean;
  errors?: Record<string, string>;
  reason?: string;
  // The new step, present only when status is 'advanced'
  snapshot?: GetStepResult;
};

// Rows of a repeated field one fill_step call wrote, with the values it meant
export type RepeatedWrite = {
  servar: any;
  rows: RowResult[];
  writtenRows: number[];
  intendedValues: Record<number, unknown>;
};

// What fill_step calls on the current step wrote, so a later call on the
// same step reclassifies them after its own rules run
export type FormToolsStepWrites = {
  stepKey: string;
  intended: Record<string, unknown>;
  repeated: Record<string, RepeatedWrite>;
};
