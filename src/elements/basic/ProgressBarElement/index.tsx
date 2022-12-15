import React, { useMemo } from 'react';
import { isNum } from '../../../utils/primitives';
import SmoothBar from './components/SmoothBar';
import SegmentBar from './components/SegmentBar';

function applyProgressBarStyles(element: any, responsiveStyles: any) {
  responsiveStyles.addTargets('barContainer', 'bar');

  responsiveStyles.applyFontStyles('barContainer');
  responsiveStyles.apply('barContainer', 'vertical_layout', (a: any) => ({
    justifyContent: a
  }));
  responsiveStyles.apply('barContainer', 'layout', (a: any) => ({
    alignItems: a
  }));
  responsiveStyles.apply('barContainer', 'width', (a: any) => ({
    width: `${a}%`
  }));

  responsiveStyles.apply('bar', 'bar_color', (a: any) => ({
    backgroundColor: `#${a}`
  }));

  return responsiveStyles;
}

function ProgressBarElement({
  element,
  responsiveStyles,
  progress,
  curDepth = 1,
  maxDepth = 1,
  elementProps = {},
  children
}: any) {
  const styles = useMemo(
    () => applyProgressBarStyles(element, responsiveStyles),
    [responsiveStyles]
  );

  let userProgress, userSegments;
  if (progress) {
    if (typeof progress === 'number') {
      userProgress = progress;
    } else {
      userProgress = progress.progress;
      userSegments = progress.segments ?? element.properties.num_segments;
    }
  }

  userProgress = userProgress ?? element.properties?.progress;
  const percent = isNum(userProgress)
    ? userProgress
    : Math.round((100 * curDepth) / (maxDepth || 1));

  const BarComponent = userSegments ? SegmentBar : SmoothBar;
  const progressBarElements = [
    <BarComponent
      key='progress'
      styles={styles}
      percent={percent}
      numSegments={userSegments}
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
