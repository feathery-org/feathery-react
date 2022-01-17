import React from 'react';
import SignatureCanvas from 'react-signature-canvas';

function SignatureField({
  element,
  fieldLabel,
  applyStyles,
  signatureRef = {},
  elementProps = {},
  children
}) {
  const servar = element.servar;
  return (
    <div
      css={{
        ...applyStyles.getTarget('fc'),
        maxWidth: '100%',
        position: 'relative'
      }}
      {...elementProps}
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
      {children}
    </div>
  );
}

export default SignatureField;
