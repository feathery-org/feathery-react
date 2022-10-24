import React, { useState, useRef, useEffect } from 'react';
// @ts-expect-error TS(7016): Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import SignatureCanvas from 'react-signature-canvas';
import { dataURLToFile, toBase64 } from '../../utils/image';
import { CloseIcon } from '../components/icons';

function SignatureField({
  element,
  fieldLabel,
  applyStyles,
  defaultValue = null,
  editMode,
  elementProps = {},
  onEnd = () => {},
  onClear = () => {},
  children
}: any) {
  const servar = element.servar;
  const signatureRef = useRef();
  const [isClearVisible, setIsClearVisible] = useState(defaultValue !== null);
  const signatureCanvasStyles = applyStyles.getTarget('field', true);
  // Pick top border color for icon color
  const closeIconColor = signatureCanvasStyles.borderColor.split(' ')[0];

  useEffect(() => {
    async function setSignatureCanvas() {
      if (defaultValue === null) return;
      const signatureFile = await defaultValue;
      const base64 = await toBase64(signatureFile);
      // @ts-expect-error TS(2532): Object is possibly 'undefined'.
      signatureRef.current.fromDataURL(base64);
    }
    setSignatureCanvas();
  }, []);

  return (
    <div
      css={{
        ...applyStyles.getTarget('fc'),
        maxWidth: '100%',
        position: 'relative',
        pointerEvents: editMode ? 'none' : 'auto'
      }}
      {...elementProps}
    >
      {children}
      {fieldLabel}
      <div css={{ position: 'relative', ...applyStyles.getTarget('sub-fc') }}>
        {isClearVisible && (
          <div
            css={{
              background: '#ffffff',
              position: 'absolute',
              top: '1px',
              right: '0',
              borderRadius: '6px',
              display: 'flex'
            }}
            onClick={() => {
              // @ts-expect-error TS(2532): Object is possibly 'undefined'.
              signatureRef.current.clear();
              onClear();
              setIsClearVisible(false);
            }}
          >
            <CloseIcon fill={closeIconColor} />
          </div>
        )}
        <SignatureCanvas
          penColor='black'
          clearOnResize={false}
          canvasProps={{
            id: servar.key,
            style: {
              ...signatureCanvasStyles,
              width: '100%',
              height: '100%'
            }
          }}
          ref={(ref: any) => {
            signatureRef.current = ref;
          }}
          onEnd={() => {
            // @ts-expect-error TS(2532): Object is possibly 'undefined'.
            const base64Img = signatureRef.current.toDataURL('image/png');
            const newFile = dataURLToFile(base64Img, `${servar.key}.png`);
            onEnd(newFile);
            // @ts-expect-error TS(2532): Object is possibly 'undefined'.
            setIsClearVisible(!signatureRef.current.isEmpty());
          }}
        />
      </div>
    </div>
  );
}

export default SignatureField;
