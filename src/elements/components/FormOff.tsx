import React from 'react';
import { FormClosedIcon } from './icons';

export default function FormOff({ width = 392, noEdit = false }) {
  const message = noEdit
    ? 'You have successfully filled out the form.'
    : "This form isn't currently collecting responses.";
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        minHeight: '50vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center'
      }}
    >
      <FormClosedIcon width={width} />
      <div
        style={{
          width: `${width}px`,
          fontWeight: 600,
          fontSize: '26px',
          lineHeight: '32px',
          textAlign: 'center',
          margin: '50px 0'
        }}
      >
        {message}
      </div>
    </div>
  );
}
