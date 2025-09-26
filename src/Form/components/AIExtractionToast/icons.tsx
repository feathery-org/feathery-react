import { ComponentProps } from 'react';
import { DataItem } from './useAIExtractionToast';

const CheckIcon = (props: ComponentProps<'svg'>) => (
  <svg width='20' height='20' viewBox='0 0 24 24' fill='none' {...props}>
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

const SpinnerIcon = (props: ComponentProps<'svg'>) => (
  <svg
    style={{
      width: '20',
      height: '20',
      borderRadius: '50%'
    }}
    viewBox='0 0 50 50'
    {...props}
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

const ErrorIcon = (props: ComponentProps<'svg'>) => (
  <svg width='20' height='20' viewBox='0 0 24 24' fill='none' {...props}>
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

const PendingIcon = (props: ComponentProps<'svg'>) => (
  <svg width='20' height='20' viewBox='0 0 24 24' fill='none' {...props}>
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

export const ChevronDown = () => (
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

export const ChevronUp = () => (
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

export const StatusIcon = ({
  status,
  ...props
}: { status: DataItem['status'] } & ComponentProps<'svg'>) => {
  switch (status) {
    case 'complete':
      return <CheckIcon {...props} />;
    case 'incomplete':
      return <SpinnerIcon {...props} />;
    case 'queued':
      return <PendingIcon {...props} />;
    case 'error':
      return <ErrorIcon {...props} />;
    default:
      return null;
  }
};
