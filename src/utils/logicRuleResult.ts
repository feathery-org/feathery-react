// Shared result helpers for on-demand logic rules. This module deliberately
// belongs to neither Form logic nor assistant dispatch so form execution does
// not import assistant tooling.

export type ChangedFieldDetail = {
  key: string;
  oldValue: any;
  newValue: any;
};

export type DerivedRuleUpdate = {
  field: string;
  previous?: string;
  value: string;
  describes?: string;
};

export const RULE_FIELDS_CHANGED_NOTE =
  'This rule updated form fields but did NOT edit the open document. ' +
  'Reflect each derivedUpdates entry into the document as targeted tracked ' +
  'edits: search for its `previous` text; if that returns nothing the ' +
  'document may hold an older rendering of the field, so locate it via ' +
  '`describes`/semantic search instead. For any changed field you cannot ' +
  'locate in the document, tell the user the form field was updated but the ' +
  'document could not be; only report the document as updated after an edit ' +
  'has actually applied.';

// Values that can appear verbatim in a document: strings and stringified
// scalars. Objects/arrays/empties cannot drive an exact-text replace.
const asUpdateText = (value: any): string | null => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return null;
};

export const composeDerivedRuleUpdates = (
  details: ChangedFieldDetail[],
  opts: {
    explicitUpdates?: unknown;
    describeField?: (key: string) => string | undefined;
  } = {}
): DerivedRuleUpdate[] => {
  const explicit = Array.isArray(opts.explicitUpdates)
    ? opts.explicitUpdates
    : [];
  const coveredFields = new Set(
    explicit
      .map((update: any) => update?.field)
      .filter((field: any): field is string => typeof field === 'string')
  );
  const coveredPairs = new Set(
    explicit
      .filter((update: any) => typeof update?.value === 'string')
      .map((update: any) => `${update.previous ?? ''}\u0000${update.value}`)
  );
  const updates: DerivedRuleUpdate[] = [];
  for (const detail of details) {
    const value = asUpdateText(detail.newValue);
    if (value == null || value.trim() === '') continue;
    const previousText = asUpdateText(detail.oldValue);
    const previous =
      previousText != null && previousText.trim() !== ''
        ? previousText
        : undefined;
    if (previous === value) continue;
    if (coveredFields.has(detail.key)) continue;
    if (coveredPairs.has(`${previous ?? ''}\u0000${value}`)) continue;
    const describes = opts.describeField?.(detail.key);
    updates.push({
      field: detail.key,
      ...(previous !== undefined ? { previous } : {}),
      value,
      ...(describes ? { describes } : {})
    });
  }
  return updates;
};
