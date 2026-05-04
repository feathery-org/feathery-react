import { Chat } from '@ai-sdk/react';
import { API_URL } from '../utils/featheryClient';

export const getAssistantUrl = () => `${API_URL}ai/assistant/`;

export type AssistantHeaders = () => Record<string, string>;

export type AssistantThreadDetail = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  isTemporary?: boolean;
  messages?: { id: string; role: string; parts: unknown[] }[];
  chat?: Chat<any>;
};

export const getThreadList = async (
  headers: AssistantHeaders
): Promise<AssistantThreadDetail[] | null> => {
  const res = await fetch(`${getAssistantUrl()}threads/`, {
    headers: headers()
  });
  if (!res.ok) return null;
  return res.json();
};

export const getThreadDetail = async (
  headers: AssistantHeaders,
  threadId: string
): Promise<AssistantThreadDetail | null> => {
  const res = await fetch(`${getAssistantUrl()}threads/${threadId}/`, {
    headers: headers()
  });
  if (!res.ok) return null;
  return res.json();
};

export const generateThreadTitle = async (
  headers: AssistantHeaders,
  threadId: string | null,
  message: string,
  context?: {
    form_key?: string;
    run_id?: string;
    panel_runtime?: unknown;
  }
): Promise<string | null> => {
  if (!threadId) return null;
  const res = await fetch(
    `${getAssistantUrl()}threads/${threadId}/generate-title/`,
    {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, ...(context ?? {}) })
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.title ?? null;
};

export const deleteThread = async (
  headers: AssistantHeaders,
  threadId: string
): Promise<void> => {
  await fetch(`${getAssistantUrl()}threads/${threadId}/`, {
    method: 'DELETE',
    headers: headers()
  });
};
