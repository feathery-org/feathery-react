import { initInfo } from './init';
import getRandomBoolean from './random';

function adjustColor(color, amount) {
    return (
        '#' +
        color
            .replace(/^#/, '')
            .replace(/../g, (color) =>
                (
                    '0' +
                    Math.min(
                        255,
                        Math.max(0, parseInt(color, 16) + amount)
                    ).toString(16)
                ).substr(-2)
            )
    );
}

const calculateDimensionsHelper = (
    dimensions,
    setDimensions,
    setFormDimensions
) => (inputStep) => {
    const gridTemplateRows = inputStep.grid_rows.map(
        (row) => `minmax(${row},min-content)`
    );

    let gridTemplateColumns;
    if (window.innerWidth >= 768) {
        gridTemplateColumns = inputStep.grid_columns;
    } else {
        const seenColumns = new Set();
        if (inputStep.progress_bar)
            seenColumns.add(inputStep.progress_bar.column_index);
        inputStep.text_fields.map((field) =>
            seenColumns.add(field.column_index)
        );
        inputStep.servar_fields.map((field) =>
            seenColumns.add(field.column_index)
        );
        gridTemplateColumns = inputStep.grid_columns.map((c, index) =>
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

    const newDimensions = {
        width: definiteWidth,
        columns: gridTemplateColumns,
        rows: gridTemplateRows
    };
    if (JSON.stringify(newDimensions) !== JSON.stringify(dimensions)) {
        setDimensions(newDimensions);
        setFormDimensions(definiteWidth, gridTemplateColumns, gridTemplateRows);
    }
};

const getABVariant = (stepRes) => {
    if (!stepRes.variant) return stepRes.data;
    const { apiKey, userKey } = initInfo();
    // If userKey was not passed in, apiKey is assumed to be a user admin key
    // and thus a unique user ID
    return getRandomBoolean(userKey || apiKey, stepRes.form_name)
        ? stepRes.data
        : stepRes.variant;
};

const getDefaultFieldValues = (steps) => {
    const fieldValues = {};
    steps.forEach((step) => {
        step.servar_fields.forEach((field) => {
            let val = '';
            switch (field.servar.type) {
                case 'checkbox':
                    val = false;
                    break;
                case 'multiselect':
                    val = [];
                    break;
                case 'integer_field':
                    val = 0;
                    break;
                case 'hex_color':
                    val = '000000';
                    break;
                default:
                    val = '';
                    break;
            }
            fieldValues[field.servar.key] = val;
        });
    });
    return fieldValues;
};

const _conditionMatch = (condition, fieldValues) => {
    const fieldKey = condition.key;
    if (fieldKey in fieldValues) {
        const fieldVal = fieldValues[fieldKey];
        if (condition.type === 'multiselect') {
            return fieldVal.includes(condition.value);
        }
        return condition.value === fieldVal;
    }
    return false;
};

const setConditionalIndex = (curIndex, fieldValues, steps) => {
    let curConditions;
    while (curIndex < steps.length) {
        curConditions = steps[curIndex].attributes;
        if (curConditions.length > 0) {
            let show = true;
            curConditions.forEach(
                (condition) => (show &= _conditionMatch(condition, fieldValues))
            );
            if (!show) {
                curIndex++;
                continue;
            }
        }
        break;
    }
    return curIndex;
};

export {
    adjustColor,
    calculateDimensionsHelper,
    getABVariant,
    getDefaultFieldValues,
    setConditionalIndex
};
