import React, { useState } from 'react';
import { SketchPicker } from 'react-color';

function ColorPickerField({
    fieldLabel,
    applyStyles,
    fieldVal = 'FFFFFFFF',
    onChange = () => {},
    onClick = () => {}
}) {
    const [showPicker, setShowPicker] = useState(false);
    return (
        <div css={applyStyles.getTarget('fc')}>
            {fieldLabel}
            <div
                css={{
                    width: '36px',
                    height: '36px',
                    background: `#${fieldVal}`,
                    cursor: 'pointer',
                    ...applyStyles.getTarget('field')
                }}
                onClick={(e) => {
                    onClick(e);
                    setShowPicker((showPicker) => !showPicker);
                }}
            />
            {showPicker ? (
                <div
                    css={{
                        position: 'absolute',
                        zIndex: 2
                    }}
                >
                    <div
                        css={{
                            position: 'fixed',
                            top: '0px',
                            right: '0px',
                            bottom: '0px',
                            left: '0px'
                        }}
                        onClick={() => setShowPicker(false)}
                    />
                    <SketchPicker color={`#${fieldVal}`} onChange={onChange} />
                </div>
            ) : null}
        </div>
    );
}

export default ColorPickerField;
