import React, { useMemo } from 'react';
import { isNum } from '../../../utils/primitives';
import SmoothBar from './components/SmoothBar';
import SegmentBar from './components/SegmentBar';
import StepperBar from './components/StepperBar';

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
  stepKey,
  changeStep,
  elementProps = {},
  children
}: any) {
  const styles = useMemo(
    () => applyProgressBarStyles(responsiveStyles),
    [responsiveStyles]
  );

  const vertical = element.styles.bar_direction === 'vertical';

  const containerProps = {
    css: {
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      width: '100%',
      ...(vertical && { height: '100%' }),
      ...styles.getTarget('barContainer')
    },
    ...elementProps
  };

  if (element.properties?.stepper) {
    return (
      <div {...containerProps}>
        {children}
        <StepperBar
          styles={styles}
          stepConfigs={element.properties?.stepper_steps ?? []}
          stepKey={stepKey}
          textPlacement={element.styles.percent_text_layout}
          onStepClick={changeStep}
          vertical={vertical}
          style={vertical ? { flex: 1 } : undefined}
        />
      </div>
    );
  }

  let userProgress, userSegments;
  if (![null, undefined].includes(progress)) {
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

  const textPlacement = element.styles.percent_text_layout;
  const showText = textPlacement && textPlacement !== 'none';

  const BarComponent = userSegments ? SegmentBar : SmoothBar;
  const progressBarElements: React.ReactNode[] = [
    <BarComponent
      key='progress'
      styles={styles}
      percent={percent}
      numSegments={userSegments}
      vertical={vertical}
    />
  ];
  const completionPercentage = vertical ? (
    <div
      key='completionPercentage'
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0 8px',
        whiteSpace: 'nowrap'
      }}
    >
      {`${percent}% completed`}
    </div>
  ) : (
    <div
      key='completionPercentage'
      style={{ width: '100%', textAlign: 'center' }}
    >
      {`${percent}% completed`}
    </div>
  );
  if (textPlacement === 'top') {
    progressBarElements.unshift(completionPercentage);
  } else if (textPlacement === 'bottom') {
    progressBarElements.push(completionPercentage);
  }

  // When vertical with text beside the bar, switch to row layout
  const flexDirection =
    vertical && showText ? ('row' as const) : ('column' as const);

  return (
    <div
      {...containerProps}
      css={{
        ...containerProps.css,
        flexDirection
      }}
    >
      {children}
      {progressBarElements}
    </div>
  );
}

export default ProgressBarElement;
