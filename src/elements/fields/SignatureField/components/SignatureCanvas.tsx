import React, { useEffect, useRef, useState } from 'react';
import { dataURLToFile, toBase64 } from '../../../../utils/image';
// @ts-expect-error TS(7016): Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Signature from 'react-signature-canvas';
import { fromDataURL } from './utils';

export type SignatureCanvasProps = {
  fieldKey?: string;
  responsiveStyles: any;
  defaultValue?: any;
  disabled?: boolean;
  onClear?: () => void;
  onEnd?: (file: any) => void;
  showClear?: boolean;
};

function SignatureCanvas(props: SignatureCanvasProps) {
  const {
    fieldKey,
    responsiveStyles,
    defaultValue = null,
    disabled = false,
    showClear = true,
    onClear = () => {},
    onEnd = () => {}
  } = props;

  const [isClearVisible, setIsClearVisible] = useState(defaultValue !== null);
  const signatureRef = useRef<any>();
  const signatureCanvasStyles = responsiveStyles.getTarget('field', true);

  useEffect(() => {
    async function setSignatureCanvas() {
      const sig = signatureRef.current?.getCanvas();

      if (defaultValue === null) {
        sig.getContext('2d').clearRect(0, 0, sig.width, sig.height);
        return;
      }

      const signatureFile = await defaultValue;
      const base64 = await toBase64(signatureFile);

      const img = new Image();
      img.onload = () => {
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
        sig.getContext('2d').clearRect(0, 0, sig.width, sig.height);

        // custom implementation of fromDataURL to support xOffset and yOffset
        // since they are not supported by signature-pad v2.3.2
        // previously: signatureRef.current.fromDataURL(base64, options);
        fromDataURL(sig, base64, {
          width: imgWidth,
          height: imgHeight,
          xOffset,
          yOffset
        });
      };
      img.src = base64;
    }
    setSignatureCanvas();
  }, [defaultValue]);

  return (
    <>
      {showClear && isClearVisible && (
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
            ...(disabled ? responsiveStyles.getTarget('disabled') : {}),
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
      <Signature
        penColor='black'
        clearOnResize={false}
        canvasProps={{
          id: fieldKey,
          style: {
            ...signatureCanvasStyles,
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            paddingLeft: '5px'
          }
        }}
        ref={signatureRef}
        onEnd={() => {
          const trimmedCanvas = signatureRef.current.getTrimmedCanvas();

          const imgData = trimmedCanvas.toDataURL('image/png');
          const imgFile = dataURLToFile(imgData, `${fieldKey}.png`);

          onEnd(imgFile);
          setIsClearVisible(!signatureRef.current.isEmpty());
        }}
      />
    </>
  );
}

export default SignatureCanvas;
