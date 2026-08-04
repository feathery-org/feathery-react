import type { UIMessage } from 'ai';

const DOCUMENT_TOOL_NAMES = new Set([
  'getDocumentInventory',
  'findDocumentOccurrences',
  'applyDocumentEdits'
]);
const RETAINED_DOCUMENT_RESULTS = 2;
const DIGEST_MARKER = '[digested client-side: full result in earlier turn]';
const ANNOUNCEMENT_LIMIT = 300;

type MessagePart = UIMessage['parts'][number];
type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;

const documentToolName = (part: MessagePart): string | undefined => {
  const record = part as UnknownRecord;
  const type = typeof record.type === 'string' ? record.type : '';
  const name =
    type === 'dynamic-tool'
      ? record.toolName
      : type.startsWith('tool-')
      ? type.slice('tool-'.length)
      : undefined;
  return typeof name === 'string' && DOCUMENT_TOOL_NAMES.has(name)
    ? name
    : undefined;
};

const summarizeGroups = (groups: unknown): UnknownRecord | undefined => {
  if (!Array.isArray(groups)) return undefined;
  let revisionCount = 0;
  let restoresAppearance = 0;
  for (const group of groups) {
    const record = asRecord(group);
    if (!record) continue;
    if (typeof record.revisionCount === 'number')
      revisionCount += record.revisionCount;
    if (record.restoresAppearance === true) restoresAppearance++;
  }
  return {
    count: groups.length,
    revisionCount,
    restoresAppearance
  };
};

const digestDocumentOutput = (value: unknown): UnknownRecord => {
  const output = asRecord(value);
  const changeSet = asRecord(output?.changeSet);
  const rawResults = output?.results;
  const results = Array.isArray(rawResults) ? rawResults : undefined;
  const resultStatuses = results?.map((result) => asRecord(result)?.ok);
  let ok = typeof output?.ok === 'boolean' ? output.ok : undefined;
  if (
    ok === undefined &&
    resultStatuses?.length &&
    resultStatuses.every((status) => typeof status === 'boolean')
  )
    ok = resultStatuses.every(Boolean);
  const status = output?.status ?? changeSet?.status;
  const announcement = output?.announcement ?? changeSet?.announcement;
  const groups = summarizeGroups(output?.groups ?? changeSet?.groups);

  return {
    ...(typeof ok === 'boolean' ? { ok } : {}),
    ...(typeof status === 'string' ? { status } : {}),
    ...(typeof announcement === 'string'
      ? { announcement: announcement.slice(0, ANNOUNCEMENT_LIMIT) }
      : {}),
    ...(groups ? { groups } : {}),
    _digest: DIGEST_MARKER
  };
};

/**
 * Compact completed document-tool outputs only in the outbound copy. Results
 * in the active turn remain byte-for-byte intact because the SDK needs them to
 * match toolCallId to output before it can continue the turn.
 */
export function prepareAssistantMessagesForRequest(
  messages: UIMessage[]
): UIMessage[] {
  // Plain loop: a reduce over the UIMessage union sends the build compiler's
  // type inference infinitely deep (TS2589 under rollup rpt2, jest unaffected).
  let lastUserIndex = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user') lastUserIndex = i;
  }
  let recentDocumentResults = 0;
  let changed = false;
  const next = [...messages];

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!Array.isArray(message.parts)) continue;
    const currentTurn = i > lastUserIndex;
    let partsChanged = false;
    const parts = [...message.parts];

    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j] as MessagePart & UnknownRecord;
      if (!documentToolName(part) || part.state !== 'output-available')
        continue;

      const alreadyDigested = asRecord(part.output)?._digest === DIGEST_MARKER;
      if (currentTurn || recentDocumentResults < RETAINED_DOCUMENT_RESULTS) {
        recentDocumentResults++;
        continue;
      }
      if (alreadyDigested) continue;

      parts[j] = {
        ...part,
        output: digestDocumentOutput(part.output)
      } as MessagePart;
      partsChanged = true;
      changed = true;
    }

    if (partsChanged) next[i] = { ...message, parts };
  }

  return changed ? next : messages;
}

type PrepareRequestOptions = {
  id: string;
  messages: UIMessage[];
  body: Record<string, unknown> | undefined;
  trigger: 'submit-message' | 'regenerate-message';
  messageId: string | undefined;
};

export function prepareAssistantRequest({
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
      messages: prepareAssistantMessagesForRequest(messages),
      trigger,
      messageId
    }
  };
}
