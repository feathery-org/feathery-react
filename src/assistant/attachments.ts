import type { FileUIPart } from 'ai';
import { Chat } from '@ai-sdk/react';
import { featheryDoc } from '../utils/browser';
import { AssistantHeaders, withFormKey } from './utils';

export const MAX_DIMENSION = 1568;
export const MAX_FILE_SIZE = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;

export const IMAGE_MEDIA_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp'
]);

// Mirrors MEDIA_TYPE_TO_EXTENSION on the ai-services side
// (src/modules/robin/attachment/mediaTypes.ts), keep in sync
export const DOC_MEDIA_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/rtf',
  'text/rtf',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/vnd.ms-excel',
  'text/csv'
]);

export const ALLOWED_MEDIA_TYPES = new Set<string>([
  ...IMAGE_MEDIA_TYPES,
  ...DOC_MEDIA_TYPES
]);

export const ACCEPT_ATTR = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  '.pdf',
  'application/msword',
  '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.docx',
  'application/rtf',
  'text/rtf',
  '.rtf',
  'application/vnd.ms-powerpoint',
  '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsx',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  '.xlsm',
  'application/vnd.ms-excel',
  '.xls',
  'text/csv',
  '.csv'
].join(',');

export const isImageType = (mediaType: string): boolean =>
  IMAGE_MEDIA_TYPES.has(mediaType);

export type AttachmentProcessingStatus =
  | 'uploading'
  | 'pending'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'skipped';

export const isTerminalStatus = (
  s: AttachmentProcessingStatus | string | undefined
): boolean => s === 'ready' || s === 'failed' || s === 'skipped';

export interface AssistantAttachment {
  file: File;
  previewUrl: string;
  id?: string;
  uploadedUrl?: string;
  uploadedFilename?: string;
  uploadedMediaType?: string;
  processingStatus: AttachmentProcessingStatus;
  uploadError?: string;
}

// Attachment endpoints are the /agent/attachment/ sibling of the chat base,
// same origin (threadsBase precedent in utils.ts)
export const attachmentBase = (baseUrl: string) =>
  new URL('/agent/attachment/', baseUrl).href;

// The thread id doubles as the attachment session key (builder convention:
// a new chat mints the uuid that becomes the thread id on first message)
const chatSessionIds = new WeakMap<Chat<any>, string>();
export const setChatSessionId = (chat: Chat<any>, sessionId: string) =>
  chatSessionIds.set(chat, sessionId);
export const getChatSessionId = (chat: Chat<any>): string | undefined =>
  chatSessionIds.get(chat);

export async function compressImage(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;

    if (
      width <= MAX_DIMENSION &&
      height <= MAX_DIMENSION &&
      file.type === 'image/jpeg'
    ) {
      bitmap.close();
      return file;
    }

    const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height, 1);
    const canvas = featheryDoc().createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85)
    );
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), {
      type: 'image/jpeg'
    });
  } catch {
    return file;
  }
}

export type UploadedAttachment = {
  id: string;
  url: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  processingStatus: 'pending' | 'processing' | 'ready' | 'failed' | 'skipped';
};

export async function uploadAttachment(
  file: File,
  baseUrl: string,
  headers: AssistantHeaders,
  sessionId: string,
  signal: AbortSignal,
  formKey?: string
): Promise<UploadedAttachment> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(withFormKey(attachmentBase(baseUrl), formKey), {
    method: 'POST',
    headers: { ...headers(), 'X-Session-ID': sessionId },
    body: form,
    signal
  });
  if (!response.ok) {
    let message = `Upload failed (${response.status})`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      // body is not JSON, keep the generic message
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }
  return response.json();
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 390_000; // ~6.5 min: pipeline budget (~6 min) + slack

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });

// Poll GET /:id/url/ until the row reaches a terminal state, upload
// auto-dispatches embedding server-side so polling is the whole client
// contract
export async function pollAttachmentStatus(
  attachmentId: string,
  baseUrl: string,
  headers: AssistantHeaders,
  sessionId: string,
  signal: AbortSignal,
  formKey?: string
): Promise<UploadedAttachment> {
  const id = encodeURIComponent(attachmentId);
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let resp: Response | null = null;
    try {
      resp = await fetch(
        withFormKey(`${attachmentBase(baseUrl)}${id}/url/`, formKey),
        {
          method: 'GET',
          headers: { ...headers(), 'X-Session-ID': sessionId },
          signal
        }
      );
    } catch (err) {
      // Network blips retry until the deadline, aborts exit the loop
      if (signal.aborted) throw err;
    }
    if (resp?.ok) {
      const body = (await resp.json()) as Partial<UploadedAttachment>;
      if (isTerminalStatus(body.processingStatus)) {
        return body as UploadedAttachment;
      }
    } else if (resp && [401, 403, 404].includes(resp.status)) {
      // Definitive 4xx won't heal, 5xx retries until the deadline
      throw new Error(`Attachment status check failed (${resp.status})`);
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Embedding timed out after ${Math.round(POLL_TIMEOUT_MS / 1000)}s`
      );
    }
    await delay(POLL_INTERVAL_MS, signal);
  }
}

export function getFilePart(attachment: AssistantAttachment): FileUIPart {
  return {
    type: 'file' as const,
    mediaType: attachment.uploadedMediaType ?? attachment.file.type,
    filename: attachment.uploadedFilename ?? attachment.file.name,
    url: attachment.uploadedUrl ?? attachment.previewUrl,
    // File parts are stripped from the LLM stream, the attachmentId is the
    // handle the agent passes to queryAttachmentSemantic
    ...(attachment.id
      ? { providerMetadata: { feathery: { attachmentId: attachment.id } } }
      : {})
  };
}
