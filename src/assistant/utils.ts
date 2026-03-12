import type { Chat } from '@ai-sdk/react';

export type ChatThread = {
  id?: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
  messages?: { id: string; role: string; parts: unknown[] }[];
  chat?: Chat<any>;
};

export const fetchThreads = async (
  baseUrl: string,
  headers: () => Record<string, string>
): Promise<ChatThread[]> => {
  const response = await fetch(`${baseUrl}/api/threads`, {
    method: 'GET',
    headers: headers()
  });
  const json = await response.json();
  return json.map((thread: any) => ({
    id: thread.id,
    title: thread.title,
    created_at: thread.created_at,
    updated_at: thread.updated_at
  }));
};

export const fetchThread = async (
  baseUrl: string,
  threadId: string,
  headers: () => Record<string, string>
): Promise<ChatThread> => {
  const response = await fetch(`${baseUrl}/api/threads/${threadId}`, {
    method: 'GET',
    headers: headers()
  });
  const json = await response.json();
  return {
    id: json.id,
    title: json.title,
    created_at: json.created_at,
    updated_at: json.updated_at,
    messages: json.messages
  };
};

export const deleteThread = async (
  baseUrl: string,
  threadId: string,
  headers: () => Record<string, string>
): Promise<void> => {
  await fetch(`${baseUrl}/api/threads/${threadId}`, {
    method: 'DELETE',
    headers: headers()
  });
};
