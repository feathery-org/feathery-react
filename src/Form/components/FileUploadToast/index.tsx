import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import ActionToast from '../ActionToast';
import { DataItem } from '../ActionToast/useAIExtractionToast';
import {
  FileUploadEntry,
  clearFinishedUploads,
  getUploadsSnapshot,
  isLeaderToastHost,
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

const getTitle = (entries: FileUploadEntry[]) => {
  // Count files, not rows: one field can carry several files
  const fileCount = entries.reduce(
    (total, entry) => total + Math.max(entry.fileNames.length, 1),
    0
  );
  const plural = fileCount > 1;
  if (entries.some((entry) => entry.status === 'uploading'))
    return plural ? 'Uploading Files' : 'Uploading File';
  if (entries.some((entry) => entry.status === 'error')) return 'Upload Failed';
  return plural ? 'Files Uploaded' : 'File Uploaded';
};

const toDataItem = (entry: FileUploadEntry): DataItem => ({
  id: entry.id,
  variantId: '',
  status: entry.status === 'uploading' ? 'incomplete' : entry.status,
  label: entry.fileNames.length ? entry.fileNames.join(', ') : entry.fieldKey
});

// Consolidated progress box for in-flight file submissions. Mounted in every
// form instance; only the leader instance renders, showing uploads from all
// forms whose show_file_upload_progress setting is on.
export default function FileUploadToast({
  instanceId,
  bottom
}: {
  instanceId: string;
  bottom: number;
}) {
  const entries = useSyncExternalStore(
    subscribeToUploads,
    getUploadsSnapshot,
    getUploadsSnapshot
  );

  useEffect(() => {
    registerToastHost(instanceId);
    return () => unregisterToastHost(instanceId);
  }, [instanceId]);

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

  const allFinished =
    entries.length > 0 &&
    entries.every((entry) => entry.status !== 'uploading');
  useEffect(() => {
    if (!allFinished) return;
    const timeoutId = setTimeout(
      clearFinishedUploads,
      COMPLETED_TOAST_DURATION_MS
    );
    return () => clearTimeout(timeoutId);
  }, [allFinished]);

  if (!runningInClient()) return null;
  if (!isLeaderToastHost(instanceId) || entries.length === 0) return null;

  return createPortal(
    <ActionToast
      ref={measureToast}
      data={entries.map(toDataItem)}
      title={getTitle(entries)}
      bottom={bottom}
    />,
    getToastContainer()
  );
}
