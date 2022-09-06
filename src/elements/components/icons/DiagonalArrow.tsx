import React from 'react';

export default function DiagonalArrowIcon({ width = 24, height = 24 }) {
  return (
    <svg
      width={width}
      height={height}
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      viewBox='9 9 15 15'
    >
      <path
        d='m14.293 11.249 8.278.008.007 8.277M11.257 22.57 22.57 11.257'
        stroke='#414859'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
}
