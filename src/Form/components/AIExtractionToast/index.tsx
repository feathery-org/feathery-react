import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from './icons';
import ExtractionItem from './ExtractionItem';
import { DataItem } from './useAIExtractionToast';

type ExtractionToastProps = {
  data: DataItem[];
  title?: string;
  bottom?: number;
};

const ExtractionToast = ({
  data,
  title = 'Scanning Documents',
  bottom = 20
}: ExtractionToastProps) => {
  const [isToastExpanded, setIsToastExpanded] = useState(true);

  return (
    <div
      css={{
        position: 'fixed',
        bottom: `${bottom}px`,
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
          padding: '8px 16px',
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
