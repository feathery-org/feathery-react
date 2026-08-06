import type { UIMessage } from 'ai';

import {
  createRoundSelectionRequestPreparer,
  __testing
} from './messageHistory';

const { prepareAssistantRequest } = __testing;

const heavy = (label: string) => `${label}:${'x'.repeat(88_000)}`;

const user = (id: string): UIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text: id }]
});

const tool = (
  id: string,
  name: string,
  output: unknown,
  dynamic = false
): UIMessage => ({
  id: `message-${id}`,
  role: 'assistant',
  parts: [
    dynamic
      ? {
          type: 'dynamic-tool',
          toolName: name,
          toolCallId: id,
          state: 'output-available',
          input: {},
          output
        }
      : ({
          type: `tool-${name}`,
          toolCallId: id,
          state: 'output-available',
          input: {},
          output
        } as any)
  ]
});

const pendingTool = (
  id: string,
  name: string,
  state: 'input-streaming' | 'input-available',
  dynamic = false
): UIMessage => ({
  id: `message-${id}`,
  role: 'assistant',
  parts: [
    {
      type: dynamic ? 'dynamic-tool' : `tool-${name}`,
      ...(dynamic ? { toolName: name } : {}),
      toolCallId: id,
      state,
      input: { query: id }
    } as any
  ]
});

const sentMessages = (
  prepare: (options: any) => { body: Record<string, unknown> },
  messages: UIMessage[],
  messageId: string
): UIMessage[] =>
  prepare({
    id: 'chat-id',
    messages,
    body: { thread_id: 'thread-id' },
    trigger: 'submit-message',
    messageId
  }).body.messages as UIMessage[];

describe('assistant outbound message history', () => {
  it('sends every completed document-tool result byte-identically as the conversation grows', () => {
    const prepare = createRoundSelectionRequestPreparer();
    // Mirrors the live shape that broke the prompt cache: heavy document-tool
    // outputs settling into history behind several later turns.
    const results = [
      tool('inventory', 'getDocumentInventory', {
        inventory: [{ anchor: '0;0', text: heavy('inventory') }]
      }),
      tool(
        'occurrences',
        'findDocumentOccurrences',
        { ok: true, occurrences: [{ blockText: heavy('occurrences') }] },
        true
      ),
      tool('edits', 'applyDocumentEdits', {
        results: [{ ok: true, echo: heavy('edits') }],
        changeSet: {
          status: 'applied',
          announcement: 'Updated the document',
          groups: [{ id: 'edits', revisionCount: 3, restoresAppearance: true }]
        }
      }),
      tool('pattern', 'getSectionPattern', {
        ok: true,
        sections: [{ text: heavy('pattern') }]
      }),
      tool('blocks', 'applyDocumentBlocks', {
        results: [{ ok: true, echo: heavy('blocks') }]
      })
    ];

    const history: UIMessage[] = [];
    const sends: UIMessage[][] = [];
    for (let turn = 0; turn < results.length; turn++) {
      history.push(user(`turn-${turn + 1}`));
      sends.push(sentMessages(prepare, [...history], `turn-${turn + 1}`));
      // Two tool steps per turn: the multi-step loop re-sends history on each.
      history.push(results[turn]);
      sends.push(sentMessages(prepare, [...history], `step-${turn + 1}`));
    }

    // The outbound prefix is append-only: everything a previous request sent
    // comes back byte-for-byte in the next one, so the provider cache holds.
    for (let i = 1; i < sends.length; i++) {
      const previous = sends[i - 1];
      const current = sends[i];
      expect(current.length).toBeGreaterThanOrEqual(previous.length);
      for (let index = 0; index < previous.length; index++) {
        expect(JSON.stringify(current[index])).toBe(
          JSON.stringify(previous[index])
        );
      }
    }

    // And each settled result is still the full one it was when it completed.
    const last = sends[sends.length - 1];
    for (const result of results) {
      const sent = last.find((message) => message.id === result.id);
      expect(JSON.stringify(sent)).toBe(JSON.stringify(result));
      expect(JSON.stringify(sent)).toContain('x'.repeat(88_000));
    }
  });

  it('sends history by reference so nothing can rewrite a settled result', () => {
    const old = tool('old', 'getDocumentInventory', {
      inventory: [heavy('old')]
    });
    const current = tool('current', 'applyDocumentEdits', {
      results: [{ ok: true, echo: heavy('current') }],
      changeSet: { status: 'applied', announcement: 'Updated' }
    });
    const messages = [
      user('turn-1'),
      old,
      user('turn-2'),
      tool('mid', 'findDocumentOccurrences', {
        ok: true,
        occurrences: [heavy('mid')]
      }),
      user('turn-3'),
      current
    ];
    const snapshot = JSON.stringify(messages);

    const prepared = prepareAssistantRequest({
      id: 'chat-id',
      messages,
      body: undefined,
      trigger: 'submit-message',
      messageId: undefined
    }).body.messages;

    expect(prepared).toBe(messages);
    expect(JSON.stringify(messages)).toBe(snapshot);
  });

  it('leaves dangling calls untouched for service-boundary repair', () => {
    const streaming = pendingTool(
      'streaming',
      'readAttachment',
      'input-streaming',
      true
    );
    const available = pendingTool(
      'available',
      'getDocumentInventory',
      'input-available'
    );
    const messages = [user('turn-1'), streaming, available, user('turn-2')];
    const snapshot = JSON.stringify(messages);

    const prepared = prepareAssistantRequest({
      id: 'chat-id',
      messages,
      body: undefined,
      trigger: 'submit-message',
      messageId: undefined
    }).body.messages as UIMessage[];

    expect(prepared).toBe(messages);
    expect(JSON.stringify(prepared)).toBe(snapshot);
  });

  it('preserves the default transport body contract and thread context', () => {
    const messages = [user('turn')];
    const prepared = prepareAssistantRequest({
      id: 'chat-id',
      messages,
      body: { thread_id: 'thread-id', targets: [{ type: 'panel', id: 'p1' }] },
      trigger: 'submit-message',
      messageId: 'message-id'
    });

    expect(prepared.body).toEqual({
      thread_id: 'thread-id',
      targets: [{ type: 'panel', id: 'p1' }],
      id: 'chat-id',
      messages,
      trigger: 'submit-message',
      messageId: 'message-id'
    });
  });

  it('pins selection content and offsets to the user message for every tool continuation', () => {
    const prepare = createRoundSelectionRequestPreparer();
    const originalSelection = {
      anchor: '0;4',
      startOffset: '0;4;0',
      endOffset: '0;4;58',
      text: 'Our firm supports clients throughout the policy lifecycle.',
      isCollapsed: false
    };
    const firstMessages = [user('turn-1')];
    const first = prepare({
      id: 'chat-id',
      messages: firstMessages,
      body: { selection: originalSelection },
      trigger: 'submit-message',
      messageId: 'turn-1'
    }).body;

    originalSelection.text = '\r';
    const continuation = prepare({
      id: 'chat-id',
      messages: [
        ...firstMessages,
        tool('inventory', 'getDocumentInventory', { inventory: [] })
      ],
      body: {
        selection: {
          anchor: '0;0',
          startOffset: '0;0;0',
          endOffset: '0;0;1',
          text: '\r',
          isCollapsed: false
        }
      },
      trigger: 'submit-message',
      messageId: 'message-inventory'
    }).body;

    expect(first.selection).toEqual({
      ...originalSelection,
      text: 'Our firm supports clients throughout the policy lifecycle.'
    });
    expect(continuation.selection).toEqual(first.selection);

    const next = prepare({
      id: 'chat-id',
      messages: [...firstMessages, user('turn-2')],
      body: {
        selection: {
          anchor: '0;6',
          startOffset: '0;6;3',
          endOffset: '0;6;13',
          text: '. Our firm',
          isCollapsed: false
        }
      },
      trigger: 'submit-message',
      messageId: 'turn-2'
    }).body;
    expect(next.selection).toMatchObject({
      anchor: '0;6',
      text: '. Our firm'
    });
  });
});
