import { KeyboardEvent, useState } from 'react';

import { SendIcon } from '../icons';
import { ChatColors, GRAY_50, GRAY_200 } from '../colors';

type ChatInputBarProps = {
  isLoading: boolean;
  canSend: boolean;
  onSend: (text: string) => void;
  colors: ChatColors;
};

const ChatInputBar = ({
  isLoading,
  canSend,
  onSend,
  colors
}: ChatInputBarProps) => {
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
        onClick={submit}
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
  );
};

export default ChatInputBar;
