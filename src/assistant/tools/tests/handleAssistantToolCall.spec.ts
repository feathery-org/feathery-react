// The wedge itself: a streamed tool call that never produces an output.
//
// Live evidence (captain, 2026-07-27): `sendAutomaticallyWhen:
// lastAssistantMessageIsCompleteWithToolCalls` fires only once EVERY tool call in
// the assistant message has an output. A server tool arriving before its browser
// handler can otherwise make AssistantChat's onToolCall chain emit nothing:
// no error, no answer, forever.
//
// The invariant is: NO tool call, whatever it is named, can leave this handler
// without exactly one output.
import {
  handleAssistantToolCall,
  NativeToolHandlers
} from '../handleAssistantToolCall';
import {
  UNHANDLED_TOOL_ERROR,
  unhandledToolOutput
} from '../assistantToolDispatch';

type Emitted = { tool: string; toolCallId: string; output: any };

function harness(
  overrides: {
    dispatch?: (toolName: string, input: any) => Promise<any>;
    native?: Partial<NativeToolHandlers>;
  } = {}
) {
  const emitted: Emitted[] = [];
  const native = {
    setFieldValue: jest.fn().mockResolvedValue({ ok: true, via: 'setFieldValue' }),
    clickElement: jest.fn().mockResolvedValue({ ok: true, via: 'clickElement' }),
    navigateToStep: jest.fn().mockResolvedValue({ ok: true, via: 'navigateToStep' }),
    triggerTableAction: jest
      .fn()
      .mockResolvedValue({ ok: true, via: 'triggerTableAction' }),
    addTableRow: jest.fn().mockResolvedValue({ ok: true, via: 'addTableRow' }),
    deleteTableRow: jest.fn().mockResolvedValue({ ok: true, via: 'deleteTableRow' }),
    setTableCellValue: jest
      .fn()
      .mockResolvedValue({ ok: true, via: 'setTableCellValue' }),
    ...overrides.native
  } as unknown as NativeToolHandlers;

  return {
    emitted,
    native,
    deps: {
      dispatch:
        overrides.dispatch ??
        (async () => ({ handled: false } as { handled: boolean; output?: any })),
      native,
      unhandled: unhandledToolOutput,
      emit: (args: Emitted) => emitted.push(args)
    }
  };
}

describe('every streamed tool call produces exactly one output', () => {
  it('THE LIVE WEDGE: an unrecognised tool ends the turn with a visible error instead of silence', async () => {
    const h = harness();

    await handleAssistantToolCall(
      { toolName: 'futureServerTool', toolCallId: 'call_a4', input: {} },
      h.deps
    );

    // Before the fix this array was EMPTY, and that emptiness was the hang.
    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0]).toMatchObject({
      tool: 'futureServerTool',
      toolCallId: 'call_a4',
      output: { ok: false, error: UNHANDLED_TOOL_ERROR }
    });
  });

  it('a DYNAMIC tool the dispatch did not claim also gets an output', async () => {
    const h = harness();

    await handleAssistantToolCall(
      {
        toolName: 'rule_fm_set_advisor_title_c07c',
        toolCallId: 'call_rule',
        input: { title: 'Sr. Advisor' },
        dynamic: true
      },
      h.deps
    );

    // The second silent-drop path: `if (toolCall.dynamic) return;` returned with
    // no output at all, and dynamic tools are the per-request `rule_*` catalog,
    // so a catalog or naming mismatch landed here.
    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0].output).toMatchObject({ error: UNHANDLED_TOOL_ERROR });
  });

  it.each([
    ['setFieldValue', { fields: [{ fieldKey: 'a', value: 'b' }] }],
    ['clickElement', { elementId: 'btn' }],
    ['navigateToStep', { stepKey: 'coverage' }],
    ['triggerTableAction', { tableId: 't', rowIndex: 0, actionLabel: 'Edit' }],
    ['addTableRow', { tableId: 't' }],
    ['deleteTableRow', { tableId: 't', rowIndex: 1 }],
    ['setTableCellValue', { tableId: 't', cells: [] }]
  ])('%s is routed to its native handler and emits its output', async (toolName, input) => {
    const h = harness();

    await handleAssistantToolCall(
      { toolName, toolCallId: `call_${toolName}`, input },
      h.deps
    );

    expect(h.emitted).toEqual([
      {
        tool: toolName,
        toolCallId: `call_${toolName}`,
        output: { ok: true, via: toolName }
      }
    ]);
  });

  it('a dispatch-handled tool emits the dispatch output and skips the native chain', async () => {
    const h = harness({
      dispatch: async () => ({ handled: true, output: { ok: true, via: 'dispatch' } })
    });

    await handleAssistantToolCall(
      { toolName: 'applyDocumentEdits', toolCallId: 'call_doc', input: {} },
      h.deps
    );

    expect(h.emitted[0].output).toEqual({ ok: true, via: 'dispatch' });
    expect(h.native.setFieldValue).not.toHaveBeenCalled();
  });

  it('EXHAUSTIVE: no tool name in a broad sweep escapes without an output', async () => {
    // The invariant, checked against the tools ai-services can forward plus
    // shapes that have caused trouble before: snake_case aliases, unknown names,
    // empty names. A future tool added server-side ahead of the client lands in
    // this set by construction.
    const names = [
      'setFieldValue',
      'clickElement',
      'navigateToStep',
      'triggerTableAction',
      'addTableRow',
      'deleteTableRow',
      'setTableCellValue',
      'futureServerTool',
      'getDocumentInventory',
      'getSectionPattern',
      'applyDocumentEdits',
      'queryOutput',
      'someToolInventedNextQuarter',
      ''
    ];

    for (const toolName of names) {
      const h = harness();
      await handleAssistantToolCall(
        { toolName, toolCallId: `id_${toolName}`, input: {} },
        h.deps
      );
      expect(h.emitted).toHaveLength(1);
      expect(h.emitted[0].toolCallId).toBe(`id_${toolName}`);
      expect(h.emitted[0].output).toBeDefined();
    }
  });

  it('emits exactly once - never twice - so an output is not overwritten', async () => {
    const h = harness();

    await handleAssistantToolCall(
      { toolName: 'navigateToStep', toolCallId: 'call_nav', input: { stepKey: 's' } },
      h.deps
    );

    expect(h.emitted).toHaveLength(1);
  });
});
