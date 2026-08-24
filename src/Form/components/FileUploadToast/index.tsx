import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import ActionToast from '../ActionToast';
import { DataItem } from '../ActionToast/useAIExtractionToast';
import {
  FileUploadEntry,
  clearCompletedUploads,
  dismissResolvedUploads,
  getUploadsSnapshot,
  isLeaderToastHost,
  isPendingUpload,
  registerToastHost,
  setUploadToastHeight,
  subscribeToUploads,
  unregisterToastHost
} from '../../../utils/fileUploadProgress';
import { featheryDoc, runningInClient } from '../../../utils/browser';

const COMPLETED_TOAST_DURATION_MS = 3200;
const CONTAINER_ID = 'feathery-file-upload-toast';

// Body-level container so the box escapes ancestor transform/filter containing
// blocks and stays stable when toast leadership moves between form instances.
const getToastContainer = () => {
  const doc = featheryDoc();
  let container = doc.getElementById(CONTAINER_ID);
  if (!container) {
    container = doc.createElement('div');
    container.id = CONTAINER_ID;
    doc.body.appendChild(container);
  }
  return container;
};

// Count files, not rows: one field can carry several files
const countFiles = (entries: FileUploadEntry[]) =>
  entries.reduce((total, entry) => total + Math.max(entry.fileCount, 1), 0);

const getTitle = (entries: FileUploadEntry[]) => {
  const plural = countFiles(entries) > 1;
  if (entries.some((entry) => entry.status === 'uploading'))
    return plural ? 'Uploading Files' : 'Uploading File';
  // Queued rows are waiting on connectivity, not stalled
  if (entries.some((entry) => entry.status === 'queued'))
    return plural ? 'Files Waiting to Upload' : 'File Waiting to Upload';
  if (entries.some((entry) => entry.status === 'error')) return 'Upload Failed';
  return plural ? 'Files Uploaded' : 'File Uploaded';
};

// Falls back to a file count rather than the field key, which is an internal
// developer name that means nothing to the person filling out the form.
const getLabel = (entry: FileUploadEntry) => {
  if (entry.fileNames.length) return entry.fileNames.join(', ');
  const count = Math.max(entry.fileCount, 1);
  return `${count} file${count === 1 ? '' : 's'}`;
};

const toDataItem = (entry: FileUploadEntry): DataItem => ({
  id: entry.id,
  variantId: '',
  status: entry.status === 'uploading' ? 'incomplete' : entry.status,
  label: getLabel(entry)
});

// Consolidated progress box for in-flight file submissions. Mounted in every
// form instance, but only instances whose show_file_upload_progress setting is
// on compete to host it, so a form with the setting off never paints a box.
// The hosting instance shows uploads from every form that reports them.
export default function FileUploadToast({
  instanceId,
  enabled,
  bottom
}: {
  instanceId: string;
  enabled: boolean;
  bottom: number;
}) {
  const entries = useSyncExternalStore(
    subscribeToUploads,
    getUploadsSnapshot,
    getUploadsSnapshot
  );

  useEffect(() => {
    if (!enabled) return;
    registerToastHost(instanceId);
    return () => unregisterToastHost(instanceId);
  }, [instanceId, enabled]);

  // Publish the rendered height so each form can stack its own bottom-right
  // overlays (the assistant bubble) above the shared box instead of under it
  const observerRef = useRef<ResizeObserver | null>(null);
  const measureToast = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) {
      setUploadToastHeight(0);
      return;
    }
    const observer = new ResizeObserver((measured) =>
      setUploadToastHeight(measured[0].contentRect.height)
    );
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  // Only successful rows time out. An error stays until a retry replaces it or
  // the user dismisses the box.
  const allSucceeded =
    entries.length > 0 && entries.every((entry) => entry.status === 'complete');
  useEffect(() => {
    if (!allSucceeded) return;
    const timeoutId = setTimeout(
      clearCompletedUploads,
      COMPLETED_TOAST_DURATION_MS
    );
    return () => clearTimeout(timeoutId);
  }, [allSucceeded]);

  if (!runningInClient() || !enabled) return null;
  if (!isLeaderToastHost(instanceId) || entries.length === 0) return null;

  // Nothing left to dismiss while every row is still in flight
  const dismissable = entries.some((entry) => !isPendingUpload(entry.status));

  return createPortal(
    <ActionToast
      ref={measureToast}
      data={entries.map(toDataItem)}
      title={getTitle(entries)}
      bottom={bottom}
      onDismiss={dismissable ? dismissResolvedUploads : undefined}
    />,
    getToastContainer()
  );
}
