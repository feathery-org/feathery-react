import {
  Fragment,
  useState,
  useRef,
  useEffect,
  KeyboardEvent,
  useMemo
} from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { ChatIcon, MinimizeIcon, SendIcon, SpinnerIcon } from './icons';
import { initInfo } from '../../../utils/init';
import { API_URL } from '../../../utils/featheryClient';
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

export interface AssistantChatProps {
  formId: string;
  bottom?: number;
  color?: string;
}

const AssistantChat = ({ formId, bottom = 20, color }: AssistantChatProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Compute color variants from primary color
  const colors = useMemo(
    () => getChatColors(color || DEFAULT_CHAT_COLOR),
    [color]
  );

  const { sdkKey, userId } = initInfo();

  // Memoize transport to avoid recreating on every render
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${API_URL}ai/assistant/chat/`,
        headers: {
          Authorization: `Token ${sdkKey}`
        },
        body: {
          fuser_key: userId,
          form_id: formId
        }
      }),
    [sdkKey, userId, formId]
  );

  // @ts-ignore
  const { messages, sendMessage, status, error } = useChat({ transport });

  // TODO: Implement smooth scroll takeover - stop auto-scroll when user scrolls up
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
          color: 'white'
        }}
      >
        <div css={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ChatIcon />
          <span css={{ fontWeight: 600, fontSize: '14px' }}>AI Assistant</span>
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
                {message.parts.map((part, index) =>
                  part.type === 'text' ? (
                    <span key={index}>{part.text}</span>
                  ) : null
                )}
              </div>
            </div>
          ) : (
            // Assistant message - separate blocks for each part
            <Fragment key={message.id}>
              {message.parts.map((part, index) => {
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
          disabled={isLoading}
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
            },
            ':disabled': {
              backgroundColor: GRAY_100,
              cursor: 'not-allowed'
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
