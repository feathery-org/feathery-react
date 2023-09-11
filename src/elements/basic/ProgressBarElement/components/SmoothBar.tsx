import React from 'react';

function SmoothBar({ styles, percent }: any) {
  return (
    <div
      style={{
        height: '0.4rem',
        width: '100%',
        borderRadius: 0,
        display: 'flex',
        backgroundColor: '#e9ecef',
        ...styles.getTarget('barWrapper')
      }}
    >
      <div
        style={{ width: `${percent}%` }}
        css={{
          transition: 'width 0.6s ease',
          // TODO: hack to not override bar mobile styles for now
          ...styles.getTarget('barWrapper', true),
          ...styles.getTarget('bar')
        }}
      />
    </div>
  );
}

export default SmoothBar;
