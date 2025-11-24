import { useState } from 'react';
import { ChevronDown, ChevronUp, StatusIcon } from './icons';
import { DataItem } from './useAIExtractionToast';

const INDENT_PX = 24;

// Default labels for different toast types
const DEFAULT_LABELS = {
  queued: 'Queued Document',
  incomplete: 'Uploading Document',
  complete: 'Completed',
  error: 'Failed'
};

export default function ToastItem({
  item,
  level = 0
}: {
  item: DataItem;
  level?: number;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasChildren =
    item.status === 'incomplete' && item.children && item.children.length > 0;

  const paddingLeft = level * INDENT_PX;

  return (
    <div css={{ width: '100%' }}>
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          paddingLeft: `${paddingLeft + 16}px`,
          cursor: hasChildren ? 'pointer' : 'default',
          ':hover': {
            backgroundColor: hasChildren ? '#f9fafb' : ''
          }
        }}
        onClick={() => hasChildren && setIsExpanded(!isExpanded)}
      >
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flex: 1
          }}
        >
          <StatusIcon status={item.status} css={{ flexShrink: 0 }} />
          <div
            css={{
              fontSize: '14px',
              fontWeight: 500
            }}
          >
            {renderItemLabel(item)}
          </div>
        </div>

        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          {hasChildren && (isExpanded ? <ChevronUp /> : <ChevronDown />)}
        </div>
      </div>

      {hasChildren && isExpanded && (
        <div css={{ width: '100%' }}>
          {item.children?.map((child, index) => (
            <ToastItem key={index} item={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

const renderItemLabel = (item: DataItem) => {
  // fallback labels if no run data yet
  if (!item.extractionKey) {
    const docCount = item.documents?.length || 0;
    const docCountText = docCount > 1 ? ` (${docCount})` : '';

    // Use custom labels if provided, otherwise use defaults
    const labels = item.labels || DEFAULT_LABELS;
    const baseLabel =
      labels[item.status] || DEFAULT_LABELS[item.status] || 'Action';
    const label = `${baseLabel}${docCountText}`;

    return (
      <span css={{ color: item.status === 'queued' ? '#9ca3af' : '#374151' }}>
        {label}
      </span>
    );
  }

  const fileSourcesText = getFileSourcesText(item.fileSources);

  return (
    <>
      <span css={{ color: item.status === 'queued' ? '#9ca3af' : '#374151' }}>
        {item.extractionKey}
      </span>
      {fileSourcesText && (
        <span css={{ color: '#9ca3af' }}> {fileSourcesText}</span>
      )}
    </>
  );
};

const getFileSourcesText = (fileSources?: any[]) => {
  if (!fileSources?.length) return null;

  const fileName = getFileName(fileSources[0].url as string);
  const additionalFiles = fileSources.length - 1;

  const fileInfo =
    additionalFiles > 0 ? `${fileName} & ${additionalFiles} more` : fileName;

  return `(${fileInfo})`;
};

const getFileName = (fileUrl: string) => {
  const lastSlashIndex = fileUrl.lastIndexOf('/');
  return fileUrl.substring(lastSlashIndex + 1);
};
