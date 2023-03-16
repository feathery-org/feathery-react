import { isNum } from './primitives';

export const MIN_AXIS_SIZE = 15;

export const FIT = 'fit';
export const FILL = 'fill';

export const isFill = (v: any) => v === FILL;
export const isFit = (v: any) => v === FIT;
export const isPx = (v: string) =>
  typeof v === 'string' && v.indexOf('px') >= 0;

export const getPxValue = (size: string) => {
  return isPx(size) ? Number.parseFloat(size) : MIN_AXIS_SIZE;
};

const formatDimensionValue = (value: any, type: string) => {
  // fit-content is needed here, for both fill and fit, to allow elements to push beyond the parent container's explicit height.
  switch (value) {
    case FILL:
      return type === 'width' ? '100%' : 'max-content';
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
    gridWidth: formatDimensionValue(gridWidth, 'width'),
    gridHeight: formatDimensionValue(gridHeight, 'height')
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
function calculateStepCSS(step: any) {
  if (!step) return {};

  const desktop = calculateDimensionsHelper(step);
  const mobile = calculateDimensionsHelper(step, 'mobile_');

  const stepCSS = {
    backgroundColor: `#${step.default_background_color}`,
    backgroundImage: `url("${step.background_image_url}")`,
    backgroundSize: 'cover',
    width: '100%',
    minWidth: (desktop as any).minWidth,
    maxWidth: desktop.gridWidth,
    height: desktop.gridHeight,
    minHeight: (desktop as any).minHeight,
    maxHeight: (desktop as any).maxHeight
  };

  // 478
  // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
  stepCSS[`@media (max-width: 478px)`] = {
    // width will be controlled by maxWidth in the case it is fixed below 478px
    width: '100%',
    minWidth: (mobile as any).minWidth,
    maxWidth: mobile.gridWidth,
    height: mobile.gridHeight,
    minHeight: (mobile as any).minHeight,
    maxHeight: (desktop as any).maxHeight
  };

  return stepCSS;
}

export { calculateStepCSS };
