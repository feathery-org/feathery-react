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
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls
} from 'ai';
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
import ToolStatus, {
  BACKGROUND_TOOL_NAMES,
  getLivePillState,
  readPartType
} from './ToolStatus';
import MarkdownText from './MarkdownText';
import {
  AssistantHeaders,
  AssistantThreadDetail,
  deleteThread,
  generateThreadTitle,
  getThreadDetail,
  getThreadList
} from './utils';
import { initInfo } from '../utils/init';
import { featheryWindow, getCookie } from '../utils/browser';
import {
  getCurrentStepKey,
  getPanelRuntimeSnapshot
} from './tools/panelRuntime';
import {
  applyServarValues,
  validateSetFieldValue,
  type ErrorType
} from './tools/setFieldValue';
import { dispatchClickElement } from './tools/clickElement';

const FAB_SIZE = 56;
const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 500;

type AssistantEntry =
  | { kind: 'text'; key: string; text: string }
  | {
      kind: 'outcome';
      key: string;
      toolName: string;
      state: string;
      input: any;
      output: unknown;
    };

const isRunningState = (s: string) =>
  s === 'input-streaming' || s === 'input-available';

const WEB_TOOL_NAMES = new Set(['searchWeb', 'scrapeUrl']);
const sameToolGroup = (a: string, b: string) =>
  a === b || (WEB_TOOL_NAMES.has(a) && WEB_TOOL_NAMES.has(b));

// Precedence ladder so the merged pill surfaces the worst outcome:
// any running > any error > all done.
const mergeStates = (a: string, b: string): string => {
  if (isRunningState(a) || isRunningState(b)) return 'input-available';
  if (a === 'output-error' || b === 'output-error') return 'output-error';
  return 'output-available';
};

const mergeToolOutputs = (a: unknown, b: unknown): unknown => {
  const aObj = a && typeof a === 'object' ? (a as Record<string, unknown>) : {};
  const bObj = b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
  const merged: Record<string, unknown> = { ...aObj, ...bObj };
  for (const k of ['web', 'news', 'images']) {
    const aArr = Array.isArray(aObj[k]) ? (aObj[k] as unknown[]) : [];
    const bArr = Array.isArray(bObj[k]) ? (bObj[k] as unknown[]) : [];
    if (aArr.length || bArr.length) merged[k] = [...aArr, ...bArr];
  }
  return merged;
};

const mergeToolInputs = (a: any, b: any): any => {
  const queries = [a?.query, b?.query].filter(
    (q): q is string => typeof q === 'string' && q.length > 0
  );
  const urls = [a?.url, b?.url].filter(
    (u): u is string => typeof u === 'string' && u.length > 0
  );
  return {
    ...a,
    ...b,
    ...(queries.length ? { query: queries.join(' • ') } : {}),
    ...(urls.length ? { url: urls.join(' • ') } : {})
  };
};

const mergeAssistantParts = (parts: any[]): AssistantEntry[] => {
  const entries: AssistantEntry[] = [];
  parts.forEach((part: any, index: number) => {
    if (part.type === 'text' && part.text.trim()) {
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
    const meta = readPartType(part);
    if (!meta || meta.kind !== 'tool' || !meta.toolName) return;
    if (BACKGROUND_TOOL_NAMES.has(meta.toolName)) return;
    const prev = entries[entries.length - 1];
    if (
      prev &&
      prev.kind === 'outcome' &&
      sameToolGroup(prev.toolName, meta.toolName)
    ) {
      prev.state = mergeStates(prev.state, part.state as string);
      prev.toolName = meta.toolName;
      prev.input = mergeToolInputs(prev.input, part.input);
      prev.output = mergeToolOutputs(prev.output, part.output);
      return;
    }
    entries.push({
      kind: 'outcome',
      key: `tool-${index}`,
      toolName: meta.toolName,
      state: part.state as string,
      input: part.input,
      output: part.output
    });
  });
  return entries;
};

export type ResourceRef = { type: string; id: string };

export type WorkflowAction = {
  name: string;
  description?: string;
  instructions: string;
};

export type AssistantChatProps = {
  instanceId?: string;
  baseUrl: string;
  getTargets: () => ResourceRef[];
  getJwt?: () => string;
  bottom?: number;
  color?: string;
  workflowActions?: WorkflowAction[];
};

const AssistantChat = ({
  instanceId,
  getTargets,
  getJwt,
  baseUrl,
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

  const buildChatBody = (): Record<string, unknown> => {
    const body: Record<string, unknown> = {};
    const targets = getTargets();
    if (targets.length > 0) body.targets = targets;

    if (instanceId) {
      const panelRuntime = getPanelRuntimeSnapshot(instanceId);
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
                  thread.id === threadId ? { ...t, chat: chat } : thread
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
        if (toolCall.dynamic) return;

        if (toolCall.toolName === 'setFieldValue') {
          type FieldResult =
            | { fieldKey: string; ok: true }
            | {
                fieldKey: string;
                ok: false;
                error: string;
                errorType: ErrorType | 'apply_failed';
              };
          const input = (toolCall.input ?? {}) as {
            fields?: Array<{ fieldKey?: unknown; value?: unknown }>;
          };
          const fields = Array.isArray(input.fields) ? input.fields : [];
          const snap = instanceId ? getPanelRuntimeSnapshot(instanceId) : null;
          const results: FieldResult[] = [];
          const toApply: Array<{ fieldKey: string; value: unknown }> = [];
          for (const item of fields) {
            const fieldKey =
              typeof item?.fieldKey === 'string' ? item.fieldKey : '';
            if (!fieldKey) {
              results.push({
                fieldKey,
                ok: false,
                errorType: 'shape_mismatch',
                error: 'fieldKey is required.'
              });
              continue;
            }
            const validation = validateSetFieldValue(
              fieldKey,
              item.value,
              snap
            );
            if (!validation.ok) {
              results.push({
                fieldKey,
                ok: false,
                error: validation.error,
                errorType: validation.errorType
              });
              continue;
            }
            toApply.push({ fieldKey, value: validation.value });
          }
          try {
            await applyServarValues(instanceId, toApply);
            for (const { fieldKey } of toApply) {
              results.push({ fieldKey, ok: true });
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            for (const { fieldKey } of toApply) {
              results.push({
                fieldKey,
                ok: false,
                errorType: 'apply_failed',
                error: message
              });
            }
          }
          chat.addToolOutput({
            tool: 'setFieldValue',
            toolCallId: toolCall.toolCallId,
            output: { results }
          });
        } else if (toolCall.toolName === 'clickElement') {
          const input = (toolCall.input ?? {}) as { elementId?: unknown };
          const elementId =
            typeof input.elementId === 'string' ? input.elementId : '';
          const output = await dispatchClickElement(instanceId, elementId);
          chat.addToolOutput({
            tool: 'clickElement',
            toolCallId: toolCall.toolCallId,
            output
          });
        }
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

  const readyChat = useMemo(
    () => makeChat(null),
    [headers, getTargets, getJwt]
  );
  const activeThread = threads.find((t) => t.id === activeThreadId);
  const activeChat = activeThread?.chat ?? readyChat;

  const { messages, sendMessage, status, error } = useChat({
    chat: activeChat
  });

  // TODO: Implement smooth scroll takeover - stop auto-scroll when user scrolls up
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (status !== 'ready') return;
    const id = featheryWindow().requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'end'
      });
    });
    return () => featheryWindow().cancelAnimationFrame(id);
  }, [status]);

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
    const thread = await getThreadDetail(baseUrl, headers, id);
    if (!thread) return;
    const chat = makeChat(id, thread.messages ?? [], thread.title);
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
      await deleteThread(baseUrl, headers, id);
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

  const { livePillLabel, isLoading } = getLivePillState(messages, status);

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
            How can I help?
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
            // Assistant message - separate blocks for each part
            <Fragment key={message.id}>
              {mergeAssistantParts(message.parts).map((entry) => {
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
                // Tool status - separate styled block
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
              })}
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
