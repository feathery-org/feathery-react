import { KeyboardEvent, useState } from 'react';

import {
  CloseIcon,
  MicIcon,
  SendIcon,
  SpeakerIcon,
  SpinnerIcon,
  StopIcon,
  WaveformIcon
} from '../icons';
import { ChatColors, GRAY_50, GRAY_200, GRAY_800 } from '../colors';
import type { VoiceState } from '../voice/VoiceSession';

type ChatInputBarProps = {
  voiceActive: boolean;
  voiceState: VoiceState;
  isLoading: boolean;
  canSend: boolean;
  micAvailable: boolean;
  onSend: (text: string) => void;
  onStartVoice: () => void;
  onStopVoice: () => void;
  onPillTap: () => void;
  onStopGenerating: () => void;
  colors: ChatColors;
};

function ChatInputBar({
  voiceActive,
  voiceState,
  isLoading,
  canSend,
  micAvailable,
  onSend,
  onStartVoice,
  onStopVoice,
  onPillTap,
  onStopGenerating,
  colors
}: ChatInputBarProps) {
  const [input, setInput] = useState('');

  const submit = () => {
    if (!input.trim() || !canSend) return;
    onSend(input);
    setInput('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      submit();
    }
  };

  const stopGenerating = () => {
    try {
      onStopGenerating();
    } catch {
      /* noop */
    }
  };

  return (
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
      {voiceActive ? (
        <>
          <button
            type='button'
            onClick={onPillTap}
            disabled={voiceState !== 'speaking'}
            title={voiceState === 'speaking' ? 'Tap to skip' : undefined}
            css={{
              flex: 1,
              padding: '10px 14px',
              border: `1px solid ${colors.primary}`,
              borderRadius: '8px',
              fontSize: '14px',
              backgroundColor: 'white',
              color: colors.primary,
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              cursor: voiceState === 'speaking' ? 'pointer' : 'default'
            }}
          >
            {voiceState === 'starting' ||
            voiceState === 'thinking' ||
            voiceState === 'transcribing' ? (
              <SpinnerIcon />
            ) : voiceState === 'speaking' ? (
              <SpeakerIcon />
            ) : (
              <WaveformIcon />
            )}
            <span>
              {voiceState === 'starting' && 'Starting…'}
              {(voiceState === 'listening' || voiceState === 'recording') &&
                'Listening…'}
              {(voiceState === 'transcribing' || voiceState === 'thinking') &&
                'One moment…'}
              {voiceState === 'speaking' && 'Speaking - tap to skip'}
              {voiceState === 'error' && 'Voice unavailable'}
            </span>
          </button>
          <button
            type='button'
            onClick={onStopVoice}
            title='End voice'
            css={{
              padding: '10px',
              backgroundColor: 'white',
              color: GRAY_800,
              border: `1px solid ${GRAY_200}`,
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              ':hover': { backgroundColor: GRAY_50 }
            }}
          >
            <CloseIcon />
          </button>
        </>
      ) : (
        <>
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
          {isLoading ? (
            <button
              type='button'
              onClick={stopGenerating}
              title='Stop generating'
              css={{
                width: '40px',
                height: '40px',
                boxSizing: 'border-box',
                backgroundColor: 'white',
                color: GRAY_800,
                border: `1px solid ${GRAY_200}`,
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                ':hover': { backgroundColor: GRAY_50 }
              }}
            >
              <StopIcon />
            </button>
          ) : input.trim() ? (
            <button
              type='button'
              onClick={submit}
              disabled={!input.trim()}
              css={{
                width: '40px',
                height: '40px',
                boxSizing: 'border-box',
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
          ) : (
            <button
              type='button'
              onClick={onStartVoice}
              disabled={!micAvailable}
              title={micAvailable ? 'Voice' : 'Microphone unavailable'}
              css={{
                width: '40px',
                height: '40px',
                boxSizing: 'border-box',
                backgroundColor: colors.primary,
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                ':hover:not(:disabled)': { backgroundColor: colors.hover },
                ':disabled': {
                  backgroundColor: colors.disabled,
                  cursor: 'not-allowed'
                }
              }}
            >
              <MicIcon />
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default ChatInputBar;
