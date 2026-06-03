import { Fragment, RefObject } from 'react';

import { ChatColors, GRAY_400, GRAY_800 } from '../colors';
import { ToolChunk, ToolChunkPlaceholder } from './ToolStatus';
import MarkdownText from './MarkdownText';
import { mergeAssistantParts } from '../utils';

type MessageListProps = {
  messages: any[];
  status: string;
  isLoading: boolean;
  error: unknown;
  colors: ChatColors;
  containerRef: RefObject<HTMLDivElement>;
  endRef: RefObject<HTMLDivElement>;
  onScroll: () => void;
};

const MessageList = ({
  messages,
  status,
  isLoading,
  error,
  colors,
  containerRef,
  endRef,
  onScroll
}: MessageListProps) => (
  <div
    ref={containerRef}
    onScroll={onScroll}
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

    {messages.map((message, mIdx) =>
      message.role === 'user' ? (
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
        <Fragment key={message.id}>
          {(() => {
            const isLastMsg = mIdx === messages.length - 1;
            const chunks = mergeAssistantParts(message.parts);
            const lastPart = message.parts[message.parts.length - 1];
            const turnFinished =
              !isLastMsg || (status === 'ready' && lastPart?.type === 'text');
            return chunks.map((chunk, chunkIdx) => {
              if (chunk.kind === 'text') {
                return (
                  <div
                    key={chunk.key}
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
                      <MarkdownText
                        text={chunk.text}
                        isStreaming={
                          isLoading &&
                          isLastMsg &&
                          chunkIdx === chunks.length - 1
                        }
                      />
                    </div>
                  </div>
                );
              }
              const followedByText = chunks
                .slice(chunkIdx + 1)
                .some((c) => c.kind === 'text');
              return (
                <div
                  key={chunk.key}
                  css={{
                    display: 'flex',
                    justifyContent: 'flex-start',
                    maxWidth: '80%',
                    minWidth: 0
                  }}
                >
                  <ToolChunk
                    rows={chunk.rows}
                    turnFinished={turnFinished}
                    followedByText={followedByText}
                    linkColor={colors.primary}
                    isFirstChunk={chunkIdx === 0}
                  />
                </div>
              );
            });
          })()}
        </Fragment>
      )
    )}

    {(() => {
      if (!isLoading) return null;
      const last = messages[messages.length - 1] as
        | { role?: string; parts?: any[] }
        | undefined;
      if (!last) return null;
      if (last.role !== 'user') {
        const parts = last.parts || [];
        const hasContent = parts.some((p: any) => {
          if (p?.type === 'text') return (p.text ?? '').trim().length > 0;
          const t = typeof p?.type === 'string' ? p.type : '';
          return t.startsWith('tool-') || t === 'dynamic-tool';
        });
        if (hasContent) return null;
      }
      return <ToolChunkPlaceholder />;
    })()}

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

    <div ref={endRef} />
  </div>
);

export default MessageList;
