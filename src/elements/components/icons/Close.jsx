import React from 'react';

export default function CloseIcon({
  width = 24,
  height = 24,
  fill = '#414859'
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
        d='M9.546 6.954a1.5 1.5 0 1 0-2.121 2.121l2.12-2.12Zm14.85 19.092a1.5 1.5 0 1 0 2.12-2.121l-2.12 2.12ZM7.424 9.076l16.97 16.97 2.122-2.121L9.546 6.954 7.425 9.075Z'
        fill={fill}
      />
      <path
        d='M7.425 23.925a1.5 1.5 0 0 0 2.12 2.121l-2.12-2.121Zm19.091-14.85a1.5 1.5 0 1 0-2.12-2.12l2.12 2.12ZM9.547 26.046l16.97-16.97-2.12-2.122-16.971 16.97 2.12 2.122Z'
        fill={fill}
      />
    </svg>
  );
}
