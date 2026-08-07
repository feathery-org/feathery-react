import type { UIMessage } from 'ai';

type PrepareRequestOptions = {
  id: string;
  messages: UIMessage[];
  body: Record<string, unknown> | undefined;
  trigger: 'submit-message' | 'regenerate-message';
  messageId: string | undefined;
};

/**
 * Pin the selection to the user message which started a tool round. The AI SDK
 * rebuilds transport `body()` for every automatic tool continuation; without
 * this boundary a later request can replace the user's intent with whatever
 * temporary range the editor exposes while a read is running.
 */
export function createRoundSelectionRequestPreparer(): (
  options: PrepareRequestOptions
) => { body: Record<string, unknown> } {
  let userMessageId: string | undefined;
  let selectionSnapshot: unknown;
  let hasSnapshot = false;

  return (options) => {
    let currentUserId: string | undefined;
    // Keep this as a plain loop: array combinators over the AI SDK's recursive
    // UIMessage union exceed rollup-plugin-typescript2's instantiation depth.
    for (let index = options.messages.length - 1; index >= 0; index--) {
      const message = options.messages[index];
      if (message.role !== 'user') continue;
      currentUserId = message.id;
      break;
    }
    if (currentUserId && currentUserId !== userMessageId) {
      userMessageId = currentUserId;
      const selection = options.body?.selection;
      selectionSnapshot =
        selection && typeof selection === 'object' && !Array.isArray(selection)
          ? { ...(selection as Record<string, unknown>) }
          : selection;
      hasSnapshot = true;
    }

    return prepareAssistantRequest({
      ...options,
      body: hasSnapshot
        ? { ...options.body, selection: selectionSnapshot }
        : options.body
    });
  };
}

/**
 * Send conversation history exactly as it stands. Reducing settled tool results
 * has one owner and it is the service: a client-side reduction rewrote already
 * completed document-tool outputs on a moving window, so the same toolCallId
 * reached the provider with different bytes and every message after the rewrite
 * point dropped out of the prompt cache. Per-request state ([live state],
 * [selection], budget) is appended after history by the service, so keeping
 * history append-only here keeps the cached prefix monotone. Dangling tool-call
 * repair likewise belongs to the service transport boundary.
 */
function prepareAssistantRequest({
  id,
  messages,
  body,
  trigger,
  messageId
}: PrepareRequestOptions): { body: Record<string, unknown> } {
  return {
    body: {
      ...body,
      id,
      messages,
      trigger,
      messageId
    }
  };
}

// Test seam: the only production entry point is
// createRoundSelectionRequestPreparer.
export const __testing = {
  prepareAssistantRequest
};
