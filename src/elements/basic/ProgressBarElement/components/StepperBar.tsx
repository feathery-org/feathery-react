import React from 'react';

const CIRCLE_SIZE = 28;
const CONNECTOR_GAP = 6;

type StepConfig = { label: string; step_key: string };

function StepperBar({
  styles,
  stepConfigs,
  stepKey,
  textPlacement = 'bottom',
  onStepClick
}: {
  styles: any;
  stepConfigs: StepConfig[];
  stepKey?: string;
  textPlacement?: string;
  onStepClick?: (stepKey: string) => void;
}) {
  const barStyles = styles.getTarget('bar');
  const showLabels = textPlacement !== 'none';
  const labelsOnTop = textPlacement === 'top';
  const steps = stepConfigs.map((s) => s.label);
  const activeStep = stepKey
    ? Math.max(
        0,
        stepConfigs.findIndex((s) => s.step_key === stepKey)
      )
    : 0;

  const circleStyleFor = (isCompleted: boolean, isActive: boolean) => {
    if (isActive) {
      return { ...barStyles, color: '#fff' };
    }
    if (isCompleted) return { ...barStyles, color: '#fff' };
    return { backgroundColor: '#e9ecef', color: '#888' };
  };

  // Labels row — same flex structure as circles row so each label sits
  // directly above/below its circle without affecting circle layout.
  const labelsRow = (margin: 'marginTop' | 'marginBottom') => (
    <div style={{ display: 'flex', [margin]: '6px' }}>
      {steps.map((label, index) => {
        const isLast = index === steps.length - 1;
        return (
          <React.Fragment key={index}>
            <div
              style={{
                width: `${CIRCLE_SIZE}px`,
                flexShrink: 0,
                display: 'flex',
                justifyContent: 'center'
              }}
            >
              <span
                css={{
                  whiteSpace: 'nowrap',
                  fontSize: '12px',
                  textAlign: 'center',
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
                  marginLeft: `${CONNECTOR_GAP}px`,
                  marginRight: `${CONNECTOR_GAP}px`
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      {showLabels && labelsOnTop && labelsRow('marginBottom')}

      <div style={{ display: 'flex', alignItems: 'center' }}>
        {steps.map((_, index) => {
          const isCompleted = index < activeStep;
          const isActive = index === activeStep;
          const isLast = index === steps.length - 1;
          const stepKey = stepConfigs?.[index]?.step_key;
          const isClickable = isCompleted && !!onStepClick && !!stepKey;

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
                onClick={isClickable ? () => onStepClick(stepKey) : undefined}
              >
                {isCompleted ? (
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
                )}
              </div>
              {!isLast && (
                <div
                  css={{
                    flex: 1,
                    height: '2px',
                    marginLeft: `${CONNECTOR_GAP}px`,
                    marginRight: `${CONNECTOR_GAP}px`,
                    ...(isCompleted
                      ? barStyles
                      : { backgroundColor: '#e9ecef' })
                  }}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {showLabels && !labelsOnTop && labelsRow('marginTop')}
    </div>
  );
}

export default StepperBar;
