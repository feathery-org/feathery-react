import React, { useState, useRef, useEffect } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { dataURLToFile, toBase64 } from '../../utils/image';
import { CloseIcon } from '../components/icons';

function SignatureField({
  element,
  fieldLabel,
  applyStyles,
  defaultValue = null,
  editable = false,
  elementProps = {},
  onEnd = () => {},
  onClear = () => {},
  children
}) {
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
        pointerEvents: editable ? 'none' : 'auto'
      }}
      {...elementProps}
    >
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
          ref={(ref) => {
            signatureRef.current = ref;
          }}
          onEnd={() => {
            const base64Img = signatureRef.current.toDataURL('image/png');
            const newFile = dataURLToFile(base64Img, `${servar.key}.png`);
            onEnd(newFile);
            setIsClearVisible(!signatureRef.current.isEmpty());
          }}
        />
      </div>
      {children}
    </div>
  );
}

export default SignatureField;
