// Module-level tracker for in-flight file submissions, shared across all
// mounted form instances (same pattern as filePathMap / fileRetryStatus).
// Feeds the consolidated FileUploadToast so exactly one progress box renders
// per page regardless of how many forms are mounted.

// 'queued' means the request is saved for replay and is waiting on
// connectivity, which is pending rather than resolved.
export type FileUploadStatus = 'uploading' | 'queued' | 'complete' | 'error';

export interface FileUploadEntry {
  id: string;
  formKey: string;
  fieldKey: string;
  fileNames: string[];
  // Number of files in the request. Not always equal to fileNames.length —
  // a signature blob has no usable name, so it is counted but not named.
  fileCount: number;
  status: FileUploadStatus;
  startedAt: number;
}

export const isPendingUpload = (status: FileUploadStatus) =>
  status === 'uploading' || status === 'queued';

// A fast upload would otherwise flip to a checkmark within ~80ms, which reads
// as a glitch rather than as confirmation that the file was sent. Hold the
// spinner for at least this long so the transition is perceptible.
export const MIN_UPLOADING_MS = 900;

const enabledForms = new Set<string>();
const uploads = new Map<string, FileUploadEntry>();
const listeners = new Set<() => void>();
const heightListeners = new Set<() => void>();
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
  fileNames: string[] = [],
  fileCount = fileNames.length
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
    fileCount: fileCount || existing?.fileCount || 0,
    status: 'uploading',
    startedAt: Date.now()
  });
  notify();
};

export const completeUpload = (formKey: string, fieldKey: string) =>
  finishUpload(formKey, fieldKey, 'complete');

export const failUpload = (formKey: string, fieldKey: string) =>
  finishUpload(formKey, fieldKey, 'error');

// The request was saved for replay. Applied immediately rather than through
// finishUpload, since the minimum spinner dwell exists to make a *resolution*
// perceptible and this row has not resolved.
export const queueUpload = (formKey: string, fieldKey: string) => {
  const id = entryId(formKey, fieldKey);
  cancelPendingFinish(id);
  applyStatus(id, 'queued');
};

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

// Drops successful rows once they have been shown long enough. Errors are
// deliberately left behind: a failure that disappears on its own is the exact
// case this box exists to surface. They clear when a retry supersedes them
// (startUpload overwrites the row) or when the user dismisses the box.
export const clearCompletedUploads = () => {
  let changed = false;
  uploads.forEach((entry, id) => {
    if (entry.status === 'complete') {
      uploads.delete(id);
      changed = true;
    }
  });
  if (changed) notify();
};

// User dismissal: drop every resolved row, errors included. Rows still in
// flight stay, since hiding them would lose the only report of their outcome.
export const dismissResolvedUploads = () => {
  let changed = false;
  uploads.forEach((entry, id) => {
    if (!isPendingUpload(entry.status)) {
      uploads.delete(id);
      changed = true;
    }
  });
  if (changed) notify();
};

export const setUploadToastHeight = (height: number) => {
  if (height === toastHeight) return;
  toastHeight = height;
  // Height-only listeners, so a resize does not rebuild the uploads snapshot
  // and re-render every subscriber that only cares about the rows.
  heightListeners.forEach((listener) => listener());
};

export const getUploadToastHeight = () => toastHeight;

export const subscribeToUploads = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const subscribeToUploadToastHeight = (listener: () => void) => {
  heightListeners.add(listener);
  return () => {
    heightListeners.delete(listener);
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
  heightListeners.clear();
  toastHosts.length = 0;
  pendingFinishes.forEach((timeout) => clearTimeout(timeout));
  pendingFinishes.clear();
  snapshot = [];
  toastHeight = 0;
};
