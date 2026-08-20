// Module-level tracker for in-flight file submissions, shared across all
// mounted form instances (same pattern as filePathMap / fileRetryStatus).
// Feeds the consolidated FileUploadToast so exactly one progress box renders
// per page regardless of how many forms are mounted.

export type FileUploadStatus = 'uploading' | 'complete' | 'error';

export interface FileUploadEntry {
  id: string;
  formKey: string;
  fieldKey: string;
  fileNames: string[];
  status: FileUploadStatus;
  startedAt: number;
}

// A fast upload would otherwise flip to a checkmark within ~80ms, which reads
// as a glitch rather than as confirmation that the file was sent. Hold the
// spinner for at least this long so the transition is perceptible.
export const MIN_UPLOADING_MS = 900;

const enabledForms = new Set<string>();
const uploads = new Map<string, FileUploadEntry>();
const listeners = new Set<() => void>();
// Insertion-ordered form instance ids; the first is the leader that renders
// the consolidated toast.
const toastHosts: string[] = [];
// Status flips held back to satisfy MIN_UPLOADING_MS, keyed by entry id
const pendingFinishes = new Map<string, ReturnType<typeof setTimeout>>();

let snapshot: FileUploadEntry[] = [];
// Rendered height of the consolidated box, published by whichever instance is
// leading. Shared rather than local because the box is page-level, so every
// mounted form needs it to stack its own bottom-right overlays above it.
let toastHeight = 0;

const entryId = (formKey: string, fieldKey: string) =>
  `${formKey}::${fieldKey}`;

const notify = () => {
  snapshot = Array.from(uploads.values());
  listeners.forEach((listener) => listener());
};

export const setUploadIndicatorEnabled = (
  formKey: string,
  enabled: boolean
) => {
  if (enabled) enabledForms.add(formKey);
  else enabledForms.delete(formKey);
};

export const isUploadIndicatorEnabled = (formKey: string) =>
  enabledForms.has(formKey);

export const startUpload = (
  formKey: string,
  fieldKey: string,
  fileNames: string[] = []
) => {
  if (!enabledForms.has(formKey)) return;
  const id = entryId(formKey, fieldKey);
  const existing = uploads.get(id);
  cancelPendingFinish(id);
  uploads.set(id, {
    id,
    formKey,
    fieldKey,
    // A replayed request may not know its file names; keep the old ones
    fileNames: fileNames.length ? fileNames : existing?.fileNames ?? [],
    status: 'uploading',
    startedAt: Date.now()
  });
  notify();
};

export const completeUpload = (formKey: string, fieldKey: string) =>
  finishUpload(formKey, fieldKey, 'complete');

export const failUpload = (formKey: string, fieldKey: string) =>
  finishUpload(formKey, fieldKey, 'error');

const finishUpload = (
  formKey: string,
  fieldKey: string,
  status: FileUploadStatus
) => {
  const id = entryId(formKey, fieldKey);
  const entry = uploads.get(id);
  if (!entry || entry.status === status) return;

  const remaining = MIN_UPLOADING_MS - (Date.now() - entry.startedAt);
  if (remaining <= 0) {
    applyStatus(id, status);
    return;
  }
  cancelPendingFinish(id);
  pendingFinishes.set(
    id,
    setTimeout(() => {
      pendingFinishes.delete(id);
      applyStatus(id, status);
    }, remaining)
  );
};

const applyStatus = (id: string, status: FileUploadStatus) => {
  const entry = uploads.get(id);
  if (!entry) return;
  entry.status = status;
  notify();
};

const cancelPendingFinish = (id: string) => {
  const timeout = pendingFinishes.get(id);
  if (timeout === undefined) return;
  clearTimeout(timeout);
  pendingFinishes.delete(id);
};

export const clearFinishedUploads = () => {
  let changed = false;
  uploads.forEach((entry, id) => {
    if (entry.status !== 'uploading') {
      uploads.delete(id);
      changed = true;
    }
  });
  if (changed) notify();
};

export const setUploadToastHeight = (height: number) => {
  if (height === toastHeight) return;
  toastHeight = height;
  notify();
};

export const getUploadToastHeight = () => toastHeight;

export const subscribeToUploads = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getUploadsSnapshot = () => snapshot;

export const registerToastHost = (instanceId: string) => {
  if (!toastHosts.includes(instanceId)) toastHosts.push(instanceId);
  notify();
};

export const unregisterToastHost = (instanceId: string) => {
  const index = toastHosts.indexOf(instanceId);
  if (index >= 0) toastHosts.splice(index, 1);
  notify();
};

export const isLeaderToastHost = (instanceId: string) =>
  toastHosts[0] === instanceId;

// Test-only: reset all module state between specs
export const _resetFileUploadProgress = () => {
  enabledForms.clear();
  uploads.clear();
  listeners.clear();
  toastHosts.length = 0;
  pendingFinishes.forEach((timeout) => clearTimeout(timeout));
  pendingFinishes.clear();
  snapshot = [];
  toastHeight = 0;
};
