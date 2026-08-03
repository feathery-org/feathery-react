// The wedge itself: a streamed tool call that never produces an output.
//
// Live evidence (captain, 2026-07-27): `sendAutomaticallyWhen:
// lastAssistantMessageIsCompleteWithToolCalls` fires only once EVERY tool call in
// the assistant message has an output. A server tool arriving before its browser
// handler can otherwise make AssistantChat's onToolCall chain emit nothing:
// no error, no answer, forever.
//
// The invariant is: NO tool call, whatever it is named, can leave the TURN
// without exactly one output. Not the handler - the turn. `onToolCall` also fires
// for the tools ai-services executes itself, so answering an unrecognised call on
// the spot overwrote the server's real result with a failure (the row flashed a
// red X, then flipped back to a check when the real output landed). Those calls
// are left alone here and swept at turn end, where unanswered means unowned.
import {
  answerUnansweredToolCalls,
  handleAssistantToolCall,
  NativeToolHandlers
} from '../handleAssistantToolCall';
import { unhandledToolOutput } from '../assistantToolDispatch';

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
  it('THE LIVE WEDGE: an unrecognised tool is answered at turn end, not with silence', async () => {
    const h = harness();

    await handleAssistantToolCall(
      { toolName: 'futureServerTool', toolCallId: 'call_a4', input: {} },
      h.deps
    );

    // Nothing yet: while the stream is open this is indistinguishable from a
    // server-executed tool whose real output is still coming.
    expect(h.emitted).toHaveLength(0);

    answerUnansweredToolCalls(
      [
        {
          type: 'tool-futureServerTool',
          toolCallId: 'call_a4',
          state: 'input-available'
        }
      ],
      h.deps
    );

    // Before the fix this array was EMPTY, and that emptiness was the hang.
    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0]).toMatchObject({
      tool: 'futureServerTool',
      toolCallId: 'call_a4',
      output: { ok: false, error: 'unhandled_tool' }
    });
  });

  it('THE FLASH: a tool the server already answered is left alone', async () => {
    const h = harness();

    // The regression this fix is for: getPanelSnapshot runs in ai-services, so
    // onToolCall fires for it here and its output arrives over the stream.
    await handleAssistantToolCall(
      { toolName: 'getPanelSnapshot', toolCallId: 'call_snap', input: {} },
      h.deps
    );
    expect(h.emitted).toHaveLength(0);

    answerUnansweredToolCalls(
      [
        {
          type: 'tool-getPanelSnapshot',
          toolCallId: 'call_snap',
          state: 'output-available',
          output: { steps: [] }
        }
      ],
      h.deps
    );

    expect(h.emitted).toHaveLength(0);
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
    expect(h.emitted[0].output).toMatchObject({ error: 'unhandled_tool' });
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
      // Whatever the handler declined to answer is still pending at turn end,
      // so the sweep answers it and the two together emit exactly once
      if (h.emitted.length === 0)
        answerUnansweredToolCalls(
          [
            {
              type: `tool-${toolName}`,
              toolCallId: `id_${toolName}`,
              state: 'input-available'
            }
          ],
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

describe('the turn-end sweep answers only what nobody else did', () => {
  it('answers a pending call in either streamed state, static or dynamic', () => {
    const h = harness();

    answerUnansweredToolCalls(
      [
        { type: 'step-start' },
        { type: 'text', text: 'looking that up' },
        { type: 'tool-searchDocuments', toolCallId: 'a', state: 'input-available' },
        { type: 'tool-queryHub', toolCallId: 'b', state: 'input-streaming' },
        {
          type: 'dynamic-tool',
          toolName: 'rule_fm_quote_c07c',
          toolCallId: 'c',
          state: 'input-available'
        }
      ],
      h.deps
    );

    expect(h.emitted.map((e) => [e.tool, e.toolCallId])).toEqual([
      ['searchDocuments', 'a'],
      ['queryHub', 'b'],
      ['rule_fm_quote_c07c', 'c']
    ]);
    h.emitted.forEach((e) =>
      expect(e.output).toMatchObject({ ok: false, error: 'unhandled_tool' })
    );
  });

  it('leaves answered, errored and provider-executed calls untouched', () => {
    const h = harness();

    answerUnansweredToolCalls(
      [
        { type: 'tool-setFieldValue', toolCallId: 'a', state: 'output-available' },
        { type: 'tool-clickElement', toolCallId: 'b', state: 'output-error' },
        // The provider runs its own tools and answers them itself
        {
          type: 'tool-web_search',
          toolCallId: 'c',
          state: 'input-available',
          providerExecuted: true
        },
        { type: 'tool-getPanelSnapshot', state: 'input-available' }
      ],
      h.deps
    );

    expect(h.emitted).toHaveLength(0);
  });

  it('survives a reply with no parts at all', () => {
    const h = harness();

    answerUnansweredToolCalls([], h.deps);
    answerUnansweredToolCalls(undefined as any, h.deps);

    expect(h.emitted).toHaveLength(0);
  });
});
