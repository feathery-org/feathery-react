import { featheryWindow, runningInClient } from './browser';

/**
 * Work a mounted element is holding that leaving the form would throw away —
 * an unsaved document edit, a spreadsheet's buffered cells.
 *
 * Elements register a message while they hold something; the form asks before
 * a step transition, a browser back/forward, and a full page exit. Keeping one
 * registry rather than one per element means a single `beforeunload` listener
 * and a single prompt when several elements are dirty at once.
 */

// Legacy fallback so an element rendered without a formId is still guarded.
const DEFAULT_FORM_ID = '__legacy_unsaved_work_form__';

// formId -> source id -> the message to show before that work is lost.
const workByForm = new Map<string, Map<string, string>>();
let listenerAttached = false;

const beforeUnloadHandler = (event: any) => {
  event.preventDefault();
  // Legacy method of doing this for Chrome/Edge < 119
  event.returnValue = true;
};

// The browser unload warning is armed only while something is actually unsaved.
const syncUnloadListener = () => {
  if (!runningInClient()) return;
  const anyUnsaved = [...workByForm.values()].some((sources) => sources.size);
  if (anyUnsaved && !listenerAttached) {
    featheryWindow().addEventListener('beforeunload', beforeUnloadHandler);
    listenerAttached = true;
  } else if (!anyUnsaved && listenerAttached) {
    featheryWindow().removeEventListener('beforeunload', beforeUnloadHandler);
    listenerAttached = false;
  }
};

const formKey = (formId?: string) => formId || DEFAULT_FORM_ID;

/**
 * Record (or, with a null message, clear) one source's unsaved work. Source ids
 * are namespaced by their owner, e.g. `docx:<containerId>`.
 */
export const setUnsavedWork = (
  formId: string | undefined,
  sourceId: string,
  message: string | null
) => {
  const key = formKey(formId);
  if (message) {
    const sources = workByForm.get(key) ?? new Map<string, string>();
    sources.set(sourceId, message);
    workByForm.set(key, sources);
  } else {
    const sources = workByForm.get(key);
    sources?.delete(sourceId);
    if (sources && !sources.size) workByForm.delete(key);
  }
  syncUnloadListener();
};

export const clearUnsavedWork = (
  formId: string | undefined,
  sourceId: string
) => setUnsavedWork(formId, sourceId, null);

/** Source ids currently holding unsaved work, in registration order. */
export const unsavedWorkSources = (formId?: string): string[] => [
  ...(workByForm.get(formKey(formId))?.keys() ?? [])
];

/**
 * What to tell the user before they leave, or null when nothing is unsaved.
 * Distinct messages are stacked so two dirty elements do not turn into two
 * consecutive dialogs, or into one that mentions only the first of them.
 */
export const unsavedWorkMessage = (formId?: string): string | null => {
  const sources = workByForm.get(formKey(formId));
  if (!sources?.size) return null;
  return [...new Set(sources.values())].join('\n\n');
};

export const hasUnsavedWork = (formId?: string): boolean =>
  unsavedWorkMessage(formId) !== null;

/** True to go ahead: either nothing is unsaved, or the user accepted losing it. */
export const confirmLeavingUnsavedWork = (formId?: string): boolean => {
  const message = unsavedWorkMessage(formId);
  return !message || featheryWindow().confirm(message);
};

export const _clearUnsavedWorkRegistry = () => {
  workByForm.clear();
  syncUnloadListener();
};
