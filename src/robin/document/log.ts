/**
 * Diagnostics in the browser console, for testing on a running form: every write that does not
 * commit (a refusal, a conflict, a failed proof and its rollback) as a warning, a handler exception
 * as an error, and a commit as a debug line, each tagged `[robin-document]`.
 *
 * On by default in development builds (`process.env.NODE_ENV` is `development`, as the rig's
 * watcher and Next dev set it) and off in production and test builds; `setDocumentLogging` turns it
 * on or off at run time.
 */
export const LOG_TAG = '[robin-document]';

/** Whether a build with this `NODE_ENV` logs by default: development only. */
export function loggingByDefault(nodeEnv: string | undefined): boolean {
  return nodeEnv === 'development';
}

function developmentBuild(): boolean {
  try {
    // replaced with a literal by the bundler; a runtime with no `process` is not development, and
    // test runs (NODE_ENV test) stay quiet unless a test turns logging on
    return loggingByDefault(process.env.NODE_ENV);
  } catch {
    return false;
  }
}

let enabled = developmentBuild();

export function setDocumentLogging(on: boolean): void {
  enabled = on;
}

export function documentLoggingEnabled(): boolean {
  return enabled;
}

/** A detail value as at most about 300 characters of JSON. */
export function truncatedDetail(
  detail: unknown,
  limit = 300
): string | undefined {
  if (detail === undefined) return undefined;
  let text: string;
  try {
    text = JSON.stringify(detail) ?? String(detail);
  } catch {
    text = String(detail);
  }
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

export function logWarn(payload: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  if (enabled) console.warn(LOG_TAG, payload);
}

export function logError(payload: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  if (enabled) console.error(LOG_TAG, payload);
}

export function logDebug(payload: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  if (enabled) console.debug(LOG_TAG, payload);
}
