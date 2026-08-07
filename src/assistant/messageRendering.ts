type UnknownPart = Record<string, unknown>;
type RenderMessage = {
  id: string;
  role: string;
  parts: any[];
  [key: string]: any;
};

const continuesPart = (previous: UnknownPart, next: UnknownPart): boolean => {
  if (previous.type !== next.type) return false;

  if (previous.type === 'text' || previous.type === 'reasoning') {
    return (
      typeof previous.text === 'string' &&
      typeof next.text === 'string' &&
      next.text.startsWith(previous.text)
    );
  }

  if (
    previous.type === 'dynamic-tool' ||
    (typeof previous.type === 'string' && previous.type.startsWith('tool-'))
  ) {
    return (
      typeof previous.toolCallId === 'string' &&
      previous.toolCallId === next.toolCallId
    );
  }

  if (typeof previous.id === 'string' || typeof next.id === 'string') {
    return previous.id === next.id;
  }

  return JSON.stringify(previous) === JSON.stringify(next);
};

const continuesSnapshot = (previous: unknown[], next: unknown[]): boolean =>
  previous.length === 0 ||
  (next.length >= previous.length &&
    previous.every((part, index) =>
      continuesPart(part as UnknownPart, next[index] as UnknownPart)
    ));

/**
 * Present adjacent assistant messages as one turn. The AI SDK can append a
 * cumulative message snapshot when a stream changes message id; replace that
 * snapshot's previous contribution instead of concatenating it again.
 */
export function coalesceAssistantMessages(
  messages: RenderMessage[]
): RenderMessage[] {
  const combined: RenderMessage[] = [];
  let lastRawParts: unknown[] = [];
  let tailStart = 0;

  for (const message of messages) {
    const previous = combined[combined.length - 1];
    if (previous?.role !== 'assistant' || message.role !== 'assistant') {
      combined.push(message);
      lastRawParts = message.role === 'assistant' ? message.parts ?? [] : [];
      tailStart = 0;
      continue;
    }

    const nextParts = message.parts ?? [];
    const isSnapshot = continuesSnapshot(lastRawParts, nextParts);
    const parts = isSnapshot
      ? [...previous.parts.slice(0, tailStart), ...nextParts]
      : [...previous.parts, ...nextParts];

    if (!isSnapshot) {
      tailStart = previous.parts.length;
    }

    combined[combined.length - 1] = {
      ...message,
      id: previous.id,
      parts
    };
    lastRawParts = nextParts;
  }

  return combined;
}
