export type WarnType = 'option' | 'value';

export type WarningArgs = {
  state: Set<string>;
  type: WarnType;
  field: string;
  reason: string;
  context: string;
  payload: unknown;
  entityLabel?: string;
};

type WarningBucket = {
  type: WarnType;
  field: string;
  reason: string;
  entityLabel: string;
  count: number;
  contexts: string[];
  sample: unknown;
};

const warningBuckets = new Map<string, WarningBucket>();
let flushScheduled = false;

const flushBuckets = () => {
  flushScheduled = false;
  warningBuckets.forEach((bucket) => {
    const label = bucket.type === 'option' ? 'option entry' : 'selected value';
    const plural = bucket.count === 1 ? '' : ' entries';
    const contextSuffix = bucket.contexts.length
      ? ` at ${bucket.contexts.join(', ')}`
      : '';
    console.warn(
      `[Feathery] ${bucket.entityLabel} "${bucket.field}" skipped ${bucket.count} invalid ${label}${plural} (${bucket.reason})${contextSuffix}.`,
      bucket.sample
    );
  });
  warningBuckets.clear();
};

const scheduleFlush = () => {
  if (flushScheduled) return;
  flushScheduled = true;
  const runner = typeof queueMicrotask === 'function' ? queueMicrotask : (cb: () => void) => Promise.resolve().then(cb);
  runner(flushBuckets);
};

export const normalizeToString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
};

export const warnInvalidData = ({
  state,
  type,
  field,
  reason,
  context,
  payload,
  entityLabel = 'Field'
}: WarningArgs) => {
  const contextSignature = `${type}|${field}|${reason}|${context}`;
  if (state.has(contextSignature)) return;
  state.add(contextSignature);

  const bucketKey = `${type}|${field}|${reason}`;
  let bucket = warningBuckets.get(bucketKey);
  if (!bucket) {
    bucket = {
      type,
      field,
      reason,
      entityLabel,
      count: 0,
      contexts: [],
      sample: payload
    };
    warningBuckets.set(bucketKey, bucket);
  }

  bucket.count += 1;
  if (bucket.contexts.length < 5) {
    bucket.contexts.push(context);
  }
  if (bucket.sample === undefined) {
    bucket.sample = payload;
  }

  scheduleFlush();
};
