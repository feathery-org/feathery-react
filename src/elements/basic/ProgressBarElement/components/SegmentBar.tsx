import React from 'react';

function SegmentBar({ styles, percent, numSegments, vertical = false }: any) {
  const mainDim = vertical ? 'height' : 'width';
  const crossDim = vertical ? 'width' : 'height';
  const spacerProp = vertical ? 'marginBottom' : 'marginRight';

  const numFilled = Math.floor(percent / (100 / numSegments));
  const filledSegments = [];
  for (let i = 0; i < numFilled; i++) {
    const spacer = i === numSegments - 1 ? 0 : 5;
    filledSegments.push(
      <div
        key={i}
        css={{
          [mainDim]: `calc(${100 / numSegments}% - ${spacer}px)`,
          [spacerProp]: `${spacer}px`,
          borderRadius: '2px',
          // TODO: hack to not override bar mobile styles for now
          ...styles.getTarget('barWrapper', true),
          ...styles.getTarget('bar')
        }}
      />
    );
  }

  return (
    <div
      style={{
        [crossDim]: '0.4rem',
        [mainDim]: '100%',
        flexDirection: vertical ? ('column-reverse' as const) : undefined,
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
