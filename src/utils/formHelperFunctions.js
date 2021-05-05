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
    Object.values(steps).forEach((step) => {
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
    Object.values(steps).forEach((step) => {
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
                    val = '';
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

const prevStepKey = (prevConditions, seenStepKeys) => {
    let prevKey = null;
    prevConditions.forEach((cond) => {
        if (seenStepKeys.has(cond.previous_step_key))
            prevKey = cond.previous_step_key;
    });
    return prevKey;
};

const nextStepKey = (
    nextConditions,
    nextStepKey,
    steps,
    fieldValues,
    file,
    client,
    onLoad,
    updateFieldValues,
    updateFieldOptions
) => {
    let newKey, defaultKey;
    nextConditions.forEach((cond) => {
        if (cond.default) defaultKey = cond.next_step_key;
        else {
            const userVal = fieldValues[cond.key];
            if (!userVal) return;

            if (Array.isArray(userVal)) {
                if (userVal.includes(cond.value)) newKey = cond.next_step_key;
            } else {
                if (userVal === cond.value) newKey = cond.next_step_key;
            }
        }
    });
    newKey = nextStepKey || newKey || defaultKey;
    if (!newKey) return null;

    client.registerEvent(newKey, 'load');
    if (typeof onLoad === 'function') {
        const formattedFields = formatAllStepFields(steps, fieldValues, file);
        onLoad({
            fields: formattedFields,
            stepName: newKey,
            lastStep: steps[newKey].next_conditions.length === 0,
            setValues: updateFieldValues,
            setOptions: updateFieldOptions(steps)
        });
    }
    return newKey;
};

const getOrigin = (steps) => {
    let originKey;
    Object.values(steps).forEach((step) => {
        if (step.origin) originKey = step.key;
    });
    return originKey;
};

const recurseDepth = (steps, startKey, endKey = null) => {
    const seenStepKeys = new Set();
    const stepQueue = [[steps[startKey], 0]];
    let maxDepth = 0;
    while (stepQueue.length > 0) {
        const [step, depth] = stepQueue.shift();
        if (seenStepKeys.has(step.key)) continue;
        seenStepKeys.add(step.key);

        if (step.key === endKey) return depth;
        maxDepth = depth;

        step.next_conditions.forEach((condition) => {
            const nextStep = steps[condition.next_step_key];
            if (endKey || condition.default)
                stepQueue.push([nextStep, depth + 1]);
        });
    }
    return maxDepth;
};

export {
    adjustColor,
    formatAllStepFields,
    formatStepFields,
    calculateDimensionsHelper,
    getABVariant,
    getDefaultFieldValues,
    nextStepKey,
    prevStepKey,
    getOrigin,
    recurseDepth
};
