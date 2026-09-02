import { forwardRef, useState } from 'react';
import { ChevronDown, ChevronUp, CloseIcon } from './icons';
import ToastItem from './ToastItem';
import { DataItem } from './useAIExtractionToast';

type ActionToastProps = {
  data: DataItem[];
  bottom?: number;
  title?: string;
  // When supplied, renders a dismiss control. Toasts that clear themselves
  // leave this off and stay uncloseable, as before.
  onDismiss?: () => void;
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

const ActionToast = forwardRef<HTMLDivElement, ActionToastProps>(
  ({ data, bottom = 20, title, onDismiss }, ref) => {
    const [isToastExpanded, setIsToastExpanded] = useState(true);

    if (data.length === 0) return null;

    return (
      <div
        ref={ref}
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
            {title ?? getTitle(data)}
          </h3>
          <div css={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isToastExpanded ? <ChevronUp /> : <ChevronDown />}
            {onDismiss && (
              <span
                role='button'
                aria-label='Dismiss'
                css={{
                  display: 'flex',
                  alignItems: 'center',
                  color: '#6b7280',
                  ':hover': { color: '#111827' }
                }}
                onClick={(event) => {
                  // The header toggles expansion, so keep the click here
                  event.stopPropagation();
                  onDismiss();
                }}
              >
                <CloseIcon />
              </span>
            )}
          </div>
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
  }
);

export default ActionToast;
