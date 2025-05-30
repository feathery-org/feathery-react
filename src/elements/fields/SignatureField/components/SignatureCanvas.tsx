import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react';
import { toBase64 } from '../../../../utils/image';
import Signature from 'react-signature-canvas';
import { fromDataURL } from './utils';
import { SignatureTranslations } from '../translation';

export type SignatureCanvasProps = {
  fieldKey?: string;
  responsiveStyles: any;
  defaultValue?: any;
  disabled?: boolean;
  repeatIndex: any;
  onClear?: () => void;
  onEnd?: () => void;
  showClear?: boolean;
  translation: SignatureTranslations;
};

export type SignatureCanvasRefType = {
  clear: () => void;
  isEmpty: () => boolean;
  getTrimmedCanvas: () => HTMLCanvasElement;
  getCanvas: () => HTMLCanvasElement;
  fromDataURL: (dataURL: string, options: any) => void;
};

const SignatureCanvas = forwardRef<
  SignatureCanvasRefType,
  SignatureCanvasProps
>((props, ref) => {
  const {
    fieldKey,
    repeatIndex,
    responsiveStyles,
    defaultValue = null,
    disabled = false,
    showClear = true,
    onClear = () => {},
    onEnd = () => {},
    translation: t
  } = props;

  const [isClearVisible, setIsClearVisible] = useState(defaultValue !== null);
  const signatureRef = useRef<any>(undefined);
  const signatureCanvasStyles = responsiveStyles.getTarget('field', true);

  useImperativeHandle(ref, () => ({
    clear: () => {
      signatureRef.current?.clear();
    },
    isEmpty: () => {
      return signatureRef.current?.isEmpty();
    },
    getTrimmedCanvas: () => {
      return signatureRef.current?.getTrimmedCanvas();
    },
    getCanvas: () => {
      return signatureRef.current?.getCanvas();
    },
    fromDataURL: (dataURL: string, options: any) => {
      return signatureRef.current?.fromDataURL(dataURL, options);
    }
  }));

  useEffect(() => {
    async function setSignatureCanvas() {
      const sig = signatureRef.current?.getCanvas();

      if (defaultValue === null) {
        sig.getContext('2d').clearRect(0, 0, sig.width, sig.height);
        return;
      }

      const signatureFile = await defaultValue;
      const base64 = signatureFile ? await toBase64(signatureFile) : '';

      const img = new Image();
      img.onload = () => {
        if (!sig) return;

        const hRatio = sig.offsetWidth / img.width;
        const vRatio = sig.offsetHeight / img.height;
        const ratio = Math.min(hRatio, vRatio, 1.5);
        const imgWidth = img.width * ratio;
        const imgHeight = img.height * ratio;

        // position signature in bottom left corner
        const xOffset = 0;
        const yOffset = sig.offsetHeight - imgHeight;

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
          {t.clear}
        </div>
      )}
      <Signature
        penColor='black'
        dotSize={4}
        minWidth={1.5}
        maxWidth={3}
        clearOnResize={false}
        canvasProps={{
          id: fieldKey + repeatIndex,
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
          onEnd();
          setIsClearVisible(!signatureRef.current.isEmpty());
        }}
      />
    </>
  );
});

export default SignatureCanvas;
