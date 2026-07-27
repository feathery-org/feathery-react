// Robin assistant tool dispatch for the docx-editor surface. This module is
// deliberately SyncFusion-free: it never imports the editor. It only calls
// handlers/objects the host hands in (a docx bridge, a custom-handler map, a
// callable-rule catalog, and a runLogicRuleById fn), so @feathery/react stays
// decoupled from the editor implementation.

// One field a rule run actually changed, with the pre-invoke (old) and
// post-run (new) values. oldValue comes from the snapshot taken BEFORE the
// rule executed, so it is available for BOTH client- and server-side rules.
export type ChangedFieldDetail = {
  key: string;
  oldValue: any;
  newValue: any;
};

// A document-reflectable update derived from a rule's field changes, for any
// rule (client- or server-side) that mutates form fields without returning an
// explicit { updates } payload. `previous`/`value` are the exact old/new texts
// for a deterministic occurrence-based replace; `describes` carries what the
// text is (field key + admin label) so reflection can fall back to semantic
// search when `previous` is not in the document - the document may hold an
// OLDER rendering of the field than the pre-rule value. Shape-compatible with
// the ai-services rule-update contract
// ({ value, previous?, field?, describes?, anchor? }).
export type DerivedRuleUpdate = {
  field: string;
  // Omitted when the pre-rule value was not usable search text (empty field,
  // object value); reflection then relies on `describes`.
  previous?: string;
  value: string;
  describes?: string;
};

export type RunLogicRuleResult = {
  changedFields: string[];
  // Old->new per changed field; parallel to changedFields (richer shape kept
  // separate so existing changedFields readers stay untouched).
  changedFieldDetails?: ChangedFieldDetail[];
  // Present when scalar old->new pairs could be derived from the rule's field
  // changes, on both the client- and server-side paths. Deduped against an
  // explicitly returned returnValue.updates array.
  derivedUpdates?: DerivedRuleUpdate[];
  // Present (always false) whenever the rule changed at least one form field:
  // running a rule NEVER edits the open document by itself, so "the rule ran"
  // and "the document shows it" stay two separate facts for the model.
  documentEdited?: false;
  note?: string;
  returnValue?: any;
  error?: string;
};

// Travels on every rule result that changed form fields. This is the
// data-level counterweight to designer-authored rule descriptions that
// (wrongly) claim field writes propagate to an already-generated document.
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
// scalars. Objects/arrays/empties can't drive an exact-text replace.
const asUpdateText = (v: any): string | null => {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
};

// Compose document updates from a rule's changed-field details: one
// { field, previous?, value, describes? } per field whose NEW value is usable
// exact text. `previous` (from the pre-invoke snapshot) rides along when it
// is usable search text; `describes` (via opts.describeField) names what the
// text is for the semantic-search fallback. Fields already covered by the
// rule's explicitly returned updates (opts.explicitUpdates) are skipped so
// the same edit is never surfaced twice.
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
      .map((u: any) => u?.field)
      .filter((f: any): f is string => typeof f === 'string')
  );
  const coveredPairs = new Set(
    explicit
      .filter((u: any) => typeof u?.value === 'string')
      .map((u: any) => `${u.previous ?? ''}\u0000${u.value}`)
  );
  const updates: DerivedRuleUpdate[] = [];
  for (const d of details) {
    const value = asUpdateText(d.newValue);
    // A cleared field or an object value can't drive an exact-text write; the
    // change still reaches the model via changedFieldDetails + note.
    if (value == null || value.trim() === '') continue;
    const previousText = asUpdateText(d.oldValue);
    const previous =
      previousText != null && previousText.trim() !== ''
        ? previousText
        : undefined;
    if (previous === value) continue;
    if (coveredFields.has(d.key)) continue;
    if (coveredPairs.has(`${previous ?? ''}\u0000${value}`)) continue;
    const describes = opts.describeField?.(d.key);
    updates.push({
      field: d.key,
      ...(previous !== undefined ? { previous } : {}),
      value,
      ...(describes ? { describes } : {})
    });
  }
  return updates;
};

// Per-tool-call budgets: reads must not stall the turn beyond a minute; edit
// batches (track-changes, large docs) get more headroom.
export const TOOL_TIMEOUT_READ_MS = 60_000;
export const TOOL_TIMEOUT_APPLY_MS = 90_000;

// Docx bridge injected by the host - thin async handlers that drive the live
// DocxEditor instance. Both are optional so an absent bridge degrades to a
// synthetic error rather than a hung turn.
export type DocxBridge = {
  getDocumentInventory?: (input: any) => Promise<any>;
  applyDocumentEdits?: (input: any) => Promise<any>;
  findDocumentOccurrences?: (input: any) => Promise<any>;
};

// A designer-defined `trigger_event === 'tool'` rule, as it appears in the
// request's callable_rules catalog.
export type CallableRule = {
  id: string;
  name: string;
  description?: string;
  purpose?: string;
  server_side: boolean;
  parameters?: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean' | 'file';
    description?: string;
    required?: boolean;
    // The form field this parameter feeds (metadata.tool.parameters[].field),
    // forwarded so Robin can ground/clarify against the field's current value.
    field?: string;
    [key: string]: any;
  }>;
  // The form fields the rule reads/writes (metadata.tool.allowed_fields),
  // forwarded as description context so Robin can look up current values via
  // getFormFields before/while invoking the rule.
  allowed_fields?: string[];
  // Preserve the server-provided rule metadata so ai-services receives the
  // complete host catalog without a discovery round trip.
  metadata?: Record<string, any>;
};

export type AssistantToolContext = {
  customToolHandlers?: Record<string, (input: any) => Promise<any>>;
  docxBridge?: DocxBridge;
  callableRules?: CallableRule[];
  runLogicRule?: (
    ruleId: string,
    inputParams: Record<string, any>
  ) => Promise<RunLogicRuleResult>;
};

export type ToolDispatchResult = { handled: boolean; output?: any };

// Synthetic tool output so a hung/absent handler resolves the turn cleanly
// instead of leaving the tool call pending forever.
const syntheticError = (error: string, message: string) => ({
  ok: false,
  error,
  message
});

// Race a handler against a timeout. On timeout we RESOLVE (never reject) with a
// synthetic error so addToolOutput always fires and the model can recover.
export async function withToolTimeout<T>(
  run: () => Promise<T>,
  ms: number,
  toolName: string
): Promise<T | ReturnType<typeof syntheticError>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ReturnType<typeof syntheticError>>((resolve) => {
    timer = setTimeout(
      () =>
        resolve(
          syntheticError(
            'timeout',
            `Tool "${toolName}" timed out after ${Math.round(ms / 1000)}s.`
          )
        ),
      ms
    );
  });
  try {
    return await Promise.race([
      Promise.resolve()
        .then(run)
        .catch((e: any) =>
          syntheticError(
            'handler_error',
            e instanceof Error ? e.message : String(e)
          )
        ),
      timeout
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Mirror ai-services' rule tool naming: `rule_<slug>_<first4-of-id>`, where slug
// is the sanitized rule name. Kept in lockstep so a tool the model calls
// resolves back to its rule here.
export const sanitizeRuleSlug = (name: string): string =>
  (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'rule';

export const ruleToolName = (rule: CallableRule): string =>
  `rule_${sanitizeRuleSlug(rule.name)}_${(rule.id || '').slice(0, 4)}`;

// Resolve a tool call to a rule id STRICTLY from the catalog. A model-echoed id
// is never trusted on its own: it is only accepted when it exists in the
// catalog, so the model cannot invoke a rule the host did not offer.
export const resolveRuleId = (
  toolName: string,
  input: any,
  callableRules: CallableRule[]
): string | null => {
  if (toolName === 'runLogicRule') {
    const echoed = input?.ruleId;
    const match = callableRules.find((r) => r.id === echoed);
    return match ? match.id : null;
  }
  if (toolName.startsWith('rule_')) {
    // Prefer an exact regenerated-name match; fall back to the trailing
    // id-suffix segment so slight slug drift across repos still resolves.
    const exact = callableRules.find((r) => ruleToolName(r) === toolName);
    if (exact) return exact.id;
    const suffix = toolName.slice(toolName.lastIndexOf('_') + 1);
    const bySuffix = callableRules.filter(
      (r) => (r.id || '').slice(0, 4) === suffix
    );
    return bySuffix.length === 1 ? bySuffix[0].id : null;
  }
  return null;
};

const isRuleTool = (toolName: string): boolean =>
  toolName === 'runLogicRule' || toolName.startsWith('rule_');

// Central dispatch, run BEFORE the hardcoded onToolCall branches. Returns
// { handled: false } for tools this module doesn't own so the caller can fall
// through to its built-in tools. `output` is always safe to feed straight into
// addToolOutput.
export async function dispatchAssistantTool(
  toolName: string,
  input: any,
  ctx: AssistantToolContext
): Promise<ToolDispatchResult> {
  // 1) Host-supplied custom handlers win over everything else.
  const custom = ctx.customToolHandlers?.[toolName];
  if (custom) {
    const output = await withToolTimeout(
      () => custom(input),
      TOOL_TIMEOUT_READ_MS,
      toolName
    );
    return { handled: true, output };
  }

  // 2) Built-in docx bridge reads/edits.
  if (
    toolName === 'getDocumentInventory' ||
    toolName === 'get_document_inventory'
  ) {
    const handler = ctx.docxBridge?.getDocumentInventory;
    const output = handler
      ? await withToolTimeout(
          () => handler(input),
          TOOL_TIMEOUT_READ_MS,
          toolName
        )
      : syntheticError(
          'handler_unavailable',
          'No document is connected to read from.'
        );
    return { handled: true, output };
  }
  if (
    toolName === 'findDocumentOccurrences' ||
    toolName === 'find_document_occurrences'
  ) {
    const handler = ctx.docxBridge?.findDocumentOccurrences;
    const output = handler
      ? await withToolTimeout(
          () => handler(input),
          TOOL_TIMEOUT_READ_MS,
          toolName
        )
      : syntheticError(
          'handler_unavailable',
          'No document is connected to search.'
        );
    return { handled: true, output };
  }
  if (
    toolName === 'applyDocumentEdits' ||
    toolName === 'apply_document_edits'
  ) {
    const handler = ctx.docxBridge?.applyDocumentEdits;
    const output = handler
      ? await withToolTimeout(
          () => handler(input),
          TOOL_TIMEOUT_APPLY_MS,
          toolName
        )
      : syntheticError(
          'handler_unavailable',
          'No document is connected to edit.'
        );
    return { handled: true, output };
  }

  // 3) Designer-defined logic-rule tools.
  if (isRuleTool(toolName)) {
    const callableRules = ctx.callableRules ?? [];
    const ruleId = resolveRuleId(toolName, input, callableRules);
    if (!ruleId || !ctx.runLogicRule) {
      return {
        handled: true,
        output: syntheticError(
          'unknown_rule',
          `Could not resolve tool "${toolName}" to a callable rule.`
        )
      };
    }
    // rule_* tools carry params directly; the generic fallback nests them.
    const inputParams =
      toolName === 'runLogicRule'
        ? ((input?.inputParams ?? {}) as Record<string, any>)
        : ((input ?? {}) as Record<string, any>);
    const run = ctx.runLogicRule;
    const output = await withToolTimeout(
      () => run(ruleId, inputParams),
      TOOL_TIMEOUT_APPLY_MS,
      toolName
    );
    return { handled: true, output };
  }

  return { handled: false };
}

// Build the callable_rules catalog from the form's logic rules - only
// `trigger_event === 'tool'` rules, projected into the tool-facing shape.
export const buildCallableRules = (logicRules: any[] = []): CallableRule[] =>
  logicRules
    .filter(
      (r) =>
        r?.trigger_event === 'tool' &&
        typeof r.id === 'string' &&
        !!r.id &&
        r.enabled !== false &&
        r.valid !== false
    )
    .map((r) => {
      const rule: CallableRule = {
        id: r.id,
        name: r.name,
        description: r.description,
        server_side: !!r.server_side,
        parameters: r?.metadata?.tool?.parameters ?? [],
        ...(r.metadata ? { metadata: r.metadata } : {})
      };
      const purpose = r.purpose ?? r.metadata?.tool?.purpose;
      if (purpose) rule.purpose = purpose;
      const allowedFields = r?.metadata?.tool?.allowed_fields;
      if (Array.isArray(allowedFields) && allowedFields.length > 0) {
        rule.allowed_fields = allowedFields.filter(
          (f: unknown): f is string => typeof f === 'string' && !!f
        );
      }
      return rule;
    });

// Keep per-request metadata under `context`, where ai-services'
// createAssistantContext reads targets, selection, callable_rules, and
// panel_runtime. The backend adopts a new attachment session only from the
// top-level `thread_id`, so mirror the resolved thread id in both places.
export const buildAssistantRequestBody = (
  context: Record<string, unknown>,
  threadId: string | null
): { thread_id: string | null; context: Record<string, unknown> } => ({
  thread_id: threadId || null,
  context: { ...context, threadId: threadId || null }
});

export type AssistantSelection = {
  anchor: string;
  text: string;
  isCollapsed: boolean;
};

export const SELECTION_TEXT_LIMIT = 500;

// Normalize a host getSelection() result into the request payload shape: text
// clamped to 500 characters, or null when there's nothing usable.
export const normalizeSelection = (
  raw: AssistantSelection | null | undefined
): AssistantSelection | null => {
  if (!raw || typeof raw.anchor !== 'string') return null;
  const text = typeof raw.text === 'string' ? raw.text : '';
  return {
    anchor: raw.anchor,
    text: text.slice(0, SELECTION_TEXT_LIMIT),
    isCollapsed: !!raw.isCollapsed
  };
};
