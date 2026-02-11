import { ComponentProps } from 'react';

export const ChatIcon = (props: ComponentProps<'svg'>) => (
  <svg width='24' height='24' viewBox='0 0 24 24' fill='none' {...props}>
    <path
      d='M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      fill='none'
    />
  </svg>
);

export const MinimizeIcon = (props: ComponentProps<'svg'>) => (
  <svg width='16' height='16' viewBox='0 0 24 24' fill='none' {...props}>
    <path
      d='m6 9 6 6 6-6'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

export const SendIcon = (props: ComponentProps<'svg'>) => (
  <svg width='20' height='20' viewBox='0 0 24 24' fill='none' {...props}>
    <path
      d='m22 2-7 20-4-9-9-4 20-7z'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='m22 2-11 11'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

export const SpinnerIcon = (props: ComponentProps<'svg'>) => (
  <svg
    style={{
      width: '16px',
      height: '16px',
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
        stroke: '#f5cbcb',
        strokeWidth: 3,
        opacity: 1
      }}
    />
    <circle
      cx={25}
      cy={25}
      r={22.5}
      style={{
        fill: 'none',
        stroke: '#e2626e',
        strokeWidth: 3,
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

export const CloseIcon = (props: ComponentProps<'svg'>) => (
  <svg width='16' height='16' viewBox='0 0 24 24' fill='none' {...props}>
    <path
      d='M18 6 6 18'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='m6 6 12 12'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

export const CheckIcon = (props: ComponentProps<'svg'>) => (
  <svg width='14' height='14' viewBox='0 0 24 24' fill='none' {...props}>
    <polyline
      points='20 6 9 17 4 12'
      stroke='#10b981'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

export const LinkIcon = (props: ComponentProps<'svg'>) => (
  <svg width='12' height='12' viewBox='0 0 24 24' fill='none' {...props}>
    <path
      d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);
