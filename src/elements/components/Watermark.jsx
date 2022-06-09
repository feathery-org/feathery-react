import React from 'react';

export default function Watermark({ width = 127, height = 40 }) {
  return (
    <div
      style={{
        width: `${width}px`,
        height: `${height}px`,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: '#FFFFFF',
        boxShadow: '0px 2px 10px rgba(151, 161, 172, 0.3)',
        borderRadius: '6px',
        color: '#6c7589',
        fontFamily: 'Axiforma, sans-serif',
        fontSmoothing: 'antialiased',
        fontWeight: 400,
        fontSize: '10px',
        gap: '5px',
        pointerEvents: 'none'
      }}
    >
      <span>Built on</span>
      <img
        src='https://feathery.s3.us-west-1.amazonaws.com/full-logo.png'
        alt='Feathery Logo'
      />
    </div>
  );
}
