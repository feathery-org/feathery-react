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

    // Filter out all the text fields that don't belong to the repeated row
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

    // Check the existing servar fields for a repeating field
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
    if (step === null) {
        return null;
    }

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

    const progressBar =
        !step.progress_bar || step.progress_bar.row_index_end < rrStart
            ? step.progress_bar
            : {
                  ...step.progress_bar,
                  row_index: afterRowIndex(step.progress_bar.row_index),
                  row_index_end: afterRowIndex(step.progress_bar.row_index_end)
              };

    return {
        ...step,
        progress_bar: progressBar,
        grid_rows: gridRows,
        servar_fields: step.servar_fields.flatMap(unfold),
        texts: step.texts.flatMap(unfold),
        buttons: step.buttons.flatMap(unfold),
        images: step.images.flatMap(unfold)
    };
}

/**
 * Calculates the dimensions of the provided step.
 * Note: The provided step should be fully-hydrated (i.e. rows injected, etc.) to calculate dimensions accurately.
 */
function calculateDimensions(step) {
    if (step === null) {
        return {
            relativeWidth: 0,
            definiteWidth: 0,
            relativeColumns: [],
            relativeRows: []
        };
    }

    let hasRelativeColumn = false;
    let definiteWidth = 0;
    step.grid_columns.forEach((column) => {
        if (column.slice(-2) === 'px') definiteWidth += parseFloat(column);
        else hasRelativeColumn = true;
    });

    const relativeColumns = step.grid_columns.map((column) => {
        return column.slice(-2) === 'px'
            ? `${(100 * parseFloat(column)) / definiteWidth}%`
            : 0;
    });
    const relativeRows = step.grid_rows.map((row) =>
        row === 'min-content' ? row : `minmax(${row},min-content)`
    );
    definiteWidth = `${definiteWidth}px`;

    return {
        relativeWidth: hasRelativeColumn ? '100%' : definiteWidth,
        definiteWidth,
        relativeColumns,
        relativeRows
    };
}

export {
    TEXT_VARIABLE_PATTERN,
    calculateRepeatedRowCount,
    injectRepeatedRows,
    calculateDimensions
};
