import { getDefaultFieldValue } from './formHelperFunctions';

const TEXT_VARIABLE_PATTERN = /{{.*?}}/g;

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
        .map((textField) => textField.text.match(TEXT_VARIABLE_PATTERN))
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
        .map((btnField) => btnField.text.match(TEXT_VARIABLE_PATTERN))
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
            const repeatTriggerExists =
                field.servar.repeat_trigger === 'set_value';

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
              ...[...Array(repeatedRowCount)].flatMap(
                  () => repeatedMobileGridRows
              ),
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
        images: step.images.flatMap(unfold)
    };
}

const calculateDimensionsHelper = (step, p = '') => {
    const gridColumns = step[`${p}grid_columns`] || step.grid_columns;
    const gridRows = step[`${p}grid_rows`] || step.grid_rows;

    let hasRelativeColumn = false;
    let definiteWidth = 0;
    gridColumns.forEach((column) => {
        if (column.slice(-2) === 'px') definiteWidth += parseFloat(column);
        else hasRelativeColumn = true;
    });

    const relativeColumns = gridColumns.map((column) => {
        return column.slice(-2) === 'px'
            ? `${(100 * parseFloat(column)) / definiteWidth}%`
            : 0;
    });
    const relativeRows = gridRows.map((row) =>
        row === 'min-content' ? row : `minmax(${row},min-content)`
    );
    definiteWidth = `${definiteWidth}px`;

    return {
        relativeWidth: hasRelativeColumn ? '100%' : definiteWidth,
        definiteWidth,
        definiteColumns: gridColumns,
        relativeColumns,
        relativeRows
    };
};

/**
 * Calculates the dimensions of the provided step.
 * Note: The provided step should be fully-hydrated (i.e. rows injected, etc.) to calculate dimensions accurately.
 */
function calculateStepCSS(step) {
    if (!step) return {};

    const desktop = calculateDimensionsHelper(step);
    const mobile = calculateDimensionsHelper(step, 'mobile_');

    const stepCSS = {
        backgroundColor: `#${step.default_background_color}`,
        display: 'grid',
        maxWidth: '100%',
        gridTemplateRows: desktop.relativeRows.join(' '),
        width: desktop.relativeWidth,
        gridTemplateColumns: desktop.definiteColumns.join(' ')
    };
    const ddw = desktop.definiteWidth;
    const dmw = mobile.definiteWidth;
    // If checks to prevent media query collisions
    if (ddw !== '478px' && ddw !== dmw) {
        stepCSS[`@media (max-width: ${ddw})`] = {
            width: ddw,
            gridTemplateColumns: desktop.relativeColumns.join(' ')
        };
    }
    if (dmw !== '478px') {
        stepCSS['@media (max-width: 478px)'] = {
            width: mobile.relativeWidth,
            gridTemplateRows: mobile.relativeRows.join(' '),
            gridTemplateColumns: mobile.definiteColumns.join(' ')
        };
    }
    stepCSS[`@media (max-width: ${dmw})`] = {
        width: dmw,
        gridTemplateColumns: mobile.relativeColumns.join(' ')
    };

    return stepCSS;
}

export {
    TEXT_VARIABLE_PATTERN,
    calculateRepeatedRowCount,
    injectRepeatedRows,
    calculateStepCSS
};
