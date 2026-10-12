/** Failures keep HTTP status and recovery intent all the way to the editor. */
export class DocumentPersistenceError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | 'network'
      | 'timeout'
      | 'auth'
      | 'conflict'
      | 'invalid'
      | 'blocked'
      | 'cancelled',
    public readonly status?: number,
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'DocumentPersistenceError';
  }
}

export function canRetryDocumentError(error: unknown): boolean {
  if (error instanceof DocumentPersistenceError)
    return error.kind === 'network' || error.kind === 'timeout';
  const status = (error as { status?: number })?.status;
  return status == null || status === 408 || status === 429 || status >= 500;
}

export const DOCUMENT_REQUEST_TIMEOUT_MS = 45_000;

/** Bounds the entire request, including reading its body. Abort is best-effort;
 * Promise.race also releases callers when a host ignores the signal. */
export async function withDocumentDeadline<T>(
  request: (signal: AbortSignal) => Promise<T>,
  timeoutMs = DOCUMENT_REQUEST_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new DocumentPersistenceError(
          'Document request timed out. Your changes have not been discarded; retry the save.',
          'timeout'
        )
      );
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([request(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function documentErrorMessage(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (Array.isArray(payload))
    return payload.map(documentErrorMessage).join('; ');
  if (payload && typeof payload === 'object')
    return Object.values(payload)
      .map(documentErrorMessage)
      .filter(Boolean)
      .join('; ');
  return '';
}

export async function fetchDocumentBytes(url: string): Promise<ArrayBuffer> {
  return withDocumentDeadline(async (signal) => {
    const response = await fetch(url, { cache: 'no-store', signal });
    if (!response.ok)
      throw new DocumentPersistenceError(
        'Could not fetch the saved document',
        response.status >= 500 ? 'network' : 'invalid',
        response.status
      );
    return response.arrayBuffer();
  });
}
