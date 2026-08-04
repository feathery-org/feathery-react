// Robin assistant tool dispatch for the docx-editor surface. This module is
// deliberately SyncFusion-free: it never imports the editor. It only calls
// handlers/objects the host hands in (a docx bridge, a local rule execution
// allowlist, and a runLogicRuleById fn), so @feathery/react stays decoupled
// from the editor implementation.

import type { LogicRuleTransportResult } from '../../utils/logicRuleResult';
import { DOCUMENT_EDITOR_READ_CAPABILITIES } from '../capabilities/registry';

export type RunLogicRuleResult = LogicRuleTransportResult;

// Per-tool-call budgets: docx reads a minute, edit batches more headroom, and
// rules the 240s logic-lambda ceiling since rule code can await long work
// like extractions
export const TOOL_TIMEOUT_READ_MS = 60_000;
export const TOOL_TIMEOUT_APPLY_MS = 90_000;
export const TOOL_TIMEOUT_RULE_MS = 240_000;

// Docx bridge injected by the host - thin async handlers that drive the live
// DocxEditor instance. All are optional so an absent bridge degrades to a
// synthetic error rather than a hung turn.
export type DocxBridge = {
  getDocumentInventory?: (input: any) => Promise<any>;
  getSectionPattern?: (input: any) => Promise<any>;
  applyDocumentEdits?: (input: any) => Promise<any>;
  findDocumentOccurrences?: (input: any) => Promise<any>;
};

const GET_SECTION_PATTERN_TOOL = DOCUMENT_EDITOR_READ_CAPABILITIES.find(
  (capability) => capability.tool === 'getSectionPattern'
)?.tool;

// A designer-defined `trigger_event === 'tool'` rule used only to authorize and
// resolve a server-selected rule tool call back to a local rule id. ai-services
// builds the model-facing catalog from the backend, never from this
export type CallableRule = {
  id: string;
  name: string;
};

export type AssistantToolContext = {
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

/**
 * The output for a streamed tool call nothing on the client can execute.
 *
 * This is the durable fix for a whole class of dead turn, not for one tool. The
 * model's tool list is built server-side; whenever it contains something this
 * build cannot run - a tool added to ai-services ahead of the client, a
 * client-forwarded tool whose handler has not landed yet, or a handler removed
 * in a refactor - the turn used to hang forever
 * with no error at all, because `lastAssistantMessageIsCompleteWithToolCalls`
 * only fires once every tool call has an output.
 *
 * An error output ends the turn visibly and tells the model something it can act
 * on, which is strictly better than silence in every case.
 */
export const UNHANDLED_TOOL_ERROR = 'unhandled_tool';

export const unhandledToolOutput = (toolName: string) =>
  syntheticError(
    UNHANDLED_TOOL_ERROR,
    `This client has no handler for the tool "${toolName}", so it cannot be executed here. ` +
      'Do not retry it; use a different tool, or tell the user what you could not do.'
  );

// Race a handler against a timeout, RESOLVING (never rejecting) with a
// synthetic error so addToolOutput always fires. User JS cannot be aborted,
// so the message stays honest that its work may still land
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
            `Tool "${toolName}" timed out after ${Math.round(
              ms / 1000
            )}s. It was not cancelled and may still complete and change state: re-read the current state before further edits instead of blindly retrying.`
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

// Resolve a rule tool call STRICTLY from the catalog. The envelope's ruleId
// literal is the routing key (tool names are decoration), and the model-echoed
// id is only accepted when the catalog offers it
export const resolveRuleId = (
  input: any,
  callableRules: CallableRule[]
): string | null => {
  const echoed = input?.ruleId;
  const match = callableRules.find((r) => r.id === echoed);
  return match ? match.id : null;
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
  // 1) Built-in docx bridge reads/edits.
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
  if (toolName === GET_SECTION_PATTERN_TOOL) {
    const handler = ctx.docxBridge?.getSectionPattern;
    const output = handler
      ? await withToolTimeout(
          () => handler(input),
          TOOL_TIMEOUT_READ_MS,
          toolName
        )
      : syntheticError(
          'handler_unavailable',
          'No document is connected to derive a section pattern from.'
        );
    return { handled: true, output };
  }
  if (toolName === 'findDocumentOccurrences') {
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

  // 2) Designer-defined logic-rule tools.
  if (isRuleTool(toolName)) {
    const run = ctx.runLogicRule;
    if (!run) {
      return {
        handled: true,
        output: syntheticError(
          'handler_unavailable',
          'No live form is connected to run rules against.'
        )
      };
    }
    const ruleId = resolveRuleId(input, ctx.callableRules ?? []);
    if (!ruleId) {
      return {
        handled: true,
        output: syntheticError(
          'unknown_rule',
          `Could not resolve tool "${toolName}" to a rule on this form. ` +
            'The form session may be stale: rules added or changed since the form loaded are only picked up on reload.'
        )
      };
    }
    const inputParams = (input?.inputParams ?? {}) as Record<string, any>;
    const output = await withToolTimeout(
      () => run(ruleId, inputParams),
      TOOL_TIMEOUT_RULE_MS,
      toolName
    );
    return { handled: true, output };
  }

  return { handled: false };
}

// Build the local execution allowlist from the form's current logic rules. This
// is never sent to ai-services and never determines which tools the model sees.
export const buildCallableRules = (logicRules: any[] = []): CallableRule[] =>
  logicRules
    .filter(
      (r) =>
        r?.trigger_event === 'tool' &&
        r.server_side !== true &&
        typeof r.id === 'string' &&
        !!r.id &&
        r.enabled !== false &&
        r.valid !== false
    )
    .map((r) => ({ id: r.id, name: r.name }));
