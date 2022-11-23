import React, { useMemo } from 'react';
import ProgressBar from 'react-bootstrap/ProgressBar';
import { isNum } from '../../../utils/primitives';
import { openTab } from '../../../utils/browser';
import SmoothBar from './components/SmoothBar';
import SegmentBar from './components/SegmentBar';

function applyProgressBarStyles(element: any, applyStyles: any) {
  applyStyles.addTargets('barContainer', 'bar');

  applyStyles.applyFontStyles('barContainer');
  applyStyles.apply('barContainer', 'vertical_layout', (a: any) => ({
    justifyContent: a
  }));
  applyStyles.apply('barContainer', 'layout', (a: any) => ({
    alignItems: a
  }));
  applyStyles.apply('barContainer', 'width', (a: any) => ({
    width: `${a}%`
  }));

  applyStyles.apply('bar', 'bar_color', (a: any) => ({
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
}: any) {
  const styles = useMemo(
    () => applyProgressBarStyles(element, applyStyles),
    [applyStyles]
  );

  const actualProgress = progress ?? element.properties?.progress;
  const percent = isNum(actualProgress)
    ? actualProgress
    : Math.round((100 * curDepth) / (maxDepth || 1));
  const BarComponent = element.properties.num_segments ? SegmentBar : SmoothBar;
  const progressBarElements = [
    <BarComponent
      key='progress'
      styles={styles}
      percent={percent}
      numSegments={element.properties.num_segments}
    />
  ];
  const completionPercentage = (
    <div
      key='completionPercentage'
      style={{ width: '100%', textAlign: 'center' }}
    >
      {`${percent}% completed`}
    </div>
  );
  if (element.styles.percent_text_layout === 'top') {
    progressBarElements.unshift(completionPercentage);
  } else if (element.styles.percent_text_layout === 'bottom') {
    progressBarElements.push(completionPercentage);
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
      {children}
      {progressBarElements}
    </div>
  );
}

export default ProgressBarElement;
