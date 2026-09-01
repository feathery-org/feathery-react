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

export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
    <polyline points='7 10 12 15 17 10' />
    <line x1='12' y1='3' x2='12' y2='15' />
  </Svg>
);

export const ResetIcon = (p: IconProps) => (
  <Svg {...p}>
    <polyline points='1 4 1 10 7 10' />
    <path d='M3.51 15a9 9 0 1 0 2.13-9.36L1 10' />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <line x1='12' y1='5' x2='12' y2='19' />
    <line x1='5' y1='12' x2='19' y2='12' />
  </Svg>
);

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <polyline points='3 6 5 6 21 6' />
    <path d='M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' />
  </Svg>
);

export const ZoomInIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx='11' cy='11' r='8' />
    <line x1='21' y1='21' x2='16.65' y2='16.65' />
    <line x1='11' y1='8' x2='11' y2='14' />
    <line x1='8' y1='11' x2='14' y2='11' />
  </Svg>
);

export const ZoomOutIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx='11' cy='11' r='8' />
    <line x1='21' y1='21' x2='16.65' y2='16.65' />
    <line x1='8' y1='11' x2='14' y2='11' />
  </Svg>
);

export const FitWidthIcon = (p: IconProps) => (
  <Svg {...p}>
    <polyline points='15 3 21 3 21 9' />
    <polyline points='9 21 3 21 3 15' />
    <line x1='21' y1='3' x2='14' y2='10' />
    <line x1='3' y1='21' x2='10' y2='14' />
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

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <polyline points='20 6 9 17 4 12' />
  </Svg>
);

export const EllipsisIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx='12' cy='12' r='1' />
    <circle cx='5' cy='12' r='1' />
    <circle cx='19' cy='12' r='1' />
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
