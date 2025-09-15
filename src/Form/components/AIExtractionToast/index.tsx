import React, { useState } from 'react';
import { ChevronDown, ChevronUp, StatusIcon } from './icons';
import ExtractionItem from './ExtractionItem';

export type DataItem = {
  status: 'complete' | 'polling' | 'error' | 'queued';
  extraction_key?: string;
  extraction_variant_key?: string;
  children?: DataItem[];
  id: string;
  variantId: string;
  isSequential: boolean;
  run_id?: string;
  created_at?: string;
  file_sources?: any[];
};

type ExtractionToastProps = {
  data: DataItem[];
  title?: string;
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
