import { isSameFieldValue } from './fieldValueEquality';

/**
 * The field values last sent to the server for the current submission, so a
 * write that matches what the server already has can skip the network.
 *
 * This is deliberately not `fieldValues`: typing into a form field only updates
 * `fieldValues` locally, and SEs rely on rules writing a field's value back
 * (`field.value = field.value`) to save drafts before step submit.
 *
 * Values are stored as copies so that changing an array or object in place
 * afterwards still counts as a change. Field values live per user on the
 * server, so the map is shared by every client and reset with the submission.
 */
let submitted: Record<string, any> = {};
// Counts sends per key, so a slow earlier request can't record a stale value
let sendSeq: Record<string, number> = {};

/** Copy arrays and plain objects; files, promises and primitives are kept. */
export function copyFieldValue(value: any): any {
  if (Array.isArray(value)) return Array.from(value, copyFieldValue);
  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, copyFieldValue(entry)])
    );
  }
  return value;
}

/** Whether the server already has `value` for `key` from an earlier send. */
export function isSubmittedValue(key: string, value: any): boolean {
  return key in submitted && isSameFieldValue(submitted[key], value);
}

/**
 * Call when values are about to be sent. Until the request succeeds the
 * server's copy is unknown, so the keys stop counting as submitted; the
 * returned callback records the values once it has. A key sent again in the
 * meantime keeps the newer send's outcome.
 */
export function startSubmittingValues(values: Record<string, any>) {
  const sending: Record<string, { value: any; seq: number }> = {};
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined) return;
    delete submitted[key];
    sendSeq[key] = (sendSeq[key] ?? 0) + 1;
    sending[key] = { value: copyFieldValue(value), seq: sendSeq[key] };
  });
  return () =>
    Object.entries(sending).forEach(([key, { value, seq }]) => {
      if (sendSeq[key] === seq) submitted[key] = value;
    });
}

/** Record values the server is known to have already. */
export function recordSubmittedValues(values: Record<string, any>) {
  startSubmittingValues(values)();
}

export function resetSubmittedValues() {
  submitted = {};
  sendSeq = {};
}
