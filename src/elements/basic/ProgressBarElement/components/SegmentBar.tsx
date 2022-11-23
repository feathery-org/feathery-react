import React from 'react';

function SegmentBar({ styles, percent, numSegments }: any) {
  const numFilled = Math.floor(percent / (100 / numSegments));
  const filledSegments = [];
  for (let i = 0; i < numFilled; i++) {
    const spacer = i === numSegments - 1 ? 0 : 5;
    filledSegments.push(
      <div
        key={i}
        style={{
          width: `calc(${100 / numSegments}% - ${spacer}px)`,
          marginRight: `${spacer}px`,
          borderRadius: '2px',
          ...styles.getTarget('bar')
        }}
      />
    );
  }
  return (
    <div
      style={{
        height: '0.4rem',
        width: '100%',
        display: 'flex',
        backgroundColor: '#e9ecef',
        borderRadius: '2px'
      }}
    >
      {filledSegments}
    </div>
  );
}

export default SegmentBar;
