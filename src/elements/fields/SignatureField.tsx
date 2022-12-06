import React, { useState, useRef, useEffect } from 'react';
// @ts-expect-error TS(7016): Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import SignatureCanvas from 'react-signature-canvas';
import { dataURLToFile, toBase64 } from '../../utils/image';

function SignatureField({
  element,
  fieldLabel,
  responsiveStyles,
  defaultValue = null,
  editMode,
  elementProps = {},
  onEnd = () => {},
  onClear = () => {},
  children
}: any) {
  const servar = element.servar;
  const signatureRef = useRef<any>();
  const [isClearVisible, setIsClearVisible] = useState(defaultValue !== null);
  const signatureCanvasStyles = responsiveStyles.getTarget('field', true);

  useEffect(() => {
    async function setSignatureCanvas() {
      if (defaultValue === null) return;
      const signatureFile = await defaultValue;
      const base64 = await toBase64(signatureFile);

      const img = new Image();
      img.onload = () => {
        const sig = signatureRef.current?.getCanvas();
        if (!sig) return;

        const hRatio = sig.offsetWidth / img.width;
        const vRatio = sig.offsetHeight / img.height;
        const ratio = Math.min(hRatio, vRatio, 1);
        const imgWidth = img.width * ratio;
        const imgHeight = img.height * ratio;
        const xOffset = (sig.offsetWidth - imgWidth) / 2;
        const yOffset = (sig.offsetHeight - imgHeight) / 2;
        // Preserve aspect ratio when loading signature
        // TODO: fix offsets. for some reason they're not being respected and
        //  are treated as 0, 0
        signatureRef.current.fromDataURL(base64, {
          width: imgWidth,
          height: imgHeight,
          xOffset,
          yOffset
        });
      };
      img.src = base64;
    }
    setSignatureCanvas();
  }, []);

  return (
    <div
      css={{
        ...responsiveStyles.getTarget('fc'),
        maxWidth: '100%',
        position: 'relative',
        pointerEvents: editMode ? 'none' : 'auto'
      }}
      {...elementProps}
    >
      {children}
      {fieldLabel}
      <div
        css={{ position: 'relative', ...responsiveStyles.getTarget('sub-fc') }}
      >
        {isClearVisible && (
          <div
            css={{
              background: '#ffffff',
              position: 'absolute',
              bottom: '5px',
              right: '5px',
              borderRadius: '6px',
              display: 'flex',
              cursor: 'pointer',
              color: 'rgb(173, 173, 173)',
              fontSize: '14px',
              transition: '0.15s ease-in-out all',
              '&:hover': { color: 'black' }
            }}
            onClick={() => {
              signatureRef.current.clear();
              onClear();
              setIsClearVisible(false);
            }}
          >
            clear
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
          ref={signatureRef}
          onEnd={() => {
            const base64Img = signatureRef.current.toDataURL('image/png');
            const newFile = dataURLToFile(base64Img, `${servar.key}.png`);
            onEnd(newFile);
            setIsClearVisible(!signatureRef.current.isEmpty());
          }}
        />
      </div>
    </div>
  );
}

export default SignatureField;
