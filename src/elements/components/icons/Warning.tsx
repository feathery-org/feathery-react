import React from 'react';

export default function WarningIcon({
  width = 32,
  height = 32,
  color = '#414859'
}) {
  return (
    <svg
      width={width}
      height={height}
      viewBox='0 0 32 32'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M16.0281 17.9627V12.1078'
        stroke={color}
        strokeWidth='2.8947'
        strokeMiterlimit='10'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M16.0281 22.5588V22.1093'
        stroke={color}
        strokeWidth='2.8947'
        strokeMiterlimit='10'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M26.142 26.8853H5.85803C4.45333 26.8853 3.55432 25.3682 4.22858 24.1321L14.3986 5.9271C15.0729 4.69097 16.9271 4.69097 17.6014 5.9271L27.7714 24.1321C28.4457 25.3682 27.5467 26.8853 26.142 26.8853Z'
        stroke={color}
        strokeWidth='2.8947'
        strokeMiterlimit='10'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
}
