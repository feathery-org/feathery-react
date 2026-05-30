import internalState from '../../utils/internalState';
import { initState } from '../../utils/init';
import { replaceTextVariables } from '../../elements/components/TextNodes';
import { findClickableAncestorSubgrids } from '../utils';
import {
  getRepeatedContainer,
  getRepeatedContainers
} from '../../utils/repeat';
import { getPositionKey } from '../../utils/hideAndRepeats';
import { getDefaultFieldValue } from '../../utils/fieldHelperFunctions';
import { isButtonDisabled } from '../../utils/button';

export type PanelRuntimeFieldEntry = {
  key: string;
  type: string;
  value: unknown;
  visible: boolean;
  disabled: boolean;
  required: boolean;
  rowCount?: number;
  repeatContainerId?: string;
  hasLogicRules?: boolean;
  clickableAncestorIds?: string[];
  placeholder?: string;
  tooltip?: string;
  error?: string;
  options?: Array<{ value: string; label: string }>;
  rowOptions?: Array<Array<{ value: string; label: string }> | null>;
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
      type: 'text';
      id?: string;
      text: string;
      templateText?: string;
      visible: boolean;
      actions?: Array<Record<string, unknown>>;
      hasLogicRules?: boolean;
      clickableAncestorIds?: string[];
      repeatContainerId?: string;
    }
  | {
      type: 'image';
      text: string;
      visible: boolean;
      clickableAncestorIds?: string[];
    }
  | {
      type: 'button';
      id: string;
      text: string;
      visible: boolean;
      disabled: boolean;
      submit: boolean;
      actions: Array<Record<string, unknown>>;
      hasLogicRules?: boolean;
      repeatContainerId?: string;
    }
  | {
      type: 'container';
      id: string;
      visible: boolean;
      actions: Array<Record<string, unknown>>;
      hasLogicRules?: boolean;
      clickableAncestorIds?: string[];
      repeatContainerId?: string;
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

// Mirrors canRunAction in utils/elementActions.ts; step events run for every in-scope step, element events require elementId in rule.elements.
const STEP_EVENTS = new Set(['submit', 'load']);
const elementHasLogicRules = (
  logicRules: any[] | undefined,
  triggerEvent: string,
  stepId: string,
  elementId: string
): boolean =>
  (logicRules ?? []).some((rule) => {
    if (rule?.trigger_event !== triggerEvent) return false;
    if (rule.enabled === false || rule.valid === false) return false;
    const { steps, elements } = rule;
    if (Array.isArray(steps) && steps.length > 0 && !steps.includes(stepId))
      return false;
    if (STEP_EVENTS.has(triggerEvent)) return true;
    return Array.isArray(elements) && elements.includes(elementId);
  });

export const getPanelRuntimeSnapshot = (
  formId: string
): PanelRuntimeSnapshot | null => {
  const state = internalState[formId];
  if (!state || !state.currentStep) return null;

  const step = state.currentStep;
  const visiblePositions = state.visiblePositions ?? {};
  const fieldsMap = state.fields ?? {};
  const inlineErrors = state.inlineErrors ?? {};
  const logicRules = state.logicRules;
  const formReadOnly = !!(
    state.formSettings?.readOnly || initState.collaboratorReview === 'readOnly'
  );

  // Every subgrid has onClick wired so its handler fires on bubble; include any that'll do something - actions or an action-trigger rule scoped to its id.
  const clickableSubgrids = ((step.subgrids ?? []) as any[]).filter((sg) => {
    const acts = sg?.properties?.actions;
    if (Array.isArray(acts) && acts.length > 0) return true;
    return elementHasLogicRules(logicRules, 'action', step.id, sg.id ?? '');
  });
  const findClickableAncestorIds = (el: any): string[] =>
    findClickableAncestorSubgrids(
      clickableSubgrids,
      Array.isArray(el?.position) ? el.position : []
    ).map((sg: any) => sg.id ?? '');

  // Match the renderer (fields + text-variable arrays) by reading the same flags it builds
  const rowCountByContainer: Record<string, number> = {};
  getRepeatedContainers(step as any).forEach((container: any) => {
    const id = container?.id;
    if (!id) return;
    const flags = visiblePositions[getPositionKey(container)];
    if (Array.isArray(flags)) rowCountByContainer[id] = flags.length;
  });

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
    const repeated = !!servar.repeated;
    const repeatAncestor = repeated
      ? getRepeatedContainer(step as any, field)
      : undefined;
    const repeatAncestorId = repeatAncestor?.id ?? '';
    const rawOptions = Array.isArray(meta.options) ? meta.options : null;
    const rawLabels = Array.isArray(meta.labels) ? meta.labels : [];
    const options = rawOptions
      ? rawOptions.map((value: any, i: number) => ({
          value: String(value ?? ''),
          label: String(rawLabels[i] ?? value ?? '')
        }))
      : undefined;
    // Per-row option overrides for repeated choice fields
    const rawRowOptions = Array.isArray(meta.repeat_options)
      ? meta.repeat_options.map((row: any) =>
          Array.isArray(row)
            ? row.map((o: any) => ({
                value: String(o?.value ?? o ?? ''),
                label: String(o?.label ?? o?.value ?? o ?? '')
              }))
            : null
        )
      : undefined;
    const padTarget =
      rowCountByContainer[repeatAncestorId] ?? rawRowOptions?.length ?? 0;
    const rowOptions = rawRowOptions
      ? Array.from({ length: padTarget }, (_, i) =>
          Array.isArray(rawRowOptions[i]) ? rawRowOptions[i] : null
        )
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
    const hasLogicRules = elementHasLogicRules(
      logicRules,
      'change',
      step.id,
      servar.id ?? ''
    );
    const clickableAncestorIds = findClickableAncestorIds(field);
    let value = fieldEntity?.value ?? null;
    const rowCount = repeated
      ? rowCountByContainer[repeatAncestorId] ??
        (Array.isArray(value) ? (value as unknown[]).length : 0)
      : undefined;
    // Pad to rowCount so trailing rendered-but-unwritten rows read as blank
    if (typeof rowCount === 'number' && rowCount > 0) {
      const base = Array.isArray(value) ? value : [];
      if (base.length < rowCount) {
        value = [
          ...base,
          ...Array(rowCount - base.length).fill(getDefaultFieldValue(field))
        ];
      }
    }
    return {
      key: servar.key,
      type: servar.type,
      value,
      visible,
      disabled,
      required: !!servar.required,
      ...(typeof rowCount === 'number' ? { rowCount } : {}),
      ...(repeatAncestor?.id ? { repeatContainerId: repeatAncestor.id } : {}),
      ...(hasLogicRules ? { hasLogicRules: true } : {}),
      ...(clickableAncestorIds.length > 0 ? { clickableAncestorIds } : {}),
      ...(placeholder ? { placeholder } : {}),
      ...(tooltip ? { tooltip } : {}),
      ...(error ? { error } : {}),
      ...(options ? { options } : {}),
      ...(rowOptions ? { rowOptions } : {}),
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

  const currentStepElements: PanelRuntimeElementEntry[] = [];
  const visibilityFor = (el: any): boolean => {
    const positionKey = el.position?.join(',') || 'root';
    const flags = visiblePositions[positionKey];
    return Array.isArray(flags) ? flags.some(Boolean) : true;
  };

  clickableSubgrids.forEach((sg: any) => {
    const actions = sg.properties.actions;
    const hasLogicRules = elementHasLogicRules(
      logicRules,
      'action',
      step.id,
      sg.id ?? ''
    );
    const clickableAncestorIds = findClickableAncestorIds(sg);
    // A repeated subgrid is its own repeat container (one clickable instance per row)
    const containerRepeatContainer = !sg.repeated
      ? getRepeatedContainer(step as any, sg)?.id
      : sg.id;
    currentStepElements.push({
      type: 'container',
      id: sg.id ?? '',
      visible: visibilityFor(sg),
      actions,
      ...(hasLogicRules ? { hasLogicRules: true } : {}),
      ...(clickableAncestorIds.length > 0 ? { clickableAncestorIds } : {}),
      ...(containerRepeatContainer
        ? { repeatContainerId: containerRepeatContainer }
        : {})
    });
  });

  (step.texts ?? []).forEach((el: any) => {
    const raw = extractRawText(el?.properties ?? {});
    if (!raw) return;
    const resolved = resolveText(raw);
    const props = el?.properties ?? {};
    const actions = Array.isArray(props.actions) ? props.actions : [];
    const hasLogicRules = elementHasLogicRules(
      logicRules,
      'action',
      step.id,
      el.id ?? ''
    );
    const clickableAncestorIds = findClickableAncestorIds(el);
    const textRepeatContainer = getRepeatedContainer(step as any, el)?.id;
    currentStepElements.push({
      type: 'text',
      text: resolved,
      visible: visibilityFor(el),
      ...(el.id ? { id: el.id } : {}),
      ...(raw !== resolved ? { templateText: raw } : {}),
      ...(actions.length > 0 ? { actions } : {}),
      ...(hasLogicRules ? { hasLogicRules: true } : {}),
      ...(clickableAncestorIds.length > 0 ? { clickableAncestorIds } : {}),
      ...(textRepeatContainer ? { repeatContainerId: textRepeatContainer } : {})
    });
  });
  (step.buttons ?? []).forEach((el: any) => {
    const raw = extractRawText(el?.properties ?? {});
    const props = el?.properties ?? {};
    const actions = Array.isArray(props.actions) ? props.actions : [];
    // submit-flagged buttons also fire submit-trigger and form_complete-trigger rules on this step
    const hasLogicRules =
      elementHasLogicRules(logicRules, 'action', step.id, el.id ?? '') ||
      (!!props.submit &&
        (elementHasLogicRules(logicRules, 'submit', step.id, '') ||
          elementHasLogicRules(logicRules, 'form_complete', step.id, '')));
    if (!raw && actions.length === 0 && !props.submit && !hasLogicRules) return;
    const buttonRepeatContainer = getRepeatedContainer(step as any, el)?.id;
    currentStepElements.push({
      type: 'button',
      id: el.id ?? '',
      text: resolveText(raw),
      visible: visibilityFor(el),
      disabled: isButtonDisabled(el, step, visiblePositions, formReadOnly),
      submit: !!props.submit,
      actions,
      ...(hasLogicRules ? { hasLogicRules: true } : {}),
      ...(buttonRepeatContainer
        ? { repeatContainerId: buttonRepeatContainer }
        : {})
    });
  });
  (step.images ?? []).forEach((el: any) => {
    const props = el?.properties ?? {};
    const altRaw =
      (typeof props.alt_text === 'string' && props.alt_text) ||
      (typeof props.caption === 'string' && props.caption) ||
      '';
    if (!altRaw) return;
    const clickableAncestorIds = findClickableAncestorIds(el);
    currentStepElements.push({
      type: 'image',
      text: resolveText(altRaw),
      visible: visibilityFor(el),
      ...(clickableAncestorIds.length > 0 ? { clickableAncestorIds } : {})
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
