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

const formatStepFields = (step, fieldValues, fileObj) => {
    const formattedFields = {};
    step.servar_fields.forEach((field) => {
        const servar = field.servar;
        let value = fieldValues[servar.key];
        if (servar.type === 'file_upload') value = fileObj;
        formattedFields[servar.key] = {
            value,
            type: servar.type,
            displayText: servar.name
        };
    });
    return formattedFields;
};

const formatAllStepFields = (steps, fieldValues, fileObj) => {
    let formattedFields = {};
    steps.forEach((step) => {
        const stepFields = formatStepFields(step, fieldValues, fileObj);
        formattedFields = { ...formattedFields, ...stepFields };
    });
    return formattedFields;
};

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
                case 'select':
                    val = null;
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

const _customConditionMatch = (condition, fieldValues) => {
    const fieldKey = condition.key;
    if (fieldKey in fieldValues) {
        const fieldVal = fieldValues[fieldKey];
        return condition.value === fieldVal;
    } else return false;
};

const setConditionalIndex = (
    curIndex,
    fieldValues,
    steps,
    file,
    client,
    onLoad,
    updateFieldValues,
    updateFieldOptions
) => {
    while (curIndex < steps.length) {
        const curStep = steps[curIndex];

        if (typeof onLoad === 'function') {
            const formattedFields = formatAllStepFields(
                steps,
                fieldValues,
                file
            );
            onLoad({
                fields: formattedFields,
                stepName: curStep.key,
                stepNumber: curIndex,
                lastStep: curIndex === steps.length - 1,
                setValues: (userVals) =>
                    (fieldValues = updateFieldValues(userVals, fieldValues)),
                setOptions: updateFieldOptions(steps)
            });
        }

        const curConds = curStep.conditions;
        const curCustomConds = curStep.custom_conditions;
        if (curConds.length > 0 || curCustomConds.length > 0) {
            let show = true;
            curConds.forEach(
                (condition) => (show &= _conditionMatch(condition, fieldValues))
            );
            curCustomConds.forEach(
                (condition) =>
                    (show &= _customConditionMatch(condition, fieldValues))
            );
            if (!show) {
                // register that step was skipped due to condition
                client.registerEvent(curIndex, 'conditional_skip');
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
    formatAllStepFields,
    formatStepFields,
    calculateDimensionsHelper,
    getABVariant,
    getDefaultFieldValues,
    setConditionalIndex
};
