import React, { useState } from 'react';

type DataItem = {
  status: 'complete' | 'polling' | 'error' | 'queued';
  extraction_key: string;
  extraction_variant_key?: string;
  children?: DataItem[];
};

type ExtractionToastProps = {
  data: DataItem[];
  title?: string;
};

const INDENT_PX = 24;

const ExtractionItem = ({
  item,
  level = 0
}: {
  item: DataItem;
  level?: number;
}) => {
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
};

const ExtractionToast = ({
  data,
  title = 'Scanning Documents'
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
    style={{
      width: '20',
      height: '20',
      borderRadius: '50%'
    }}
    viewBox='0 0 50 50'
  >
    <circle
      cx={25}
      cy={25}
      r={22.5}
      style={{
        fill: 'none',
        stroke: '#dbdfe8',
        strokeWidth: 2,
        opacity: 1
      }}
    />
    <circle
      cx={25}
      cy={25}
      r={22.5}
      style={{
        fill: 'none',
        stroke: '#333849',
        strokeWidth: 2,
        opacity: 1,
        strokeLinecap: 'round',
        transformOrigin: '50% 50%',
        transform: 'rotate3d(0,0,1,0deg)',
        animation:
          '2156ms ease-in-out 0s infinite normal none running feathery-spinner-arc,1829ms linear 0s infinite normal none running feathery-spinner-rotate'
      }}
    />
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

const PendingIcon = () => (
  <svg width='20' height='20' viewBox='0 0 24 24' fill='none'>
    <circle cx='12' cy='12' r='10' fill='#9ca3af' />
    <path
      d='M12 6v6l4 2'
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
    case 'polling':
      return <SpinnerIcon />;
    case 'queued':
      return <PendingIcon />;
    case 'error':
      return <ErrorIcon />;
    default:
      return null;
  }
};
