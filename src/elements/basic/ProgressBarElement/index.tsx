import React, { useMemo } from 'react';
import { isNum } from '../../../utils/primitives';
import SmoothBar from './components/SmoothBar';
import SegmentBar from './components/SegmentBar';

function applyProgressBarStyles(responsiveStyles: any) {
  responsiveStyles.addTargets('barContainer', 'bar', 'barWrapper');

  responsiveStyles.applyFontStyles('barContainer');
  responsiveStyles.apply('barContainer', 'vertical_align', (a: any) => ({
    justifyContent: a
  }));
  responsiveStyles.apply('barContainer', 'horizontal_align', (a: any) => ({
    alignItems: a
  }));
  responsiveStyles.applyCorners('barWrapper');

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
    () => applyProgressBarStyles(responsiveStyles),
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
    : Math.round((100 * (curDepth + 1)) / ((maxDepth || 1) + 1));

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
        width: '100%',
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
