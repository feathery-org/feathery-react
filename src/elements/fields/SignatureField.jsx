import React from 'react';
import SignatureCanvas from 'react-signature-canvas';

function SignatureField(
  {
    element,
    fieldLabel,
    applyStyles,
    signatureRef = {},
    elementProps = {},
    onEnd,
    children
  },
  parentRef
) {
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
          height: element.styles.height,
          style: {
            ...applyStyles.getTarget('field', true),
            width: '100%'
          }
        }}
        ref={(ref) => {
          signatureRef[servar.key] = ref;
          parentRef(ref);
        }}
        onEnd={onEnd}
      />
      {children}
    </div>
  );
}

export default React.forwardRef(SignatureField);
