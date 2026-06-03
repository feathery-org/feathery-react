import {
  MouseEvent,
  MutableRefObject,
  useCallback,
  useMemo,
  useRef,
  useState
} from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Chat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls
} from 'ai';

import {
  AssistantThreadDetail,
  deleteThread,
  generateThreadTitle,
  getThreadDetail,
  getThreadList,
  handleAssistantToolCall
} from '../utils';
import {
  getCurrentStepKey,
  getPanelRuntimeSnapshot
} from '../tools/panelRuntime';
import type { AssistantHeaders, ResourceRef } from '../types';

type UseChatThreadsArgs = {
  baseUrl: string;
  headers: AssistantHeaders;
  instanceId?: string;
  getTargets: () => ResourceRef[];
  voiceActiveRef: MutableRefObject<boolean>;
};

export default function useChatThreads({
  baseUrl,
  headers,
  instanceId,
  getTargets,
  voiceActiveRef
}: UseChatThreadsArgs) {
  const [threads, setThreads] = useState<AssistantThreadDetail[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const atBottomRef = useRef(true);

  const buildChatBody = (): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      voice_mode: voiceActiveRef.current
    };
    const targets = getTargets();
    if (targets.length > 0) body.targets = targets;
    if (instanceId) {
      const panelRuntime = getPanelRuntimeSnapshot(instanceId);
      if (panelRuntime) body.panel_runtime = panelRuntime;
    }
    return body;
  };

  const makeChat = (
    threadId: string | null,
    initialMessages: any[] = [],
    initialTitle?: string
  ): Chat<any> => {
    let resolvedThreadId = threadId;
    let titleGenerated = !!initialTitle;

    const chatTransport = new DefaultChatTransport({
      api: baseUrl,
      headers: headers,
      body: () => ({
        ...buildChatBody(),
        thread_id: resolvedThreadId || null
      }),
      fetch: async (url: any, init?: any) => {
        const res = await fetch(url, init);
        const threadId = res.headers.get('X-Thread-Id');
        if (threadId && !resolvedThreadId) {
          resolvedThreadId = threadId;
          setThreads((prev) =>
            prev.map((t) =>
              t.chat === chat ? { ...t, id: threadId, isTemporary: false } : t
            )
          );
          setActiveThreadId(threadId);
          getThreadDetail(baseUrl, headers, threadId).then((t) => {
            if (t)
              setThreads((prev) =>
                prev.map((thread) =>
                  thread.id === threadId
                    ? { ...t, chat, title: thread.title || t.title }
                    : thread
                )
              );
          });
        }
        if (!titleGenerated) {
          const titleMessage = chat.messages.find((m: any) => m.role === 'user')
            ?.parts?.[0]?.text;
          if (titleMessage) {
            titleGenerated = true;
            const currentThreadId = resolvedThreadId || threadId || null;
            const titleContext: {
              targets?: ResourceRef[];
              current_step?: string;
            } = {};
            const targets = getTargets();
            if (targets.length > 0) titleContext.targets = targets;
            if (instanceId) {
              const stepKey = getCurrentStepKey(instanceId);
              if (stepKey) titleContext.current_step = stepKey;
            }
            generateThreadTitle(
              baseUrl,
              headers,
              currentThreadId,
              titleMessage,
              titleContext
            ).then((title) => {
              if (!title) return;
              if (currentThreadId) {
                setThreads((prev) =>
                  prev.map((t) =>
                    t.id === currentThreadId ? { ...t, title } : t
                  )
                );
              } else {
                setThreads((prev) =>
                  prev.map((t) => (t.chat === chat ? { ...t, title } : t))
                );
              }
            });
          }
        }
        return res;
      }
    });

    const chat: Chat<any> = new Chat<any>({
      transport: chatTransport,
      messages: initialMessages,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      onToolCall: async ({ toolCall }: any) => {
        await handleAssistantToolCall(chat, toolCall, instanceId);
      },
      onFinish: ({ isAbort, isError }: any) => {
        if (isAbort || isError || !resolvedThreadId) return;
        setThreads((prev) => {
          const thread = prev.find((t) => t.id === resolvedThreadId);
          if (!thread) return prev;
          return [
            { ...thread, updated_at: new Date().toISOString() },
            ...prev.filter((t) => t.id !== resolvedThreadId)
          ];
        });
      }
    });

    return chat;
  };

  const readyChat = useMemo(() => makeChat(null), [headers, getTargets]);
  const activeThread = threads.find((t) => t.id === activeThreadId);
  const activeChat = activeThread?.chat ?? readyChat;

  const fetchThreads = useCallback(async () => {
    const data = await getThreadList(baseUrl, headers);
    if (!data) return;
    setThreads((prev) => [
      ...data.map((d) => ({
        ...d,
        chat: prev.find((p) => p.id === d.id)?.chat
      })),
      ...prev.filter((p) => !data.find((d) => d.id === p.id))
    ]);
  }, [headers, baseUrl]);

  const handleNewThread = () => {
    atBottomRef.current = true;
    const id = uuidv4();
    const now = new Date().toISOString();
    const chat = makeChat(null);
    setThreads((prev) => [
      {
        id,
        title: '',
        created_at: now,
        updated_at: now,
        isTemporary: true,
        chat
      },
      ...prev.filter((t) => !t.isTemporary || t.title)
    ]);
    setActiveThreadId(id);
  };

  const handleSelectThread = async (id: string) => {
    atBottomRef.current = true;
    if (threads.find((t) => t.id === id)?.chat) {
      setActiveThreadId(id);
      return;
    }
    const thread = await getThreadDetail(baseUrl, headers, id);
    if (!thread) return;
    const chat = makeChat(id, thread.messages ?? [], thread.title);
    setThreads((prev) =>
      prev.map((t) => (t.id === id ? { ...thread, chat } : t))
    );
    setActiveThreadId(id);
  };

  const handleDeleteThread = async (id: string, e: MouseEvent) => {
    e.stopPropagation();
    const thread = threads.find((t) => t.id === id);
    if (!thread?.isTemporary) {
      await deleteThread(baseUrl, headers, id);
    }
    setThreads((prev) => prev.filter((t) => t.id !== id));
    if (activeThreadId === id) handleNewThread();
  };

  const ensureThreadForSend = () => {
    const now = new Date().toISOString();
    if (!activeThreadId) {
      const id = uuidv4();
      setThreads((prev) => [
        {
          id,
          title: 'New Chat',
          created_at: now,
          updated_at: now,
          isTemporary: true,
          chat: activeChat
        },
        ...prev
      ]);
      setActiveThreadId(id);
    } else if (activeThread && !activeThread.title) {
      setThreads((prev) => [
        { ...activeThread, title: 'New Chat', updated_at: now },
        ...prev.filter((t) => t.id !== activeThreadId)
      ]);
    }
  };

  return {
    threads,
    activeThreadId,
    activeThread,
    activeChat,
    atBottomRef,
    fetchThreads,
    handleNewThread,
    handleSelectThread,
    handleDeleteThread,
    ensureThreadForSend
  };
}
