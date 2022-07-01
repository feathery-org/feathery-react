import { isNum } from './primitives';

const TEXT_VARIABLE_PATTERN = /{{.*?}}/g;

const FIT = 'fit';
const FILL = 'fill';

const isFill = (v) => {
  return v === FILL;
};

const formatDimensionValue = (value, type = 'col') => {
  // fit-content is needed here, for both fill and fit, to allow elements to push beyond the parent container's explicit height.
  switch (value) {
    case FILL:
      return type === 'col' ? '100%' : 'fit-content';
    case FIT:
      return type === 'col' ? 'auto' : 'fit-content';
    default:
      return parseInt(value);
  }
};

const calculateDimensionsHelper = (step, p = '') => {
  const gridWidth = step[`${p}width`] || step.width;
  const gridHeight = step[`${p}height`] || step.height;

  const dimensions = {
    gridWidth: formatDimensionValue(gridWidth, 'col'),
    gridHeight: formatDimensionValue(gridHeight, 'row')
  };

  // to allow responsiveness, min width shouldn't be set for fixed widths
  dimensions.minWidth = isNum(gridWidth) ? undefined : dimensions.gridWidth;

  // min and max height must be 100% to prevent fit-content from collapsing, which would break fill's non-collapsing intent
  dimensions.minHeight = isFill(gridHeight) ? '100%' : dimensions.gridHeight;

  return dimensions;
};

/**
 * Calculates the dimensions of the provided step.
 * Note: The provided step should be fully-hydrated (i.e. rows injected, etc.) to calculate dimensions accurately.
 */
function calculateStepCSS(step) {
  const desktop = calculateDimensionsHelper(step);
  const mobile = calculateDimensionsHelper(step, 'mobile_');

  const stepCSS = {
    backgroundColor: `#${step.default_background_color}`,
    backgroundImage: `url("${step.background_image_url}")`,
    backgroundSize: 'cover',
    width: desktop.gridWidth,
    minWidth: desktop.minWidth,
    maxWidth: desktop.gridWidth,
    height: desktop.gridHeight,
    minHeight: desktop.minHeight,
    maxHeight: desktop.maxHeight
  };

  // 478
  stepCSS[`@media (max-width: 478px)`] = {
    width: mobile.gridWidth,
    minWidth: mobile.minWidth,
    maxWidth: mobile.gridWidth,
    height: mobile.gridHeight,
    minHeight: mobile.minHeight,
    maxHeight: desktop.maxHeight
  };

  return stepCSS;
}

export { TEXT_VARIABLE_PATTERN, calculateStepCSS };
