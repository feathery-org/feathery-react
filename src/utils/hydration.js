import { getAllElements, getDefaultFieldValue } from './formHelperFunctions';
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

/**
 * Calculates the initial number of repeated rows to display given field values (some which may be arrays).
 */
function calculateRepeatedRowCount({ step, values }) {
  let count = 1;

  if (step === null) {
    return count;
  }

  // Filter out all the text elements that don't belong to the repeated row
  // Then track all the instances of text variables in the text field
  // Calculate the count of repeat rows based on if the corresponding values for the text variables are arrays
  step.texts
    .filter(
      (textField) =>
        textField.row_index >= step.repeat_row_start &&
        textField.row_index_end <= step.repeat_row_end
    )
    .map((textField) => textField.properties.text.match(TEXT_VARIABLE_PATTERN))
    .filter((matches) => matches !== null)
    .forEach((matches) => {
      matches.forEach((match) => {
        const property = match.slice(2, -2);
        const value = values[property];

        if (Array.isArray(value)) {
          count = Math.max(count, value.length);
        }
      });
    });

  step.buttons
    .filter(
      (btnField) =>
        btnField.row_index >= step.repeat_row_start &&
        btnField.row_index_end <= step.repeat_row_end
    )
    .map((btnField) => btnField.properties.text.match(TEXT_VARIABLE_PATTERN))
    .filter((matches) => matches !== null)
    .forEach((matches) => {
      matches.forEach((match) => {
        const property = match.slice(2, -2);
        const value = values[property];

        if (Array.isArray(value)) {
          count = Math.max(count, value.length);
        }
      });
    });

  // Check the existing servar elements for a repeating field
  // Count should be the maximum number of repeated servar instances
  step.servar_fields
    .filter((field) => field.servar.repeated)
    .forEach((field) => {
      // We need to append a trailing row if the field is a repeat trigger
      // But don't append if a trailing value already exists
      const value = values[field.servar.key];
      const trailingValueExists =
        value[value.length - 1] === getDefaultFieldValue(field);
      const repeatTriggerExists = field.servar.repeat_trigger === 'set_value';

      count = Math.max(
        count,
        values[field.servar.key].length +
          Number(!trailingValueExists && repeatTriggerExists)
      );
    });

  return count;
}

/**
 * Creates a copy of the provided step with the correct number of repeated rows injected into it.
 */
function injectRepeatedRows({ step, repeatedRowCount }) {
  const rrStart = step.repeat_row_start;
  const rrEnd = step.repeat_row_end;

  if (rrStart === null && rrEnd === null) {
    return step;
  }

  function inRowIndex(fieldIndex, rrIndex) {
    return fieldIndex + (rrEnd - rrStart + 1) * rrIndex;
  }

  function afterRowIndex(fieldIndex) {
    return fieldIndex + (rrEnd - rrStart + 1) * (repeatedRowCount - 1);
  }

  function unfold(field) {
    if (field.row_index_end < rrStart) {
      return [field];
    } else if (field.row_index > rrEnd) {
      return [
        {
          ...field,
          row_index: afterRowIndex(field.row_index),
          row_index_end: afterRowIndex(field.row_index_end)
        }
      ];
    } else {
      return [...Array(repeatedRowCount)].map((_, index) => ({
        ...field,
        row_index: inRowIndex(field.row_index, index),
        row_index_end: inRowIndex(field.row_index_end, index),
        repeat: index
      }));
    }
  }

  const repeatedGridRows = step.grid_rows.slice(rrStart, rrEnd + 1);
  const gridRows = [
    ...step.grid_rows.slice(0, rrStart),
    ...[...Array(repeatedRowCount)].flatMap(() => repeatedGridRows),
    ...step.grid_rows.slice(rrEnd + 1)
  ];
  const repeatedMobileGridRows = step.grid_rows.slice(rrStart, rrEnd + 1);
  const mobileGridRows = step.mobile_grid_rows
    ? [
        ...step.mobile_grid_rows.slice(0, rrStart),
        ...[...Array(repeatedRowCount)].flatMap(() => repeatedMobileGridRows),
        ...step.mobile_grid_rows.slice(rrEnd + 1)
      ]
    : null;

  return {
    ...step,
    grid_rows: gridRows,
    mobile_grid_rows: mobileGridRows,
    progress_bars: step.progress_bars.flatMap(unfold),
    servar_fields: step.servar_fields.flatMap(unfold),
    texts: step.texts.flatMap(unfold),
    buttons: step.buttons.flatMap(unfold),
    images: step.images.flatMap(unfold),
    videos: step.videos.flatMap(unfold)
  };
}

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

export {
  TEXT_VARIABLE_PATTERN,
  calculateRepeatedRowCount,
  injectRepeatedRows,
  calculateStepCSS
};
