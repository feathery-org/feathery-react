import React from 'react';

export default function PencilIcon({
  width = 16,
  height = 16,
  ...props
}: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={width}
      height={height}
      fill='none'
      viewBox='0 0 24 24'
      stroke='currentColor'
      strokeWidth={2}
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <path
        strokeLinecap='round'
        strokeLinejoin='round'
        d='M15.232 5.232l3.536 3.536M9 20H5v-4L16.732 4.268a2.5 2.5 0 013.536 3.536L9 20z'
      />
    </svg>
  );
}
