import type { UIMessage } from 'ai';

import { coalesceAssistantMessages } from './messageRendering';

const toolPart = {
  type: 'tool-applyDocumentEdits',
  toolCallId: 'tool-call-1',
  state: 'output-available',
  input: {},
  output: { ok: true }
};

describe('assistant message rendering', () => {
  it('keeps one reply while a continuation streams cumulative snapshots', () => {
    const chunks = ['Finished ', 'updating ', 'the ', 'document.'];
    const messages: UIMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Update the document' }]
      },
      {
        id: 'assistant-initial',
        role: 'assistant',
        parts: [toolPart] as any
      }
    ];

    chunks.forEach((_, index) => {
      messages.push({
        id: `assistant-continuation-${index}`,
        role: 'assistant',
        parts: [
          toolPart,
          { type: 'step-start' },
          { type: 'text', text: chunks.slice(0, index + 1).join('') }
        ] as any
      });
    });

    const rendered = coalesceAssistantMessages(messages);
    const replies = rendered.filter((message) => message.role === 'assistant');

    expect(replies).toHaveLength(1);
    expect(replies[0].id).toBe('assistant-initial');
    expect(replies[0].parts).toEqual([
      toolPart,
      { type: 'step-start' },
      { type: 'text', text: 'Finished updating the document.' }
    ]);
  });

  it('preserves distinct assistant segments before replacing their latest snapshot', () => {
    const messages: UIMessage[] = [
      {
        id: 'assistant-intro',
        role: 'assistant',
        parts: [{ type: 'text', text: 'I will update the document.' }]
      },
      {
        id: 'assistant-tool',
        role: 'assistant',
        parts: [toolPart] as any
      },
      {
        id: 'assistant-tool-update',
        role: 'assistant',
        parts: [
          { ...toolPart, output: { ok: true, revisionCount: 3 } },
          { type: 'text', text: 'Done.' }
        ] as any
      }
    ];

    expect(coalesceAssistantMessages(messages)[0].parts).toEqual([
      { type: 'text', text: 'I will update the document.' },
      { ...toolPart, output: { ok: true, revisionCount: 3 } },
      { type: 'text', text: 'Done.' }
    ]);
  });
});
