import React, { useCallback, useRef, useState } from 'react';
import SignatureCanvas, { SignatureCanvasProps } from './SignatureCanvas';
import { CloseIcon } from '../../../components/icons';
import { dataURLToFile } from '../../../../utils/image';
import html2canvas from 'html2canvas';
import debounce from 'lodash.debounce';

type SignatureModalProps = SignatureCanvasProps & {
  show: boolean;
  setShow: (val: boolean) => void;
  returnFile?: boolean;
  signMethods: '' | 'draw' | 'type';
};

function SignatureModal(props: SignatureModalProps) {
  const {
    show = false,
    setShow = () => {},
    fieldKey,
    defaultValue,
    responsiveStyles,
    onClear = () => {},
    onEnd = () => {},
    signMethods = ''
  } = props;

  const typeOnly = signMethods === 'type';
  const drawOnly = signMethods === 'draw';
  const [drawSignature, setDrawSignature] = useState(drawOnly);
  const [fullName, setFullName] = useState('');
  const [isLoading, setLoading] = useState(false);
  const [signatureFile, setSignatureFile] = useState<File>();
  const [signatureImgData, setSignatureImgData] = useState('');
  const previewRef = useRef<HTMLDivElement>(null);

  const resetState = () => {
    setSignatureFile(undefined);
    setSignatureImgData('');
    setFullName('');
    setDrawSignature(false);
  };

  const generateSignature = () => {
    if (previewRef.current) {
      html2canvas(previewRef.current, { backgroundColor: null }).then(
        (canvas) => {
          const imgData = canvas.toDataURL('image/png');
          const imgFile = dataURLToFile(imgData, `${fieldKey}.png`);

          setSignatureImgData(imgData);
          setSignatureFile(imgFile);
          setLoading(false);
        }
      );
    } else {
      setLoading(false);
    }
  };

  const debounceGenerateSignature = useCallback(
    debounce(generateSignature, 1000),
    []
  );

  const handleCancel = () => {
    setShow(false);
    resetState();
  };

  const handleSubmit = () => {
    onEnd(signatureFile);
    setShow(false);
    resetState();
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
        zIndex: 1000,
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
          <h3 css={{ padding: 0, margin: 0, flex: '1' }}>Add your signature</h3>
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
          {!drawSignature && (
            <>
              <div
                css={{
                  display: 'flex',
                  gap: '15px',
                  flexDirection: 'column',
                  paddingBottom: '30px'
                }}
              >
                <h3>Type your signature</h3>
                <input
                  onChange={(e) => {
                    setFullName(e.target.value);
                    setLoading(true);
                    debounceGenerateSignature();
                  }}
                  placeholder='Your full name'
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
                    fontFamily: 'cursive'
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
                      Generating signature...
                    </div>
                  )}
                  <div
                    css={{
                      position: 'fixed',
                      top: '-1500px',
                      left: 0
                    }}
                  >
                    <div
                      ref={previewRef}
                      css={{
                        fontSize: '1.5em',
                        fontFamily: 'cursive',
                        color: '#000'
                      }}
                      className='previewText'
                    >
                      {fullName}
                    </div>
                  </div>
                  {!signatureImgData ? (
                    'Full Name'
                  ) : (
                    <img
                      src={signatureImgData}
                      alt='Signature Image'
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
                      or
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
                      <h3>Draw your signature</h3>
                      <p>
                        Draw your signature here using your mouse or trackpad.
                      </p>
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
                Draw your signature in the box below.
              </p>
              <div
                css={{ position: 'relative', width: '100%', height: '200px' }}
              >
                <SignatureCanvas
                  fieldKey={fieldKey}
                  responsiveStyles={responsiveStyles}
                  onClear={onClear}
                  onEnd={(file) => setSignatureFile(file)}
                  showClear={false}
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
              Cancel
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.preventDefault();
                setDrawSignature(false);
              }}
              css={{ '&:hover': { backgroundColor: '#e1e1e1' } }}
            >
              Back
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
                Clear
              </button>
            )}
            <button
              onClick={() => {
                if (!isLoading) {
                  handleSubmit();
                }
              }}
              disabled={isLoading}
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
              Sign
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SignatureModal;
