const TEXT_VARIABLE_PATTERN = /{{.*?}}/g;

/**
 * Calculates the initial number of repeated rows to display given field values (some which may be arrays).
 */
function calculateRepeatedRowCount({ step, values }) {
    let count = 0;

    if (step === null) {
        return count;
    }

    // Filter out all the text fields that don't belong to the repeated row
    // Then track all the instances of text variables in the text field
    // Calculate the count of repeat rows based on if the corresponding values for the text variables are arrays
    step.text_fields
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

    // Check the existing servar fields for a repeating field
    // Count should be the maximum number of repeated servar instances
    step.servar_fields
        .filter((field) => field.servar.repeated)
        .forEach((field) => {
            count = Math.max(count, values[field.servar.key].length);
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
        text_fields: step.text_fields.flatMap(unfold),
        images: step.images.flatMap(unfold)
    };
}

/**
 * Calculates the dimensions of the provided step.
 * Note: The provided step should be fully-hydrated (i.e. rows injected, etc.) to calculate dimensions accurately.
 */
function calculateDimensions(step) {
    if (step === null) {
        return { width: null, rows: [], columns: [] };
    }

    const gridTemplateRows = step.grid_rows.map(
        (row) => `minmax(${row},min-content)`
    );

    let gridTemplateColumns;
    if (window.innerWidth >= 768) {
        gridTemplateColumns = step.grid_columns;
    } else {
        const seenColumns = new Set();
        if (step.progress_bar) {
            const s = step.progress_bar.column_index;
            const e = step.progress_bar.column_index_end;
            for (let i = s; i <= e; i++) {
                seenColumns.add(i);
            }
        }
        step.text_fields.map((field) => {
            const s = field.column_index;
            const e = field.column_index_end;
            for (let i = s; i <= e; i++) {
                seenColumns.add(i);
            }
        });
        step.servar_fields.map((field) => {
            const s = field.column_index;
            const e = field.column_index_end;
            for (let i = s; i <= e; i++) {
                seenColumns.add(i);
            }
        });
        step.images.map((image) => {
            const s = image.column_index;
            const e = image.column_index_end;
            for (let i = s; i <= e; i++) {
                seenColumns.add(i);
            }
        });
        gridTemplateColumns = step.grid_columns.map((c, index) =>
            seenColumns.has(index) ? c : '10px'
        );
    }

    let definiteWidth = 0;
    gridTemplateColumns.forEach((column) => {
        if (definiteWidth !== null && column.slice(-2) === 'px') {
            definiteWidth += parseFloat(column);
        } else {
            definiteWidth = null;
        }
    });
    if (definiteWidth) {
        gridTemplateColumns = gridTemplateColumns.map(
            (c) => `${(100 * parseFloat(c)) / definiteWidth}%`
        );
    }

    return {
        width: definiteWidth,
        columns: gridTemplateColumns,
        rows: gridTemplateRows
    };
}

export {
    TEXT_VARIABLE_PATTERN,
    calculateRepeatedRowCount,
    injectRepeatedRows,
    calculateDimensions
};
