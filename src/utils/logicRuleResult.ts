// Canonical transport contract for on-demand logic rules. Form execution owns
// the facts; ai-services owns how the model is instructed to act on them.

export type ChangedFieldDetail = {
  key: string;
  oldValue: unknown;
  newValue: unknown;
};

export type FieldChange = {
  key: string;
  before: unknown;
  after: unknown;
  documentHint?: {
    anchor?: string;
    describes?: string;
  };
};

export type LogicRuleTransportResult = {
  ok: boolean;
  rule: {
    id: string;
    name: string;
  };
  result: unknown;
  fieldChanges: FieldChange[];
  error?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Remove the retired embedded `updates` alias before the arbitrary return value
 * is put under `result`. Its facts are merged into `fieldChanges` instead.
 */
export const withoutEmbeddedFieldUpdates = (value: unknown): unknown => {
  if (
    !isRecord(value) ||
    !Object.prototype.hasOwnProperty.call(value, 'updates')
  )
    return value;
  const result = { ...value };
  delete result.updates;
  return Object.keys(result).length > 0 ? result : null;
};

/**
 * Merge the actual before/after diff with any legacy rule-authored update hints
 * into one list, deduplicated by field key. Runtime field state wins over a
 * returned hint's previous/value pair; the hint may only add a document locator.
 */
export const composeFieldChanges = (
  details: ChangedFieldDetail[],
  opts: {
    explicitUpdates?: unknown;
    describeField?: (key: string) => string | undefined;
    includeDocumentHints?: boolean;
  } = {}
): FieldChange[] => {
  const changes = new Map<string, FieldChange>();
  for (const detail of details) {
    if (!detail.key) continue;
    changes.set(detail.key, {
      key: detail.key,
      before: detail.oldValue,
      after: detail.newValue
    });
  }

  const explicit = Array.isArray(opts.explicitUpdates)
    ? opts.explicitUpdates
    : [];
  for (const candidate of explicit) {
    if (
      !isRecord(candidate) ||
      typeof candidate.field !== 'string' ||
      !candidate.field
    )
      continue;
    const key = candidate.field;
    const existing = changes.get(key);
    const change: FieldChange =
      existing ??
      ({
        key,
        before: candidate.previous ?? null,
        after: candidate.value ?? null
      } as FieldChange);
    if (opts.includeDocumentHints) {
      const anchor =
        typeof candidate.anchor === 'string' && candidate.anchor
          ? candidate.anchor
          : undefined;
      const describes =
        typeof candidate.describes === 'string' && candidate.describes
          ? candidate.describes
          : opts.describeField?.(key);
      if (anchor || describes) {
        change.documentHint = {
          ...(anchor ? { anchor } : {}),
          ...(describes ? { describes } : {})
        };
      }
    }
    changes.set(key, change);
  }

  if (opts.includeDocumentHints) {
    for (const change of changes.values()) {
      if (change.documentHint) continue;
      const describes = opts.describeField?.(change.key);
      if (describes) change.documentHint = { describes };
    }
  }

  return [...changes.values()];
};
