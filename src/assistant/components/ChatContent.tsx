import { ComponentType, MouseEvent, RefObject } from 'react';

import ChatHeader from './ChatHeader';
import MessageList from './MessageList';
import WorkflowActionBar from './WorkflowActionBar';
import ChatInputBar from './ChatInputBar';
import { ChatColors } from '../colors';
import type { AssistantMode, WorkflowAction } from '../types';
import type { AssistantThreadDetail } from '../utils';

type ChatContentProps = {
  title: string;
  mode: AssistantMode;
  setMode: (mode: AssistantMode) => void;
  allowedModes: AssistantMode[];
  threads: AssistantThreadDetail[];
  activeThreadId: string | null;
  onNewThread: () => void;
  onSelectThread: (id: string) => Promise<void> | void;
  onDeleteThread: (id: string, e: MouseEvent) => void;
  onCollapse: () => void;
  layoutSide: 'left' | 'right' | null;
  CollapseIcon: ComponentType;
  ModeTriggerIcon: ComponentType;
  messages: any[];
  status: any;
  isLoading: boolean;
  error: any;
  messagesContainerRef: RefObject<HTMLDivElement>;
  messagesEndRef: RefObject<HTMLDivElement>;
  onMessagesScroll: () => void;
  workflowActions: WorkflowAction[];
  onWorkflowAction: (action: WorkflowAction) => void;
  canSend: boolean;
  onSend: (text: string) => void;
  colors: ChatColors;
};

const ChatContent = ({
  title,
  mode,
  setMode,
  allowedModes,
  threads,
  activeThreadId,
  onNewThread,
  onSelectThread,
  onDeleteThread,
  onCollapse,
  layoutSide,
  CollapseIcon,
  ModeTriggerIcon,
  messages,
  status,
  isLoading,
  error,
  messagesContainerRef,
  messagesEndRef,
  onMessagesScroll,
  workflowActions,
  onWorkflowAction,
  canSend,
  onSend,
  colors
}: ChatContentProps) => (
  <>
    <ChatHeader
      title={title}
      mode={mode}
      setMode={setMode}
      allowedModes={allowedModes}
      threads={threads}
      activeThreadId={activeThreadId}
      onNewThread={onNewThread}
      onSelectThread={onSelectThread}
      onDeleteThread={onDeleteThread}
      onCollapse={onCollapse}
      layoutSide={layoutSide}
      CollapseIcon={CollapseIcon}
      ModeTriggerIcon={ModeTriggerIcon}
      colors={colors}
    />

    <MessageList
      messages={messages}
      status={status}
      isLoading={isLoading}
      error={error}
      colors={colors}
      containerRef={messagesContainerRef}
      endRef={messagesEndRef}
      onScroll={onMessagesScroll}
    />

    <WorkflowActionBar
      actions={workflowActions}
      disabled={isLoading}
      onAction={onWorkflowAction}
      colors={colors}
    />

    <ChatInputBar
      isLoading={isLoading}
      canSend={canSend}
      onSend={onSend}
      colors={colors}
    />
  </>
);

export default ChatContent;
