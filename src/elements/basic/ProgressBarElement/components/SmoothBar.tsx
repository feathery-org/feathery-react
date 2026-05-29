import React, { useEffect, useState } from 'react';

let formerProgress: number | undefined;

function SmoothBar({ styles, percent, vertical = false }: any) {
  const [curProgress, setCurProgress] = useState(formerProgress);

  useEffect(() => {
    if (percent !== curProgress) {
      setCurProgress(percent);
      formerProgress = percent;
    }
  }, [percent]);

  const mainDim = vertical ? 'height' : 'width';
  const crossDim = vertical ? 'width' : 'height';

  return (
    <div
      css={{
        [crossDim]: '0.4rem',
        [mainDim]: '100%',
        flexDirection: vertical ? 'column-reverse' : undefined,
        borderRadius: 0,
        display: 'flex',
        backgroundColor: '#e9ecef',
        ...styles.getTarget('barWrapper')
      }}
    >
      <div
        style={{ [mainDim]: `${curProgress}%` }}
        css={{
          transition: `${mainDim} 0.6s ease`,
          // TODO: hack to not override bar mobile styles for now
          ...styles.getTarget('barWrapper', true),
          ...styles.getTarget('bar')
        }}
      />
    </div>
  );
}

export default SmoothBar;
