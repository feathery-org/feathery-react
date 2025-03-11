import React, { useEffect, useState } from 'react';
import SignatureCanvas from './components/SignatureCanvas';
import SignatureModal from './components/SignatureModal';
import { FORM_Z_INDEX } from '../../../utils/styles';
import { defaultTranslations, SignatureTranslations } from './translation';
import ErrorInput from '../../components/ErrorInput';

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

  const t = {
    ...defaultTranslations,
    ...(element.properties.translate as Partial<SignatureTranslations>)
  };

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
          translation={t}
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
            {!defaultValue && !disabled && t.label}
          </div>
          <SignatureCanvas
            fieldKey={fieldKey}
            responsiveStyles={responsiveStyles}
            defaultValue={defaultValue}
            disabled={disabled}
            showClear={false}
            translation={t}
          />
          {/* This input must always be rendered so we can set field errors */}
          <ErrorInput
            id={servar.key}
            aria-label={element.properties.aria_label}
          />
        </div>
      </div>
    </>
  );
}

export default SignatureField;
