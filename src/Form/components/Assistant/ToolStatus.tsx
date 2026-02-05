import { useState } from 'react';
import { CheckIcon, LinkIcon, MinimizeIcon, SpinnerIcon } from './icons';
import { DEFAULT_CHAT_COLOR } from './colors';

// Tool status labels mapping
const TOOL_LABELS: Record<string, { running: string; done: string }> = {
  search_documents: {
    running: 'Searching documents...',
    done: 'Documents searched'
  },
  search_web: { running: 'Searching the web...', done: 'Web searched' }
};

// Format URL for display (show domain + truncated path)
const formatUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const path =
      parsed.pathname.length > 25
        ? parsed.pathname.substring(0, 25) + '...'
        : parsed.pathname;
    return parsed.hostname + (path !== '/' ? path : '');
  } catch {
    return url.length > 40 ? url.substring(0, 40) + '...' : url;
  }
};

// Extract URLs from various possible output structures
const extractUrls = (output: unknown): string[] => {
  if (!output || typeof output !== 'object') return [];

  const out = output as Record<string, unknown>;
  const urls: string[] = [];

  const extractFromArray = (arr: unknown[]): string[] => {
    return arr
      .map((r: unknown) => {
        if (typeof r === 'object' && r !== null) {
          const item = r as Record<string, unknown>;
          return (item.url as string) || '';
        }
        return '';
      })
      .filter(Boolean);
  };

  if (Array.isArray(out.web)) {
    urls.push(...extractFromArray(out.web));
  }
  if (Array.isArray(out.news)) {
    urls.push(...extractFromArray(out.news));
  }
  if (Array.isArray(out.images)) {
    urls.push(...extractFromArray(out.images));
  }

  if (urls.length > 0) {
    return urls;
  }

  if (Array.isArray(output)) {
    return extractFromArray(output);
  }

  return [];
};

interface ToolStatusProps {
  toolName: string;
  state: string;
  input?: { query?: string };
  output?: unknown;
  linkColor?: string;
}

// Tool status component - shows running/done state for tool calls
const ToolStatus = ({
  toolName,
  state,
  input,
  output,
  linkColor = DEFAULT_CHAT_COLOR
}: ToolStatusProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const labels = TOOL_LABELS[toolName] || {
    running: 'Processing...',
    done: 'Done'
  };
  const isRunning = state === 'input-streaming' || state === 'input-available';
  const query = input?.query;

  const urls = extractUrls(output);
  const hasLinks = urls.length > 0;

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '8px 12px',
        backgroundColor: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        fontSize: '13px'
      }}
    >
      {/* Status row */}
      <div
        role={hasLinks ? 'button' : undefined}
        tabIndex={hasLinks ? 0 : undefined}
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          color: '#6b7280',
          cursor: hasLinks ? 'pointer' : 'default'
        }}
        onClick={() => hasLinks && setIsExpanded(!isExpanded)}
        onKeyDown={(e) =>
          hasLinks &&
          (e.key === 'Enter' || e.key === ' ') &&
          setIsExpanded(!isExpanded)
        }
      >
        {isRunning ? <SpinnerIcon /> : <CheckIcon />}
        <span>{isRunning ? labels.running : labels.done}</span>
        {hasLinks && (
          <span
            css={{
              marginLeft: 'auto',
              color: '#9ca3af',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px'
            }}
          >
            {urls.length} {urls.length === 1 ? 'source' : 'sources'}
            <MinimizeIcon
              css={{
                width: '12px',
                height: '12px',
                transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                transition: 'transform 0.2s ease'
              }}
            />
          </span>
        )}
      </div>

      {/* Query */}
      {query && (
        <div
          css={{
            color: '#9ca3af',
            fontSize: '12px',
            paddingLeft: '22px',
            fontStyle: 'italic'
          }}
        >
          "{query.length > 50 ? query.substring(0, 50) + '...' : query}"
        </div>
      )}

      {/* Collapsible links */}
      {hasLinks && isExpanded && (
        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            paddingLeft: '22px',
            marginTop: '4px'
          }}
        >
          {urls.map((url, i) => (
            <a
              key={i}
              href={url}
              target='_blank'
              rel='noopener noreferrer'
              css={{
                fontSize: '12px',
                color: linkColor,
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                ':hover': { textDecoration: 'underline' }
              }}
            >
              <LinkIcon />
              {formatUrl(url)}
            </a>
          ))}
        </div>
      )}
    </div>
  );
};

export default ToolStatus;
