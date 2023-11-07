import React, { useState } from 'react';
import SignatureCanvas from './components/SignatureCanvas';
import SignatureModal from './components/SignatureModal';

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
  const fieldKey = element.servar?.key ?? element.key;

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
        />
      </Portal>
      <div
        css={{
          maxWidth: '100%',
          width: '100%',
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
              if (!disabled) {
                setShowSignatureModal(true);
              }
            }}
            css={{
              position: 'absolute',
              display: 'flex',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              zIndex: 1,
              alignItems: 'center',
              justifyContent: 'center',
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
        </div>
      </div>
    </>
  );
}

export default SignatureField;
