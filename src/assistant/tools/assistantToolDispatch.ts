// Robin ASSISTANT tool dispatch for the docx-editor surface (HILB Contract
// A/B/E/F). This module is deliberately SyncFusion-free: it never imports the
// editor. It only calls handlers/objects the host hands in (a docx bridge, a
// custom-handler map, a callable-rule catalog, and a runLogicRuleById fn), so
// @feathery/react stays decoupled from the editor implementation.

export type RunLogicRuleResult = {
  changedFields: string[];
  returnValue?: any;
  error?: string;
};

// Per-tool-call budgets: reads must not stall the turn beyond a minute; edit
// batches (track-changes, large docs) get more headroom.
export const TOOL_TIMEOUT_READ_MS = 60_000;
export const TOOL_TIMEOUT_APPLY_MS = 90_000;

// Docx bridge injected by the host - thin async handlers that drive Ayesha's
// DocxEditor instance. Both are optional so an absent bridge degrades to a
// synthetic error rather than a hung turn.
export type DocxBridge = {
  getDocumentInventory?: (input: any) => Promise<any>;
  applyDocumentEdits?: (input: any) => Promise<any>;
};

// A designer-defined `trigger_event === 'tool'` rule, as it appears in the
// request's callable_rules catalog (Contract E).
export type CallableRule = {
  id: string;
  name: string;
  description?: string;
  server_side: boolean;
  parameters?: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean' | 'file';
    description?: string;
    required?: boolean;
  }>;
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

// Mirror ai-services' rule tool naming (Contract B): `rule_<slug>_<first4-of-id>`
// where slug is the sanitized rule name. Kept in lockstep so a tool the model
// calls resolves back to its rule here.
export const sanitizeRuleSlug = (name: string): string =>
  (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'rule';

export const ruleToolName = (rule: CallableRule): string =>
  `rule_${sanitizeRuleSlug(rule.name)}_${(rule.id || '').slice(0, 4)}`;

// Resolve a tool call to a rule id STRICTLY from the catalog - a model-echoed
// id is only ever accepted if it exists in the catalog (Contract F: never trust
// a model-echoed id).
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
  if (toolName === 'getDocumentInventory') {
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
  if (toolName === 'applyDocumentEdits') {
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

// Build the callable_rules catalog (Contract E) from the form's logic rules -
// only `trigger_event === 'tool'` rules, projecting the tool-facing shape.
export const buildCallableRules = (logicRules: any[] = []): CallableRule[] =>
  logicRules
    .filter((r) => r?.trigger_event === 'tool')
    .map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      server_side: !!r.server_side,
      parameters: r?.metadata?.tool?.parameters ?? []
    }));

// Wrap the per-request context under a `context` key. ai-services'
// createAssistantContext reads everything off `body.context.*` (targets,
// selection, callable_rules, panel_runtime, threadId), so anything sent at the
// top level is silently ignored - which is why the docx tools failed to
// register. threadId is merged in from the transport's resolved id.
export const buildAssistantRequestBody = (
  context: Record<string, unknown>,
  threadId: string | null
): { context: Record<string, unknown> } => ({
  context: { ...context, threadId: threadId || null }
});

export type AssistantSelection = {
  anchor: string;
  text: string;
  isCollapsed: boolean;
};

export const SELECTION_TEXT_LIMIT = 500;

// Normalize a host getSelection() result into the payload shape (Contract E):
// text clamped to <=500 chars, or null when there's nothing usable.
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
