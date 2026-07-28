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
// The fix is structural rather than per-tool: the chain now terminates in an
// `unhandled` branch, so a tool this build cannot run ends the turn with a
// visible error, which is what stops the next version-skewed tool from hanging.
import type { ToolDispatchResult } from './assistantToolDispatch';

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
  // `rule_*` catalog), so a naming or catalog mismatch lands here. Server-
  // executed tools never reach onToolCall at all, so anything arriving here is
  // waiting on this client for an output and must receive one.
  if (toolCall.dynamic) {
    done(unhandled(toolCall.toolName));
    return;
  }

  switch (toolCall.toolName) {
    case 'setFieldValue':
      done(await native.setFieldValue(asArray(input.fields)));
      return;
    case 'clickElement':
      done(
        await native.clickElement(asString(input.elementId), input.repeatIndex)
      );
      return;
    case 'navigateToStep':
      done(await native.navigateToStep(asString(input.stepKey)));
      return;
    case 'triggerTableAction':
      done(
        await native.triggerTableAction(
          asString(input.tableId),
          asNumber(input.rowIndex),
          typeof input.actionLabel === 'string' ? input.actionLabel : undefined
        )
      );
      return;
    case 'addTableRow':
      done(await native.addTableRow(asString(input.tableId)));
      return;
    case 'deleteTableRow':
      done(
        await native.deleteTableRow(
          asString(input.tableId),
          asNumber(input.rowIndex)
        )
      );
      return;
    case 'setTableCellValue':
      done(
        await native.setTableCellValue(
          asString(input.tableId),
          asArray(input.cells)
        )
      );
      return;
    default:
      // The branch whose absence wedged the conversation.
      done(unhandled(toolCall.toolName));
  }
}
