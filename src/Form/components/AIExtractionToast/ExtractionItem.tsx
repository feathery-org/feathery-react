import { useState } from 'react';
import { DataItem } from '.';
import { ChevronDown, ChevronUp, StatusIcon } from './icons';

const INDENT_PX = 24;

export default function ExtractionItem({
  item,
  level = 0
}: {
  item: DataItem;
  level?: number;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasChildren = item.children && item.children.length > 0;

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
          <StatusIcon status={item.status} />
          <span
            css={{
              color: item.status === 'queued' ? '#9ca3af' : '#374151',
              fontWeight: 500,
              fontSize: '14px'
            }}
          >
            {item.extraction_key && item.extraction_variant_key
              ? `${item.extraction_key} (${item.extraction_variant_key})`
              : item.extraction_key ||
                {
                  complete: 'Completed',
                  error: 'Failed',
                  queued: 'Queued Action',
                  polling: 'Uploading Document'
                }[item.status] ||
                'Action'}
          </span>
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
            <ExtractionItem key={index} item={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
