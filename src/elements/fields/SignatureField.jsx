import React from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { dataURLToFile } from '../../utils/image';
import { fieldValues } from '../../utils/init';

function SignatureField({
  element,
  fieldLabel,
  applyStyles,
  signatureRef = {},
  elementProps = {},
  onEnd,
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
          height: element.styles.height,
          style: {
            ...applyStyles.getTarget('field', true),
            width: '100%'
          }
        }}
        ref={(ref) => {
          signatureRef[servar.key] = ref;
        }}
        onEnd={() => {
          const base64Img = signatureRef[servar.key].toDataURL('image/png');
          const newFile = dataURLToFile(base64Img, `${servar.key}.png`);
          fieldValues[servar.key] = newFile;
          onEnd();
        }}
      />
      {children}
    </div>
  );
}

export default SignatureField;
