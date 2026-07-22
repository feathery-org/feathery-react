import { Chat } from '@ai-sdk/react';

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

// Thread endpoints live on the unified /agent/threads/ family, same origin as
// the assistant chat base
const threadsBase = (baseUrl: string) =>
  new URL('/agent/threads/', baseUrl).href;

// form_key lets backend form auth validate the session against the current
// form, without it the request stays anonymous
export const withFormKey = (url: string, formKey?: string): string => {
  if (!formKey) return url;
  const parsed = new URL(url);
  parsed.searchParams.set('form_key', formKey);
  return parsed.href;
};

export const getThreadList = async (
  baseUrl: string,
  headers: AssistantHeaders,
  formKey?: string
): Promise<AssistantThreadDetail[] | null> => {
  const res = await fetch(withFormKey(threadsBase(baseUrl), formKey), {
    headers: headers()
  });
  if (!res.ok) return null;
  return res.json();
};

export const getThreadDetail = async (
  baseUrl: string,
  headers: AssistantHeaders,
  threadId: string,
  formKey?: string
): Promise<AssistantThreadDetail | null> => {
  const res = await fetch(
    withFormKey(`${threadsBase(baseUrl)}${threadId}/`, formKey),
    {
      headers: headers()
    }
  );
  if (!res.ok) return null;
  return res.json();
};

export const generateThreadTitle = async (
  baseUrl: string,
  headers: AssistantHeaders,
  threadId: string | null,
  message: string,
  context?: {
    targets?: { type: string; id: string }[];
    current_step?: string;
  },
  formKey?: string
): Promise<string | null> => {
  const res = await fetch(
    withFormKey(`${threadsBase(baseUrl)}title/`, formKey),
    {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        thread_id: threadId ?? undefined,
        ...(context ?? {})
      })
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.title ?? null;
};

export const deleteThread = async (
  baseUrl: string,
  headers: AssistantHeaders,
  threadId: string,
  formKey?: string
): Promise<void> => {
  await fetch(withFormKey(`${threadsBase(baseUrl)}${threadId}/`, formKey), {
    method: 'DELETE',
    headers: headers()
  });
};
