import React from 'react';

export default function DownloadIcon({ width = 26, height = 26 }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox='0 0 26 26'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M1 19.3529V22.1765C1 22.9253 1.31607 23.6435 1.87868 24.173C2.44129 24.7025 3.20435 25 4 25H22C22.7956 25 23.5587 24.7025 24.1213 24.173C24.6839 23.6435 25 22.9253 25 22.1765V19.3529M5.5 10.8824L13 17.9412M13 17.9412L20.5 10.8824M13 17.9412V1'
        stroke='white'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
}
