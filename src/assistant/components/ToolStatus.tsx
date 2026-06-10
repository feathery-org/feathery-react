import { useState } from 'react';
import {
  CheckIcon,
  CloseIcon,
  LinkIcon,
  MinimizeIcon,
  SpinnerIcon
} from '../icons';
import {
  DEFAULT_CHAT_COLOR,
  GRAY_200,
  GRAY_400,
  GRAY_500,
  RED_500
} from '../colors';

interface ToolLabel {
  running: string;
  done?: string;
}

const TOOL_LABELS: Record<string, ToolLabel> = {
  searchWeb: {
    running: 'Searching the web...',
    done: 'Searched the web'
  },
  scrapeUrl: { running: 'Reading web page...', done: 'Read the web page' },
  searchDocuments: {
    running: 'Searching documents...',
    done: 'Searched the documents'
  },
  setFieldValue: {
    running: 'Updating form fields...',
    done: 'Updated form fields'
  },
  clickElement: {
    running: 'Running form action...',
    done: 'Ran the form action'
  },
  addTableRow: {
    running: 'Adding a row...',
    done: 'Added a row'
  },
  deleteTableRow: {
    running: 'Deleting a row...',
    done: 'Deleted a row'
  },
  setTableCellValue: {
    running: 'Updating table cells...',
    done: 'Updated table cells'
  },
  triggerTableAction: {
    running: 'Running table action...',
    done: 'Ran the table action'
  },
  getPanelSnapshot: {
    running: 'Reading the form...',
    done: 'Reviewed the form'
  },
  getFuserSnapshot: {
    running: 'Looking up your submission...',
    done: 'Reviewed the submission'
  },
  getExtractionSnapshot: {
    running: 'Reading extraction setup...',
    done: 'Reviewed the extraction setup'
  },
  getExtractionResults: {
    running: 'Reading extraction results...',
    done: 'Reviewed the extraction results'
  },
  listFormExtractions: {
    running: 'Looking up extractions...',
    done: 'Reviewed available extractions'
  },
  getLogicRules: {
    running: 'Reading form logic...',
    done: 'Reviewed form logic'
  }
};

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

// Format URL for display (show domain + path); CSS handles truncation.
function formatUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname + (parsed.pathname !== '/' ? parsed.pathname : '');
  } catch {
    return url;
  }
}

function extractUrls(output: unknown): string[] {
  if (!output || typeof output !== 'object') return [];
  const out = output as Record<string, unknown>;
  const urls: string[] = [];
  const extractFromArray = (arr: unknown[]): string[] =>
    arr
      .map((r: unknown) => {
        if (typeof r === 'object' && r !== null) {
          const item = r as Record<string, unknown>;
          return (item.url as string) || '';
        }
        return '';
      })
      .filter(Boolean);
  if (Array.isArray(out.web)) urls.push(...extractFromArray(out.web));
  if (Array.isArray(out.news)) urls.push(...extractFromArray(out.news));
  if (Array.isArray(out.images)) urls.push(...extractFromArray(out.images));
  if (typeof out.url === 'string' && out.url) urls.push(out.url);
  if (urls.length > 0) return Array.from(new Set(urls));
  if (Array.isArray(output))
    return Array.from(new Set(extractFromArray(output)));
  return [];
}

export interface ToolRow {
  key: string;
  toolName: string;
  state: string;
  input?: { query?: string };
  output?: unknown;
}

function isRunningState(s: string) {
  return s === 'input-streaming' || s === 'input-available';
}
function isErrorRow(row: ToolRow) {
  return (
    row.state === 'output-error' ||
    (typeof row.output === 'object' &&
      row.output !== null &&
      (row.output as { ok?: unknown }).ok === false)
  );
}

interface ToolRowDetailProps {
  row: ToolRow;
  linkColor: string;
  indent?: number;
}

function ToolRowDetail({ row, linkColor, indent = 24 }: ToolRowDetailProps) {
  const query = row.input?.query;
  const urls = extractUrls(row.output);
  const hasContent = !!query || urls.length > 0;
  if (!hasContent) return null;
  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        paddingLeft: `${indent}px`,
        marginTop: '2px',
        marginBottom: '4px'
      }}
    >
      {query && (
        <div
          css={{
            color: GRAY_400,
            fontSize: '12px',
            fontStyle: 'italic'
          }}
        >
          &quot;{query.length > 80 ? query.substring(0, 80) + '...' : query}
          &quot;
        </div>
      )}
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
          <LinkIcon css={{ flexShrink: 0 }} />
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
  );
}

function hasDetail(row: ToolRow): boolean {
  if (row.input?.query) return true;
  if (extractUrls(row.output).length > 0) return true;
  return false;
}

function labelFor(row: ToolRow): string {
  const labels = TOOL_LABELS[row.toolName] || {
    running: 'Working...',
    done: 'Done'
  };
  if (isRunningState(row.state)) return labels.running;
  if (isErrorRow(row)) return labels.done ?? 'Failed';
  return labels.done ?? labels.running;
}

// background-clip:text so the gradient sweep only paints the glyphs
const shimmerCss = {
  backgroundImage: `linear-gradient(90deg, ${GRAY_500} 25%, #d1d5db 50%, ${GRAY_500} 75%)`,
  backgroundSize: '220% 100%',
  backgroundClip: 'text',
  WebkitBackgroundClip: 'text',
  color: 'transparent',
  animation: 'feathery-tool-shimmer 1.6s linear infinite',
  '@keyframes feathery-tool-shimmer': {
    from: { backgroundPosition: '160% 0' },
    to: { backgroundPosition: '-60% 0' }
  }
} as const;

interface ToolChunkProps {
  rows: ToolRow[];
  followedByText: boolean;
  turnFinished: boolean;
  linkColor?: string;
  isFirstChunk?: boolean;
}

export function ToolChunk({
  rows,
  followedByText,
  turnFinished,
  linkColor = DEFAULT_CHAT_COLOR,
  isFirstChunk = false
}: ToolChunkProps) {
  const isRunning = rows.some((r) => isRunningState(r.state));
  const chunkDone = !isRunning && (followedByText || turnFinished);
  const shouldCollapse = !isRunning && followedByText;
  const defaultExpanded = !shouldCollapse;
  const [override, setOverride] = useState<boolean | null>(null);
  const expanded = override ?? defaultExpanded;
  const toggle = () => setOverride(!expanded);

  // Match the message bubble's horizontal padding
  const TEXT_ALIGN_PADDING = 14;

  const containerCss = {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
    fontSize: '13px',
    minWidth: 0,
    paddingLeft: `${TEXT_ALIGN_PADDING}px`,
    ...(isFirstChunk
      ? {}
      : {
          animation: 'feathery-chunk-fade-in 220ms ease-out both',
          '@keyframes feathery-chunk-fade-in': {
            from: { opacity: 0, transform: 'translateY(4px)' },
            to: { opacity: 1, transform: 'translateY(0)' }
          }
        })
  };

  // Inline only when done; wrapping while in-flight avoids reflow on a 2nd row
  if (chunkDone && rows.length === 1) {
    const row = rows[0];
    const error = isErrorRow(row);
    const expandable = hasDetail(row);
    return (
      <div css={containerCss}>
        <button
          type='button'
          onClick={expandable ? toggle : undefined}
          css={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: 'none',
            border: 'none',
            padding: '4px 0',
            cursor: expandable ? 'pointer' : 'default',
            color: GRAY_500,
            textAlign: 'left',
            font: 'inherit',
            fontSize: '13px',
            alignSelf: 'flex-start'
          }}
        >
          {error && (
            <CloseIcon
              css={{ width: '12px', height: '12px', color: RED_500 }}
            />
          )}
          <span>{labelFor(row)}</span>
          {expandable && (
            <MinimizeIcon
              css={{
                width: '12px',
                height: '12px',
                color: GRAY_400,
                transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                transition: 'transform 0.2s ease',
                flexShrink: 0
              }}
            />
          )}
        </button>
        {expandable && expanded && (
          <ToolRowDetail row={row} linkColor={linkColor} indent={6} />
        )}
      </div>
    );
  }

  // Multi-tool case
  const headerLabel = chunkDone ? 'Finished working' : 'Working on it...';

  return (
    <div css={containerCss}>
      {/* Header: label + chevron, no spinner/check. Chevron sits inline
          immediately after the label as the expand/collapse affordance. */}
      <button
        type='button'
        onClick={toggle}
        css={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          background: 'none',
          border: 'none',
          padding: '4px 0',
          cursor: 'pointer',
          color: GRAY_500,
          textAlign: 'left',
          font: 'inherit',
          fontSize: '13px',
          alignSelf: 'flex-start'
        }}
      >
        <span css={chunkDone ? undefined : shimmerCss}>{headerLabel}</span>
        <MinimizeIcon
          css={{
            width: '12px',
            height: '12px',
            color: GRAY_400,
            transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 0.2s ease',
            flexShrink: 0
          }}
        />
      </button>
      {expanded && (
        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            marginLeft: '5px',
            paddingLeft: '13px',
            borderLeft: `2px solid ${GRAY_200}`
          }}
        >
          {rows.map((row) => (
            <ToolChunkRow key={row.key} row={row} linkColor={linkColor} />
          ))}
        </div>
      )}
    </div>
  );
}

interface ToolChunkRowProps {
  row: ToolRow;
  linkColor: string;
}

function ToolChunkRow({ row, linkColor }: ToolChunkRowProps) {
  const expandable = hasDetail(row);
  const running = isRunningState(row.state);
  const error = isErrorRow(row);
  // Auto-expanded while running, collapses when output lands
  const [override, setOverride] = useState<boolean | null>(null);
  const expanded = override ?? running;
  const setExpanded = (next: boolean) => setOverride(next);
  const RowEl = expandable ? 'button' : 'div';
  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <RowEl
        type={expandable ? 'button' : undefined}
        onClick={expandable ? () => setExpanded(!expanded) : undefined}
        css={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          color: error ? RED_500 : GRAY_500,
          background: 'none',
          border: 'none',
          padding: '2px 0',
          textAlign: 'left',
          cursor: expandable ? 'pointer' : 'default',
          font: 'inherit',
          fontSize: '13px',
          alignSelf: 'flex-start'
        }}
      >
        {running ? (
          <SpinnerIcon css={{ width: '12px', height: '12px' }} />
        ) : error ? (
          <CloseIcon css={{ width: '12px', height: '12px' }} />
        ) : (
          <CheckIcon css={{ width: '12px', height: '12px' }} />
        )}
        <span css={running ? shimmerCss : undefined}>{labelFor(row)}</span>
        {expandable && (
          <MinimizeIcon
            css={{
              width: '10px',
              height: '10px',
              color: GRAY_400,
              transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 0.2s ease',
              flexShrink: 0
            }}
          />
        )}
      </RowEl>
      {expandable && expanded && (
        <ToolRowDetail row={row} linkColor={linkColor} />
      )}
    </div>
  );
}

// Mimics the chunk header so a real tool arriving doesn't reflow the layout
export function ToolChunkPlaceholder() {
  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        fontSize: '13px',
        minWidth: 0,
        paddingLeft: '14px',
        animation: 'feathery-chunk-fade-in 220ms ease-out both',
        '@keyframes feathery-chunk-fade-in': {
          from: { opacity: 0, transform: 'translateY(4px)' },
          to: { opacity: 1, transform: 'translateY(0)' }
        }
      }}
    >
      <div
        css={{
          padding: '4px 0',
          color: GRAY_500,
          fontSize: '13px',
          alignSelf: 'flex-start'
        }}
      >
        <span css={shimmerCss}>Working on it...</span>
      </div>
    </div>
  );
}

export default ToolChunk;
