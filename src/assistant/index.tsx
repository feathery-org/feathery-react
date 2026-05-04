import {
  Fragment,
  KeyboardEvent,
  MouseEvent,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo
} from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Chat, useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { ChatIcon, MinimizeIcon, SendIcon, SpinnerIcon } from './icons';
import {
  DEFAULT_CHAT_COLOR,
  getChatColors,
  GRAY_50,
  GRAY_100,
  GRAY_200,
  GRAY_400,
  GRAY_800
} from './colors';
import ToolStatus, { TOOL_LABELS } from './ToolStatus';
import MarkdownText from './MarkdownText';
import {
  AssistantHeaders,
  AssistantThreadDetail,
  deleteThread,
  generateThreadTitle,
  getAssistantUrl,
  getThreadDetail,
  getThreadList
} from './utils';
import { initInfo } from '../utils/init';
import { getCookie } from '../utils/browser';
import internalState from '../utils/internalState';
import { getPanelRuntimeSnapshot } from './panelRuntime';
import { useApplyValueOps } from './useApplyValueOps';

const FAB_SIZE = 56;
const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 500;

export type WorkflowAction = {
  name: string;
  description?: string;
  instructions: string;
};

export type ResourceRef = { type: string; id: string };

export type AssistantChatProps = {
  formId?: string;
  /**
   * Internal stable id assigned by `<Form>` (`_internalId`); used to look up
   * the renderer's live form state in `internalState`. Not part of the
   * public dashboard surface.
   */
  _internalId?: string;
  runId?: string;
  /**
   * Lazily produces the Builder-aligned `targets[]` for the request body.
   * Called at every send so route/state changes are picked up without
   * re-rendering the chat. When omitted, AssistantChat falls back to a
   * default that derives panel + fuser from `formId` + `initInfo().userId`
   * (the hosted-form path). Dashboard callers should pass an explicit
   * resolver tied to URL/Redux.
   */
  getTargets?: () => ResourceRef[];
  getJwt?: () => string;
  bottom?: number;
  color?: string;
  workflowActions?: WorkflowAction[];
};

const AssistantChat = ({
  formId,
  _internalId,
  runId,
  getTargets,
  getJwt,
  bottom = 20,
  color,
  workflowActions = []
}: AssistantChatProps) => {
  const headers = useMemo<AssistantHeaders>(() => {
    if (getJwt) return () => ({ Authorization: `Bearer ${getJwt()}` });
    const { sdkKey } = initInfo();
    return () => {
      const headers: Record<string, string> = {
        Authorization: `Token ${sdkKey}`
      };
      const sessionJwt = getCookie('feathery_session_token');
      if (sessionJwt) headers['X-Feathery-Session'] = sessionJwt;
      return headers;
    };
  }, [getJwt]);
  // Builds the per-send body. Called from inside DefaultChatTransport.body
  // (Builder pattern) so getTargets re-runs each send and picks up route
  // changes without re-rendering AssistantChat.
  const buildChatBody = (): Record<string, unknown> => {
    const body: Record<string, unknown> = {};
    if (getJwt) {
      if (runId) body.run_id = runId;
    } else {
      const { userId } = initInfo();
      if (formId) body.form_key = formId;
      if (userId) body.fuser_key = userId;
    }

    let targets: ResourceRef[];
    if (getTargets) {
      targets = getTargets();
    } else {
      // Default fallback for surfaces that don't supply getTargets (mainly
      // hosted forms via @feathery/react's <Form>): derive panel + fuser
      // from local scope. Prefer the resolved panel UUID from the form
      // fetch response over the slug so agent endpoints can look it up.
      const { userId } = initInfo();
      const formState = _internalId ? internalState[_internalId] : undefined;
      const panelId = formState?.panelId;
      // Step is intentionally NOT pushed as a target. Targets feed the
      // cached system prompt's manifest; per-step churn there would bust
      // the system cache breakpoint. Current step is exposed via the
      // getPanelRuntime tool, which lives outside the cached prefix.
      targets = [];
      if (panelId || formId) {
        targets.push({ type: 'panel', id: panelId ?? (formId as string) });
      }
      if (userId) targets.push({ type: 'fuser', id: userId });
      if (runId) targets.push({ type: 'extraction_run', id: runId });
    }
    if (targets.length > 0) body.targets = targets;

    // Push live form state from the renderer (Builder-style frontend snapshot)
    // so the assistant sees what's filled, what's visible, and the current
    // step. Joins with getPanelSnapshot via servar.key + step.key.
    if (_internalId) {
      const panelRuntime = getPanelRuntimeSnapshot(_internalId);
      if (panelRuntime) body.panel_runtime = panelRuntime;
    }
    return body;
  };

  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [threads, setThreads] = useState<AssistantThreadDetail[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [actionTooltip, setActionTooltip] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const colors = useMemo(
    () => getChatColors(color || DEFAULT_CHAT_COLOR),
    [color]
  );

  // Server-emitted `data-changeop` parts land here. The component
  // derives `applying` below by inspecting the in-flight assistant
  // message's parts directly.
  const { handleDataPart, queueLen } = useApplyValueOps(_internalId);

  const makeChat = (
    threadId: string | null,
    initialMessages: any[] = []
  ): Chat<any> => {
    let resolvedThreadId = threadId;
    let titleGenerated = false;

    const chatTransport = new DefaultChatTransport({
      api: `${getAssistantUrl()}chat/`,
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
          getThreadDetail(headers, threadId).then((t) => {
            if (t)
              setThreads((prev) =>
                prev.map((thread) =>
                  thread.id === threadId ? { ...t, chat: chat } : thread
                )
              );
          });
        }
        if (!titleGenerated) {
          const titleMessage = chat.messages.find((m: any) => m.role === 'user')
            ?.parts?.[0]?.text;
          if (titleMessage) {
            const currentThreadId = resolvedThreadId || threadId || null;
            // Pass the same grounding context the chat uses so the title
            // can reflect the workflow (e.g. "Income verification step
            // question" instead of "Form question").
            const titleContext: {
              form_key?: string;
              run_id?: string;
              panel_runtime?: unknown;
            } = {};
            if (formId) titleContext.form_key = formId;
            if (runId) titleContext.run_id = runId;
            if (_internalId) {
              const snap = getPanelRuntimeSnapshot(_internalId);
              if (snap) titleContext.panel_runtime = snap;
            }
            generateThreadTitle(headers, currentThreadId, titleMessage, titleContext).then(
              (title) => {
                if (!title) return;
                titleGenerated = true;
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
              }
            );
          }
        }
        return res;
      }
    });

    const chat = new Chat<any>({
      transport: chatTransport,
      messages: initialMessages,
      onData: handleDataPart,
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

  const readyChat = useMemo(() => makeChat(null), [headers, formId, runId, getTargets, getJwt]);
  const activeThread = threads.find((t) => t.id === activeThreadId);
  const activeChat = activeThread?.chat ?? readyChat;

  // @ts-ignore
  const { messages, sendMessage, status, error } = useChat({
    chat: activeChat,
    onData: handleDataPart
  });

  // TODO: Implement smooth scroll takeover - stop auto-scroll when user scrolls up
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // When the agent finishes (status -> 'ready'), the actions bar may render
  // and the smooth scroll above can leave the last message behind it. Run a
  // final settling scroll once layout is stable.
  useEffect(() => {
    if (status !== 'ready') return;
    const id = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'end'
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [status]);

  const fetchThreads = useCallback(async () => {
    const data = await getThreadList(headers);
    if (!data) return;
    setThreads((prev) => [
      ...data.map((d) => ({
        ...d,
        chat: prev.find((p) => p.id === d.id)?.chat
      })),
      ...prev.filter((p) => !data.find((d) => d.id === p.id))
    ]);
  }, [headers]);

  useEffect(() => {
    if (isOpen) fetchThreads();
  }, [isOpen, fetchThreads]);

  const handleNewThread = () => {
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
    if (threads.find((t) => t.id === id)?.chat) {
      setActiveThreadId(id);
      setIsDropdownOpen(false);
      return;
    }
    const thread = await getThreadDetail(headers, id);
    if (!thread) return;
    const chat = makeChat(id, thread.messages ?? []);
    setThreads((prev) =>
      prev.map((t) => (t.id === id ? { ...thread, chat } : t))
    );
    setActiveThreadId(id);
    setIsDropdownOpen(false);
  };

  const handleDeleteThread = async (id: string, e: MouseEvent) => {
    e.stopPropagation();
    const thread = threads.find((t) => t.id === id);
    if (!thread?.isTemporary) {
      await deleteThread(headers, id);
    }
    setThreads((prev) => prev.filter((t) => t.id !== id));
    if (activeThreadId === id) handleNewThread();
  };

  const handleSend = () => {
    if (input.trim() && status === 'ready') {
      const now = new Date().toISOString();
      if (!activeThreadId) {
        // First send, register readyChat as a real thread entry
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
      } else {
        if (activeThread && !activeThread.title) {
          setThreads((prev) => [
            {
              ...activeThread,
              title: 'New Chat',
              updated_at: now
            },
            ...prev.filter((t) => t.id !== activeThreadId)
          ]);
        }
      }
      sendMessage({ text: input });
      setInput('');
    }
  };

  const handleWorkflowAction = (action: WorkflowAction) => {
    if (status !== 'ready') return;
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
    sendMessage({
      parts: [
        { type: 'text', text: action.name },
        {
          type: 'text',
          text: action.instructions,
          hidden: true,
          interpolate: true
        }
      ]
    } as any);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      handleSend();
    }
  };

  // Only show threads that have had at least one message sent
  const visibleThreads = threads.filter((t) => t.title);

  const streaming = status === 'submitted' || status === 'streaming';
  const lastMsg = messages[messages.length - 1] as { role?: string; parts?: any[] } | undefined;

  // Background tools whose only on-screen presence is the live "trailing
  // pill" at the bottom of the chat. Kept in sync with the BACKGROUND_TOOLS
  // set used by the message-rendering loop above.
  const BACKGROUND_TOOL_NAMES = new Set<string>([
    'getPanelRuntime',
    'getPanelSnapshot',
    'getFuserSnapshot',
    'getExtractionSnapshot',
    'getExtractionResults',
    'listFormExtractions',
    'listRunDocuments',
    'setFieldValue',
  ]);

  // Walk the in-flight assistant message's parts. The trailing pill shows
  // the *most recent* background tool that hasn't been closed off by a
  // following text part. setFieldValue is sticky across the whole fill
  // window so sequential writes don't flicker; intervening data-changeop
  // and step-start parts don't reset it.
  const liveParts: any[] = streaming && lastMsg?.role === 'assistant' && lastMsg?.parts
    ? lastMsg.parts
    : [];
  let trailingTool: string | null = null;
  for (const p of liveParts) {
    if (p?.type === 'text' && (p.text ?? '').trim().length > 0) {
      trailingTool = null;
      continue;
    }
    const isStatic = typeof p?.type === 'string' && p.type.startsWith('tool-');
    const isDynamic = p?.type === 'dynamic-tool';
    if (!isStatic && !isDynamic) continue;
    const name = isStatic ? p.type.replace('tool-', '') : (p.toolName as string) || 'unknown';
    if (BACKGROUND_TOOL_NAMES.has(name)) trailingTool = name;
    else trailingTool = null;
  }

  const showThinkingPlaceholder = streaming && (!lastMsg || lastMsg.role !== 'assistant' || (lastMsg.parts ?? []).length === 0);
  const livePillLabel: string | null = trailingTool
    ? TOOL_LABELS[trailingTool]?.running ?? 'Thinking...'
    : showThinkingPlaceholder
      ? 'Thinking...'
      : null;

  const applying = trailingTool === 'setFieldValue' || queueLen > 0;
  const isLoading = streaming || applying;
  const hasAssistantMessage =
    messages[messages.length - 1]?.role === 'assistant' &&
    (messages[messages.length - 1].parts as any[]).length > 0;

  // Collapsed state - show chat bubble
  if (!isOpen) {
    return (
      <button
        type='button'
        onClick={() => setIsOpen(true)}
        css={{
          position: 'fixed',
          bottom: `${bottom}px`,
          right: '20px',
          width: `${FAB_SIZE}px`,
          height: `${FAB_SIZE}px`,
          borderRadius: '50%',
          backgroundColor: colors.primary,
          color: 'white',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow:
            '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          transition: 'transform 0.2s, box-shadow 0.2s, background-color 0.2s',
          zIndex: 1000,
          ':hover': {
            backgroundColor: colors.hover,
            transform: 'scale(1.05)',
            boxShadow:
              '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
          }
        }}
      >
        <ChatIcon />
      </button>
    );
  }

  // Expanded state - show full chat panel
  return (
    <div
      css={{
        position: 'fixed',
        bottom: `${bottom}px`,
        right: '20px',
        width: `${PANEL_WIDTH}px`,
        height: `${PANEL_HEIGHT}px`,
        backgroundColor: 'white',
        borderRadius: '12px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
        border: `1px solid ${GRAY_200}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 1000
      }}
    >
      {/* Header */}
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          backgroundColor: colors.primary,
          color: 'white',
          position: 'relative'
        }}
      >
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            minWidth: 0,
            overflow: 'hidden'
          }}
        >
          <ChatIcon />
          <button
            type='button'
            onClick={() => setIsDropdownOpen((prev) => !prev)}
            css={{
              background: 'none',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '14px',
              padding: '0',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              minWidth: 0,
              ':hover': { opacity: 0.85 }
            }}
          >
            <span
              css={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {activeThread?.title || 'AI Assistant'}
            </span>
            <span css={{ fontSize: '10px', opacity: 0.8, flexShrink: 0 }}>
              ▾
            </span>
          </button>
        </div>
        <button
          type='button'
          onClick={() => setIsOpen(false)}
          css={{
            background: 'none',
            border: 'none',
            color: 'white',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '4px',
            ':hover': {
              backgroundColor: 'rgba(255, 255, 255, 0.1)'
            }
          }}
        >
          <MinimizeIcon />
        </button>

        {/* Thread dropdown */}
        {isDropdownOpen && (
          <>
            <div
              css={{ position: 'fixed', inset: 0, zIndex: 1000 }}
              onClick={() => setIsDropdownOpen(false)}
            />
            <div
              css={{
                position: 'absolute',
                top: '100%',
                left: 0,
                width: '100%',
                backgroundColor: 'white',
                border: `1px solid ${GRAY_200}`,
                borderTop: 'none',
                borderRadius: '0 0 8px 8px',
                boxShadow: '0 8px 16px rgba(0,0,0,0.12)',
                zIndex: 1001,
                maxHeight: '240px',
                // `scroll` (not `auto`) keeps the scrollbar's space
                // reserved on classic-scrollbar systems so deleting
                // threads doesn't reflow the row width and shift the
                // delete (×) button under the cursor. Rows still fill
                // to the scrollbar's inner edge, so the hover/active
                // highlight reaches the end. macOS overlay scrollbars
                // don't take layout space either way.
                overflowY: 'scroll'
              }}
            >
              <button
                type='button'
                onClick={() => {
                  handleNewThread();
                  setIsDropdownOpen(false);
                }}
                css={{
                  width: '100%',
                  padding: '10px 14px',
                  background: 'none',
                  border: 'none',
                  borderBottom: `1px solid ${GRAY_100}`,
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: colors.primary,
                  textAlign: 'left',
                  ':hover': { backgroundColor: GRAY_50 }
                }}
              >
                + New Chat
              </button>

              {visibleThreads.length === 0 && (
                <div
                  css={{
                    padding: '12px 14px',
                    fontSize: '13px',
                    color: GRAY_400
                  }}
                >
                  No chats yet
                </div>
              )}
              {visibleThreads.map((thread) => (
                <div
                  key={thread.id}
                  onClick={() => handleSelectThread(thread.id)}
                  css={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    cursor: 'pointer',
                    backgroundColor:
                      thread.id === activeThreadId ? colors.light : 'white',
                    ':hover': { backgroundColor: GRAY_50 }
                  }}
                >
                  <div css={{ flex: 1, minWidth: 0 }}>
                    <div
                      css={{
                        fontSize: '13px',
                        fontWeight: 500,
                        color: GRAY_800,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {thread.title || 'Untitled conversation'}
                    </div>
                    <div
                      css={{
                        fontSize: '11px',
                        color: GRAY_400,
                        marginTop: '2px'
                      }}
                    >
                      {new Date(thread.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    type='button'
                    onClick={(e) => handleDeleteThread(thread.id, e)}
                    css={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: GRAY_400,
                      fontSize: '16px',
                      padding: '2px 6px',
                      marginLeft: '8px',
                      borderRadius: '4px',
                      lineHeight: 1,
                      ':hover': {
                        color: '#dc2626',
                        backgroundColor: '#fef2f2'
                      }
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Messages */}
      <div
        css={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}
      >
        {messages.length === 0 && (
          <div
            css={{
              textAlign: 'center',
              color: GRAY_400,
              fontSize: '14px',
              marginTop: '40px'
            }}
          >
            Ask me anything about your documents
          </div>
        )}

        {messages.map((message) =>
          message.role === 'user' ? (
            // User message - single bubble
            <div
              key={message.id}
              css={{
                display: 'flex',
                justifyContent: 'flex-end'
              }}
            >
              <div
                css={{
                  maxWidth: '80%',
                  padding: '10px 14px',
                  borderRadius: '12px',
                  fontSize: '14px',
                  lineHeight: '1.5',
                  backgroundColor: colors.primary,
                  color: 'white',
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-word'
                }}
              >
                {message.parts
                  .filter((part: any) => !part.hidden)
                  .map((part: any, index: number) =>
                    part.type === 'text' ? (
                      <span key={index}>{part.text}</span>
                    ) : null
                  )}
              </div>
            </div>
          ) : (
            // Assistant message - we collapse all background-tool calls
            // into a single loading-style "thinking" indicator that lives
            // just before the next visible content (text or outcome tool).
            // This keeps the chat alive while the agent works without
            // leaving stale per-tool residue in history. Outcome-bearing
            // tools (searchDocs, searchWeb, extraction results) keep their
            // own pills so sources/citations stay attached.
            <Fragment key={message.id}>
              {(() => {
                const BACKGROUND_TOOLS = new Set([
                  'getPanelRuntime',
                  'getPanelSnapshot',
                  'getFuserSnapshot',
                  'getExtractionSnapshot',
                  'getExtractionResults',
                  'listFormExtractions',
                  'listRunDocuments',
                  'setFieldValue'
                ]);
                type Entry =
                  | { kind: 'text'; key: string; text: string }
                  | {
                      kind: 'outcome';
                      key: string;
                      toolName: string;
                      state: string;
                      input: any;
                      output: unknown;
                    };

                // Build text + outcome entries. Background-tool "thinking"
                // pills render as a single live pill at the bottom of the
                // chat (see below) - we don't bake one into each message
                // here, so old assistant messages don't leave a stale
                // "Filling in..." artifact in history.
                const entries: Entry[] = [];

                message.parts.forEach((part: any, index: number) => {
                  if (part.type === 'text' && part.text.trim()) {
                    // If the previous entry is also text (only background
                    // tools between them, which are invisible to the user),
                    // merge into one bubble so the agent's multi-step
                    // thinking doesn't read as two separate messages.
                    const prev = entries[entries.length - 1];
                    if (prev && prev.kind === 'text') {
                      prev.text = `${prev.text}\n\n${part.text}`;
                    } else {
                      entries.push({
                        kind: 'text',
                        key: `text-${index}`,
                        text: part.text
                      });
                    }
                    return;
                  }
                  const isStatic = part.type.startsWith('tool-');
                  const isDynamic = part.type === 'dynamic-tool';
                  if (!isStatic && !isDynamic) return;
                  const toolPart = part as Record<string, unknown>;
                  const toolName = isStatic
                    ? part.type.replace('tool-', '')
                    : (toolPart.toolName as string) || 'unknown';
                  if (BACKGROUND_TOOLS.has(toolName)) {
                    // Background tools don't get their own outcome pill.
                    // The single trailing live pill at the bottom of the
                    // chat shows the running label for the most recent
                    // background tool that wasn't followed by text.
                    return;
                  }
                  entries.push({
                    kind: 'outcome',
                    key: `tool-${index}`,
                    toolName,
                    state: toolPart.state as string,
                    input: toolPart.input,
                    output: toolPart.output
                  });
                });

                return entries.map((entry) => {
                  if (entry.kind === 'text') {
                    return (
                      <div
                        key={entry.key}
                        css={{
                          display: 'flex',
                          justifyContent: 'flex-start'
                        }}
                      >
                        <div
                          css={{
                            maxWidth: '80%',
                            padding: '10px 14px',
                            borderRadius: '12px',
                            fontSize: '14px',
                            lineHeight: '1.5',
                            backgroundColor: colors.light,
                            color: GRAY_800,
                            overflowWrap: 'anywhere',
                            wordBreak: 'break-word'
                          }}
                        >
                          <MarkdownText text={entry.text} />
                        </div>
                      </div>
                    );
                  }
                  // outcome
                  return (
                    <div
                      key={entry.key}
                      css={{
                        display: 'flex',
                        justifyContent: 'flex-start',
                        maxWidth: '80%',
                        minWidth: 0
                      }}
                    >
                      <ToolStatus
                        toolName={entry.toolName}
                        state={entry.state}
                        input={entry.input}
                        output={entry.output}
                        linkColor={colors.primary}
                      />
                    </div>
                  );
                });
              })()}
            </Fragment>
          )
        )}



        {livePillLabel && (
          <div css={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div
              css={{
                padding: '10px 14px',
                borderRadius: '12px',
                backgroundColor: colors.light,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <SpinnerIcon />
              <span css={{ fontSize: '14px', color: colors.primary }}>
                {livePillLabel}
              </span>
            </div>
          </div>
        )}

        {error && (
          <div
            css={{
              padding: '10px 14px',
              borderRadius: '8px',
              backgroundColor: '#fef2f2',
              color: '#dc2626',
              fontSize: '14px'
            }}
          >
            Something went wrong. Please try again.
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Workflow action buttons */}
      {workflowActions.length > 0 && (
        <div
          css={{
            position: 'relative',
            zIndex: 1,
            borderTop: `1px solid ${GRAY_200}`,
            backgroundColor: GRAY_50,
            padding: '8px 16px',
            display: 'flex',
            gap: '6px',
            overflowX: 'auto'
          }}
        >
          {workflowActions.map((action, index) => (
            <button
              key={index}
              type='button'
              disabled={isLoading}
              onClick={() => handleWorkflowAction(action)}
              onMouseEnter={(e: React.MouseEvent) => {
                if (!action.description) return;
                const r = e.currentTarget.getBoundingClientRect();
                setActionTooltip({
                  text: action.description,
                  x: r.left + r.width / 2,
                  y: r.top
                });
              }}
              onMouseLeave={() => setActionTooltip(null)}
              css={{
                flexShrink: 0,
                padding: '4px 10px',
                fontSize: '12px',
                border: `1px solid ${colors.primary}`,
                borderRadius: '12px',
                backgroundColor: 'white',
                color: colors.primary,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                ':disabled': { opacity: 0.5, cursor: 'not-allowed' },
                ':hover:not(:disabled)': { backgroundColor: colors.light },
                transition: 'background-color 0.15s, color 0.15s'
              }}
            >
              {action.name}
            </button>
          ))}
          {actionTooltip && (
            <div
              css={{
                position: 'fixed',
                top: actionTooltip.y - 34,
                left: actionTooltip.x,
                transform: 'translateX(-50%)',
                backgroundColor: 'rgba(0,0,0,0.9)',
                color: 'white',
                fontSize: '12px',
                padding: '4px 8px',
                borderRadius: '4px',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                zIndex: 10000
              }}
            >
              {actionTooltip.text}
            </div>
          )}
        </div>
      )}

      {/* Input */}
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 16px',
          borderTop: `1px solid ${GRAY_200}`,
          backgroundColor: GRAY_50
        }}
      >
        <input
          type='text'
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder='Type a message...'
          css={{
            flex: 1,
            padding: '10px 14px',
            border: `1px solid ${GRAY_200}`,
            borderRadius: '8px',
            fontSize: '14px',
            outline: 'none',
            transition: 'border-color 0.2s',
            ':focus': {
              borderColor: colors.primary
            }
          }}
        />
        <button
          type='button'
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
          css={{
            padding: '10px',
            backgroundColor: colors.primary,
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background-color 0.2s',
            ':hover:not(:disabled)': {
              backgroundColor: colors.hover
            },
            ':disabled': {
              backgroundColor: colors.disabled,
              cursor: 'not-allowed'
            }
          }}
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );
};

export default AssistantChat;
