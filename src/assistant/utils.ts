import { Chat } from '@ai-sdk/react';

export type AssistantTransport = {
  url: string;
  headers: () => Record<string, string>;
  body: Record<string, unknown>;
};

export type AssistantThreadDetail = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  isTemporary?: boolean;
  messages?: { id: string; role: string; parts: unknown[] }[];
  chat?: Chat<any>;
};

const toQueryString = (params: Record<string, unknown>): string => {
  const filtered = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => [k, String(v)]) as [string, string][];
  if (!filtered.length) return '';
  return '?' + new URLSearchParams(filtered).toString();
};

export const getThreadList = async (
  transport: AssistantTransport
): Promise<AssistantThreadDetail[] | null> => {
  const threadsUrl = `${transport.url}threads/${toQueryString(transport.body)}`;
  const res = await fetch(threadsUrl, {
    headers: transport.headers()
  });
  if (!res.ok) return null;
  return res.json();
};

export const getThreadDetail = async (
  transport: AssistantTransport,
  threadId: string
): Promise<AssistantThreadDetail | null> => {
  const threadsUrl = `${transport.url}threads/${threadId}/${toQueryString(
    transport.body
  )}`;
  const res = await fetch(threadsUrl, {
    headers: transport.headers()
  });
  if (!res.ok) return null;
  return res.json();
};

export const generateThreadTitle = async (
  transport: AssistantTransport,
  threadId: string,
  message: string
): Promise<string | null> => {
  const res = await fetch(
    `${transport.url}threads/${threadId}/generate-title/${toQueryString(
      transport.body
    )}`,
    {
      method: 'POST',
      headers: { ...transport.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.title ?? null;
};

export const deleteThread = async (
  transport: AssistantTransport,
  threadId: string
): Promise<void> => {
  const threadsUrl = `${transport.url}threads/${threadId}/${toQueryString(
    transport.body
  )}`;
  await fetch(threadsUrl, {
    method: 'DELETE',
    headers: transport.headers()
  });
};
