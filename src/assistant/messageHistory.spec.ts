import type { UIMessage } from 'ai';

import {
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

  it('leaves pending and non-document tools untouched', () => {
    const pending = tool('pending', 'getDocumentInventory', { wait: true });
    (pending.parts[0] as any).state = 'input-available';
    delete (pending.parts[0] as any).output;
    const unrelated = tool('other', 'setFieldValue', {
      ok: true,
      echo: heavy('field')
    });
    const messages = [
      user('turn-1'),
      pending,
      user('turn-2'),
      unrelated,
      user('turn-3'),
      tool('new-1', 'getDocumentInventory', { inventory: [heavy('new-1')] }),
      user('turn-4'),
      tool('new-2', 'findDocumentOccurrences', {
        ok: true,
        occurrences: [heavy('new-2')]
      })
    ];

    expect(prepareAssistantMessagesForRequest(messages)).toBe(messages);
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
