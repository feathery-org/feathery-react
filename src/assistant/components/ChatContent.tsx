import { ComponentType, MouseEvent, RefObject } from 'react';

import ChatHeader from './ChatHeader';
import MessageList from './MessageList';
import WorkflowActionBar from './WorkflowActionBar';
import ChatInputBar from './ChatInputBar';
import { ChatColors } from '../colors';
import type { AssistantMode, WorkflowAction } from '../types';
import type { AssistantThreadDetail } from '../utils';
import type { VoiceState } from '../voice/VoiceSession';

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
  voiceActive: boolean;
  voiceState: VoiceState;
  voiceStateByMsg: Record<string, any>;
  micAvailable: boolean;
  onStartVoice: () => void;
  onStopVoice: () => void;
  onPillTap: () => void;
  onStopGenerating: () => void;
  colors: ChatColors;
};

function ChatContent({
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
  voiceActive,
  voiceState,
  voiceStateByMsg,
  micAvailable,
  onStartVoice,
  onStopVoice,
  onPillTap,
  onStopGenerating,
  colors
}: ChatContentProps) {
  return (
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
        voiceActive={voiceActive}
        voiceState={voiceState}
        voiceStateByMsg={voiceStateByMsg}
      />

      <WorkflowActionBar
        actions={workflowActions}
        disabled={isLoading}
        onAction={onWorkflowAction}
        colors={colors}
      />

      <ChatInputBar
        voiceActive={voiceActive}
        voiceState={voiceState}
        isLoading={isLoading}
        canSend={canSend}
        micAvailable={micAvailable}
        onSend={onSend}
        onStartVoice={onStartVoice}
        onStopVoice={onStopVoice}
        onPillTap={onPillTap}
        onStopGenerating={onStopGenerating}
        colors={colors}
      />
    </>
  );
}

export default ChatContent;
