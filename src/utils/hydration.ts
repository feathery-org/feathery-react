import { isNum } from './primitives';
import ResponsiveStyles from '../elements/styles';

export const MIN_AXIS_SIZE = 15;

export const FIT = 'fit';
export const FILL = 'fill';

export const isFill = (v: any) => v === FILL;
export const isFit = (v: any) => v === FIT;
export const isPx = (v: string) =>
  typeof v === 'string' && v.indexOf('px') >= 0 && v.indexOf('calc') < 0;

export const getPxValue = (size: string) => {
  return isPx(size) ? Number.parseFloat(size) : MIN_AXIS_SIZE;
};

const formatDimensionValue = (value: any, type: string) => {
  // fit-content is needed to allow elements to push beyond the parent container's explicit height.
  switch (value) {
    case FILL:
      return type === 'width' ? '100%' : 'auto';
    case FIT:
      return 'fit-content';
    default:
      return parseInt(value);
  }
};

const calculateDimensionsHelper = (root: any, p = '') => {
  const width = root[`${p}width`] || root.width;
  const height = root[`${p}height`] || root.height;

  const dimensions: Record<string, any> = {
    maxWidth: formatDimensionValue(width, 'width'),
    height: formatDimensionValue(height, 'height')
  };

  // to allow responsiveness, min width shouldn't be set for fixed widths
  dimensions.minWidth = isNum(width) ? undefined : dimensions.maxWidth;

  // min and max height must be 100% to prevent fit-content from collapsing, which would break fill's non-collapsing intent
  dimensions.minHeight = isFill(height) ? '100%' : dimensions.height;

  return dimensions;
};

/**
 * Calculates the dimensions of the provided step.
 * Note: The provided step should be fully-hydrated (i.e. rows injected, etc.) to calculate dimensions accurately.
 */
export function calculateStepCSS(step: any): Record<string, any> {
  if (!step) return {};

  const root = step.subgrids.find((grid: any) => grid.position.length === 0);

  const desktop = calculateDimensionsHelper(root);
  const mobile = calculateDimensionsHelper(root, 'mobile_');

  const stepCSS: Record<string, any> = {
    backgroundSize: 'cover',
    width: '100%',
    ...desktop
  };

  // width will be controlled by maxWidth in the case it is fixed below 478px
  stepCSS[`@media (max-width: 478px)`] = { width: '100%', ...mobile };

  return stepCSS;
}

export function calculateGlobalCSS(globalStyles: any) {
  const styles = new ResponsiveStyles({ styles: globalStyles }, ['form']);
  if (globalStyles) {
    styles.applyFontStyles('form');
  }
  return styles;
}
