// The client's `onToolCall` handler, lifted out of AssistantChat so its one
// load-bearing invariant can be tested:
//
//   EVERY streamed tool call must produce exactly one tool output.
//
// That is not a style rule. `sendAutomaticallyWhen:
// lastAssistantMessageIsCompleteWithToolCalls` only fires once every tool call in
// the assistant message has an output, so a single unanswered call leaves the
// conversation permanently stuck - no error, no answer, no way for the user to
// tell it apart from a slow model. A server tool landing before its browser
// handler can otherwise make the chain of `else if`s simply end in silence.
//
// The fix is structural rather than per-tool: a call nothing here can run is
// answered by `answerUnansweredToolCalls` once the turn is over, so a
// version-skewed tool ends with a visible error instead of hanging. Answering has
// to wait until then, because `onToolCall` also fires for the tools ai-services
// executes itself and their real output is still on the way.
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

/**
 * Run one streamed tool call to an output.
 *
 * Every path for a tool this client owns ends in `emit`. A tool it does not own
 * is left alone, and `answerUnansweredToolCalls` catches it at turn end if the
 * server never answered it either.
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

  // A dynamic tool the dispatch did not claim can be answered right here, unlike
  // an unknown static one: the only dynamic tools are the per-request `rule_*`
  // catalog, which ai-services forwards to this client instead of executing, so a
  // naming or catalog mismatch leaves nobody else to answer it.
  if (toolCall.dynamic) {
    done(unhandled(toolCall.toolName));
    return;
  }

  // A hung form-runtime handler is the same wedge as a missing output, so
  // every native call races the shared tool timeout
  const timed = (run: () => Promise<any>) =>
    withToolTimeout(run, TOOL_TIMEOUT_READ_MS, toolCall.toolName);

  switch (toolCall.toolName) {
    case 'setFieldValue':
      done(await timed(() => native.setFieldValue(asArray(input.fields))));
      return;
    case 'clickElement':
      done(
        await timed(() =>
          native.clickElement(asString(input.elementId), input.repeatIndex)
        )
      );
      return;
    case 'navigateToStep':
      done(await timed(() => native.navigateToStep(asString(input.stepKey))));
      return;
    case 'triggerTableAction':
      done(
        await timed(() =>
          native.triggerTableAction(
            asString(input.tableId),
            asNumber(input.rowIndex),
            typeof input.actionLabel === 'string'
              ? input.actionLabel
              : undefined
          )
        )
      );
      return;
    case 'addTableRow':
      done(await timed(() => native.addTableRow(asString(input.tableId))));
      return;
    case 'deleteTableRow':
      done(
        await timed(() =>
          native.deleteTableRow(
            asString(input.tableId),
            asNumber(input.rowIndex)
          )
        )
      );
      return;
    case 'setTableCellValue':
      done(
        await timed(() =>
          native.setTableCellValue(
            asString(input.tableId),
            asArray(input.cells)
          )
        )
      );
  }
  // Anything else is not this client's tool to run. `onToolCall` fires for
  // everything ai-services executes itself too, and its real output is already on
  // the way, so emitting here would overwrite a good result with a failure
}

const PENDING_TOOL_STATES = ['input-streaming', 'input-available'];

// The tool name behind a message part still waiting for an output, or null.
// Provider-executed calls are the provider's to answer, never ours.
const unansweredToolName = (part: any): string | null => {
  if (!part || !PENDING_TOOL_STATES.includes(part.state)) return null;
  if (part.providerExecuted || !part.toolCallId) return null;
  if (part.type === 'dynamic-tool') return part.toolName || 'unknown';
  if (typeof part.type !== 'string' || !part.type.startsWith('tool-'))
    return null;
  // A nameless part still wedges the turn, so it still gets answered
  return part.type.slice('tool-'.length) || 'unknown';
};

/**
 * Answer every tool call the finished turn left without an output.
 *
 * This is where the hang from the header comment actually gets fixed, and it can
 * only run once the stream is done: while it is still open, an unanswered call is
 * indistinguishable from one ai-services is about to answer itself.
 *
 * Call this only for a turn that finished on its own. On an aborted turn the
 * outputs would auto-send a continuation of the reply the user just stopped.
 */
export function answerUnansweredToolCalls(
  parts: any[],
  deps: Pick<AssistantToolCallDeps, 'unhandled' | 'emit'>
): void {
  (parts ?? []).forEach((part) => {
    const toolName = unansweredToolName(part);
    if (!toolName) return;
    deps.emit({
      tool: toolName,
      toolCallId: part.toolCallId,
      output: deps.unhandled(toolName)
    });
  });
}
