import React, { memo } from 'react';
import Status from './Status';
import { useCustomComponentIframe } from './useCustomComponentIframe';

const CustomField = ({
  element,
  responsiveStyles,
  elementProps = {},
  editMode,
  onChange,
  rawValue
}: any) => {
  const componentCode = element.servar.metadata.code;
  const isCodeEmpty = !componentCode || componentCode.trim() === '';
  const showPlaceholder = isCodeEmpty && editMode;

  const { iframeRef, error, loading } = useCustomComponentIframe({
    componentCode: element.servar.metadata.code,
    elementId: element.id,
    value: rawValue,
    onChange
  });

  return (
    <div
      style={{
        maxWidth: '100%',
        width: '100%',
        height: 'auto',
        position: 'relative',
        pointerEvents: editMode ? 'none' : 'auto',
        ...responsiveStyles?.getTarget('fc')
      }}
      {...elementProps}
    >
      {showPlaceholder ? (
        <Status.Placeholder />
      ) : (
        <>
          {error && <Status.Error error={error} />}
          {loading && <Status.Loading />}

          <iframe
            ref={iframeRef}
            sandbox='allow-scripts allow-same-origin'
            style={{
              width: '100%',
              border: 'none',
              backgroundColor: 'transparent',
              overflow: 'hidden',
              display: 'block'
            }}
          />
        </>
      )}
    </div>
  );
};

export default memo(CustomField);
