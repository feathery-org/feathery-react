import React from 'react';

export default function MicrophoneIcon({
  width = '20px',
  color = '#414859',
  style
}: any) {
  return (
    <svg
      width={width}
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      style={style}
    >
      <rect
        x='9'
        y='2'
        width='6'
        height='13'
        rx='3'
        stroke={color}
        strokeWidth='1.5'
      />
      <path
        d='M5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8'
        stroke={color}
        strokeWidth='1.5'
        strokeLinecap='round'
      />
    </svg>
  );
}
