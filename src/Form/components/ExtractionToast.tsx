import React, { useState } from 'react';

type DataItem = {
  label: string;
  status: 'complete' | 'in_progress' | 'error' | string;
  items?: DataItem[];
};

type ExtractionToastProps = {
  data: DataItem[];
  title?: string;
};

const ExtractionItem = ({
  item,
  level = 0
}: {
  item: DataItem;
  level?: number;
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasChildren = item.items && item.items.length > 0;

  const paddingLeft = level * 24;

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
            backgroundColor: '#f9fafb'
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
              color: item.status === 'queued' ? '#aaa' : '#374151',
              fontWeight: 500,
              fontSize: '14px'
            }}
          >
            {getRunLabel(item)}
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
          {item.items?.map((childItem, index) => (
            <ExtractionItem key={index} item={childItem} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

const ExtractionToast = ({
  data,
  title = 'Document Extractions'
}: ExtractionToastProps) => {
  const [isToastExpanded, setIsToastExpanded] = useState(true);

  return (
    <div
      css={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        width: '384px',
        background: 'white',
        borderRadius: '8px',
        boxShadow:
          '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        border: '1px solid #e5e7eb',
        overflow: 'hidden',
        zIndex: 1000
      }}
    >
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px',
          background: '#f9fafb',
          borderBottom: '1px solid #e5e7eb',
          cursor: 'pointer',
          ':hover': {
            background: '#f3f4f6'
          }
        }}
        onClick={() => setIsToastExpanded(!isToastExpanded)}
      >
        <h3
          css={{
            fontWeight: 600,
            color: '#111827',
            margin: 0,
            fontSize: '16px'
          }}
        >
          {title}
        </h3>
        {isToastExpanded ? <ChevronUp /> : <ChevronDown />}
      </div>

      {isToastExpanded && (
        <div
          css={{
            maxHeight: '384px',
            overflowY: 'auto'
          }}
        >
          {data.map((item, index) => (
            <ExtractionItem key={index} item={item} />
          ))}
        </div>
      )}
    </div>
  );
};

export default ExtractionToast;

const CheckIcon = () => (
  <svg width='20' height='20' viewBox='0 0 24 24' fill='none'>
    <circle cx='12' cy='12' r='10' fill='#10b981' />
    <path
      d='m9 12 2 2 4-4'
      stroke='white'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

const SpinnerIcon = () => (
  <svg
    width='20'
    height='20'
    viewBox='0 0 24 24'
    fill='none'
    css={{
      animation: 'spin 1s linear infinite',
      '@keyframes spin': {
        from: { transform: 'rotate(0deg)' },
        to: { transform: 'rotate(360deg)' }
      }
    }}
  >
    <circle
      cx='12'
      cy='12'
      r='10'
      stroke='#3b82f6'
      strokeWidth='2'
      fill='none'
      strokeDasharray='31.416'
      strokeDashoffset='31.416'
    >
      <animate
        attributeName='stroke-dasharray'
        dur='2s'
        values='0 31.416;15.708 15.708;0 31.416'
        repeatCount='indefinite'
      />
      <animate
        attributeName='stroke-dashoffset'
        dur='2s'
        values='0;-15.708;-31.416'
        repeatCount='indefinite'
      />
    </circle>
  </svg>
);

const ErrorIcon = () => (
  <svg width='20' height='20' viewBox='0 0 24 24' fill='none'>
    <circle cx='12' cy='12' r='10' fill='#ef4444' />
    <path
      d='m15 9-6 6'
      stroke='white'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='m9 9 6 6'
      stroke='white'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

const ChevronDown = () => (
  <svg width='16' height='16' viewBox='0 0 24 24' fill='none'>
    <path
      d='m6 9 6 6 6-6'
      stroke='#9ca3af'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

const ChevronUp = () => (
  <svg width='16' height='16' viewBox='0 0 24 24' fill='none'>
    <path
      d='m18 15-6-6-6 6'
      stroke='#9ca3af'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

const StatusIcon = ({ status }: { status: DataItem['status'] }) => {
  switch (status) {
    case 'complete':
      return <CheckIcon />;
    case 'in_progress':
    case 'incomplete':
    case 'polling':
      return <SpinnerIcon />;
    case 'error':
      return <ErrorIcon />;
    default:
      return <div style={{ height: 20, width: 20 }}></div>;
  }
};

export const getRunLabel = (run: any): string => {
  if (run.extraction_key && run.extraction_variant_key) {
    return `${run.extraction_key} (${run.extraction_variant_key})`;
  }

  if (run.extraction_key) {
    return run.extraction_key;
  }

  switch (run.status) {
    case 'complete':
      return 'Completed Extraction';
    case 'error':
      return 'Failed Extraction';
    case 'queued':
      return 'Queued Extraction';
    case 'polling':
      return 'Running Extraction';
    default:
      return 'Extraction';
  }
};
