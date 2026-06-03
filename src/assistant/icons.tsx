import { ComponentProps } from 'react';

export function ChatIcon(props: ComponentProps<'svg'>) {
  return (
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
}

export function MinimizeIcon(props: ComponentProps<'svg'>) {
  return (
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
}

export function SendIcon(props: ComponentProps<'svg'>) {
  return (
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
}

export function SpinnerIcon(props: ComponentProps<'svg'>) {
  return (
    <svg
      width='16'
      height='16'
      style={{ borderRadius: '50%' }}
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
}

export function CloseIcon(props: ComponentProps<'svg'>) {
  return (
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
}

export function CheckIcon(props: ComponentProps<'svg'>) {
  return (
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
}

export function ChevronDownIcon(props: ComponentProps<'svg'>) {
  return (
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
}

export function FloatingIcon(props: ComponentProps<'svg'>) {
  return (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' {...props}>
      <rect
        x='3'
        y='3'
        width='18'
        height='18'
        rx='2'
        stroke='currentColor'
        strokeWidth='2'
      />
      <rect
        x='12'
        y='12'
        width='7'
        height='7'
        rx='1'
        stroke='currentColor'
        strokeWidth='2'
      />
    </svg>
  );
}

export function SidebarLeftIcon(props: ComponentProps<'svg'>) {
  return (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' {...props}>
      <rect
        x='3'
        y='3'
        width='18'
        height='18'
        rx='2'
        stroke='currentColor'
        strokeWidth='2'
      />
      <path d='M9 3v18' stroke='currentColor' strokeWidth='2' />
    </svg>
  );
}

export function SidebarRightIcon(props: ComponentProps<'svg'>) {
  return (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' {...props}>
      <rect
        x='3'
        y='3'
        width='18'
        height='18'
        rx='2'
        stroke='currentColor'
        strokeWidth='2'
      />
      <path d='M15 3v18' stroke='currentColor' strokeWidth='2' />
    </svg>
  );
}

export function FullscreenIcon(props: ComponentProps<'svg'>) {
  return (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' {...props}>
      <path
        d='M4 9V5a1 1 0 0 1 1-1h4'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M20 9V5a1 1 0 0 0-1-1h-4'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M4 15v4a1 1 0 0 0 1 1h4'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M20 15v4a1 1 0 0 1-1 1h-4'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
}

export function MinusIcon(props: ComponentProps<'svg'>) {
  return (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' {...props}>
      <path
        d='M5 12h14'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
    </svg>
  );
}

export function ChevronsLeftIcon(props: ComponentProps<'svg'>) {
  return (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' {...props}>
      <path
        d='m11 17-5-5 5-5'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='m18 17-5-5 5-5'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
}

export function ChevronsRightIcon(props: ComponentProps<'svg'>) {
  return (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' {...props}>
      <path
        d='m6 17 5-5-5-5'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='m13 17 5-5-5-5'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
}

export function LinkIcon(props: ComponentProps<'svg'>) {
  return (
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
}

export function MicIcon(props: ComponentProps<'svg'>) {
  return (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' {...props}>
      <rect
        x='9'
        y='3'
        width='6'
        height='12'
        rx='3'
        stroke='currentColor'
        strokeWidth='2'
      />
      <path
        d='M5 11a7 7 0 0 0 14 0'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      <path
        d='M12 18v3'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
    </svg>
  );
}

export function WaveformIcon(props: ComponentProps<'svg'>) {
  return (
    <svg width='18' height='18' viewBox='0 0 24 24' fill='none' {...props}>
      <path
        d='M4 12v0'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      <path
        d='M8 9v6'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      <path
        d='M12 5v14'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      <path
        d='M16 9v6'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      <path
        d='M20 11v2'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
    </svg>
  );
}

export function SpeakerIcon(props: ComponentProps<'svg'>) {
  return (
    <svg width='18' height='18' viewBox='0 0 24 24' fill='none' {...props}>
      <path
        d='M11 5 6 9H3v6h3l5 4z'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinejoin='round'
      />
      <path
        d='M16 9a5 5 0 0 1 0 6'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      <path
        d='M19 6a9 9 0 0 1 0 12'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
    </svg>
  );
}

export function StopIcon(props: ComponentProps<'svg'>) {
  return (
    <svg
      width='20'
      height='20'
      viewBox='0 0 24 24'
      fill='currentColor'
      {...props}
    >
      <rect x='5' y='5' width='14' height='14' rx='2' />
    </svg>
  );
}
