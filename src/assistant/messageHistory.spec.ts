import type { UIMessage } from 'ai';

import {
  createRoundSelectionRequestPreparer,
  prepareAssistantMessagesForRequest,
  prepareAssistantRequest
} from './messageHistory';

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

const outputOf = (message: UIMessage): any => (message.parts[0] as any).output;

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

describe('assistant outbound message history', () => {
  it('digests old document results while retaining summaries under 1KB', () => {
    const inventory = tool('inventory', 'getDocumentInventory', {
      inventory: [{ anchor: '0;0', text: heavy('inventory') }]
    });
    const occurrences = tool(
      'occurrences',
      'findDocumentOccurrences',
      { ok: true, occurrences: [{ blockText: heavy('occurrences') }] },
      true
    );
    const edits = tool('edits', 'applyDocumentEdits', {
      results: [{ ok: false, details: [heavy('edits')] }],
      changeSet: {
        status: 'failed',
        announcement: 'Update premium totals',
        groups: [
          { id: 'premium', revisionCount: 3, restoresAppearance: true },
          { id: 'totals', revisionCount: 2 }
        ]
      }
    });
    const messages = [
      user('turn-1'),
      inventory,
      user('turn-2'),
      occurrences,
      user('turn-3'),
      edits
    ];

    const prepared = prepareAssistantMessagesForRequest(messages);
    const digest = outputOf(prepared[1]);

    expect(digest).toEqual({
      _digest: '[digested client-side: full result in earlier turn]'
    });
    expect(JSON.stringify(digest).length).toBeLessThan(1_000);
    expect(outputOf(prepared[3])).toBe(outputOf(occurrences));
    expect(outputOf(prepared[5])).toBe(outputOf(edits));
  });

  it('never mutates state or current-turn tool outputs needed for continuation', () => {
    const old = tool('old', 'getDocumentInventory', {
      inventory: [heavy('old')]
    });
    const recentA = tool('recent-a', 'findDocumentOccurrences', {
      ok: true,
      occurrences: [heavy('recent-a')]
    });
    const recentB = tool('recent-b', 'getDocumentInventory', {
      inventory: [heavy('recent-b')]
    });
    const current = tool('current', 'applyDocumentEdits', {
      results: [{ ok: true, echo: heavy('current') }],
      changeSet: {
        status: 'applied',
        announcement: 'Updated the current document',
        groups: [{ id: 'current', revisionCount: 1 }]
      }
    });
    const messages = [
      user('turn-1'),
      old,
      user('turn-2'),
      recentA,
      user('turn-3'),
      recentB,
      user('turn-4'),
      current
    ];
    const snapshot = JSON.stringify(messages);

    const prepared = prepareAssistantMessagesForRequest(messages);

    expect(JSON.stringify(messages)).toBe(snapshot);
    expect(prepared).not.toBe(messages);
    expect(prepared[7]).toBe(current);
    expect((prepared[7].parts[0] as any).toolCallId).toBe('current');
    expect(outputOf(prepared[7])).toBe(outputOf(current));
    expect(outputOf(prepared[5])).toBe(outputOf(recentB));
    expect(outputOf(prepared[3])._digest).toContain('digested client-side');
    expect(outputOf(prepared[1])._digest).toContain('digested client-side');
  });

  it('keeps status, announcement, and a bounded groups summary', () => {
    const old = tool('old', 'applyDocumentEdits', {
      results: [
        { ok: true, echo: heavy('first') },
        { ok: true, echo: heavy('second') }
      ],
      changeSet: {
        status: 'applied',
        announcement: 'Recomputed premium and totals',
        groups: [
          { id: 'premium', revisionCount: 4, restoresAppearance: true },
          { id: 'totals', revisionCount: 2 }
        ]
      }
    });
    const messages = [
      user('turn-1'),
      old,
      user('turn-2'),
      tool('new-1', 'getDocumentInventory', { inventory: [heavy('new-1')] }),
      user('turn-3'),
      tool('new-2', 'findDocumentOccurrences', {
        ok: true,
        occurrences: [heavy('new-2')]
      })
    ];

    const digest = outputOf(prepareAssistantMessagesForRequest(messages)[1]);

    expect(digest).toMatchObject({
      ok: true,
      status: 'applied',
      announcement: 'Recomputed premium and totals',
      groups: { count: 2, revisionCount: 6, restoresAppearance: 1 }
    });
    expect(JSON.stringify(digest).length).toBeLessThan(1_000);
  });

  it('closes dangling historical tool calls as interrupted before sending', () => {
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

    expect(JSON.stringify(messages)).toBe(snapshot);
    expect(prepared).not.toBe(messages);
    expect(prepared[1].parts[0]).toEqual({
      ...(streaming.parts[0] as any),
      state: 'output-error',
      errorText: 'Tool call interrupted.'
    });
    expect(prepared[2].parts[0]).toEqual({
      ...(available.parts[0] as any),
      state: 'output-error',
      errorText: 'Tool call interrupted.'
    });
  });

  it('leaves active-turn streaming tool parts untouched', () => {
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
    const messages = [user('turn'), streaming, available];
    const snapshot = JSON.stringify(messages);

    const prepared = prepareAssistantMessagesForRequest(messages);

    expect(prepared).toBe(messages);
    expect(JSON.stringify(prepared)).toBe(snapshot);
  });

  it('leaves normal histories byte-identical', () => {
    const unrelated = tool('other', 'setFieldValue', {
      ok: true,
      echo: heavy('field')
    });
    const messages = [user('turn-1'), unrelated, user('turn-2')];
    const snapshot = JSON.stringify(messages);

    const prepared = prepareAssistantMessagesForRequest(messages);

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

  it('reduces cumulative request bytes in a simulated three-roundtrip edit conversation', () => {
    const turns: UIMessage[][] = [];
    const messages: UIMessage[] = [];
    const tools = [
      tool('inventory', 'getDocumentInventory', {
        inventory: [{ text: heavy('inventory') }]
      }),
      tool('occurrences', 'findDocumentOccurrences', {
        ok: true,
        occurrences: [{ blockText: heavy('occurrences') }]
      }),
      tool('edits', 'applyDocumentEdits', {
        results: [{ ok: true, echo: heavy('edits') }],
        changeSet: {
          status: 'applied',
          announcement: 'Updated the document',
          groups: [{ id: 'edits', revisionCount: 1 }]
        }
      })
    ];
    for (let i = 0; i < tools.length; i++) {
      messages.push(user(`turn-${i + 1}`), tools[i]);
      turns.push([...messages]);
    }
    const bytes = (value: unknown) =>
      Buffer.byteLength(JSON.stringify({ messages: value }), 'utf8');
    const before = turns.map(bytes);
    const after = turns.map((turn) =>
      bytes(prepareAssistantMessagesForRequest(turn))
    );

    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBeLessThan(before[2] - 80_000);
    expect(after.reduce((sum, value) => sum + value, 0)).toBeLessThan(
      before.reduce((sum, value) => sum + value, 0)
    );
  });
});
