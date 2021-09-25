import React from 'react';

function ButtonGroupField({
    element,
    applyStyles,
    fieldLabel,
    fieldVal = null,
    onClick = () => {}
}) {
    const servar = element.servar;
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
                            onClick={onClick}
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

export default ButtonGroupField;
