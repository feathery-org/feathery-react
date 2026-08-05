// The client's `onToolCall` handler, lifted out of AssistantChat so its one
// load-bearing invariant can be tested:
//
//   EVERY streamed tool call must produce exactly one tool output.
//
// That is not a style rule. `sendAutomaticallyWhen:
// lastAssistantMessageIsCompleteWithToolCalls` only fires once every tool call in
// the assistant message has an output, so a single unanswered call leaves the
// conversation permanently stuck - no error, no answer, no way for the user to
// tell it apart from a slow model. `onToolCall` fires for the tools ai-services
// executes itself too, so those get a placeholder their real output overwrites.
//
// The fix is structural rather than per-tool: the chain now terminates in an
// `unhandled` branch, so a tool this build cannot run ends the turn with a
// visible error, which is what stops the next version-skewed tool from hanging.
import type { ToolDispatchResult } from './assistantToolDispatch';

import { TOOL_TIMEOUT_READ_MS, withToolTimeout } from './assistantToolDispatch';

export type StreamedToolCall = {
  toolName: string;
  toolCallId: string;
  input?: any;
  dynamic?: boolean;
};

/**
 * The form-runtime dispatchers, injected so this module stays testable and free
 * of React/editor imports.
 */
export type NativeToolHandlers = {
  setFieldValue: (fields: any[]) => Promise<any>;
  clickElement: (elementId: string, repeatIndex: unknown) => Promise<any>;
  navigateToStep: (stepKey: string) => Promise<any>;
  triggerTableAction: (
    tableId: string,
    rowIndex: number,
    actionLabel: string | undefined
  ) => Promise<any>;
  addTableRow: (tableId: string) => Promise<any>;
  deleteTableRow: (tableId: string, rowIndex: number) => Promise<any>;
  setTableCellValue: (tableId: string, cells: any[]) => Promise<any>;
};

export type AssistantToolCallDeps = {
  /** Central dispatch (custom handlers, docx bridge, rule tools). */
  dispatch: (toolName: string, input: any) => Promise<ToolDispatchResult>;
  native: NativeToolHandlers;
  /** Output for a tool nothing here can execute. */
  unhandled: (toolName: string) => any;
  emit: (args: { tool: string; toolCallId: string; output: any }) => void;
};

const asString = (value: unknown): string =>
  typeof value === 'string' ? value : '';
const asNumber = (value: unknown): number =>
  typeof value === 'number' ? value : NaN;
const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? value : []);

// Tools this client runs itself, keyed by the name ai-services forwards
const NATIVE_TOOL_CALLS: Record<
  string,
  (input: any, native: NativeToolHandlers) => Promise<any>
> = {
  setFieldValue: (i, n) => n.setFieldValue(asArray(i.fields)),
  clickElement: (i, n) => n.clickElement(asString(i.elementId), i.repeatIndex),
  navigateToStep: (i, n) => n.navigateToStep(asString(i.stepKey)),
  triggerTableAction: (i, n) =>
    n.triggerTableAction(
      asString(i.tableId),
      asNumber(i.rowIndex),
      typeof i.actionLabel === 'string' ? i.actionLabel : undefined
    ),
  addTableRow: (i, n) => n.addTableRow(asString(i.tableId)),
  deleteTableRow: (i, n) =>
    n.deleteTableRow(asString(i.tableId), asNumber(i.rowIndex)),
  setTableCellValue: (i, n) =>
    n.setTableCellValue(asString(i.tableId), asArray(i.cells))
};

/**
 * Run one streamed tool call to an output.
 *
 * Structured so that there is exactly one exit that does not emit - there is
 * none. Every path ends in `emit`.
 */
export async function handleAssistantToolCall(
  toolCall: StreamedToolCall,
  deps: AssistantToolCallDeps
): Promise<void> {
  const { dispatch, native, unhandled, emit } = deps;
  const input = toolCall.input ?? {};
  const done = (output: any) =>
    emit({ tool: toolCall.toolName, toolCallId: toolCall.toolCallId, output });

  const dispatched = await dispatch(toolCall.toolName, input);
  if (dispatched.handled) {
    done(dispatched.output);
    return;
  }

  // A dynamic tool the dispatch did not claim is the same wedge as an unknown
  // static one, and a likelier one: dynamic tools are built per request (the
  // `rule_*` catalog), so a naming or catalog mismatch lands here
  if (toolCall.dynamic) {
    done(unhandled(toolCall.toolName));
    return;
  }

  // hasOwn, so a name like `constructor` cannot resolve to a handler
  const run = Object.prototype.hasOwnProperty.call(
    NATIVE_TOOL_CALLS,
    toolCall.toolName
  )
    ? NATIVE_TOOL_CALLS[toolCall.toolName]
    : undefined;
  if (!run) {
    // Unknown tools must still emit an output or the turn hangs forever
    done(unhandled(toolCall.toolName));
    return;
  }

  // A hung form-runtime handler is the same wedge as a missing output, so every
  // native call races the shared tool timeout
  done(
    await withToolTimeout(
      () => run(input, native),
      TOOL_TIMEOUT_READ_MS,
      toolCall.toolName
    )
  );
}
