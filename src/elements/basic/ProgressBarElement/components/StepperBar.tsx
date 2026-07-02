import React from 'react';
import { getCompletedStepKeys } from '../../../../utils/init';
import {
  isStepperStepReachable,
  isStepperStepVisible
} from '../../../../utils/stepper';

const CIRCLE_SIZE = 28;
const CONNECTOR_GAP = 4;

type StepConfig = {
  label: string;
  step_key: string;
  visibility_field_key?: string;
  visibility_condition?: '' | 'show' | 'hide';
};

function StepperBar({
  styles,
  stepConfigs,
  stepKey,
  textPlacement = 'bottom',
  onStepClick,
  allowAllNavigation = false,
  vertical = false,
  style
}: {
  styles: any;
  stepConfigs: StepConfig[];
  stepKey?: string;
  textPlacement?: string;
  onStepClick?: (stepKey: string) => void;
  allowAllNavigation?: boolean;
  vertical?: boolean;
  style?: React.CSSProperties;
}) {
  const barStyles = styles.getTarget('bar');
  const showLabels = textPlacement !== 'none';
  const visibleStepConfigs = stepConfigs.filter(isStepperStepVisible);
  const steps = visibleStepConfigs.map((s) => s.label);
  const activeStep = stepKey
    ? Math.max(
        0,
        visibleStepConfigs.findIndex((s) => s.step_key === stepKey)
      )
    : 0;

  const completedStepKeys = getCompletedStepKeys();

  const mainDim = vertical ? 'height' : 'width';
  const crossAlign = vertical ? 'alignItems' : 'justifyContent';

  // Halo around the active step's circle so it reads as the current step even
  // though it shares the filled bar color with completed steps.
  const activeRingColor = barStyles.backgroundColor ?? '#888';
  const circleStyleFor = (isCompleted: boolean, isActive: boolean) => {
    if (isActive)
      return {
        ...barStyles,
        color: '#fff',
        boxShadow: `0 0 0 2px #fff, 0 0 0 4px ${activeRingColor}`
      };
    if (isCompleted) return { ...barStyles, color: '#fff' };
    return { backgroundColor: '#e9ecef', color: '#888' };
  };

  const circleContent = (isCompleted: boolean, index: number) =>
    isCompleted ? (
      <svg
        width='14'
        height='14'
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        strokeWidth='2.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      >
        <polyline points='20 6 9 17 4 12' />
      </svg>
    ) : (
      index + 1
    );

  const renderNodes = () =>
    steps.map((_, index) => {
      const isActive = index === activeStep;
      const isLast = index === steps.length - 1;
      const sKey = visibleStepConfigs?.[index]?.step_key;
      // A step is completed only if it was actually submitted. Steps skipped
      // over (navigated past without submitting) stay uncompleted even when
      // they sit behind the current step.
      const isCompleted = !!sKey && completedStepKeys.has(sKey);
      // With all-step navigation on, any step other than the current one is
      // clickable; otherwise only completed (already-visited) steps are.
      const isClickable =
        !!onStepClick &&
        !!sKey &&
        isStepperStepReachable(isActive, allowAllNavigation, isCompleted);

      const connectorStyle = vertical
        ? {
            width: '2px',
            flex: 1,
            marginTop: `${CONNECTOR_GAP}px`,
            marginBottom: `${CONNECTOR_GAP}px`
          }
        : {
            flex: 1,
            height: '2px',
            marginLeft: `${CONNECTOR_GAP}px`,
            marginRight: `${CONNECTOR_GAP}px`
          };

      return (
        <React.Fragment key={index}>
          <div
            css={{
              width: `${CIRCLE_SIZE}px`,
              height: `${CIRCLE_SIZE}px`,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '13px',
              fontWeight: 600,
              flexShrink: 0,
              cursor: isClickable ? 'pointer' : 'default',
              transition: 'opacity 0.15s ease',
              '&:hover': isClickable ? { opacity: 0.7 } : {},
              ...circleStyleFor(isCompleted, isActive)
            }}
            onClick={isClickable ? () => onStepClick(sKey) : undefined}
          >
            {circleContent(isCompleted && !isActive, index)}
          </div>
          {!isLast && (
            <div
              css={{
                ...connectorStyle,
                // Connectors track progress to the active step: fill every
                // connector up to (and into) the active node, regardless of
                // which individual steps were completed vs skipped.
                ...(index < activeStep
                  ? barStyles
                  : { backgroundColor: '#e9ecef' })
              }}
            />
          )}
        </React.Fragment>
      );
    });

  const renderLabelItems = () =>
    steps.map((label, index) => {
      const isLast = index === steps.length - 1;
      return (
        <React.Fragment key={index}>
          <div
            style={{
              [mainDim]: `${CIRCLE_SIZE}px`,
              display: 'flex',
              [crossAlign]: 'center',
              flexShrink: 0
            }}
          >
            <span
              css={{
                fontSize: '12px',
                whiteSpace: 'nowrap',
                ...(vertical ? {} : { textAlign: 'center' }),
                ...styles.getTarget('barContainer')
              }}
            >
              {label}
            </span>
          </div>
          {!isLast && (
            <div
              style={{
                flex: 1,
                ...(vertical
                  ? {
                      marginTop: `${CONNECTOR_GAP}px`,
                      marginBottom: `${CONNECTOR_GAP}px`
                    }
                  : {
                      marginLeft: `${CONNECTOR_GAP}px`,
                      marginRight: `${CONNECTOR_GAP}px`
                    })
              }}
            />
          )}
        </React.Fragment>
      );
    });

  if (vertical) {
    // textPlacement 'bottom' → labels on left, 'top' → labels on right
    const labelsOnLeft = textPlacement === 'bottom';

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: labelsOnLeft ? 'row-reverse' : 'row',
          height: '100%',
          gap: showLabels ? '10px' : '0',
          ...style
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: `${CIRCLE_SIZE}px`
          }}
        >
          {renderNodes()}
        </div>
        {showLabels && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {renderLabelItems()}
          </div>
        )}
      </div>
    );
  }

  // Horizontal layout
  const labelsOnTop = textPlacement === 'top';
  const marginProp = labelsOnTop ? 'marginBottom' : 'marginTop';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      {showLabels && labelsOnTop && (
        <div style={{ display: 'flex', [marginProp]: '6px' }}>
          {renderLabelItems()}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {renderNodes()}
      </div>
      {showLabels && !labelsOnTop && (
        <div style={{ display: 'flex', [marginProp]: '6px' }}>
          {renderLabelItems()}
        </div>
      )}
    </div>
  );
}

export default StepperBar;
