import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from './icons';
import ToastItem from './ToastItem';
import { DataItem } from './useAIExtractionToast';

type ActionToastProps = {
  data: DataItem[];
  bottom?: number;
};

const getTitle = (data: DataItem[]): string => {
  const hasAIExtraction = data.some((item) => item.type === 'ai-extraction');
  const hasEnvelopes = data.some((item) => item.type === 'envelope-generation');

  const totalDocs = data
    .filter((item) => item.type === 'envelope-generation')
    .reduce((sum, item) => sum + (item.documents?.length || 0), 0);

  if (hasAIExtraction && hasEnvelopes) {
    return 'Processing Documents';
  }

  if (hasEnvelopes) {
    return totalDocs > 1 ? 'Preparing Documents' : 'Preparing Document';
  }

  return 'Scanning Documents';
};

const ActionToast = ({ data, bottom = 20 }: ActionToastProps) => {
  const [isToastExpanded, setIsToastExpanded] = useState(true);

  if (data.length === 0) return null;

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
          {getTitle(data)}
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
            <ToastItem key={index} item={item} />
          ))}
        </div>
      )}
    </div>
  );
};

export default ActionToast;
