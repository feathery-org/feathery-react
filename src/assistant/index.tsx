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
import ToolStatus from './ToolStatus';
import MarkdownText from './MarkdownText';
import {
  AssistantThreadDetail,
  AssistantTransport,
  deleteThread,
  generateThreadTitle,
  getThreadDetail,
  getThreadList
} from './utils';

const FAB_SIZE = 56;
const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 500;

export type WorkflowAction = {
  name: string;
  description?: string;
  instructions: string;
};

export type AssistantChatProps = {
  transport: AssistantTransport;
  bottom?: number;
  color?: string;
  workflowActions?: WorkflowAction[];
};

const AssistantChat = ({
  transport,
  bottom = 20,
  color,
  workflowActions = []
}: AssistantChatProps) => {
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
    initialMessages: any[] = []
  ): Chat<any> => {
    let resolvedThreadId = threadId;

    const chatTransport = new DefaultChatTransport({
      api: `${transport.url}chat/`,
      headers: transport.headers,
      body: () => ({ ...transport.body, thread_id: resolvedThreadId || null }),
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
          const titleMessage = chat.messages.find((m: any) => m.role === 'user')
            ?.parts?.[0]?.text;
          if (titleMessage) {
            generateThreadTitle(transport, threadId, titleMessage).then(
              (title) => {
                if (title)
                  setThreads((prev) =>
                    prev.map((t) => (t.id === threadId ? { ...t, title } : t))
                  );
              }
            );
          }
          getThreadDetail(transport, threadId).then((t) => {
            if (t)
              setThreads((prev) =>
                prev.map((thread) =>
                  thread.id === threadId ? { ...t, chat: chat } : thread
                )
              );
          });
        }
        return res;
      }
    });

    const chat = new Chat<any>({
      transport: chatTransport,
      messages: initialMessages,
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

  const readyChat = useMemo(() => makeChat(null), [transport]);
  const activeThread = threads.find((t) => t.id === activeThreadId);
  const activeChat = activeThread?.chat ?? readyChat;

  // @ts-ignore
  const { messages, sendMessage, status, error } = useChat({
    chat: activeChat
  });

  // TODO: Implement smooth scroll takeover - stop auto-scroll when user scrolls up
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchThreads = useCallback(async () => {
    const data = await getThreadList(transport);
    if (!data) return;
    setThreads((prev) => [
      ...data.map((d) => ({
        ...d,
        chat: prev.find((p) => p.id === d.id)?.chat
      })),
      ...prev.filter((p) => !data.find((d) => d.id === p.id))
    ]);
  }, [transport]);

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
    const thread = await getThreadDetail(transport, id);
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
      await deleteThread(transport, id);
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
          title: action.name,
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
        { ...activeThread, title: action.name, updated_at: now },
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

  const isLoading = status === 'submitted' || status === 'streaming';
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
                overflowY: 'auto'
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
                  color: 'white'
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
              {message.parts.map((part: any, index: number) => {
                if (part.type === 'text' && part.text.trim()) {
                  return (
                    <div
                      key={index}
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
                          color: GRAY_800
                        }}
                      >
                        <MarkdownText text={part.text} />
                      </div>
                    </div>
                  );
                }
                // Tool status - separate styled block
                if (part.type.startsWith('tool-')) {
                  const toolName = part.type.replace('tool-', '');
                  const toolPart = part as Record<string, unknown>;
                  return (
                    <div
                      key={index}
                      css={{
                        display: 'flex',
                        justifyContent: 'flex-start'
                      }}
                    >
                      <ToolStatus
                        toolName={toolName}
                        state={toolPart.state as string}
                        input={toolPart.input as { query?: string }}
                        output={toolPart.output}
                        linkColor={colors.primary}
                      />
                    </div>
                  );
                }
                return null;
              })}
            </Fragment>
          )
        )}

        {isLoading && !hasAssistantMessage && (
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
                Thinking...
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
