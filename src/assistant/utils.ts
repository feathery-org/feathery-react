import { Chat } from '@ai-sdk/react';

import { dispatchSetFieldValue } from './tools/setFieldValue';
import { dispatchClickElement } from './tools/clickElement';
import { dispatchTriggerTableAction } from './tools/triggerTableAction';
import {
  dispatchAddTableRow,
  dispatchDeleteTableRow,
  dispatchSetTableCellValue
} from './tools/tableMutations';
import { readPartType, type ToolRow } from './components/ToolStatus';
import type { AssistantHeaders } from './types';

type AssistantChunk =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'tools'; key: string; rows: ToolRow[] };

export function mergeAssistantParts(parts: any[]): AssistantChunk[] {
  const chunks: AssistantChunk[] = [];
  parts.forEach((part: any, index: number) => {
    if (part.type === 'text' && part.text.trim()) {
      const prev = chunks[chunks.length - 1];
      if (prev && prev.kind === 'text') {
        prev.text = `${prev.text}\n\n${part.text}`;
      } else {
        chunks.push({ kind: 'text', key: `text-${index}`, text: part.text });
      }
      return;
    }
    const meta = readPartType(part);
    if (!meta || meta.kind !== 'tool' || !meta.toolName) return;
    const row: ToolRow = {
      key: `tool-${index}`,
      toolName: meta.toolName,
      state: part.state as string,
      input: part.input,
      output: part.output
    };
    const prev = chunks[chunks.length - 1];
    if (prev && prev.kind === 'tools') {
      prev.rows.push(row);
    } else {
      chunks.push({
        kind: 'tools',
        key: `tools-${index}`,
        rows: [row]
      });
    }
  });
  return chunks;
}

export type AssistantThreadDetail = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  isTemporary?: boolean;
  messages?: { id: string; role: string; parts: unknown[] }[];
  chat?: Chat<any>;
};

export async function getThreadList(
  baseUrl: string,
  headers: AssistantHeaders
): Promise<AssistantThreadDetail[] | null> {
  const res = await fetch(`${baseUrl}threads/`, { headers: headers() });
  if (!res.ok) return null;
  return res.json();
}

export async function getThreadDetail(
  baseUrl: string,
  headers: AssistantHeaders,
  threadId: string
): Promise<AssistantThreadDetail | null> {
  const res = await fetch(`${baseUrl}threads/${threadId}/`, {
    headers: headers()
  });
  if (!res.ok) return null;
  return res.json();
}

export async function generateThreadTitle(
  baseUrl: string,
  headers: AssistantHeaders,
  threadId: string | null,
  message: string,
  context?: {
    targets?: { type: string; id: string }[];
    current_step?: string;
  }
): Promise<string | null> {
  const res = await fetch(`${baseUrl}threads/title/`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      thread_id: threadId ?? undefined,
      ...(context ?? {})
    })
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.title ?? null;
}

export async function deleteThread(
  baseUrl: string,
  headers: AssistantHeaders,
  threadId: string
): Promise<void> {
  await fetch(`${baseUrl}threads/${threadId}/`, {
    method: 'DELETE',
    headers: headers()
  });
}

// Runs client-forwarded tool calls and writes the result back as the chat's tool output
export async function handleAssistantToolCall(
  chat: Chat<any>,
  toolCall: any,
  instanceId?: string
): Promise<void> {
  if (toolCall.dynamic) return;

  if (toolCall.toolName === 'setFieldValue') {
    const input = (toolCall.input ?? {}) as {
      fields?: Array<{
        fieldKey?: unknown;
        value?: unknown;
        repeatIndex?: unknown;
      }>;
    };
    const fields = Array.isArray(input.fields) ? input.fields : [];
    const output = await dispatchSetFieldValue(instanceId, fields);
    chat.addToolOutput({
      tool: 'setFieldValue',
      toolCallId: toolCall.toolCallId,
      output
    });
  } else if (toolCall.toolName === 'clickElement') {
    const input = (toolCall.input ?? {}) as {
      elementId?: unknown;
      repeatIndex?: unknown;
    };
    const elementId =
      typeof input.elementId === 'string' ? input.elementId : '';
    const output = await dispatchClickElement(
      instanceId,
      elementId,
      input.repeatIndex
    );
    chat.addToolOutput({
      tool: 'clickElement',
      toolCallId: toolCall.toolCallId,
      output
    });
  } else if (toolCall.toolName === 'triggerTableAction') {
    const input = (toolCall.input ?? {}) as {
      tableId?: unknown;
      rowIndex?: unknown;
      actionLabel?: unknown;
    };
    const tableId = typeof input.tableId === 'string' ? input.tableId : '';
    const rowIndex = typeof input.rowIndex === 'number' ? input.rowIndex : NaN;
    const actionLabel =
      typeof input.actionLabel === 'string' ? input.actionLabel : undefined;
    const output = await dispatchTriggerTableAction(
      instanceId,
      tableId,
      rowIndex,
      actionLabel
    );
    chat.addToolOutput({
      tool: 'triggerTableAction',
      toolCallId: toolCall.toolCallId,
      output
    });
  } else if (toolCall.toolName === 'addTableRow') {
    const input = (toolCall.input ?? {}) as { tableId?: unknown };
    const tableId = typeof input.tableId === 'string' ? input.tableId : '';
    const output = await dispatchAddTableRow(instanceId, tableId);
    chat.addToolOutput({
      tool: 'addTableRow',
      toolCallId: toolCall.toolCallId,
      output
    });
  } else if (toolCall.toolName === 'deleteTableRow') {
    const input = (toolCall.input ?? {}) as {
      tableId?: unknown;
      rowIndex?: unknown;
    };
    const tableId = typeof input.tableId === 'string' ? input.tableId : '';
    const rowIndex = typeof input.rowIndex === 'number' ? input.rowIndex : NaN;
    const output = await dispatchDeleteTableRow(instanceId, tableId, rowIndex);
    chat.addToolOutput({
      tool: 'deleteTableRow',
      toolCallId: toolCall.toolCallId,
      output
    });
  } else if (toolCall.toolName === 'setTableCellValue') {
    const input = (toolCall.input ?? {}) as {
      tableId?: unknown;
      cells?: unknown;
    };
    const tableId = typeof input.tableId === 'string' ? input.tableId : '';
    const cells = Array.isArray(input.cells)
      ? (input.cells as Array<{
          rowIndex: unknown;
          fieldKey: unknown;
          value: unknown;
        }>)
      : [];
    const output = await dispatchSetTableCellValue(instanceId, tableId, cells);
    chat.addToolOutput({
      tool: 'setTableCellValue',
      toolCallId: toolCall.toolCallId,
      output
    });
  }
}
