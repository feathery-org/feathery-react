import { ComponentType, MouseEvent, useState } from 'react';

import {
  ChatIcon,
  ChevronDownIcon,
  FloatingIcon,
  FullscreenIcon,
  SidebarLeftIcon,
  SidebarRightIcon
} from '../icons';
import {
  ChatColors,
  GRAY_50,
  GRAY_100,
  GRAY_200,
  GRAY_400,
  GRAY_800
} from '../colors';
import type { AssistantMode } from '../types';
import type { AssistantThreadDetail } from '../utils';

const MODE_OPTIONS: Array<{
  value: AssistantMode;
  label: string;
  Icon: typeof FloatingIcon;
}> = [
  { value: 'current', label: 'Floating', Icon: FloatingIcon },
  { value: 'sidebar-left', label: 'Sidebar left', Icon: SidebarLeftIcon },
  { value: 'sidebar-right', label: 'Sidebar right', Icon: SidebarRightIcon },
  { value: 'fullscreen', label: 'Fullscreen', Icon: FullscreenIcon }
];

type ChatHeaderProps = {
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
  colors: ChatColors;
};

const ChatHeader = ({
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
  colors
}: ChatHeaderProps) => {
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const visibleThreads = threads.filter((t) => t.title);

  return (
    <div
      css={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '2px',
        padding: '12px 16px',
        backgroundColor: colors.primary,
        color: 'white',
        position: 'relative',
        ...(layoutSide
          ? {
              minHeight: 'var(--main-nav-height, 55px)',
              boxSizing: 'border-box'
            }
          : {})
      }}
    >
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          minWidth: 0,
          flex: 1,
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
            padding: '4px',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            minWidth: 0,
            maxWidth: '100%',
            ':hover': { backgroundColor: 'rgba(255, 255, 255, 0.1)' }
          }}
        >
          <span
            css={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0
            }}
          >
            {title}
          </span>
          <span css={{ display: 'flex', opacity: 0.8, flexShrink: 0 }}>
            <ChevronDownIcon />
          </span>
        </button>
      </div>
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          position: 'relative',
          flexShrink: 0
        }}
      >
        <button
          type='button'
          onClick={() => setIsModeMenuOpen((prev) => !prev)}
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
            ':hover': { backgroundColor: 'rgba(255, 255, 255, 0.1)' }
          }}
        >
          <ModeTriggerIcon />
        </button>
        <button
          type='button'
          onClick={onCollapse}
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
            ':hover': { backgroundColor: 'rgba(255, 255, 255, 0.1)' }
          }}
        >
          <CollapseIcon />
        </button>
        {isModeMenuOpen && (
          <>
            <div
              css={{ position: 'fixed', inset: 0, zIndex: 1000 }}
              onClick={() => setIsModeMenuOpen(false)}
            />
            <div
              css={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '4px',
                minWidth: '180px',
                backgroundColor: 'white',
                border: `1px solid ${GRAY_200}`,
                borderRadius: '8px',
                boxShadow: '0 8px 16px rgba(0,0,0,0.12)',
                zIndex: 1001,
                overflow: 'hidden'
              }}
            >
              {MODE_OPTIONS.filter(({ value }) =>
                allowedModes.includes(value)
              ).map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type='button'
                  onClick={() => {
                    setMode(value);
                    setIsModeMenuOpen(false);
                  }}
                  css={{
                    width: '100%',
                    padding: '10px 14px',
                    background: value === mode ? colors.light : 'white',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '13px',
                    color: GRAY_800,
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    ':hover': { backgroundColor: GRAY_50 }
                  }}
                >
                  <span
                    css={{
                      display: 'flex',
                      color: GRAY_400,
                      flexShrink: 0
                    }}
                  >
                    <Icon />
                  </span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

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
                onNewThread();
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
                onClick={async () => {
                  await onSelectThread(thread.id);
                  setIsDropdownOpen(false);
                }}
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
                  onClick={(e) => onDeleteThread(thread.id, e)}
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
  );
};

export default ChatHeader;
