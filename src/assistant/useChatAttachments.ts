import {
  ClipboardEvent,
  DragEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';
import { Chat } from '@ai-sdk/react';
import { AssistantHeaders } from './utils';
import {
  ALLOWED_MEDIA_TYPES,
  AssistantAttachment,
  compressImage,
  getChatSessionId,
  isImageType,
  isTerminalStatus,
  MAX_ATTACHMENTS,
  MAX_FILE_SIZE,
  pollAttachmentStatus,
  uploadAttachment
} from './attachments';

// Owns the composer's staged-attachment lifecycle, validate + compress on
// add, upload, poll until terminal, per-chip abort on remove, full reset on
// chat switch (another thread's session can't send them)
export function useChatAttachments({
  activeChat,
  baseUrl,
  headers,
  formKey
}: {
  activeChat: Chat<any>;
  baseUrl: string;
  headers: AssistantHeaders;
  formKey?: string;
}) {
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  // AbortController per previewUrl so removing a chip cancels its upload+poll
  const uploadControllersRef = useRef<Map<string, AbortController>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controllers = uploadControllersRef.current;
    return () => {
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
      attachmentsRef.current.forEach((attachment) =>
        URL.revokeObjectURL(attachment.previewUrl)
      );
      setAttachments([]);
      setAttachmentError(null);
    };
  }, [activeChat]);

  const uploadAndTrack = useCallback(
    async (previewUrl: string, file: File) => {
      const sessionId = getChatSessionId(activeChat);
      if (!sessionId) return;
      const controller = new AbortController();
      uploadControllersRef.current.set(previewUrl, controller);
      const stamp = (updates: Partial<AssistantAttachment>) =>
        setAttachments((prev) =>
          prev.map((a) =>
            a.previewUrl === previewUrl ? { ...a, ...updates } : a
          )
        );
      try {
        const uploaded = await uploadAttachment(
          file,
          baseUrl,
          headers,
          sessionId,
          controller.signal,
          formKey
        );
        if (controller.signal.aborted) return;
        stamp({
          id: uploaded.id,
          uploadedUrl: uploaded.url,
          uploadedFilename: uploaded.filename,
          uploadedMediaType: uploaded.mediaType,
          processingStatus: uploaded.processingStatus
        });
        if (isTerminalStatus(uploaded.processingStatus)) return;

        // Upload auto-dispatches embedding server-side, poll until terminal,
        // converted docs re-stamp mediaType/url to the canonical PDF but keep
        // the original filename for display
        const processed = await pollAttachmentStatus(
          uploaded.id,
          baseUrl,
          headers,
          sessionId,
          controller.signal,
          formKey
        );
        if (controller.signal.aborted) return;
        stamp({
          uploadedUrl: processed.url ?? uploaded.url,
          uploadedMediaType: processed.mediaType,
          processingStatus: processed.processingStatus
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        const message =
          err instanceof Error ? err.message : 'Failed to upload attachment.';
        if ((err as { status?: number }).status === 403) {
          // Anonymous fillers can't attach, drop the chip + surface inline
          setAttachments((prev) =>
            prev.filter((a) => a.previewUrl !== previewUrl)
          );
          URL.revokeObjectURL(previewUrl);
          setAttachmentError(message);
        } else {
          stamp({ processingStatus: 'failed', uploadError: message });
        }
      } finally {
        uploadControllersRef.current.delete(previewUrl);
      }
    },
    [activeChat, baseUrl, headers, formKey]
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      setAttachmentError(null);
      const validFiles = files.filter(
        (file) =>
          ALLOWED_MEDIA_TYPES.has(file.type) && file.size <= MAX_FILE_SIZE
      );
      if (validFiles.length < files.length) {
        setAttachmentError(
          'Only images, PDFs, Word documents, Excel spreadsheets, and Powerpoints up to 25MB are supported.'
        );
      }
      if (!validFiles.length) return;

      const processedFiles = await Promise.all(
        validFiles.map((file) =>
          isImageType(file.type) ? compressImage(file) : file
        )
      );

      const remaining = Math.max(
        0,
        MAX_ATTACHMENTS - attachmentsRef.current.length
      );
      if (processedFiles.length > remaining) {
        setAttachmentError(`You can attach up to ${MAX_ATTACHMENTS} files.`);
      }
      if (remaining === 0) return;

      const additions = processedFiles.slice(0, remaining).map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
        processingStatus: 'uploading' as const
      }));
      setAttachments((prev) => [...prev, ...additions]);
      additions.forEach((a) => {
        uploadAndTrack(a.previewUrl, a.file);
      });
    },
    [uploadAndTrack]
  );

  const removeFile = useCallback((previewUrl: string) => {
    const controller = uploadControllersRef.current.get(previewUrl);
    if (controller) {
      controller.abort();
      uploadControllersRef.current.delete(previewUrl);
    }
    URL.revokeObjectURL(previewUrl);
    setAttachments((prev) => prev.filter((a) => a.previewUrl !== previewUrl));
  }, []);

  // Hands staged attachments to the caller and clears them from the
  // composer, previewUrls narrows to one batch (late additions stay for the
  // next message), caller owns revoking the preview URLs
  const takeAttachments = useCallback((previewUrls?: string[]) => {
    const all = attachmentsRef.current;
    if (!previewUrls) {
      setAttachments([]);
      setAttachmentError(null);
      return all;
    }
    const taken = all.filter((a) => previewUrls.includes(a.previewUrl));
    setAttachments(all.filter((a) => !previewUrls.includes(a.previewUrl)));
    return taken;
  }, []);

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLInputElement>) => {
      const pastedFiles = Array.from(e.clipboardData.items)
        .filter(
          (item) => item.kind === 'file' && ALLOWED_MEDIA_TYPES.has(item.type)
        )
        .map((item) => item.getAsFile())
        .filter(Boolean) as File[];
      if (pastedFiles.length) addFiles(pastedFiles);
    },
    [addFiles]
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(Array.from(e.dataTransfer.files));
      }
    },
    [addFiles]
  );

  const attachmentsInFlight = attachments.some(
    (a) => !isTerminalStatus(a.processingStatus)
  );

  return {
    attachments,
    attachmentError,
    attachmentsInFlight,
    isDragging,
    fileInputRef,
    addFiles,
    removeFile,
    takeAttachments,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop
  };
}
