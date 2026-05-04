import internalState from '../utils/internalState';
import { initState } from '../utils/init';
import { replaceTextVariables } from '../elements/components/TextNodes';

export type PanelRuntimeFieldEntry = {
  key: string;
  type: string;
  value: unknown;
  visible: boolean;
  // True when the field cannot be written to: per-field
  // `properties.disabled`, form-wide `formSettings.readOnly`, or
  // collaborator-review readonly mode. Write tools must refuse.
  disabled: boolean;
  required: boolean;
  repeated: boolean;
  // Hints the user is currently reading on the page.
  placeholder?: string;
  tooltip?: string;
  // Validation message currently displayed below the field, if any.
  error?: string;
  // Choice options the user can pick from, for choice-style fields
  // (button_group, dropdown, dropdown_multi, multiselect, radio,
  // checkbox_group, matrix). Each entry pairs the stored value with the
  // label the user actually sees.
  options?: Array<{ value: string; label: string }>;
  // Matrix-only: row questions the user answers across the option columns.
  questions?: Array<{ id: string; label: string }>;
  // Length / range bounds (text length, pin/rating count, slider min/max).
  minLength?: number;
  maxLength?: number;
  // Optional servar format hint (e.g. text validation pattern).
  format?: string;
  // File-upload constraints.
  fileTypes?: string[];
  multipleFiles?: boolean;
  // Slider range labels and step size when set.
  sliderLabels?: { min?: string; max?: string };
  stepSize?: number;
};

export type PanelRuntimeElementEntry =
  | {
      type: 'text' | 'button' | 'image';
      // Plain text the user actually reads, with `{{field_key}}` placeholders
      // already substituted using current field values.
      text: string;
      visible: boolean;
    }
  | {
      type: 'progress';
      // Number of visual segments configured on the bar; may differ from
      // `totalSteps` when authors override the segmentation.
      segments?: number;
      visible: boolean;
    };

export type PanelRuntimeTableEntry = {
  // The column header the user sees, plus the underlying field key so the
  // agent can correlate to `values`.
  columns: Array<{ name: string; fieldKey: string }>;
  // Row-major data; each row is one cell value per column. Computed by
  // zipping the columns' field-value arrays - matches what the renderer
  // displays before search/sort/pagination.
  rows: unknown[][];
  visible: boolean;
};

export type PanelRuntimeSnapshot = {
  currentStep: { id: string; key: string };
  previousStepName?: string;
  totalSteps: number;
  // Fields on the *current* step. Includes evaluated visibility because
  // the renderer only computes hide-if for the active step.
  currentStepFields: PanelRuntimeFieldEntry[];
  // Non-field elements rendered on the current step (text, button copy,
  // image alt). Gives the agent the surrounding narrative the user reads.
  currentStepElements: PanelRuntimeElementEntry[];
  // Table elements on the current step rendered with their column headers
  // and underlying row data.
  currentStepTables: PanelRuntimeTableEntry[];
  // Flat map of servar values on the form keyed by servar.key. Spans all
  // steps so the agent can answer questions about earlier or later fields
  // without per-step lookups. Servars are bounded by the form's
  // configuration; included even when empty.
  values: Record<string, unknown>;
  // Hidden fields are an org-wide pool of admin/system-set values not
  // rendered on the form. Only included when meaningfully set on this
  // fuser. The agent should consult this map only when the question is
  // about state that isn't on the visible form (e.g. the user references
  // a customer_id, lead_source, or other backend-set value).
  hiddenFieldValues: Record<string, unknown>;
};

const extractRawText = (props: Record<string, unknown>): string => {
  const plain = props.text;
  if (typeof plain === 'string' && plain.trim()) return plain;
  const formatted = props.text_formatted as
    | { ops?: Array<{ insert?: unknown }> }
    | Array<{ insert?: unknown }>
    | undefined;
  const ops = Array.isArray(formatted) ? formatted : formatted?.ops;
  if (!Array.isArray(ops)) return '';
  return ops
    .map((op) => (typeof op?.insert === 'string' ? op.insert : ''))
    .join('')
    .trim();
};

const resolve = (text: string, repeat?: number): string => {
  if (!text) return '';
  try {
    return replaceTextVariables(text, repeat);
  } catch {
    return text;
  }
};

// Joins the renderer's live state into a shape the assistant agent can pair
// with `getPanelSnapshot`. Field keys here match `servar_fields[].servar.key`
// in the snapshot, and the step key matches `steps[].key`.
export const getPanelRuntimeSnapshot = (
  formId: string
): PanelRuntimeSnapshot | null => {
  const state = internalState[formId];
  if (!state || !state.currentStep) return null;

  const step = state.currentStep;
  const visiblePositions = state.visiblePositions ?? {};
  const fieldsMap = state.fields ?? {};
  const inlineErrors = state.inlineErrors ?? {};
  const formReadOnly = !!(
    state.formSettings?.readOnly || initState.collaboratorReview === 'readOnly'
  );

  const currentStepFields: PanelRuntimeFieldEntry[] = (
    step.servar_fields ?? []
  ).map((field: any) => {
    const positionKey = field.position?.join(',') || 'root';
    const visibilityFlags = visiblePositions[positionKey];
    const visible = Array.isArray(visibilityFlags)
      ? visibilityFlags.some(Boolean)
      : true;
    const fieldEntity = fieldsMap[field.servar.key];
    const props = field.properties ?? {};
    const placeholder =
      typeof props.placeholder === 'string' && props.placeholder.trim()
        ? resolve(props.placeholder)
        : undefined;
    const tooltip =
      typeof props.tooltipText === 'string' && props.tooltipText.trim()
        ? resolve(props.tooltipText)
        : undefined;
    const error = inlineErrors[field.servar.key]?.message;
    const servar = field.servar ?? {};
    const meta = servar.metadata ?? {};
    const rawOptions = Array.isArray(meta.options) ? meta.options : null;
    const rawLabels = Array.isArray(meta.labels) ? meta.labels : [];
    const options = rawOptions
      ? rawOptions.map((value: any, i: number) => ({
          value: String(value ?? ''),
          label: String(rawLabels[i] ?? value ?? '')
        }))
      : undefined;
    const rawQuestions = Array.isArray(meta.questions) ? meta.questions : null;
    const questions = rawQuestions
      ? rawQuestions
          .map((q: any) => ({
            id: String(q?.id ?? ''),
            label: String(q?.label ?? '')
          }))
          .filter((q: { id: string; label: string }) => q.id || q.label)
      : undefined;
    const fileTypes = [
      ...(Array.isArray(meta.file_types) ? meta.file_types : []),
      ...(Array.isArray(meta.custom_file_types)
        ? meta.custom_file_types.map((t: string) => `.${t}`)
        : [])
    ];
    const sliderLabels =
      meta.min_val_label || meta.max_val_label
        ? {
            ...(meta.min_val_label ? { min: String(meta.min_val_label) } : {}),
            ...(meta.max_val_label ? { max: String(meta.max_val_label) } : {})
          }
        : undefined;
    const disabled = !!(props.disabled || formReadOnly);
    return {
      key: servar.key,
      type: servar.type,
      value: fieldEntity?.value ?? null,
      visible,
      disabled,
      required: !!servar.required,
      repeated: !!servar.repeated,
      ...(placeholder ? { placeholder } : {}),
      ...(tooltip ? { tooltip } : {}),
      ...(error ? { error } : {}),
      ...(options ? { options } : {}),
      ...(questions ? { questions } : {}),
      ...(typeof servar.min_length === 'number'
        ? { minLength: servar.min_length }
        : {}),
      ...(typeof servar.max_length === 'number'
        ? { maxLength: servar.max_length }
        : {}),
      ...(servar.format ? { format: String(servar.format) } : {}),
      ...(fileTypes.length > 0 ? { fileTypes } : {}),
      ...(meta.multiple ? { multipleFiles: true } : {}),
      ...(sliderLabels ? { sliderLabels } : {}),
      ...(typeof meta.step_size === 'number'
        ? { stepSize: meta.step_size }
        : {})
    };
  });

  // Servar keys appear in state.fields alongside every hidden field in the
  // org (the SDK pre-creates Field instances for both). Split them so the
  // agent gets servars in `values` (bounded, always shipped) and hidden
  // fields in `hiddenFieldValues` (org-wide pool, only meaningful entries
  // shipped). Servar keys come from walking every step.
  const servarKeys = new Set<string>();
  for (const stepKey of Object.keys(state.steps ?? {})) {
    const step = (state.steps as any)[stepKey];
    (step?.servar_fields ?? []).forEach((f: any) => {
      if (f?.servar?.key) servarKeys.add(f.servar.key);
    });
  }
  const isMeaningful = (v: unknown): boolean => {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string' && v === '') return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  };
  const values: Record<string, unknown> = {};
  const hiddenFieldValues: Record<string, unknown> = {};
  for (const key of Object.keys(fieldsMap)) {
    const v = fieldsMap[key]?.value ?? null;
    if (servarKeys.has(key)) {
      values[key] = v;
    } else if (isMeaningful(v)) {
      hiddenFieldValues[key] = v;
    }
  }

  const currentStepElements: PanelRuntimeElementEntry[] = [];
  const visibilityFor = (el: any): boolean => {
    const positionKey = el.position?.join(',') || 'root';
    const flags = visiblePositions[positionKey];
    return Array.isArray(flags) ? flags.some(Boolean) : true;
  };
  const collectTextish = (
    list: any[] | undefined,
    type: 'text' | 'button'
  ) => {
    (list ?? []).forEach((el: any) => {
      const raw = extractRawText(el?.properties ?? {});
      if (!raw) return;
      currentStepElements.push({
        type,
        text: resolve(raw),
        visible: visibilityFor(el)
      });
    });
  };
  collectTextish(step.texts, 'text');
  collectTextish(step.buttons, 'button');
  (step.images ?? []).forEach((el: any) => {
    const props = el?.properties ?? {};
    const altRaw =
      (typeof props.alt_text === 'string' && props.alt_text) ||
      (typeof props.caption === 'string' && props.caption) ||
      '';
    if (!altRaw) return;
    currentStepElements.push({
      type: 'image',
      text: resolve(altRaw),
      visible: visibilityFor(el)
    });
  });
  (step.progress_bars ?? []).forEach((el: any) => {
    const segments = el?.properties?.num_segments;
    currentStepElements.push({
      type: 'progress',
      ...(typeof segments === 'number' ? { segments } : {}),
      visible: visibilityFor(el)
    });
  });

  const currentStepTables: PanelRuntimeTableEntry[] = [];
  (step.tables ?? []).forEach((el: any) => {
    const cols = (el?.properties?.columns ?? []) as Array<{
      name?: string;
      field_key?: string;
    }>;
    if (cols.length === 0) return;
    const numRows = cols.reduce((max, col) => {
      const v = col.field_key ? fieldsMap[col.field_key]?.value : undefined;
      return Array.isArray(v) ? Math.max(max, v.length) : max;
    }, 0);
    const rows: unknown[][] = Array.from({ length: numRows }, (_, i) =>
      cols.map((col) => {
        const v = col.field_key ? fieldsMap[col.field_key]?.value : null;
        return Array.isArray(v) ? v[i] ?? null : v ?? null;
      })
    );
    currentStepTables.push({
      columns: cols.map((c) => ({
        name: c.name ?? c.field_key ?? '',
        fieldKey: c.field_key ?? ''
      })),
      rows,
      visible: visibilityFor(el)
    });
  });

  return {
    currentStep: { id: step.id, key: step.key },
    previousStepName: state.previousStepName || undefined,
    totalSteps: Object.keys(state.steps ?? {}).length,
    currentStepFields,
    currentStepElements,
    currentStepTables,
    values,
    hiddenFieldValues
  };
};
