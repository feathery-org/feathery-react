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

const FAB_SIZE = 56;
const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 500;

export interface Transport {
  url: string;
  headers: Record<string, string> | (() => Record<string, string>);
  body: Record<string, unknown>;
}

export interface AssistantChatProps {
  transport: Transport;
  bottom?: number;
  color?: string;
}

interface ChatThreadSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_preview: string;
}

interface ChatThreadDetail extends ChatThreadSummary {
  messages: { id: string; role: string; parts: unknown[] }[];
}

const AssistantChat = ({
  transport,
  bottom = 20,
  color
}: AssistantChatProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  
  const prevTransportRef = useRef(transport);
  const chatInstancesRef = useRef<Record<string, Chat<any>>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  if (prevTransportRef.current !== transport) {
    prevTransportRef.current = transport;
    chatInstancesRef.current = {};
  }

  const colors = useMemo(
    () => getChatColors(color || DEFAULT_CHAT_COLOR),
    [color]
  );

  const chatUrl = `${transport.url}chat/`;
  const threadsUrl = `${transport.url}threads/`;

  const resolveHeaders = (
    headers: Record<string, string> | (() => Record<string, string>)
  ): Record<string, string> =>
    typeof headers === 'function' ? headers() : headers;

  // Create a Chat instance for a thread. Each instance has its own save closure.
  const makeChat = (
    threadId: string | null,
    initialMessages: any[] = []
  ): Chat<any> => {
    let resolvedThreadId = threadId; // may be updated to real ID after first request
    let chatSelf: Chat<any> | undefined;

    const chatTransport = new DefaultChatTransport({
      api: chatUrl,
      headers: transport.headers,
      body: () => ({ ...transport.body, thread_id: resolvedThreadId }),
      fetch: async (url: any, init?: any) => {
        const res = await fetch(url, init);
        const headerId = res.headers.get('X-Thread-Id');
        if (headerId && !resolvedThreadId) {
          // Backend created a new thread — remap this Chat to its real ID
          resolvedThreadId = headerId;
          if (chatSelf) {
            chatInstancesRef.current[headerId] = chatSelf;
            delete chatInstancesRef.current[''];
          }
          setActiveThreadId(headerId);
          // Fetch the thread summary to add to the list
          fetch(`${threadsUrl}${headerId}/`, {
            headers: resolveHeaders(transport.headers)
          })
            .then((r) => r.json())
            .then((t: ChatThreadDetail) => {
              setThreads((prev) => [
                {
                  id: t.id,
                  title: t.title,
                  created_at: t.created_at,
                  updated_at: t.updated_at,
                  message_preview: ''
                },
                ...prev
              ]);
            });
        }
        return res;
      }
    });

    chatSelf = new Chat<any>({
      transport: chatTransport,
      messages: initialMessages,
      onFinish: ({ isAbort, isError }: any) => {
        if (isAbort || isError || !resolvedThreadId) return;
        // Backend saves the assistant message via workspace JWT callback — just update UI
        setThreads((prev) =>
          prev.map((t) =>
            t.id === resolvedThreadId
              ? { ...t, updated_at: new Date().toISOString() }
              : t
          )
        );
      }
    });

    return chatSelf;
  };

  // Get or lazily create the Chat for the active thread
  const getOrCreateChat = (threadId: string): Chat<any> => {
    if (!chatInstancesRef.current[threadId]) {
      chatInstancesRef.current[threadId] = makeChat(threadId);
    }
    return chatInstancesRef.current[threadId];
  };

  const activeChat = getOrCreateChat(activeThreadId);

  // @ts-ignore
  const { messages, sendMessage, status, error } = useChat({ chat: activeChat });

  // TODO: Implement smooth scroll takeover - stop auto-scroll when user scrolls up
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchThreads = useCallback(async () => {
    const res = await fetch(threadsUrl, {
      headers: resolveHeaders(transport.headers)
    });
    if (!res.ok) return;
    const data: ChatThreadSummary[] = await res.json();
    setThreads(data);
  }, [threadsUrl, transport.headers]);

  // Fetch threads when panel first opens
  useEffect(() => {
    if (isOpen) fetchThreads();
  }, [isOpen]);

  const handleSelectThread = useCallback(
    async (id: string) => {
      // If already loaded, just switch
      if (chatInstancesRef.current[id]) {
        setActiveThreadId(id);
        setIsDropdownOpen(false);
        return;
      }
      const res = await fetch(`${threadsUrl}${id}/`, {
        headers: resolveHeaders(transport.headers)
      });
      if (!res.ok) return;
      const thread: ChatThreadDetail = await res.json();
      const restoredMessages = thread.messages.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        parts: m.parts
      }));
      chatInstancesRef.current[id] = makeChat(id, restoredMessages);
      setActiveThreadId(id);
      setIsDropdownOpen(false);
    },
    [threadsUrl, transport.headers]
  );

  const handleNewThread = useCallback(() => {
    // Clear any existing unsaved chat so a fresh one is created
    delete chatInstancesRef.current[''];
    setActiveThreadId('');
    setIsDropdownOpen(false);
  }, []);

  const handleDeleteThread = useCallback(
    async (id: string, e: MouseEvent) => {
      e.stopPropagation();
      await fetch(`${threadsUrl}${id}/`, {
        method: 'DELETE',
        headers: resolveHeaders(transport.headers)
      });
      delete chatInstancesRef.current[id];
      setThreads((prev) => prev.filter((t) => t.id !== id));
      if (activeThreadId === id) {
        delete chatInstancesRef.current[''];
        setActiveThreadId('');
      }
    },
    [threadsUrl, transport.headers, activeThreadId]
  );

  const handleSend = () => {
    if (input.trim() && status === 'ready') {
      sendMessage({ text: input });
      setInput('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      handleSend();
    }
  };

  const isLoading = status === 'submitted' || status === 'streaming';
  const activeThread = threads.find((t) => t.id === activeThreadId);
  const headerTitle = activeThread?.title || 'AI Assistant';

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
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
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
        <div css={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
              ':hover': { opacity: 0.85 }
            }}
          >
            {headerTitle}
            <span css={{ fontSize: '10px', opacity: 0.8 }}>▾</span>
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
            {/* Overlay to close dropdown on outside click */}
            <div
              css={{
                position: 'fixed',
                inset: 0,
                zIndex: 1000
              }}
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
              {/* New Thread button */}
              <button
                type='button'
                onClick={handleNewThread}
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
                + New Thread
              </button>

              {/* Thread list */}
              {threads.length === 0 && (
                <div
                  css={{
                    padding: '12px 14px',
                    fontSize: '13px',
                    color: GRAY_400
                  }}
                >
                  No threads yet
                </div>
              )}
              {threads.map((thread) => (
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
                    <div css={{ fontSize: '11px', color: GRAY_400, marginTop: '2px' }}>
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
                      ':hover': { color: '#dc2626', backgroundColor: '#fef2f2' }
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
                {message.parts.map((part: any, index: number) =>
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

        {status === 'submitted' && (
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
