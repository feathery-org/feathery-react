import { InlineErrorEntry, InlineErrors } from '../inlineErrors';

export type FormActionHandlers = {
  buttonOnClick: (button: any) => Promise<void>;
  runElementActions: (args: {
    actions: any[];
    element: any;
    elementType: 'button' | 'text' | 'container' | 'progress_bar' | 'tab';
    submit?: boolean;
    triggerPayload?: Record<string, any>;
  }) => Promise<any>;
  changeValue: (value: any, field: any, index?: number | null) => boolean;
  runFieldChangeLogic: (
    field: any,
    index: number | null
  ) => Promise<unknown> | undefined;
};

export const NOT_LOADED_MESSAGE = 'The form has not loaded yet.';

export const getLiveStepKey = (state: any): string | undefined =>
  state.latestStepName ?? state.currentStep?.key;

// Key and repeat row stay separate so a literal key like `f[0]` never collides with row 0 of `f`
export interface InlineErrorReport {
  key: string;
  repeatIndex?: number;
  message: string;
}

export type InlineErrorSnapshot = Map<
  string,
  { message?: string; byIndex: Map<number, string> }
>;

export const snapshotInlineErrors = (state: any): InlineErrorSnapshot => {
  const out: InlineErrorSnapshot = new Map();
  const inlineErrors: InlineErrors = state?.inlineErrors ?? {};
  for (const key of Object.keys(inlineErrors)) {
    const entry: InlineErrorEntry = inlineErrors[key] ?? {};
    const byIndex = new Map<number, string>();
    for (const [idx, data] of Object.entries(entry.byIndex ?? {})) {
      if (typeof data?.message === 'string' && data.message.length > 0)
        byIndex.set(Number(idx), data.message);
    }
    const message =
      typeof entry.message === 'string' && entry.message.length > 0
        ? entry.message
        : undefined;
    if (message || byIndex.size) out.set(key, { message, byIndex });
  }
  return out;
};

// Errors that are new or changed since the before snapshot
export const diffInlineErrorSnapshots = (
  before: InlineErrorSnapshot,
  after: InlineErrorSnapshot
): InlineErrorReport[] => {
  const out: InlineErrorReport[] = [];
  after.forEach((entry, key) => {
    const prev = before.get(key);
    if (entry.message && entry.message !== prev?.message)
      out.push({ key, message: entry.message });
    entry.byIndex.forEach((message, repeatIndex) => {
      if (message !== prev?.byIndex.get(repeatIndex))
        out.push({ key, repeatIndex, message });
    });
  });
  return out;
};

// A button's submit error is published after a delay, so wait for it before reading errors
export const awaitPendingInlineErrors = async (state: any): Promise<void> => {
  const pending = state?.pendingInlineErrorPublish;
  if (pending) await pending;
};

export function validateRepeatIndex(
  repeatIndex: number | null | undefined,
  inRepeat: boolean,
  rowCount: number,
  id: string
): string | null {
  if (!inRepeat) {
    return typeof repeatIndex === 'number'
      ? `'${id}' is not in a repeated container, do not pass repeatIndex.`
      : null;
  }
  if (typeof repeatIndex !== 'number') {
    const range =
      rowCount === 0 ? '(none yet, add a row first)' : `0..${rowCount - 1}`;
    return `'${id}' is in a repeated container, pass repeatIndex ${range}.`;
  }
  if (repeatIndex < 0 || repeatIndex >= rowCount) {
    return `repeatIndex ${repeatIndex} is out of range for '${id}' (rowCount ${rowCount}).`;
  }
  return null;
}
