import { useState, useEffect, useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { ChatIcon } from './icons';
import { DEFAULT_CHAT_COLOR, getChatColors } from './colors';
import useAutoScroll from './hooks/useAutoScroll';
import useAssistantLayout from './hooks/useAssistantLayout';
import { useChatRegistry } from './ChatRegistryProvider';
import ChatContent from './components/ChatContent';
import type {
  AssistantLayoutState,
  AssistantMode,
  WorkflowAction
} from './types';

const FAB_SIZE = 56;

const DEFAULT_MODES: AssistantMode[] = [
  'current',
  'sidebar-left',
  'sidebar-right',
  'fullscreen'
];

export type AssistantChatProps = {
  bottom?: number;
  color?: string;
  workflowActions?: WorkflowAction[];
  allowedModes?: AssistantMode[];
  onLayoutChange?: null | ((state: AssistantLayoutState) => void);
};

const AssistantChat = ({
  bottom = 20,
  color,
  workflowActions = [],
  allowedModes = DEFAULT_MODES,
  onLayoutChange
}: AssistantChatProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const {
    mode,
    setMode,
    handleResizePointerDown,
    handleResizeDoubleClick,
    layoutSide,
    panelGeometry,
    CollapseIcon,
    ModeTriggerIcon,
    fabSide,
    fabBottom
  } = useAssistantLayout({ isOpen, bottom, onLayoutChange });

  const {
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
  } = useChatRegistry();

  const colors = useMemo(
    () => getChatColors(color || DEFAULT_CHAT_COLOR),
    [color]
  );

  const {
    messages: rawMessages,
    sendMessage,
    status,
    error
  } = useChat({
    chat: activeChat
  });

  const messages = useMemo(() => {
    const combined: typeof rawMessages = [];
    for (const m of rawMessages) {
      const prev = combined[combined.length - 1] as any;
      if (
        prev &&
        prev.role === 'assistant' &&
        (m as any).role === 'assistant'
      ) {
        combined[combined.length - 1] = {
          ...prev,
          parts: [...(prev.parts ?? []), ...((m as any).parts ?? [])]
        } as any;
      } else {
        combined.push(m);
      }
    }
    return combined;
  }, [rawMessages]);

  const {
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    onScroll: handleMessagesScroll
  } = useAutoScroll(atBottomRef, messages, status);

  useEffect(() => {
    if (isOpen) fetchThreads();
  }, [isOpen, fetchThreads]);

  const handleSend = (text: string) => {
    if (status !== 'ready') return;
    atBottomRef.current = true;
    ensureThreadForSend();
    sendMessage({ text });
  };

  const handleWorkflowAction = (action: WorkflowAction) => {
    if (status !== 'ready') return;
    ensureThreadForSend();
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

  const isLoading = status === 'submitted' || status === 'streaming';

  if (!isOpen) {
    return (
      <button
        type='button'
        onClick={() => setIsOpen(true)}
        css={{
          position: 'fixed',
          bottom: `${fabBottom}px`,
          ...fabSide,
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

  return (
    <div
      css={{
        position: 'fixed',
        backgroundColor: 'white',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 1000,
        ...panelGeometry
      }}
    >
      {layoutSide && (
        <div
          role='separator'
          aria-orientation='vertical'
          aria-label='Resize assistant panel'
          title='Drag to resize, double-click to reset'
          onPointerDown={handleResizePointerDown(layoutSide)}
          onDoubleClick={handleResizeDoubleClick}
          css={{
            position: 'absolute',
            top: 0,
            [layoutSide === 'right' ? 'left' : 'right']: 0,
            width: '6px',
            height: '100%',
            cursor: 'col-resize',
            zIndex: 2,
            touchAction: 'none',
            userSelect: 'none',
            '::after': {
              content: '""',
              position: 'absolute',
              top: 0,
              [layoutSide === 'right' ? 'left' : 'right']: '2px',
              width: '2px',
              height: '100%',
              backgroundColor: 'transparent',
              transition: 'background-color 120ms ease'
            },
            ':hover::after': {
              backgroundColor: 'rgba(0, 0, 0, 0.15)'
            }
          }}
        />
      )}

      <ChatContent
        title={activeThread?.title || 'AI Assistant'}
        mode={mode}
        setMode={setMode}
        allowedModes={allowedModes}
        threads={threads}
        activeThreadId={activeThreadId}
        onNewThread={handleNewThread}
        onSelectThread={handleSelectThread}
        onDeleteThread={handleDeleteThread}
        onCollapse={() => setIsOpen(false)}
        layoutSide={layoutSide}
        CollapseIcon={CollapseIcon}
        ModeTriggerIcon={ModeTriggerIcon}
        messages={messages}
        status={status}
        isLoading={isLoading}
        error={error}
        messagesContainerRef={messagesContainerRef}
        messagesEndRef={messagesEndRef}
        onMessagesScroll={handleMessagesScroll}
        workflowActions={workflowActions}
        onWorkflowAction={handleWorkflowAction}
        canSend={status === 'ready'}
        onSend={handleSend}
        colors={colors}
      />
    </div>
  );
};

export default AssistantChat;
