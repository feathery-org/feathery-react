import { useState } from 'react';
import { CheckIcon, LinkIcon, MinimizeIcon, SpinnerIcon } from './icons';
import { DEFAULT_CHAT_COLOR, GRAY_200, GRAY_400, GRAY_500 } from './colors';

export interface ToolLabel {
  running: string;
  done?: string;
}

// Tool status labels mapping
export const TOOL_LABELS: Record<string, ToolLabel> = {
  searchDocuments: {
    running: 'Searching documents...',
    done: 'Documents searched'
  },
  searchWeb: { running: 'Searching the web...', done: 'Web searched' },
  scrapeUrl: { running: 'Reading page...', done: 'Page read' },
  getPanelRuntime: { running: 'Reading the page...' },
  getPanelSnapshot: { running: 'Reading the form...' },
  getFuserSnapshot: { running: 'Looking up your submission...' },
  listFormExtractions: { running: 'Looking up extractions...' },
  getExtractionSnapshot: { running: 'Reading extraction setup...' },
  getExtractionResults: { running: 'Reading extraction results...' },
  setFieldValue: { running: 'Filling in...' },
  clickElement: { running: 'Just a moment...' },
  getLogicRules: { running: 'Reading form logic...' }
};

export const BACKGROUND_TOOL_NAMES = new Set<string>([
  'getPanelRuntime',
  'getPanelSnapshot',
  'getFuserSnapshot',
  'getExtractionSnapshot',
  'getExtractionResults',
  'listFormExtractions',
  'getLogicRules',
  'setFieldValue',
  'clickElement'
]);

export function readPartType(
  part: any
): { kind: 'text' | 'tool'; toolName?: string } | null {
  if (part?.type === 'text') return { kind: 'text' };
  const isStatic =
    typeof part?.type === 'string' && part.type.startsWith('tool-');
  const isDynamic = part?.type === 'dynamic-tool';
  if (!isStatic && !isDynamic) return null;
  const toolName = isStatic
    ? part.type.replace('tool-', '')
    : (part.toolName as string) || 'unknown';
  return { kind: 'tool', toolName };
}

function getTrailingBackgroundTool(parts: any[]): string | null {
  let trailing: string | null = null;
  for (const part of parts) {
    const meta = readPartType(part);
    if (!meta) continue;
    if (meta.kind === 'text') {
      if ((part.text ?? '').trim().length > 0) trailing = null;
      continue;
    }
    trailing =
      meta.toolName && BACKGROUND_TOOL_NAMES.has(meta.toolName)
        ? meta.toolName
        : null;
  }
  return trailing;
}

export function getLivePillState(
  messages: any[],
  status: string
): { livePillLabel: string | null; isLoading: boolean } {
  const streaming = status === 'submitted' || status === 'streaming';
  const lastMsg = messages[messages.length - 1] as
    | { role?: string; parts?: any[] }
    | undefined;
  const isAssistantMsg = lastMsg?.role === 'assistant';
  const liveParts = streaming && isAssistantMsg ? lastMsg?.parts ?? [] : [];

  const trailingTool = getTrailingBackgroundTool(liveParts);
  const last = liveParts[liveParts.length - 1];
  const trailingIsStreamingText =
    last?.type === 'text' && (last.text ?? '').trim().length > 0;
  const lastMeta = readPartType(last);
  const trailingIsForegroundToolRunning =
    lastMeta?.kind === 'tool' &&
    !!lastMeta.toolName &&
    !BACKGROUND_TOOL_NAMES.has(lastMeta.toolName) &&
    last?.state !== 'output-available' &&
    last?.state !== 'output-error';
  const showThinkingPlaceholder =
    streaming &&
    (!isAssistantMsg ||
      (!trailingIsStreamingText && !trailingIsForegroundToolRunning));

  const livePillLabel = trailingTool
    ? TOOL_LABELS[trailingTool]?.running ?? 'Thinking...'
    : showThinkingPlaceholder
    ? 'Thinking...'
    : null;
  const isLoading = streaming || trailingTool === 'setFieldValue';
  return { livePillLabel, isLoading };
}

// Format URL for display (show domain + path); CSS handles truncation.
const formatUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    return parsed.hostname + (parsed.pathname !== '/' ? parsed.pathname : '');
  } catch {
    return url;
  }
};

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
  if (typeof out.url === 'string' && out.url) {
    urls.push(out.url);
  }

  if (urls.length > 0) {
    return Array.from(new Set(urls));
  }

  if (Array.isArray(output)) {
    return Array.from(new Set(extractFromArray(output)));
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
  const labels: ToolLabel = TOOL_LABELS[toolName] || {
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
        border: `1px solid ${GRAY_200}`,
        borderRadius: '8px',
        fontSize: '13px',
        maxWidth: '100%',
        minWidth: 0,
        overflowWrap: 'anywhere',
        wordBreak: 'break-word'
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
          color: GRAY_500,
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
              color: GRAY_400,
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
            color: GRAY_400,
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
                minWidth: 0,
                ':hover': { textDecoration: 'underline' }
              }}
            >
              <LinkIcon />
              <span
                css={{
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {formatUrl(url)}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
};

export default ToolStatus;
