import React from 'react';
import { getCompletedStepKeys } from '../../../../utils/init';
import {
  isStepperStepReachable,
  isStepperStepVisible
} from '../../../../utils/stepper';

const CIRCLE_SIZE = 28;
const VERTICAL_CONNECTOR_GAP = 4;

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
  const labelStyles = styles.getTarget('barContainer');
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

  // Connectors track progress to the active step: fill every connector
  // leading up to the active step, regardless of which steps were
  // completed vs skipped by navigation.
  const connectorStyle = (segmentIndex: number) =>
    segmentIndex < activeStep ? barStyles : { backgroundColor: '#e9ecef' };

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

  const renderCircle = (index: number) => {
    const isActive = index === activeStep;
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

    return (
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
    );
  };

  const renderVerticalNodes = () =>
    steps.map((_, index) => {
      const isLast = index === steps.length - 1;
      return (
        <React.Fragment key={index}>
          {renderCircle(index)}
          {!isLast && (
            <div
              css={{
                width: '2px',
                flex: 1,
                marginTop: `${VERTICAL_CONNECTOR_GAP}px`,
                marginBottom: `${VERTICAL_CONNECTOR_GAP}px`,
                ...connectorStyle(index)
              }}
            />
          )}
        </React.Fragment>
      );
    });

  const renderVerticalLabelItems = () =>
    steps.map((label, index) => {
      const isLast = index === steps.length - 1;
      return (
        <React.Fragment key={index}>
          <div
            style={{
              height: `${CIRCLE_SIZE}px`,
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0
            }}
          >
            <span
              css={{
                fontSize: '12px',
                whiteSpace: 'nowrap',
                ...labelStyles
              }}
            >
              {label}
            </span>
          </div>
          {!isLast && (
            <div
              style={{
                flex: 1,
                marginTop: `${VERTICAL_CONNECTOR_GAP}px`,
                marginBottom: `${VERTICAL_CONNECTOR_GAP}px`
              }}
            />
          )}
        </React.Fragment>
      );
    });

  // Limit each step column to one equal share so long labels can wrap.
  const horizontalStepMaxWidth = `calc(100% / ${Math.max(steps.length, 1)})`;
  // Odd tracks hold the steps. The tracks between them stretch for connectors.
  const horizontalGridColumns =
    steps.length <= 1
      ? 'minmax(0, 1fr)'
      : steps
          .flatMap((_, index) => [
            `fit-content(${horizontalStepMaxWidth})`,
            ...(index < steps.length - 1 ? ['minmax(0, 1fr)'] : [])
          ])
          .join(' ');
  const renderHorizontalStepper = (labelsOnTop: boolean) => {
    const labelRow = labelsOnTop ? 1 : 2;
    const nodeRow = labelsOnTop && showLabels ? 2 : 1;
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: horizontalGridColumns,
          gridTemplateRows: showLabels
            ? labelsOnTop
              ? 'auto 28px'
              : '28px auto'
            : '28px',
          rowGap: showLabels ? '6px' : '0',
          alignItems: 'center',
          width: '100%'
        }}
      >
        {steps.map((label, index) => {
          const stepColumn = index * 2 + 1;
          const isLast = index === steps.length - 1;
          return (
            <React.Fragment key={index}>
              {showLabels && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    minWidth: 0,
                    gridColumn: stepColumn,
                    gridRow: labelRow
                  }}
                >
                  <span
                    css={{
                      fontSize: '12px',
                      ...labelStyles,
                      minWidth: 0,
                      maxWidth: '100%',
                      whiteSpace: 'normal',
                      overflowWrap: 'anywhere',
                      textAlign: 'center'
                    }}
                  >
                    {label}
                  </span>
                </div>
              )}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `minmax(0, 1fr) ${CIRCLE_SIZE}px minmax(0, 1fr)`,
                  alignItems: 'center',
                  minWidth: 0,
                  gridColumn: stepColumn,
                  gridRow: nodeRow
                }}
              >
                {!index ? null : (
                  <div
                    css={{
                      gridColumn: 1,
                      height: '2px',
                      ...connectorStyle(index - 1)
                    }}
                  />
                )}
                <div
                  style={{
                    gridColumn: 2,
                    position: 'relative',
                    zIndex: 1
                  }}
                >
                  {renderCircle(index)}
                </div>
                {!isLast && (
                  <div
                    css={{
                      gridColumn: 3,
                      height: '2px',
                      ...connectorStyle(index)
                    }}
                  />
                )}
              </div>
              {!isLast && (
                <div
                  css={{
                    height: '2px',
                    alignSelf: 'center',
                    gridColumn: stepColumn + 1,
                    gridRow: nodeRow,
                    ...connectorStyle(index)
                  }}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

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
          {renderVerticalNodes()}
        </div>
        {showLabels && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {renderVerticalLabelItems()}
          </div>
        )}
      </div>
    );
  }

  // Horizontal layout
  const labelsOnTop = textPlacement === 'top';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      {renderHorizontalStepper(labelsOnTop)}
    </div>
  );
}

export default StepperBar;
