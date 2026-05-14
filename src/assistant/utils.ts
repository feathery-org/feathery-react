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

export const getThreadList = async (
  baseUrl: string,
  headers: AssistantHeaders
): Promise<AssistantThreadDetail[] | null> => {
  const res = await fetch(`${baseUrl}threads/`, { headers: headers() });
  if (!res.ok) return null;
  return res.json();
};

export const getThreadDetail = async (
  baseUrl: string,
  headers: AssistantHeaders,
  threadId: string
): Promise<AssistantThreadDetail | null> => {
  const res = await fetch(`${baseUrl}threads/${threadId}/`, {
    headers: headers()
  });
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
  }
): Promise<string | null> => {
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
};

export const deleteThread = async (
  baseUrl: string,
  headers: AssistantHeaders,
  threadId: string
): Promise<void> => {
  await fetch(`${baseUrl}threads/${threadId}/`, {
    method: 'DELETE',
    headers: headers()
  });
};

// Subgrids whose position is a strict prefix of `position` (callers pre-filter to those whose handler does anything), innermost first.
export const findClickableAncestorSubgrids = (
  subgrids: any[] | undefined,
  position: number[]
): any[] => {
  if (
    !Array.isArray(subgrids) ||
    !Array.isArray(position) ||
    position.length === 0
  )
    return [];
  const matches: any[] = [];
  for (const sg of subgrids) {
    const pos = Array.isArray(sg?.position) ? sg.position : [];
    if (pos.length >= position.length) continue;
    let isPrefix = true;
    for (let i = 0; i < pos.length; i++) {
      if (pos[i] !== position[i]) {
        isPrefix = false;
        break;
      }
    }
    if (!isPrefix) continue;
    matches.push(sg);
  }
  matches.sort((a, b) => b.position.length - a.position.length);
  return matches;
};
