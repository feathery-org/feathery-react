import { featheryWindow, runningInClient } from './browser';

/**
 * Records the SDK's own API traffic for the network debug panel: what was
 * sent, while which step was showing, and how the request settled. Nothing is
 * recorded unless the panel is turned on, so normal forms pay no cost.
 */

export const NETWORK_DEBUG_PARAM = 'feathery_network_debug';
// Old entries are dropped so a long session can't grow without bound
const MAX_ENTRIES = 200;

export type NetworkDebugKind =
  | 'event'
  | 'custom_submit'
  | 'step_submit'
  | 'file_submit'
  | 'form'
  | 'session'
  | 'other';

export type NetworkDebugStatus = 'pending' | 'success' | 'error';

export interface NetworkDebugEntry {
  id: number;
  kind: NetworkDebugKind;
  method: string;
  path: string;
  stepKey: string;
  // Set when the offline queue resends a request that failed earlier
  retry: boolean;
  startedAt: number;
  durationMs?: number;
  status: NetworkDebugStatus;
  httpStatus?: number;
  error?: string;
  body?: unknown;
}

type Listener = (entries: NetworkDebugEntry[]) => void;

let enabled = false;
let entries: NetworkDebugEntry[] = [];
let nextId = 1;
let currentStepKey = '';
const listeners = new Set<Listener>();

const KIND_PATTERNS: [RegExp, NetworkDebugKind][] = [
  [/panel\/step\/submit\/file/, 'file_submit'],
  [/panel\/step\/submit/, 'step_submit'],
  [/panel\/custom\/submit/, 'custom_submit'],
  [/\/event\/?$/, 'event'],
  [/panel\/session/, 'session'],
  [/panel\/(v\d+\/)?$|panel\/compressed|form\/?$/, 'form']
];

function urlEnablesDebug(): boolean {
  if (!runningInClient()) return false;
  try {
    const search = featheryWindow().location?.search ?? '';
    return new URLSearchParams(search).has(NETWORK_DEBUG_PARAM);
  } catch (e) {
    return false;
  }
}

export function isNetworkDebugEnabled(): boolean {
  if (!enabled && urlEnablesDebug()) enabled = true;
  return enabled;
}

export function enableNetworkDebug() {
  enabled = true;
}

export function setNetworkDebugStep(stepKey: string) {
  currentStepKey = stepKey;
}

function publish() {
  listeners.forEach((listener) => listener(entries));
}

export function subscribeNetworkDebug(listener: Listener) {
  listeners.add(listener);
  listener(entries);
  return () => {
    listeners.delete(listener);
  };
}

export function clearNetworkDebug() {
  entries = [];
  publish();
}

export function classifyRequest(url: string): NetworkDebugKind {
  const path = url.split('?')[0];
  const match = KIND_PATTERNS.find(([pattern]) => pattern.test(path));
  return match ? match[1] : 'other';
}

function pathOf(url: string) {
  try {
    const { pathname, search } = new URL(url);
    return pathname.replace(/^\/api\//, '/') + search;
  } catch (e) {
    return url;
  }
}

function describeFile(value: Blob) {
  const name = (value as File).name ?? 'blob';
  return `[file ${name}, ${value.size} bytes]`;
}

// Turns a request body into something readable without consuming it
export function summarizeBody(body: unknown): unknown {
  if (body == null) return undefined;
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const summary: Record<string, unknown> = {};
    body.forEach((value, key) => {
      let readable: unknown =
        typeof value === 'string' ? parseMaybeJson(value) : describeFile(value);
      if (key in summary) readable = [summary[key], readable].flat();
      summary[key] = readable;
    });
    return summary;
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob)
    return describeFile(body);
  if (typeof body === 'string') return parseMaybeJson(body);
  return body;
}

function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (e) {
    return value;
  }
}

// Shape check rather than instanceof, so polyfilled fetch responses count too
function responseStatus(result: unknown): number | undefined {
  const status = (result as { status?: unknown; ok?: unknown } | null)?.status;
  const looksLikeResponse =
    typeof status === 'number' && typeof (result as any).ok === 'boolean';
  return looksLikeResponse ? status : undefined;
}

function update(id: number, changes: Partial<NetworkDebugEntry>) {
  entries = entries.map((entry) =>
    entry.id === id ? { ...entry, ...changes } : entry
  );
  publish();
}

function errorText(error: unknown) {
  if (error instanceof Error) {
    const name = error.constructor?.name ?? error.name;
    return error.message ? `${name}: ${error.message}` : name;
  }
  return String(error);
}

/**
 * Runs a request and, when debugging is on, records it from start to finish.
 * The request's own result or error passes through untouched.
 */
export async function trackRequest<T>(
  url: string,
  options: { method?: string; body?: unknown } | undefined,
  run: () => Promise<T>,
  { retry = false }: { retry?: boolean } = {}
): Promise<T> {
  if (!isNetworkDebugEnabled()) return run();

  const id = nextId++;
  const startedAt = Date.now();
  const entry: NetworkDebugEntry = {
    id,
    kind: classifyRequest(url),
    method: (options?.method ?? 'GET').toUpperCase(),
    path: pathOf(url),
    stepKey: currentStepKey,
    retry,
    startedAt,
    status: 'pending',
    body: summarizeBody(options?.body)
  };
  entries = [...entries, entry].slice(-MAX_ENTRIES);
  publish();

  try {
    const result = await run();
    const httpStatus = responseStatus(result);
    update(id, {
      durationMs: Date.now() - startedAt,
      httpStatus,
      status: (httpStatus ?? 200) >= 400 ? 'error' : 'success'
    });
    return result;
  } catch (error) {
    update(id, {
      durationMs: Date.now() - startedAt,
      status: 'error',
      error: errorText(error)
    });
    throw error;
  }
}

// Test helper
export function _resetNetworkDebug() {
  enabled = false;
  entries = [];
  nextId = 1;
  currentStepKey = '';
  listeners.clear();
}
