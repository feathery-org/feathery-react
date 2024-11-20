import React, { useEffect, useState } from 'react';

let formerProgress: number | undefined;

function SmoothBar({ styles, percent }: any) {
  const [curProgress, setCurProgress] = useState(formerProgress);

  useEffect(() => {
    // This allows the user to see a smooth progress bar animation from former progress amount to current amount
    if (percent !== curProgress) {
      setCurProgress(percent);
      formerProgress = percent;
    }
  }, [percent]);

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
        style={{ width: `${curProgress}%` }}
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
