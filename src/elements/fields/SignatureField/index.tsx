import React, { Suspense, useEffect, useState } from 'react';
import SignatureCanvas from './components/SignatureCanvas';
import SignatureModal from './components/SignatureModal';
import { FORM_Z_INDEX } from '../../../utils/styles';
import { defaultTranslations, SignatureTranslations } from './translation';
import ErrorInput from '../../components/ErrorInput';

function SignatureField({
  element,
  responsiveStyles,
  defaultValue = null,
  editMode,
  repeatIndex,
  elementProps = {},
  disabled = false,
  onEnd = () => {},
  onClear = () => {},
  onSignAll,
  ReactPortal = null, // This is allowing the ability to pass a portal for the modal
  children
}: any) {
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const Portal = ReactPortal ?? (({ children }: any) => <>{children}</>);
  const servar = element.servar ?? {};
  const fieldKey = servar.key ?? element.key;
  const isInitials = servar.metadata?.sign_type === 'initials';

  const t = {
    ...defaultTranslations,
    ...(element.properties.translate as Partial<SignatureTranslations>)
  };

  useEffect(() => {
    // globalThis, not `global`. `global` only exists in Node - browsers never
    // had it. Vite/webpack fake it for us by injecting `global` as an alias
    // for `globalThis`, so it works there by accident. The thumbnail
    // renderer's esbuild bundle skips that step, so `global` is just
    // undefined and the thumbnail comes back blank. globalThis is the real,
    // always-available name, so use that instead of relying on the alias.
    if (!globalThis.webfontloaderPromise)
      globalThis.webfontloaderPromise = import(
        /* webpackChunkName: "webfontloader" */ 'webfontloader'
      );
    globalThis.webfontloaderPromise.then((WebFont: any) => {
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
          repeatIndex={repeatIndex}
          responsiveStyles={responsiveStyles}
          onClear={onClear}
          onEnd={onEnd}
          signMethods={servar.metadata?.sign_methods ?? ''}
          isInitials={isInitials}
          onSignAll={onSignAll}
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
        <div
          css={{
            position: 'relative',
            ...responsiveStyles.getTarget('sub-fc')
          }}
        >
          <Suspense
            fallback={
              <div
                css={{
                  ...responsiveStyles.getTarget('field', true),
                  width: '100%',
                  height: '100%',
                  boxSizing: 'border-box',
                  paddingLeft: '5px'
                }}
              />
            }
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
              {!defaultValue &&
                !disabled &&
                (servar.name || (isInitials ? t.initials_label : t.label))}
            </div>
            <SignatureCanvas
              fieldKey={fieldKey}
              repeatIndex={repeatIndex}
              responsiveStyles={responsiveStyles}
              defaultValue={defaultValue}
              disabled={disabled}
              showClear={false}
              translation={t}
            />
          </Suspense>
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
