// Shapes a first-party "form tools" registry (feathery_get_step,
// feathery_fill_step) exposed on the form context so an agent/host can
// operate a mounted form through the form's own code paths. Mirrors
// WebMCP's ModelContextTool shape; webmcp.tsx publishes them on
// document.modelContext.

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
};

export type GetStepButton = {
  id: string;
  text: string;
  navigatesTo: string | null;
  saves: boolean;
};

export type RepeatGroup = {
  containerId: string;
  fieldKeys: string[];
  rowCount: number;
  canAddRow: boolean;
  maxRows: number | null;
};

export type GetStepResult = {
  step: { id: string; key: string };
  fields: GetStepField[];
  buttons: GetStepButton[];
  repeatGroups: RepeatGroup[];
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
      status: 'rejected' | 'hidden' | 'max_repeats_exceeded';
      message?: string;
    }
  // The input gave this row null, so it was left as it is
  | { status: 'skipped' };

export type FillFieldResult =
  | { status: FillFieldStatus; value?: unknown; message?: string }
  | { status: 'repeated'; rows: RowResult[] };

export type FillStepInput = {
  values: Record<string, unknown>;
};

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
