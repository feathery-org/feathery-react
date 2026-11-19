import React from 'react';
import { keyframes } from '@emotion/react';

interface IconProps {
  size?: number;
}

function Svg({
  size = 18,
  children
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden
      focusable='false'
    >
      {children}
    </svg>
  );
}

export const ChevronLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <polyline points='15 18 9 12 15 6' />
  </Svg>
);

export const MenuIcon = (p: IconProps) => (
  <Svg {...p}>
    <line x1='3' y1='6' x2='21' y2='6' />
    <line x1='3' y1='12' x2='21' y2='12' />
    <line x1='3' y1='18' x2='21' y2='18' />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <line x1='18' y1='6' x2='6' y2='18' />
    <line x1='6' y1='6' x2='18' y2='18' />
  </Svg>
);

export const AlertIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d='M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' />
    <line x1='12' y1='9' x2='12' y2='13' />
    <line x1='12' y1='17' x2='12.01' y2='17' />
  </Svg>
);

export const ChevronUpIcon = (p: IconProps) => (
  <Svg {...p}>
    <polyline points='18 15 12 9 6 15' />
  </Svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <polyline points='6 9 12 15 18 9' />
  </Svg>
);

export const GripIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx='9' cy='6' r='1' />
    <circle cx='15' cy='6' r='1' />
    <circle cx='9' cy='12' r='1' />
    <circle cx='15' cy='12' r='1' />
    <circle cx='9' cy='18' r='1' />
    <circle cx='15' cy='18' r='1' />
  </Svg>
);

export const PaperclipIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d='M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48' />
  </Svg>
);

export const FileIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' />
    <polyline points='14 2 14 8 20 8' />
  </Svg>
);

export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
    <polyline points='7 10 12 15 17 10' />
    <line x1='12' y1='15' x2='12' y2='3' />
  </Svg>
);

const spin = keyframes({
  from: { transform: 'rotate(0deg)' },
  to: { transform: 'rotate(360deg)' }
});

export const SpinnerIcon = ({ size = 18 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    aria-hidden
    focusable='false'
    css={{
      animation: `${spin} 800ms linear infinite`,
      '@media (prefers-reduced-motion: reduce)': { animation: 'none' }
    }}
  >
    <circle
      cx='12'
      cy='12'
      r='9'
      stroke='currentColor'
      strokeOpacity={0.25}
      strokeWidth={2.5}
    />
    <path
      d='M21 12a9 9 0 0 0-9-9'
      stroke='currentColor'
      strokeWidth={2.5}
      strokeLinecap='round'
    />
  </svg>
);
