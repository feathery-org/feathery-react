import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CloseIcon } from '../../../components/icons';
import { dataURLToFile } from '../../../../utils/image';
import { MODAL_Z_INDEX } from '../../../../utils/styles';
import SignatureCanvas, { SignatureCanvasProps } from './SignatureCanvas';
import debounce from 'lodash.debounce';
import { cloneCanvas, generateSignatureImage, trimCanvas } from './utils';
import { SignatureTranslations } from '../translation';

const SIGNER_NAME_KEY = 'feathery-signer-name';

type SignatureModalProps = SignatureCanvasProps & {
  show: boolean;
  setShow: (val: boolean) => void;
  returnFile?: boolean;
  signMethods: '' | 'draw' | 'type';
  translation: SignatureTranslations;
  onEnd: (file: File) => void;
};

function SignatureModal(props: SignatureModalProps) {
  const {
    show = false,
    setShow = () => {},
    fieldKey,
    repeatIndex,
    defaultValue,
    responsiveStyles,
    onClear = () => {},
    onEnd = () => {},
    signMethods = '',
    translation: t
  } = props;

  const typeOnly = signMethods === 'type';
  const drawOnly = signMethods === 'draw';
  const [drawSignature, setDrawSignature] = useState(drawOnly);
  const [fullName, setFullName] = useState('');
  const [isLoading, setLoading] = useState(false);
  const [signatureFile, setSignatureFile] = useState<File>();
  const [signatureImgData, setSignatureImgData] = useState('');
  const fullNameRef = useRef<string>(fullName);
  const signatureCanvasRef = useRef<any>(null);

  const getSignerNameFromSessionStorage = (): string => {
    const signerName = sessionStorage.getItem(SIGNER_NAME_KEY);
    return signerName || '';
  };

  useEffect(() => {
    if (show) {
      const storedName = getSignerNameFromSessionStorage();
      setFullName(storedName);
    }
  }, [show]);

  useEffect(() => {
    fullNameRef.current = fullName;
    if (fullName !== '') {
      setLoading(true);
      debounceGenerateSignature();
    } else {
      setSignatureImgData('');
      setSignatureFile(undefined);
      setLoading(false);
    }
  }, [fullName]);
  const getFullName = () => fullNameRef.current;

  const resetState = () => {
    setSignatureFile(undefined);
    setSignatureImgData('');
    setFullName('');

    if (!drawOnly) {
      setDrawSignature(false);
    }
  };

  const generateDrawnSignature = () => {
    try {
      const canvas = cloneCanvas(signatureCanvasRef.current.getCanvas());
      if (!canvas) {
        throw new Error('Could not find signature canvas');
      }
      const trimmedCanvas = trimCanvas(canvas);
      const imgData = trimmedCanvas.toDataURL('image/png', 1.0);
      const imgFile = dataURLToFile(imgData, `${fieldKey}.png`);

      setSignatureImgData(imgData);
      setSignatureFile(imgFile);
    } catch (error) {
      console.error('Error generating signature:', error);
    }
  };

  const generateTextSignature = () => {
    const _fullName = getFullName();

    if (!_fullName) {
      setSignatureImgData('');
      setSignatureFile(undefined);
      setLoading(false);
      return;
    }

    try {
      const canvas = generateSignatureImage(_fullName);
      if (!canvas) {
        throw new Error('Could not find signature canvas');
      }
      const trimmedCanvas = trimCanvas(canvas);
      const imgData = trimmedCanvas.toDataURL('image/png', 1.0);
      const imgFile = dataURLToFile(imgData, `${fieldKey}.png`);

      setSignatureImgData(imgData);
      setSignatureFile(imgFile);
      setLoading(false);
    } catch (error) {
      console.error('Error generating signature:', error);
      setLoading(false);
    }
  };

  const debounceGenerateSignature = useCallback(
    debounce(generateTextSignature, 1000),
    []
  );

  const handleCancel = () => {
    setShow(false);
    resetState();
  };

  const handleSubmit = () => {
    if (signatureFile) {
      onEnd(signatureFile);
      sessionStorage.setItem(SIGNER_NAME_KEY, fullName);
      setShow(false);
      resetState();
    }
  };

  if (!show) {
    return null;
  }

  return (
    <div
      css={{
        position: 'fixed',
        display: 'flex',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: 'rgba(0, 0, 0, 0.2)',
        zIndex: MODAL_Z_INDEX,
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '16px',
        fontFamily:
          responsiveStyles?.getTarget('fc')?.fontFamily ?? 'sans-serif'
      }}
    >
      <div
        onClick={() => handleCancel()}
        css={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%'
        }}
      />
      <div
        className='feathery-modal'
        css={{
          position: 'relative',
          backgroundColor: '#fff',
          borderRadius: '14px',
          width: '100%',
          maxWidth: '600px'
        }}
      >
        <div
          css={{
            position: 'relative',
            display: 'flex',
            padding: '20px',
            borderBottom: '1px solid #e9e9e9'
          }}
        >
          <h3 css={{ padding: 0, margin: 0, flex: '1' }}>{t.title}</h3>
          <CloseIcon
            onClick={() => handleCancel()}
            css={{ '&:hover': { cursor: 'pointer' } }}
          />
        </div>
        <div
          css={{
            position: 'relative',
            padding: '20px 20px 30px 20px',
            '& h3': {
              fontSize: '1em',
              margin: 0,
              padding: 0
            }
          }}
        >
          {!drawSignature && !drawOnly && (
            <>
              <div
                css={{
                  display: 'flex',
                  gap: '15px',
                  flexDirection: 'column',
                  paddingBottom: '30px'
                }}
              >
                <h3>{t.type_option}</h3>
                <input
                  defaultValue={getSignerNameFromSessionStorage()}
                  onChange={(e) => {
                    const val = e.target.value.trim();
                    setFullName(val);
                  }}
                  placeholder={t.type_placeholder}
                  css={{
                    padding: '8px 10px',
                    borderRadius: '4px',
                    border: '1px solid #e9e9e9',
                    '&:focus,&:focus-visible': {
                      border: '1px solid #5e5e5e',
                      outline: 'none'
                    }
                  }}
                />
                <div
                  css={{
                    position: 'relative',
                    width: '100%',
                    height: '100px',
                    backgroundColor: '#f6f6f6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '2em',
                    fontFamily: 'La Belle Aurore'
                  }}
                >
                  {isLoading && (
                    <div
                      css={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        backgroundColor: '#f6f6f6',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: 'sans-serif',
                        fontSize: '.9rem',
                        borderRadius: '4px'
                      }}
                    >
                      {t.type_loading}
                    </div>
                  )}
                  {!signatureImgData ? (
                    t.type_example
                  ) : (
                    <img
                      src={signatureImgData}
                      alt='Signature'
                      css={{ maxHeight: '100%', maxWidth: '100%' }}
                    />
                  )}
                </div>
              </div>
              {!typeOnly && (
                <>
                  <div
                    css={{
                      height: '1px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderBottom: '1px solid #e9e9e9'
                    }}
                  >
                    <div
                      css={{
                        backgroundColor: '#fff',
                        padding: '10px',
                        color: '#5e5e5e'
                      }}
                    >
                      {t.or_label}
                    </div>
                  </div>
                  <div
                    css={{
                      paddingTop: '30px'
                    }}
                  >
                    <div
                      onClick={() => setDrawSignature(true)}
                      css={{
                        padding: '20px',
                        borderRadius: '4px',
                        border: '1px solid #e9e9e9',
                        '& h3': {
                          padding: 0,
                          margin: 0,
                          marginBottom: '10px'
                        },
                        '& p': {
                          margin: 0,
                          padding: 0
                        },
                        '&:hover': {
                          border: '1px solid #5e5e5e',
                          cursor: 'pointer'
                        }
                      }}
                    >
                      <h3>{t.draw_option}</h3>
                      <p>{t.draw_subtitle}</p>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
          {drawSignature && (
            <div
              css={{
                display: 'flex',
                flexDirection: 'column',
                gap: '15px'
              }}
            >
              <p
                css={{
                  margin: 0,
                  padding: 0
                }}
              >
                {t.draw_instructions}
              </p>
              <div
                css={{ position: 'relative', width: '100%', height: '200px' }}
              >
                <SignatureCanvas
                  ref={signatureCanvasRef}
                  fieldKey={fieldKey}
                  repeatIndex={repeatIndex}
                  responsiveStyles={responsiveStyles}
                  onClear={onClear}
                  onEnd={generateDrawnSignature}
                  showClear={false}
                  translation={t}
                />
              </div>
            </div>
          )}
        </div>
        <div
          css={{
            position: 'relative',
            display: 'flex',
            padding: '20px 20px',
            borderTop: '1px solid #e9e9e9',
            justifyContent: 'space-between',
            '& button': {
              padding: '12px 0px',
              width: '120px',
              borderRadius: '4px',
              outline: 'none',
              border: 'none',
              fontSize: '1rem',
              transition: 'background-color ease-in-out 0.1s',
              '&:hover': {
                cursor: 'pointer'
              }
            }
          }}
        >
          {drawOnly || !drawSignature ? (
            <button
              onClick={() => handleCancel()}
              css={{ '&:hover': { backgroundColor: '#e1e1e1' } }}
            >
              {t.cancel}
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.preventDefault();
                setDrawSignature(false);
                setSignatureFile(undefined);
              }}
              css={{ '&:hover': { backgroundColor: '#e1e1e1' } }}
            >
              {t.back}
            </button>
          )}
          <div>
            {defaultValue && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  onClear();
                }}
                css={{
                  marginRight: '10px',
                  '&:hover': { backgroundColor: '#e1e1e1' }
                }}
              >
                {t.clear}
              </button>
            )}
            <button
              onClick={() => {
                if (!isLoading) handleSubmit();
              }}
              disabled={isLoading || !signatureFile}
              css={{
                backgroundColor: '#535353',
                color: '#fff',
                '&:hover': {
                  backgroundColor: '#3a3a3a'
                },
                '&:disabled': {
                  '&:hover': {
                    cursor: 'not-allowed'
                  }
                }
              }}
            >
              {t.confirm}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SignatureModal;
