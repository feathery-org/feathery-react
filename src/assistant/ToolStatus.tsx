import { useState } from 'react';
import { CheckIcon, CloseIcon, LinkIcon, MinimizeIcon, SpinnerIcon } from './icons';
import { DEFAULT_CHAT_COLOR, GRAY_200, GRAY_400, GRAY_500 } from './colors';

export interface ToolLabel {
  running: string;
  done: string;
  empty?: string;
}

// Tool status labels mapping
export const TOOL_LABELS: Record<string, ToolLabel> = {
  searchDocuments: {
    running: 'Searching documents...',
    done: 'Documents searched'
  },
  searchWeb: { running: 'Searching the web...', done: 'Web searched' },
  getPanelRuntime: {
    running: 'Reading the page...',
    done: 'Page read'
  },
  getPanelSnapshot: {
    running: 'Reading the form...',
    done: 'Form read'
  },
  getFuserSnapshot: {
    running: 'Looking up your submission...',
    done: 'Submission details loaded'
  },
  listFormExtractions: {
    running: 'Looking up extractions...',
    done: 'Extractions found',
    empty: 'No extractions configured'
  },
  listRunDocuments: {
    running: 'Finding documents...',
    done: 'Documents found',
    empty: 'No documents in this run'
  },
  getExtractionSnapshot: {
    running: 'Reading extraction setup...',
    done: 'Extraction setup loaded'
  },
  getExtractionResults: {
    running: 'Reading extraction results...',
    done: 'Results loaded',
    empty: 'No results in this run'
  },
  setFieldValue: {
    running: 'Filling in...',
    done: 'Filled in'
  },
  // Legacy names kept so thread history saved before renames still renders
  search_documents: {
    running: 'Searching documents...',
    done: 'Documents searched'
  },
  search_web: { running: 'Searching the web...', done: 'Web searched' },
  getExtractionConfig: {
    running: 'Reading extraction setup...',
    done: 'Extraction setup loaded'
  },
  listFuserDocuments: {
    running: 'Finding your documents...',
    done: 'Documents found',
    empty: 'No documents found'
  },
  listExtractionRuns: {
    running: 'Looking up runs...',
    done: 'Runs found',
    empty: 'No runs found'
  }
};

const isEmptyToolOutput = (output: unknown): boolean => {
  if (Array.isArray(output)) return output.length === 0;
  if (output && typeof output === 'object') {
    const obj = output as Record<string, unknown>;
    if ('error' in obj) return false; // errors render via the normal done path
    // Common list-shaped payloads: { results: [...] }, { items: [...] }
    for (const k of ['results', 'items', 'entries']) {
      if (Array.isArray(obj[k])) return (obj[k] as unknown[]).length === 0;
    }
  }
  return false;
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
  const labels: ToolLabel = TOOL_LABELS[toolName] || {
    running: 'Processing...',
    done: 'Done'
  };
  const isRunning = state === 'input-streaming' || state === 'input-available';
  const query = input?.query;

  const urls = extractUrls(output);
  const hasLinks = urls.length > 0;
  const isEmptyDone = !isRunning && labels.empty !== undefined && isEmptyToolOutput(output);
  const doneLabel = isEmptyDone ? (labels.empty as string) : labels.done;

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
        {isRunning ? <SpinnerIcon /> : isEmptyDone ? <CloseIcon width={14} height={14} /> : <CheckIcon />}
        <span>{isRunning ? labels.running : doneLabel}</span>
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
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
                ':hover': { textDecoration: 'underline' }
              }}
            >
              <LinkIcon />
              <span css={{ minWidth: 0, overflowWrap: 'anywhere' }}>{formatUrl(url)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
};

export default ToolStatus;
