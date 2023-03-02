import { isNum } from './primitives';

const FIT = 'fit';
const FILL = 'fill';

export const isFill = (v: any) => {
  return v === FILL;
};

const formatDimensionValue = (value: any, type = 'col') => {
  // fit-content is needed here, for both fill and fit, to allow elements to push beyond the parent container's explicit height.
  switch (value) {
    case FILL:
      return type === 'col' ? '100%' : 'fit-content';
    case FIT:
      return 'fit-content';
    default:
      return parseInt(value);
  }
};

const calculateDimensionsHelper = (step: any, p = '') => {
  const gridWidth = step[`${p}width`] || step.width;
  const gridHeight = step[`${p}height`] || step.height;

  const dimensions = {
    gridWidth: formatDimensionValue(gridWidth, 'col'),
    gridHeight: formatDimensionValue(gridHeight, 'row')
  };

  // to allow responsiveness, min width shouldn't be set for fixed widths
  (dimensions as any).minWidth = isNum(gridWidth)
    ? undefined
    : dimensions.gridWidth;

  // min and max height must be 100% to prevent fit-content from collapsing, which would break fill's non-collapsing intent
  (dimensions as any).minHeight = isFill(gridHeight)
    ? '100%'
    : dimensions.gridHeight;

  return dimensions;
};

/**
 * Calculates the dimensions of the provided step.
 * Note: The provided step should be fully-hydrated (i.e. rows injected, etc.) to calculate dimensions accurately.
 */
function calculateStepCSS(step: any, max = true) {
  if (!step) return {};

  const desktop = calculateDimensionsHelper(step);
  const mobile = calculateDimensionsHelper(step, 'mobile_');

  const stepCSS = {
    backgroundColor: `#${step.default_background_color}`,
    backgroundImage: `url("${step.background_image_url}")`,
    backgroundSize: 'cover',
    width: '100%',
    minWidth: (desktop as any).minWidth,
    [max ? 'maxWidth' : 'width']: desktop.gridWidth,
    height: desktop.gridHeight,
    minHeight: (desktop as any).minHeight,
    maxHeight: (desktop as any).maxHeight
  };

  stepCSS[`@media (max-width: 478px)`] = {
    // width will be controlled by maxWidth in the case it is fixed below 478px
    width: '100%',
    minWidth: (mobile as any).minWidth,
    [max ? 'maxWidth' : 'width']: mobile.gridWidth,
    height: mobile.gridHeight,
    minHeight: (mobile as any).minHeight,
    maxHeight: (desktop as any).maxHeight
  };

  return stepCSS;
}

export { calculateStepCSS };
