import React from 'react';
import { getFieldValues } from '../../../../utils/init';

const CIRCLE_SIZE = 28;
const CONNECTOR_GAP = 6;

type StepConfig = {
  label: string;
  step_key: string;
  visibility_field_key?: string;
  visibility_condition?: '' | 'show' | 'hide';
};

function isFieldTruthy(fieldKey: string): boolean {
  const val = getFieldValues()[fieldKey];
  if (Array.isArray(val)) return val.length > 0;
  return !!val;
}

function isStepVisible(step: StepConfig): boolean {
  const cond = step.visibility_condition;
  if (!cond || !step.visibility_field_key) return true;
  const truthy = isFieldTruthy(step.visibility_field_key);
  return cond === 'show' ? truthy : !truthy;
}

function StepperBar({
  styles,
  stepConfigs,
  stepKey,
  textPlacement = 'bottom',
  onStepClick,
  vertical = false,
  style
}: {
  styles: any;
  stepConfigs: StepConfig[];
  stepKey?: string;
  textPlacement?: string;
  onStepClick?: (stepKey: string) => void;
  vertical?: boolean;
  style?: React.CSSProperties;
}) {
  const barStyles = styles.getTarget('bar');
  const showLabels = textPlacement !== 'none';
  const visibleStepConfigs = stepConfigs.filter(isStepVisible);
  const steps = visibleStepConfigs.map((s) => s.label);
  const activeStep = stepKey
    ? Math.max(
        0,
        visibleStepConfigs.findIndex((s) => s.step_key === stepKey)
      )
    : 0;

  const mainDim = vertical ? 'height' : 'width';
  const crossAlign = vertical ? 'alignItems' : 'justifyContent';

  const circleStyleFor = (isCompleted: boolean, isActive: boolean) => {
    if (isActive || isCompleted) return { ...barStyles, color: '#fff' };
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
      const isCompleted = index < activeStep;
      const isActive = index === activeStep;
      const isLast = index === steps.length - 1;
      const sKey = visibleStepConfigs?.[index]?.step_key;
      const isClickable = isCompleted && !!onStepClick && !!sKey;

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
            {circleContent(isCompleted, index)}
          </div>
          {!isLast && (
            <div
              css={{
                ...connectorStyle,
                ...(isCompleted ? barStyles : { backgroundColor: '#e9ecef' })
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
