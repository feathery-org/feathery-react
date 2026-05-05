import internalState from '../utils/internalState';
import { initState } from '../utils/init';
import { replaceTextVariables } from '../elements/components/TextNodes';

export type PanelRuntimeFieldEntry = {
  key: string;
  type: string;
  value: unknown;
  visible: boolean;
  disabled: boolean;
  required: boolean;
  repeated: boolean;
  placeholder?: string;
  tooltip?: string;
  error?: string;
  options?: Array<{ value: string; label: string }>;
  questions?: Array<{ id: string; label: string }>;
  minLength?: number;
  maxLength?: number;
  format?: string;
  fileTypes?: string[];
  multipleFiles?: boolean;
  multiple?: boolean;
  sliderLabels?: { min?: string; max?: string };
  stepSize?: number;
};

export type PanelRuntimeElementEntry =
  | {
      type: 'text' | 'button' | 'image';
      text: string;
      visible: boolean;
    }
  | {
      type: 'progress';
      segments?: number;
      visible: boolean;
    };

export type PanelRuntimeTableEntry = {
  columns: Array<{ name: string; fieldKey: string }>;
  rows: unknown[][];
  visible: boolean;
};

export type PanelRuntimeSnapshot = {
  currentStep: { id: string; key: string };
  previousStepName?: string;
  totalSteps: number;
  currentStepFields: PanelRuntimeFieldEntry[];
  currentStepElements: PanelRuntimeElementEntry[];
  currentStepTables: PanelRuntimeTableEntry[];
  values: Record<string, unknown>;
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

const resolveText = (text: string, repeat?: number): string => {
  if (!text) return '';
  try {
    return replaceTextVariables(text, repeat);
  } catch {
    return text;
  }
};

export const getCurrentStepKey = (formId: string): string | undefined =>
  internalState[formId]?.currentStep?.key;

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

  // Build per-field entries for the current step
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
        ? resolveText(props.placeholder)
        : undefined;
    const tooltip =
      typeof props.tooltipText === 'string' && props.tooltipText.trim()
        ? resolveText(props.tooltipText)
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
      ...(servar.type === 'button_group' ? { multiple: !!meta.multiple } : {}),
      ...(sliderLabels ? { sliderLabels } : {}),
      ...(typeof meta.step_size === 'number'
        ? { stepSize: meta.step_size }
        : {})
    };
  });

  // Collect every servar key across the form
  const servarKeys = new Set<string>();
  for (const stepKey of Object.keys(state.steps ?? {})) {
    const loopStep = (state.steps as any)[stepKey];
    (loopStep?.servar_fields ?? []).forEach((f: any) => {
      if (f?.servar?.key) servarKeys.add(f.servar.key);
    });
  }

  // Split values into servars (visible form fields) and hidden fields
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

  // Collect non-field elements (text, buttons, images, progress bars)
  const currentStepElements: PanelRuntimeElementEntry[] = [];
  const visibilityFor = (el: any): boolean => {
    const positionKey = el.position?.join(',') || 'root';
    const flags = visiblePositions[positionKey];
    return Array.isArray(flags) ? flags.some(Boolean) : true;
  };
  const collectText = (list: any[] | undefined, type: 'text' | 'button') => {
    (list ?? []).forEach((el: any) => {
      const raw = extractRawText(el?.properties ?? {});
      if (!raw) return;
      currentStepElements.push({
        type,
        text: resolveText(raw),
        visible: visibilityFor(el)
      });
    });
  };
  collectText(step.texts, 'text');
  collectText(step.buttons, 'button');
  (step.images ?? []).forEach((el: any) => {
    const props = el?.properties ?? {};
    const altRaw =
      (typeof props.alt_text === 'string' && props.alt_text) ||
      (typeof props.caption === 'string' && props.caption) ||
      '';
    if (!altRaw) return;
    currentStepElements.push({
      type: 'image',
      text: resolveText(altRaw),
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

  // Collect tables with their column headers and row data
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
