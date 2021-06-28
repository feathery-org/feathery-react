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

const getABVariant = (stepRes) => {
    if (!stepRes.variant) return stepRes.data;
    const { apiKey, userKey } = initInfo();
    // If userKey was not passed in, apiKey is assumed to be a user admin key
    // and thus a unique user ID
    return getRandomBoolean(userKey || apiKey, stepRes.form_name)
        ? stepRes.data
        : stepRes.variant;
};

function getDefaultFieldValue(field) {
    switch (field.servar.type) {
        case 'checkbox':
            // eslint-disable-next-line camelcase
            return !!field.servar.metadata?.always_checked;
        case 'multiselect':
            return [];
        case 'hex_color':
            return '000000';
        case 'select':
            return null;
        case 'rich_multi_file_upload':
            return [];
        default:
            return '';
    }
}

const getDefaultFieldValues = (steps) => {
    const fieldValues = {};
    Object.values(steps).forEach((step) => {
        step.servar_fields.forEach((field) => {
            const val = getDefaultFieldValue(field);
            fieldValues[field.servar.key] = field.servar.repeated ? [val] : val;
        });
    });
    return fieldValues;
};

const nextStepKey = (
    nextConditions,
    metadata,
    steps,
    fieldValues,
    stepSequence,
    sequenceIndex
) => {
    let newKey;
    let defaultKey = null;
    let sequenceValues = [];
    const inSequence = {};
    const notInSequence = [];
    nextConditions
        .filter(
            (cond) =>
                cond.element_type === metadata.elementType &&
                metadata.elementKeys.includes(cond.element_key)
        )
        .forEach((cond) => {
            if (
                cond.trigger !== metadata.trigger ||
                cond.metadata.start !== metadata.start ||
                cond.metadata.end !== metadata.end
            )
                return;

            if (cond.rules.length === 0) defaultKey = cond.next_step_key;
            else {
                let rulesMet = true;
                cond.rules.forEach((rule) => {
                    const userVal = fieldValues[rule.key] || '';
                    const ruleVal = rule.value || '';
                    if (Array.isArray(userVal)) {
                        rulesMet = false;
                        const equal =
                            userVal.includes(ruleVal) &&
                            rule.comparison === 'equal';
                        const notEqual =
                            !userVal.includes(ruleVal) &&
                            rule.comparison === 'not_equal';
                        if (equal || notEqual) {
                            if (equal) inSequence[ruleVal] = cond.next_step_key;
                            else if (notEqual)
                                notInSequence.push(cond.next_step_key);

                            if (sequenceValues.length === 0)
                                sequenceValues = userVal;
                        }
                    } else {
                        const equal = userVal === ruleVal;
                        rulesMet &=
                            (equal && rule.comparison === 'equal') ||
                            (!equal && rule.comparison === 'not_equal');
                    }
                });
                if (rulesMet) newKey = cond.next_step_key;
            }
        });

    // order and compose new sequence
    let newSequence = sequenceValues
        .map((val) => inSequence[val])
        .filter(Boolean);
    newSequence = [...newSequence, ...notInSequence];

    let newStepKey = newKey || defaultKey;
    if (newSequence.length === 1 && stepSequence.length > 0 && !newStepKey) {
        // Go back in dynamic sequence
        if (sequenceIndex <= 1) newStepKey = newSequence[0];
        else {
            sequenceIndex--;
            newStepKey = stepSequence[sequenceIndex - 1];
        }
    } else {
        // Go forward in dynamic sequence
        if (newSequence.length > 0 && !newStepKey) {
            // Propagate new array rules since they exist
            stepSequence = newSequence;
            sequenceIndex = 0;
        }

        if (stepSequence.includes(newStepKey)) {
            sequenceIndex = stepSequence.indexOf(newStepKey) + 1;
        } else if (
            !newStepKey &&
            stepSequence.length > sequenceIndex &&
            ['button', 'text'].includes(metadata.elementType)
        ) {
            newStepKey = stepSequence[sequenceIndex];
            sequenceIndex++;
        }
    }
    return {
        newStepKey,
        newSequence: stepSequence,
        newSequenceIndex: sequenceIndex
    };
};

const getOrigin = (steps) => {
    let originKey;
    Object.values(steps).forEach((step) => {
        if (step.origin) originKey = step.key;
    });
    return originKey;
};

const recurseDepth = (steps, originKey, curKey) => {
    // We may pass in a displaySteps draft that doesn't have an origin specified
    if (!originKey) return [0, 0];

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

/**
 * Creates a unique key value for a servar field (taking repeated instances into account).
 */
function reactFriendlyKey(field) {
    return field.servar.key + (field.repeat ? `-${field.repeat}` : '');
}

/**
 * Retrieves the value of the servar from the provided values.
 * If the servar field is repeated, gets the indexed value.
 */
function getFieldValue(field, values) {
    const { servar, repeat } = field;
    return repeat !== undefined
        ? {
              repeated: true,
              index: repeat,
              value: values[servar.key][repeat],
              valueList: values[servar.key]
          }
        : {
              repeated: false,
              value: values[servar.key]
          };
}

/**
 * Returns the error message for a field value if it's invalid.
 * Returns an empty string if it's valid.
 */
function getFieldError(value, servar) {
    // Check if value is missing when it's required
    if (servar.required) {
        let missingVal = false;
        switch (servar.type) {
            case 'select':
                if (!value) missingVal = true;
                break;
            case 'file_upload':
                if (!value) missingVal = true;
                break;
            case 'checkbox':
                // eslint-disable-next-line camelcase
                if (!value && servar.metadata?.must_check) missingVal = true;
                break;
            default:
                if (value === '') missingVal = true;
                break;
        }
        if (missingVal) return 'This is a required field';
    }

    // Check if value is badly formatted
    if (servar.type === 'phone_number' && value.length !== 10) {
        return 'Invalid phone number';
    } else if (servar.type === 'ssn' && value.length !== 9) {
        return 'Invalid social security number';
    }

    // No error
    return '';
}

/**
 * Returns the list of DOM nodes corresponding to the field with the provided key.
 */
function getElementsFromKey({ formRef, fieldKey }) {
    const singleOrList = formRef.current.elements[fieldKey];
    const elements =
        singleOrList instanceof RadioNodeList
            ? Array.from(singleOrList)
            : [singleOrList];

    return elements.filter((e) => e);
}

const alignmentMap = {
    left: 'flex-start',
    center: 'center',
    right: 'flex-end'
};

export {
    adjustColor,
    formatAllStepFields,
    formatStepFields,
    getABVariant,
    getDefaultFieldValue,
    getDefaultFieldValues,
    nextStepKey,
    getOrigin,
    recurseDepth,
    reactFriendlyKey,
    getFieldValue,
    getFieldError,
    getElementsFromKey,
    states,
    alignmentMap
};
