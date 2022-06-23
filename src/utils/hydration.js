import { getAllElements } from './formHelperFunctions';
import { isNum } from './primitives';

const TEXT_VARIABLE_PATTERN = /{{.*?}}/g;

const FIT = 'fit';
const FILL = 'fill';

const isFill = (v) => {
  return v === FILL;
};

const isFit = (v) => {
  return v === FIT;
};

const formatTrackValue = (parentDimension, value, type = 'col', isEmpty) => {
  // fit and fill values need to be turned into their appropriate CSS value
  if (isFit(value)) {
    if (isFill(parentDimension)) {
      value = 'min-content';
    } else if (isFit(parentDimension)) {
      // fit parents will collapse empty fit columns
      value = isEmpty ? '0' : 'min-content';
    }
  } else if (isFill(value)) {
    value = '1fr';
  }
  if (type === 'col') return `minmax(0, ${value})`; // Cols need minmax for responsive widths
  return value;
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

const getNotEmptyTrackMap = (step) => {
  const allElements = getAllElements(step);

  const row = {};
  const column = {};

  allElements.forEach(([e]) => {
    const { row_index: rowIndex, column_index: columnIndex } = e;
    row[rowIndex] = true;
    column[columnIndex] = true;
  });

  return { row, column };
};

const calculateDimensionsHelper = (step, p = '') => {
  const gridColumns = step[`${p}grid_columns`] || step.grid_columns;
  const gridRows = step[`${p}grid_rows`] || step.grid_rows;
  const gridWidth = step[`${p}width`] || step.width;
  const gridHeight = step[`${p}height`] || step.height;

  const nonEmptyTracksMap = getNotEmptyTrackMap(step);

  const dimensions = {
    gridWidth: formatDimensionValue(gridWidth, 'col'),
    gridHeight: formatDimensionValue(gridHeight, 'row'),
    columns: gridColumns.map((v, i) => {
      const isEmpty = !nonEmptyTracksMap.column[i];
      return formatTrackValue(gridWidth, v, 'col', isEmpty);
    }),
    rows: gridRows.map((v, i) => {
      const isEmpty = !nonEmptyTracksMap.row[i];
      return formatTrackValue(gridHeight, v, 'row', isEmpty);
    })
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
    display: 'grid',
    width: desktop.gridWidth,
    minWidth: desktop.minWidth,
    maxWidth: desktop.gridWidth,
    height: desktop.gridHeight,
    minHeight: desktop.minHeight,
    maxHeight: desktop.maxHeight,
    gridTemplateRows: desktop.rows.join(' '),
    gridTemplateColumns: desktop.columns.join(' ')
  };

  // 478
  stepCSS[`@media (max-width: 478px)`] = {
    width: mobile.gridWidth,
    minWidth: mobile.minWidth,
    maxWidth: mobile.gridWidth,
    height: mobile.gridHeight,
    minHeight: mobile.minHeight,
    maxHeight: desktop.maxHeight,
    gridTemplateRows: mobile.rows.join(' '),
    gridTemplateColumns: mobile.columns.join(' ')
  };

  return stepCSS;
}

export { TEXT_VARIABLE_PATTERN, calculateStepCSS };
