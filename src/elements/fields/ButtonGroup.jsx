import React from 'react';

const handleButtonGroupChange = (e, step, updateFieldValues) => {
    const fieldKey = e.target.id;

    console.log(step);
    step.servar_fields.forEach((field) => {
        const servar = field.servar;
        if (servar.key !== fieldKey) return;

        updateFieldValues({
            [servar.key]: e.target.textContent
        });
    });
};

function ButtonGroup({
    field,
    fieldLabel,
    fieldVal,
    step,
    onClick,
    updateFieldValues
}) {
    const { servar, applyStyles } = field;
    return (
        <>
            {fieldLabel}
            <div
                css={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    width: '100%',
                    ...applyStyles.getTarget('fc')
                }}
            >
                {servar.metadata.options.map((opt) => {
                    return (
                        <div
                            id={servar.key}
                            onClick={(e) => {
                                handleButtonGroupChange(
                                    e,
                                    step,
                                    updateFieldValues
                                );
                                onClick(e, field.submit_trigger === 'auto');
                            }}
                            key={opt}
                            css={{
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                cursor: 'pointer',
                                ...applyStyles.getTarget('field'),
                                '&:active': applyStyles.getTarget('active'),
                                '&:hover': applyStyles.getTarget('hover'),
                                ...(fieldVal === opt
                                    ? applyStyles.getTarget('active')
                                    : {})
                            }}
                        >
                            {opt}
                        </div>
                    );
                })}
            </div>
        </>
    );
}

export default ButtonGroup;
