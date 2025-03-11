import React, { useEffect, useState } from 'react';
import SignatureCanvas from './components/SignatureCanvas';
import SignatureModal from './components/SignatureModal';
import { FORM_Z_INDEX } from '../../../utils/styles';
import { defaultTranslations, SignatureTranslations } from './translation';

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
          <input
            id={servar.key}
            aria-label={element.properties.aria_label}
            // Properties to disable all focus/input but still allow displaying errors
            // type="text", file inputs open a file picker on focus, instead we just use a text input
            // inputMode="none" this prevents the virtual keyboard from displaying on mobile devices caused by using text input
            // tabIndex={-1} prevents the user from accessing the field using the keyboard
            // pointerEvents: 'none' prevents clicking on the element, in the case they somehow are able to click it
            // onFocus and onClick are cancelled for a similar reason
            type='text'
            inputMode='none'
            onFocus={(e) => e.preventDefault()}
            onClick={(e) => e.preventDefault()}
            tabIndex={-1}
            style={{
              pointerEvents: 'none',
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
