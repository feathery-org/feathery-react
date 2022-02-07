import React, { useMemo } from 'react';
import ProgressBar from 'react-bootstrap/ProgressBar';
import { isNum } from '../../utils/primitives';

function applyProgressBarStyles(element, applyStyles) {
  applyStyles.addTargets('barContainer', 'bar');

  applyStyles.applyFontStyles('barContainer');
  applyStyles.applyMargin('barContainer');
  applyStyles.apply('barContainer', 'vertical_layout', (a) => ({
    justifyContent: a
  }));
  applyStyles.apply('barContainer', 'layout', (a) => ({
    alignItems: a
  }));
  applyStyles.apply('barContainer', 'width', (a) => ({
    width: `${a}%`
  }));

  applyStyles.apply('bar', 'bar_color', (a) => ({
    backgroundColor: `#${a}`
  }));

  return applyStyles;
}

function ProgressBarElement({
  element,
  applyStyles,
  progress = null,
  curDepth = 1,
  maxDepth = 1,
  elementProps = {},
  children
}) {
  const styles = useMemo(() => applyProgressBarStyles(element, applyStyles), [
    applyStyles
  ]);

  const actualProgress = progress ?? element.properties?.progress;
  const percent = isNum(actualProgress)
    ? actualProgress
    : Math.round((100 * curDepth) / (maxDepth + 1));
  const progressBarElements = [
    <ProgressBar
      key='progress'
      style={{
        height: '0.4rem',
        width: '100%',
        borderRadius: 0,
        display: 'flex',
        backgroundColor: '#e9ecef'
      }}
      css={{
        '.progress-bar': {
          margin: '0 0 0 0 !important',
          transition: 'width 0.6s ease',
          ...styles.getTarget('bar')
        }
      }}
      now={percent}
    />
  ];
  const link = element.styles.font_link;
  const cursorStyle = link ? { cursor: 'pointer' } : {};
  const completionPercentage = (
    <div
      key='completionPercentage'
      style={{ width: '100%', textAlign: 'center', ...cursorStyle }}
      onClick={() => {
        if (link) window.open(link, '_blank');
      }}
    >
      {`${percent}% completed`}
    </div>
  );
  if (element.styles.percent_text_layout === 'top') {
    progressBarElements.splice(0, 0, completionPercentage);
  } else if (element.styles.percent_text_layout === 'bottom') {
    progressBarElements.splice(1, 0, completionPercentage);
  }

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        ...styles.getTarget('barContainer')
      }}
      {...elementProps}
    >
      {progressBarElements}
      {children}
    </div>
  );
}

export default ProgressBarElement;
