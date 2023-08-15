import React from 'react';

export default function BorderlessEyeIcon({
  width = 24,
  height = 24,
  color = '#414859',
  ...props
}) {
  return (
    <svg
      width={width}
      height={height}
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <path
        d='M12 6C7.99091 6 4.55455 8.48571 3 12C4.55455 15.5143 7.99091 18 12 18C16.0091 18 19.4455 15.5143 21 12C19.4455 8.48571 16.0091 6 12 6Z'
        stroke={color}
        strokeWidth='2'
        strokeMiterlimit='10'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M12 14C13.1046 14 14 13.1046 14 12C14 10.8954 13.1046 10 12 10C10.8954 10 10 10.8954 10 12C10 13.1046 10.8954 14 12 14Z'
        fill={color}
      />
    </svg>
  );
}
