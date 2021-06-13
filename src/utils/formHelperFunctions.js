import { initInfo } from './init';
import getRandomBoolean from './random';

const states = [
    'Alabama',
    'Alaska',
    'Arizona',
    'Arkansas',
    'California',
    'Colorado',
    'Connecticut',
    'Delaware',
    'District Of Columbia',
    'Florida',
    'Georgia',
    'Hawaii',
    'Idaho',
    'Illinois',
    'Indiana',
    'Iowa',
    'Kansas',
    'Kentucky',
    'Louisiana',
    'Maine',
    'Maryland',
    'Massachusetts',
    'Michigan',
    'Minnesota',
    'Mississippi',
    'Missouri',
    'Montana',
    'Nebraska',
    'Nevada',
    'New Hampshire',
    'New Jersey',
    'New Mexico',
    'New York',
    'North Carolina',
    'North Dakota',
    'Ohio',
    'Oklahoma',
    'Oregon',
    'Pennsylvania',
    'Rhode Island',
    'South Carolina',
    'South Dakota',
    'Tennessee',
    'Texas',
    'Utah',
    'Vermont',
    'Virginia',
    'Washington',
    'West Virginia',
    'Wisconsin',
    'Wyoming'
];

const textVariablePattern = /{{.*?}}/g;

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

const formatStepFields = (step, fieldValues) => {
    const formattedFields = {};
    step.servar_fields.forEach((field) => {
        const servar = field.servar;
        formattedFields[servar.key] = {
            value: fieldValues[servar.key],
            type: servar.type,
            displayText: servar.name
        };
    });
    return formattedFields;
};

const formatAllStepFields = (steps, fieldValues) => {
    let formattedFields = {};
    Object.values(steps).forEach((step) => {
        const stepFields = formatStepFields(step, fieldValues);
        formattedFields = { ...formattedFields, ...stepFields };
    });
    return formattedFields;
};

const under = (field, step) => {
    return field.row_index < step.repeat_row_start;
};

const over = (field, step) => {
    return field.row_index_end > step.repeat_row_end;
};

const setRepeatInstances = (step, attribute, numRepeats) => {
    const rs = step.repeat_row_start;
    const re = step.repeat_row_end;
    const newInstances = [];
    step[attribute].forEach((instance) => {
        if (under(instance, step)) {
            newInstances.push(instance);
        } else if (over(instance, step)) {
            instance.row_index += (re - rs + 1) * (numRepeats - 1);
            instance.row_index_end += (re - rs + 1) * (numRepeats - 1);
            newInstances.push(instance);
        } else {
            for (let i = 0; i < numRepeats; i++) {
                newInstances.push({
                    ...instance,
                    row_index: instance.row_index + (re - rs + 1) * i,
                    row_index_end: instance.row_index_end + (re - rs + 1) * i,
                    repeat: i
                });
            }
        }
    });
    step[attribute] = newInstances;
};

const calculateDimensions = (
    inputStep,
    steps,
    fieldValues,
    dimensions,
    setDimensions,
    setFormDimensions
) => {
    const rs = inputStep.repeat_row_start;
    const re = inputStep.repeat_row_end;
    if (rs && re) {
        let numRepeats = 1;
        inputStep.text_fields.forEach((field) => {
            if (under(field, inputStep) || over(field, inputStep)) return;
            const matches = field.text.match(textVariablePattern);
            if (matches) {
                matches.forEach((match) => {
                    const pStr = match.slice(2, -2);
                    if (Array.isArray(fieldValues[pStr])) {
                        numRepeats = Math.max(
                            numRepeats,
                            fieldValues[pStr].length
                        );
                    }
                });
            }
        });

        setRepeatInstances(inputStep, 'text_fields', numRepeats);
        setRepeatInstances(inputStep, 'images', numRepeats);
        setRepeatInstances(inputStep, 'servar_fields', numRepeats);

        const repeatRows = inputStep.grid_rows.slice(rs, re + 1);
        for (let i = 0; i < numRepeats - 1; i++) {
            inputStep.grid_rows.splice(rs, 0, ...repeatRows);
        }
    }

    const gridTemplateRows = inputStep.grid_rows.map(
        (row) => `minmax(${row},min-content)`
    );

    let gridTemplateColumns;
    if (window.innerWidth >= 768) {
        gridTemplateColumns = inputStep.grid_columns;
    } else {
        const seenColumns = new Set();
        if (inputStep.progress_bar) {
            const s = inputStep.progress_bar.column_index;
            const e = inputStep.progress_bar.column_index_end;
            for (let i = s; i <= e; i++) {
                seenColumns.add(i);
            }
        }
        inputStep.text_fields.map((field) => {
            const s = field.column_index;
            const e = field.column_index_end;
            for (let i = s; i <= e; i++) {
                seenColumns.add(i);
            }
        });
        inputStep.servar_fields.map((field) => {
            const s = field.column_index;
            const e = field.column_index_end;
            for (let i = s; i <= e; i++) {
                seenColumns.add(i);
            }
        });
        inputStep.images.map((image) => {
            const s = image.column_index;
            const e = image.column_index_end;
            for (let i = s; i <= e; i++) {
                seenColumns.add(i);
            }
        });
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
                    // eslint-disable-next-line camelcase
                    val = !!field.servar.metadata?.always_checked;
                    break;
                case 'multiselect':
                    val = [];
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

const nextStepKey = (nextConditions, metadata, steps, fieldValues) => {
    let newKey, defaultKey;
    nextConditions
        .filter(
            (cond) =>
                cond.element_type === metadata.elementType &&
                metadata.elementKeys.includes(cond.element_key)
        )
        .forEach((cond) => {
            if (cond.trigger !== metadata.trigger) return;
            if (
                cond.metadata.start !== metadata.start ||
                cond.metadata.end !== metadata.end
            )
                return;

            if (cond.rules.length === 0) defaultKey = cond.next_step_key;
            else {
                let rulesMet = true;
                cond.rules.forEach((rule) => {
                    const ruleVal = rule.value || '';
                    const userVal = fieldValues[rule.key] || '';
                    let equal;
                    if (Array.isArray(userVal))
                        equal = userVal.includes(ruleVal);
                    else equal = userVal === ruleVal;
                    rulesMet &=
                        (equal && rule.comparison === 'equal') ||
                        (!equal && rule.comparison === 'not_equal');
                });
                if (rulesMet) newKey = cond.next_step_key;
            }
        });
    return newKey || defaultKey;
};

const getOrigin = (steps) => {
    let originKey;
    Object.values(steps).forEach((step) => {
        if (step.origin) originKey = step.key;
    });
    return originKey;
};

const recurseDepth = (steps, originKey, curKey) => {
    const seenStepKeys = new Set();
    const stepQueue = [[steps[originKey], 0]];
    let curDepth = 0;
    let maxDepth = 0;
    while (stepQueue.length > 0) {
        const [step, depth] = stepQueue.shift();
        if (seenStepKeys.has(step.key)) continue;
        seenStepKeys.add(step.key);

        if (step.key === curKey) curDepth = depth;
        maxDepth = depth;

        step.next_conditions.forEach((condition) => {
            stepQueue.push([steps[condition.next_step_key], depth + 1]);
        });
    }
    return [curDepth, maxDepth];
};

export {
    adjustColor,
    formatAllStepFields,
    formatStepFields,
    calculateDimensions,
    getABVariant,
    getDefaultFieldValues,
    nextStepKey,
    getOrigin,
    recurseDepth,
    states,
    textVariablePattern
};
