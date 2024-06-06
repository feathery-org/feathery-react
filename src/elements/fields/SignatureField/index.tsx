import React, { useEffect, useState } from 'react';
import SignatureCanvas from './components/SignatureCanvas';
import SignatureModal from './components/SignatureModal';
import { FORM_Z_INDEX } from '../../../utils/styles';

function SignatureField({
  element,
  fieldLabel,
  responsiveStyles,
  defaultValue = null,
  editMode,
  elementProps = {},
  disabled = false,
  onEnd = () => {},
  onClear = () => {},
  ReactPortal = null, // This is allowing the ability to pass a portal for the modal
  children
}: any) {
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const Portal = ReactPortal ?? (({ children }: any) => <>{children}</>);
  const servar = element.servar ?? {};
  const fieldKey = servar.key ?? element.key;

  useEffect(() => {
    if (!global.webfontloaderPromise)
      global.webfontloaderPromise = import('webfontloader');
    global.webfontloaderPromise.then((WebFont: any) => {
      WebFont.load({ google: { families: ['La Belle Aurore'] } });
    });
  }, []);

  return (
    <>
      <Portal>
        <SignatureModal
          show={showSignatureModal}
          setShow={setShowSignatureModal}
          defaultValue={defaultValue}
          fieldKey={fieldKey}
          responsiveStyles={responsiveStyles}
          onClear={onClear}
          onEnd={onEnd}
          signMethods={servar.metadata?.sign_methods ?? ''}
        />
      </Portal>
      <div
        css={{
          maxWidth: '100%',
          width: '100%',
          height: '100%',
          ...responsiveStyles.getTarget('fc'),
          position: 'relative',
          pointerEvents: editMode || disabled ? 'none' : 'auto'
        }}
        {...elementProps}
      >
        {children}
        {fieldLabel}
        <div
          css={{
            position: 'relative',
            ...responsiveStyles.getTarget('sub-fc')
          }}
        >
          <div
            onClick={() => {
              if (!disabled) setShowSignatureModal(true);
            }}
            css={{
              position: 'absolute',
              display: 'flex',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              zIndex: FORM_Z_INDEX,
              alignItems: 'center',
              justifyContent: 'center',
              ...(disabled ? { backgroundColor: 'rgb(229, 229, 229)' } : {}),
              '&:hover': {
                cursor: 'pointer'
              }
            }}
          >
            {!defaultValue && !disabled && <>Sign here</>}
          </div>
          <SignatureCanvas
            fieldKey={fieldKey}
            responsiveStyles={responsiveStyles}
            defaultValue={defaultValue}
            disabled={disabled}
            showClear={false}
          />
          {/* This input must always be rendered so we can set field errors */}
          <input
            id={servar.key}
            aria-label={element.properties.aria_label}
            // Set to file type so keyboard doesn't pop up on mobile
            // when field error appears
            type='file'
            style={{
              position: 'absolute',
              opacity: 0,
              bottom: 0,
              left: '50%',
              width: '1px',
              height: '1px',
              zIndex: FORM_Z_INDEX - 2
            }}
          />
        </div>
      </div>
    </>
  );
}

export default SignatureField;
