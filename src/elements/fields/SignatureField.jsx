import React from 'react';
import SignatureCanvas from 'react-signature-canvas';

function SignatureField({
    element,
    fieldLabel,
    applyStyles,
    signatureRef = {}
}) {
    const servar = element.servar;
    return (
        <div
            css={{
                ...applyStyles.getTarget('fc'),
                maxWidth: '100%'
            }}
        >
            {fieldLabel}
            <SignatureCanvas
                penColor='black'
                canvasProps={{
                    id: servar.key,
                    width: element.styles.width,
                    height: element.styles.height,
                    style: applyStyles.getTarget('field', true)
                }}
                ref={(ref) => {
                    signatureRef[servar.key] = ref;
                }}
            />
        </div>
    );
}

export default SignatureField;
